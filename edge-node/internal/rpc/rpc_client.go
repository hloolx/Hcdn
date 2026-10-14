package rpc

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/TeaOSLab/EdgeNode/internal/configs"
	teaconst "github.com/TeaOSLab/EdgeNode/internal/const"
	"github.com/TeaOSLab/EdgeNode/internal/utils"
	"github.com/TeaOSLab/EdgeNode/internal/utils/encrypt"
	"github.com/TeaOSLab/EdgeNode/internal/utils/rpcutils"
	"github.com/iwind/TeaGo/maps"
	"github.com/iwind/TeaGo/rands"
	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/encoding/gzip"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/metadata"
	"net/url"
	"os"
	"sync"
	"time"
)

type RPCClient struct {
	apiConfig *configs.APIConfig
	conns     []*grpc.ClientConn

	locker sync.RWMutex

	NodeRPC                pb.NodeServiceClient
	NodeLogRPC             pb.NodeLogServiceClient
	NodeTaskRPC            pb.NodeTaskServiceClient
	NodeValueRPC           pb.NodeValueServiceClient
	HTTPAccessLogRPC       pb.HTTPAccessLogServiceClient
	HTTPCacheTaskKeyRPC    pb.HTTPCacheTaskKeyServiceClient
	APINodeRPC             pb.APINodeServiceClient
	IPLibraryArtifactRPC   pb.IPLibraryArtifactServiceClient
	IPListRPC              pb.IPListServiceClient
	IPItemRPC              pb.IPItemServiceClient
	FileRPC                pb.FileServiceClient
	FileChunkRPC           pb.FileChunkServiceClient
	ACMEAuthenticationRPC  pb.ACMEAuthenticationServiceClient
	ServerRPC              pb.ServerServiceClient
	ServerDailyStatRPC     pb.ServerDailyStatServiceClient
	ServerBandwidthStatRPC pb.ServerBandwidthStatServiceClient
	MetricStatRPC          pb.MetricStatServiceClient
	FirewallRPC            pb.FirewallServiceClient
	SSLCertRPC             pb.SSLCertServiceClient
	ScriptRPC              pb.ScriptServiceClient
	UserRPC                pb.UserServiceClient
	ClientAgentIPRPC       pb.ClientAgentIPServiceClient
	AuthorityKeyRPC        pb.AuthorityKeyServiceClient
	UpdatingServerListRPC  pb.UpdatingServerListServiceClient
	PlanRPC                pb.PlanServiceClient
}

func NewRPCClient(apiConfig *configs.APIConfig) (*RPCClient, error) {
	if apiConfig == nil {
		return nil, errors.New("api config should not be nil")
	}

	var client = &RPCClient{
		apiConfig: apiConfig,
	}

	// 初始化RPC实例
	client.NodeRPC = pb.NewNodeServiceClient(client)
	client.NodeLogRPC = pb.NewNodeLogServiceClient(client)
	client.NodeTaskRPC = pb.NewNodeTaskServiceClient(client)
	client.NodeValueRPC = pb.NewNodeValueServiceClient(client)
	client.HTTPAccessLogRPC = pb.NewHTTPAccessLogServiceClient(client)
	client.HTTPCacheTaskKeyRPC = pb.NewHTTPCacheTaskKeyServiceClient(client)
	client.APINodeRPC = pb.NewAPINodeServiceClient(client)
	client.IPLibraryArtifactRPC = pb.NewIPLibraryArtifactServiceClient(client)
	client.IPListRPC = pb.NewIPListServiceClient(client)
	client.IPItemRPC = pb.NewIPItemServiceClient(client)
	client.FileRPC = pb.NewFileServiceClient(client)
	client.FileChunkRPC = pb.NewFileChunkServiceClient(client)
	client.ACMEAuthenticationRPC = pb.NewACMEAuthenticationServiceClient(client)
	client.ServerRPC = pb.NewServerServiceClient(client)
	client.ServerDailyStatRPC = pb.NewServerDailyStatServiceClient(client)
	client.ServerBandwidthStatRPC = pb.NewServerBandwidthStatServiceClient(client)
	client.MetricStatRPC = pb.NewMetricStatServiceClient(client)
	client.FirewallRPC = pb.NewFirewallServiceClient(client)
	client.SSLCertRPC = pb.NewSSLCertServiceClient(client)
	client.ScriptRPC = pb.NewScriptServiceClient(client)
	client.UserRPC = pb.NewUserServiceClient(client)
	client.ClientAgentIPRPC = pb.NewClientAgentIPServiceClient(client)
	client.AuthorityKeyRPC = pb.NewAuthorityKeyServiceClient(client)
	client.UpdatingServerListRPC = pb.NewUpdatingServerListServiceClient(client)
	client.PlanRPC = pb.NewPlanServiceClient(client)

	err := client.init()
	if err != nil {
		return nil, err
	}

	return client, nil
}

// Context 节点上下文信息
func (this *RPCClient) Context() context.Context {
	var m = maps.Map{
		"timestamp": time.Now().Unix(),
		"type":      "node",
		"userId":    0,
	}
	method, err := encrypt.NewMethodInstance(teaconst.EncryptMethod, this.apiConfig.Secret, this.apiConfig.NodeId)
	if err != nil {
		utils.PrintError(err)
		return context.Background()
	}
	data, err := method.Encrypt(m.AsJSON())
	if err != nil {
		utils.PrintError(err)
		return context.Background()
	}
	var token = base64.StdEncoding.EncodeToString(data)

	var ctx = context.Background()
	ctx = metadata.AppendToOutgoingContext(ctx, "nodeId", this.apiConfig.NodeId, "token", token)
	return ctx
}

// ClusterContext 集群上下文
func (this *RPCClient) ClusterContext(clusterId string, clusterSecret string) context.Context {
	ctx := context.Background()
	m := maps.Map{
		"timestamp": time.Now().Unix(),
		"type":      "cluster",
		"userId":    0,
	}
	method, err := encrypt.NewMethodInstance(teaconst.EncryptMethod, clusterSecret, clusterId)
	if err != nil {
		utils.PrintError(err)
		return context.Background()
	}
	data, err := method.Encrypt(m.AsJSON())
	if err != nil {
		utils.PrintError(err)
		return context.Background()
	}
	token := base64.StdEncoding.EncodeToString(data)
	ctx = metadata.AppendToOutgoingContext(ctx, "nodeId", clusterId, "token", token)
	return ctx
}

// Close 关闭连接
func (this *RPCClient) Close() {
	this.locker.Lock()

	for _, conn := range this.conns {
		_ = conn.Close()
	}

	this.locker.Unlock()
}

// UpdateConfig 修改配置
func (this *RPCClient) UpdateConfig(config *configs.APIConfig) error {
	this.apiConfig = config

	this.locker.Lock()
	err := this.init()
	this.locker.Unlock()
	return err
}

// TestEndpoints 测试Endpoints是否可用
func (this *RPCClient) TestEndpoints(endpoints []string) bool {
	if len(endpoints) == 0 {
		return false
	}

	var wg = sync.WaitGroup{}
	wg.Add(len(endpoints))

	var ok = false

	for _, endpoint := range endpoints {
		go func(endpoint string) {
			defer wg.Done()

			credOption, host, err := this.transportCredentialOption(endpoint)
			if err != nil {
				return
			}

			ctx, cancelFunc := context.WithTimeout(context.Background(), 5*time.Second)
			defer func() {
				cancelFunc()
			}()

			conn, err := grpc.DialContext(ctx, host, credOption, grpc.WithBlock())
			if err != nil {
				return
			}
			if conn == nil {
				return
			}
			defer func() {
				_ = conn.Close()
			}()

			var pingService = pb.NewPingServiceClient(conn)
			_, err = pingService.Ping(this.Context(), &pb.PingRequest{})
			if err != nil {
				return
			}

			ok = true
		}(endpoint)
	}
	wg.Wait()

	return ok
}

// 初始化
func (this *RPCClient) init() error {
	// 重新连接
	var conns = []*grpc.ClientConn{}
	for _, endpoint := range this.apiConfig.RPCEndpoints {
		credOption, host, err := this.transportCredentialOption(endpoint)
		if err != nil {
			return err
		}

		var callOptions = grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(512<<20),
			grpc.MaxCallSendMsgSize(512<<20),
			grpc.UseCompressor(gzip.Name),
		)
		var keepaliveParams = grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time: 30 * time.Second,
		})

		conn, err := grpc.Dial(host, credOption, callOptions, keepaliveParams)
		if err != nil {
			return err
		}
		conns = append(conns, conn)
	}
	if len(conns) == 0 {
		return errors.New("[RPC]no available endpoints")
	}

	// 这里不需要加锁，防止和pickConn()冲突
	this.conns = conns
	return nil
}

// transportCredentialOption 解析单个endpoint（"scheme://host:port"），返回拨号时使用的
// grpc凭据选项，以及实际用于拨号的host:port。
//
// 安全说明（FIX-05）：
//   - endpoint必须先通过 rpcutils.ValidateEndpoint 校验：只允许 http/https 协议，且
//     明文 http 仅允许用于回环地址（127.0.0.0/8、::1、localhost），否则一律拒绝，防止
//     节点的认证令牌、以及服务端下发的敏感信息（例如服务证书私钥）以明文方式传输。
//   - https 连接永远不会设置 InsecureSkipVerify：默认使用系统根证书池校验服务端证书；
//     如果配置了 'rpc.caFile'，则只信任该PEM证书包中的CA（用于固定/双向信任我们自己
//     的私有CA），不再信任系统根证书池。
func (this *RPCClient) transportCredentialOption(endpoint string) (grpc.DialOption, string, error) {
	err := rpcutils.ValidateEndpoint(endpoint)
	if err != nil {
		return nil, "", err
	}

	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, "", fmt.Errorf("parse endpoint failed: %w", err)
	}

	if u.Scheme == "http" {
		return grpc.WithTransportCredentials(insecure.NewCredentials()), u.Host, nil
	}

	tlsConfig, err := buildTLSConfig(this.apiConfig)
	if err != nil {
		return nil, "", err
	}
	return grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)), u.Host, nil
}

// buildTLSConfig 根据api配置构造拨号API节点时使用的tls.Config，参见 transportCredentialOption
// 上的安全说明。
func buildTLSConfig(apiConfig *configs.APIConfig) (*tls.Config, error) {
	var tlsConfig = &tls.Config{}

	if len(apiConfig.RPCCAFile) > 0 {
		caData, err := os.ReadFile(apiConfig.RPCCAFile)
		if err != nil {
			return nil, fmt.Errorf("read 'rpc.caFile' failed: %w", err)
		}

		var pool = x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caData) {
			return nil, fmt.Errorf("'rpc.caFile' ('%s') does not contain a valid PEM certificate", apiConfig.RPCCAFile)
		}
		tlsConfig.RootCAs = pool
	}

	if len(apiConfig.RPCServerName) > 0 {
		tlsConfig.ServerName = apiConfig.RPCServerName
	}

	return tlsConfig, nil
}

// 随机选择一个连接
func (this *RPCClient) pickConn() *grpc.ClientConn {
	this.locker.Lock()
	defer this.locker.Unlock()

	// 检查连接状态
	var countConns = len(this.conns)
	if countConns > 0 {
		if countConns == 1 {
			return this.conns[0]
		}

		for _, stateArray := range [][2]connectivity.State{
			{connectivity.Ready, connectivity.Idle}, // 优先Ready和Idle
			{connectivity.Connecting, connectivity.Connecting},
			{connectivity.TransientFailure, connectivity.TransientFailure},
		} {
			var availableConns = []*grpc.ClientConn{}
			for _, conn := range this.conns {
				var state = conn.GetState()
				if state == stateArray[0] || state == stateArray[1] {
					availableConns = append(availableConns, conn)
				}
			}
			if len(availableConns) > 0 {
				return this.randConn(availableConns)
			}
		}
	}

	return this.randConn(this.conns)
}

func (this *RPCClient) Invoke(ctx context.Context, method string, args interface{}, reply interface{}, opts ...grpc.CallOption) error {
	var conn = this.pickConn()
	if conn == nil {
		return errors.New("could not get available grpc connection")
	}
	return conn.Invoke(ctx, method, args, reply, opts...)
}

func (this *RPCClient) NewStream(ctx context.Context, desc *grpc.StreamDesc, method string, opts ...grpc.CallOption) (grpc.ClientStream, error) {
	var conn = this.pickConn()
	if conn == nil {
		return nil, errors.New("could not get available grpc connection")
	}
	return conn.NewStream(ctx, desc, method, opts...)
}

func (this *RPCClient) randConn(conns []*grpc.ClientConn) *grpc.ClientConn {
	var l = len(conns)
	if l == 0 {
		return nil
	}
	if l == 1 {
		return conns[0]
	}
	return conns[rands.Int(0, l-1)]
}
