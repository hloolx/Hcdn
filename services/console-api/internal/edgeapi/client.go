// Package edgeapi talks to the GoEdge control plane (EdgeAPI) over gRPC.
package edgeapi

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sync/atomic"
	"time"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/metadata"
)

// Role values understood by EdgeAPI's rpcutils.ValidateRequest.
const (
	RoleUser  = "user"
	RoleAdmin = "admin"
)

// Credential is an EdgeAPI API token (edgeAPITokens.nodeId/secret).
type Credential struct {
	NodeID string `yaml:"nodeId" json:"nodeId"`
	Secret string `yaml:"secret" json:"secret"`
}

// Valid reports whether both halves are set.
func (c Credential) Valid() bool { return c.NodeID != "" && c.Secret != "" }

// Options configures the gRPC connection.
type Options struct {
	Endpoints  []string // e.g. "https://127.0.0.1:8003" or "http://127.0.0.1:8003"
	CAFile     string
	ServerName string
	User       Credential
	Admin      Credential
	Timeout    time.Duration
}

// Client holds the gRPC connections and the two credentials.
type Client struct {
	conns   []*grpc.ClientConn
	next    atomic.Uint32
	user    Credential
	admin   Credential
	timeout time.Duration
	now     func() time.Time
}

// ErrNotConfigured is returned when a credential is missing.
var ErrNotConfigured = errors.New("edgeapi: credential not configured")

// New creates the (lazily connecting) gRPC clients for all endpoints.
func New(opts Options) (*Client, error) {
	if len(opts.Endpoints) == 0 {
		return nil, errors.New("edgeAPI.endpoints is empty")
	}
	var tlsConf *tls.Config
	for _, ep := range opts.Endpoints {
		u, err := url.Parse(ep)
		if err != nil || u.Host == "" {
			return nil, fmt.Errorf("invalid EdgeAPI endpoint %q", ep)
		}
		if u.Scheme == "https" && tlsConf == nil {
			tlsConf = &tls.Config{MinVersion: tls.VersionTLS12, ServerName: opts.ServerName}
			if opts.CAFile != "" {
				pemData, err := os.ReadFile(opts.CAFile)
				if err != nil {
					return nil, fmt.Errorf("read edgeAPI.caFile: %w", err)
				}
				pool := x509.NewCertPool()
				if !pool.AppendCertsFromPEM(pemData) {
					return nil, errors.New("edgeAPI.caFile contains no certificates")
				}
				tlsConf.RootCAs = pool
			}
		}
	}
	c := &Client{user: opts.User, admin: opts.Admin, timeout: opts.Timeout, now: time.Now}
	if c.timeout <= 0 {
		c.timeout = 20 * time.Second
	}
	for _, ep := range opts.Endpoints {
		u, _ := url.Parse(ep)
		var creds credentials.TransportCredentials
		switch u.Scheme {
		case "http":
			creds = insecure.NewCredentials()
		case "https":
			creds = credentials.NewTLS(tlsConf)
		default:
			return nil, fmt.Errorf("invalid EdgeAPI endpoint scheme %q", u.Scheme)
		}
		conn, err := grpc.NewClient(u.Host,
			grpc.WithTransportCredentials(creds),
			grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(64<<20), grpc.MaxCallSendMsgSize(64<<20)),
			grpc.WithKeepaliveParams(keepalive.ClientParameters{Time: 30 * time.Second}),
		)
		if err != nil {
			return nil, err
		}
		c.conns = append(c.conns, conn)
	}
	return c, nil
}

// Close closes all connections.
func (c *Client) Close() {
	for _, conn := range c.conns {
		_ = conn.Close()
	}
}

func (c *Client) conn() *grpc.ClientConn {
	n := c.next.Add(1)
	return c.conns[int(n)%len(c.conns)]
}

// HasAdmin reports whether an admin credential is configured.
func (c *Client) HasAdmin() bool { return c.admin.Valid() }

// HasUser reports whether a user-node credential is configured.
func (c *Client) HasUser() bool { return c.user.Valid() }

// EncodeToken builds the EdgeAPI metadata token for a credential:
// base64(aes-256-cfb(JSON{"timestamp","type","userId"}, secret, nodeId)).
func EncodeToken(cred Credential, role string, id int64, now time.Time) (string, error) {
	payload, err := json.Marshal(map[string]any{
		"timestamp": now.Unix(),
		"type":      role,
		"userId":    id,
	})
	if err != nil {
		return "", err
	}
	m, err := newAES256CFB([]byte(cred.Secret), []byte(cred.NodeID))
	if err != nil {
		return "", err
	}
	data, err := m.Encrypt(payload)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// DecodeToken is the inverse of EncodeToken (used by tests).
func DecodeToken(cred Credential, token string) (map[string]any, error) {
	raw, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return nil, err
	}
	m, err := newAES256CFB([]byte(cred.Secret), []byte(cred.NodeID))
	if err != nil {
		return nil, err
	}
	plain, err := m.Decrypt(raw)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(plain, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Call is an authenticated context bound to one connection.
type Call struct {
	Ctx    context.Context
	cancel context.CancelFunc
	conn   *grpc.ClientConn
}

// Done releases the call context.
func (c *Call) Done() {
	if c.cancel != nil {
		c.cancel()
	}
}

func (c *Client) call(parent context.Context, cred Credential, role string, id int64) (*Call, error) {
	return c.callFor(parent, cred, role, id, c.timeout)
}

func (c *Client) callFor(parent context.Context, cred Credential, role string, id int64, timeout time.Duration) (*Call, error) {
	if !cred.Valid() {
		return nil, fmt.Errorf("%w (%s)", ErrNotConfigured, role)
	}
	token, err := EncodeToken(cred, role, id, c.now())
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	ctx = metadata.AppendToOutgoingContext(ctx, "nodeId", cred.NodeID, "token", token)
	return &Call{Ctx: ctx, cancel: cancel, conn: c.conn()}, nil
}

// AsUser returns a caller authenticated as customer userId (type "user").
// userId must be > 0: EdgeAPI skips every ownership check for userId 0.
func (c *Client) AsUser(parent context.Context, userID int64) (*Call, error) {
	if userID <= 0 {
		return nil, errors.New("edgeapi: AsUser requires a user id")
	}
	return c.call(parent, c.user, RoleUser, userID)
}

// AsUserFor is AsUser with a custom deadline (long-running RPCs such as ACME).
// The token is checked once when the RPC starts (EdgeAPI's ±300 s window), so
// a long call duration is fine; issue only one RPC per such Call.
func (c *Client) AsUserFor(parent context.Context, userID int64, timeout time.Duration) (*Call, error) {
	if userID <= 0 {
		return nil, errors.New("edgeapi: AsUser requires a user id")
	}
	return c.callFor(parent, c.user, RoleUser, userID, timeout)
}

// AsUserNode returns an anonymous user-node caller (userId 0). Only for RPCs
// that do not act on a user's resources (LoginUser, CheckUserUsername, ...).
func (c *Client) AsUserNode(parent context.Context) (*Call, error) {
	return c.call(parent, c.user, RoleUser, 0)
}

// AsAdmin returns a caller authenticated as admin adminId (type "admin").
func (c *Client) AsAdmin(parent context.Context, adminID int64) (*Call, error) {
	return c.call(parent, c.admin, RoleAdmin, adminID)
}

// Service clients bound to the call's connection.

func (c *Call) User() pb.UserServiceClient             { return pb.NewUserServiceClient(c.conn) }
func (c *Call) Admin() pb.AdminServiceClient           { return pb.NewAdminServiceClient(c.conn) }
func (c *Call) Login() pb.LoginServiceClient           { return pb.NewLoginServiceClient(c.conn) }
func (c *Call) UserNode() pb.UserNodeServiceClient     { return pb.NewUserNodeServiceClient(c.conn) }
func (c *Call) Server() pb.ServerServiceClient         { return pb.NewServerServiceClient(c.conn) }
func (c *Call) Origin() pb.OriginServiceClient         { return pb.NewOriginServiceClient(c.conn) }
func (c *Call) HTTPWeb() pb.HTTPWebServiceClient       { return pb.NewHTTPWebServiceClient(c.conn) }
func (c *Call) SSLCert() pb.SSLCertServiceClient       { return pb.NewSSLCertServiceClient(c.conn) }
func (c *Call) SSLPolicy() pb.SSLPolicyServiceClient   { return pb.NewSSLPolicyServiceClient(c.conn) }
func (c *Call) IPList() pb.IPListServiceClient         { return pb.NewIPListServiceClient(c.conn) }
func (c *Call) IPItem() pb.IPItemServiceClient         { return pb.NewIPItemServiceClient(c.conn) }
func (c *Call) Log() pb.LogServiceClient               { return pb.NewLogServiceClient(c.conn) }
func (c *Call) Node() pb.NodeServiceClient             { return pb.NewNodeServiceClient(c.conn) }
func (c *Call) NodeValue() pb.NodeValueServiceClient   { return pb.NewNodeValueServiceClient(c.conn) }
func (c *Call) APINode() pb.APINodeServiceClient       { return pb.NewAPINodeServiceClient(c.conn) }
func (c *Call) ACMEUser() pb.ACMEUserServiceClient     { return pb.NewACMEUserServiceClient(c.conn) }
func (c *Call) ACMETask() pb.ACMETaskServiceClient     { return pb.NewACMETaskServiceClient(c.conn) }
func (c *Call) SysSetting() pb.SysSettingServiceClient { return pb.NewSysSettingServiceClient(c.conn) }
func (c *Call) NodeLog() pb.NodeLogServiceClient       { return pb.NewNodeLogServiceClient(c.conn) }
func (c *Call) DNSDomain() pb.DNSDomainServiceClient   { return pb.NewDNSDomainServiceClient(c.conn) }

func (c *Call) ReverseProxy() pb.ReverseProxyServiceClient {
	return pb.NewReverseProxyServiceClient(c.conn)
}
func (c *Call) FirewallPolicy() pb.HTTPFirewallPolicyServiceClient {
	return pb.NewHTTPFirewallPolicyServiceClient(c.conn)
}
func (c *Call) FirewallRuleGroup() pb.HTTPFirewallRuleGroupServiceClient {
	return pb.NewHTTPFirewallRuleGroupServiceClient(c.conn)
}
func (c *Call) FirewallRuleSet() pb.HTTPFirewallRuleSetServiceClient {
	return pb.NewHTTPFirewallRuleSetServiceClient(c.conn)
}
func (c *Call) RegionCountry() pb.RegionCountryServiceClient {
	return pb.NewRegionCountryServiceClient(c.conn)
}
func (c *Call) ServerDailyStat() pb.ServerDailyStatServiceClient {
	return pb.NewServerDailyStatServiceClient(c.conn)
}
func (c *Call) ServerBandwidthStat() pb.ServerBandwidthStatServiceClient {
	return pb.NewServerBandwidthStatServiceClient(c.conn)
}
func (c *Call) ServerStatBoard() pb.ServerStatBoardServiceClient {
	return pb.NewServerStatBoardServiceClient(c.conn)
}
func (c *Call) ServerRegionCountryStat() pb.ServerRegionCountryMonthlyStatServiceClient {
	return pb.NewServerRegionCountryMonthlyStatServiceClient(c.conn)
}
func (c *Call) AccessLog() pb.HTTPAccessLogServiceClient {
	return pb.NewHTTPAccessLogServiceClient(c.conn)
}
func (c *Call) CacheTask() pb.HTTPCacheTaskServiceClient {
	return pb.NewHTTPCacheTaskServiceClient(c.conn)
}
func (c *Call) AccessKey() pb.UserAccessKeyServiceClient {
	return pb.NewUserAccessKeyServiceClient(c.conn)
}
func (c *Call) NodeCluster() pb.NodeClusterServiceClient {
	return pb.NewNodeClusterServiceClient(c.conn)
}
func (c *Call) NodeIPAddress() pb.NodeIPAddressServiceClient {
	return pb.NewNodeIPAddressServiceClient(c.conn)
}
func (c *Call) DNSProvider() pb.DNSProviderServiceClient {
	return pb.NewDNSProviderServiceClient(c.conn)
}
