package rpc

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"github.com/TeaOSLab/EdgeAdmin/internal/configs"
	"net"
	"os"
	"strings"
)

// BuildTLSConfig 根据API配置构建用于校验API节点证书的TLS客户端配置。
// 默认使用系统根证书池；如果配置了rpc.caFile，则额外（仅）信任该CA文件中的证书。
// ServerName优先使用rpc.serverName配置，否则使用连接地址中的主机名。
func BuildTLSConfig(apiConfig *configs.APIConfig, host string) (*tls.Config, error) {
	var config = &tls.Config{
		ServerName: hostnameOf(host),
	}

	if apiConfig != nil {
		if len(apiConfig.RPCServerName) > 0 {
			config.ServerName = apiConfig.RPCServerName
		}

		if len(apiConfig.RPCCAFile) > 0 {
			caData, err := os.ReadFile(apiConfig.RPCCAFile)
			if err != nil {
				return nil, fmt.Errorf("read 'rpc.caFile' failed: %w", err)
			}

			var pool = x509.NewCertPool()
			if !pool.AppendCertsFromPEM(caData) {
				return nil, errors.New("invalid 'rpc.caFile': no certificates found in '" + apiConfig.RPCCAFile + "'")
			}
			config.RootCAs = pool
		}
	}

	return config, nil
}

// IsLoopbackHost 判断主机地址（可以带有端口）是否为回环地址。
// 只有回环地址才允许使用明文的'http://' RPC端点。
func IsLoopbackHost(host string) bool {
	var hostname = hostnameOf(host)
	if len(hostname) == 0 {
		return false
	}

	if strings.EqualFold(hostname, "localhost") {
		return true
	}

	var ip = net.ParseIP(hostname)
	if ip == nil {
		return false
	}

	return ip.IsLoopback()
}

// hostnameOf 从'host'或'host:port'中提取主机名部分（同时去掉IPv6字面量的方括号）
func hostnameOf(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return strings.Trim(host, "[]")
}
