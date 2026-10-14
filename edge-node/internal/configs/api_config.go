package configs

import (
	"errors"
	"github.com/TeaOSLab/EdgeNode/internal/utils/rpcutils"
	"github.com/iwind/TeaGo/Tea"
	"gopkg.in/yaml.v3"
	"os"
	"sync"
)

const ConfigFileName = "api_node.yaml"
const oldConfigFileName = "api.yaml"

type APIConfig struct {
	OldRPC struct {
		Endpoints     []string `yaml:"endpoints,omitempty" json:"endpoints"`
		DisableUpdate bool     `yaml:"disableUpdate,omitempty" json:"disableUpdate"`
	} `yaml:"rpc,omitempty" json:"rpc"`

	RPCEndpoints []string `yaml:"rpc.endpoints,flow" json:"rpc.endpoints"`

	// RPCDisableUpdate controls whether the node is allowed to automatically sync its
	// rpc.endpoints from the control plane's API-node list (see task_sync_api_nodes.go). It is a
	// *bool so a missing key can default to "disabled" while still honoring an explicit `false`.
	// Use the DisableUpdate() accessor rather than reading this field directly. See FIX-27.
	RPCDisableUpdate *bool `yaml:"rpc.disableUpdate,omitempty" json:"rpc.disableUpdate,omitempty"`

	// RPCAllowedEndpoints lists additional endpoints (beyond rpc.endpoints above) that this node
	// is allowed to adopt if the control plane later supplies them via node config
	// (apiNodeAddrs) or the API-node sync task. Endpoints not in rpc.endpoints or this list are
	// ignored -- the control plane cannot redirect a node's control connection to an arbitrary
	// host just by naming it. See FIX-27.
	RPCAllowedEndpoints []string `yaml:"rpc.allowedEndpoints,omitempty,flow" json:"rpc.allowedEndpoints,omitempty"`

	// RPCCAFile, when set, is a PEM bundle of CA certificates: ONLY these CAs are trusted for
	// verifying 'rpc.endpoints' TLS certificates (certificate pinning for a private CA). When
	// empty, the system root CA pool is used instead. See FIX-05.
	RPCCAFile string `yaml:"rpc.caFile,omitempty" json:"rpc.caFile"`

	// RPCServerName, when set, overrides the server name used for TLS certificate verification
	// (SNI + hostname check), useful when an endpoint's host is a bare IP address that doesn't
	// match the certificate's subject. See FIX-05.
	RPCServerName string `yaml:"rpc.serverName,omitempty" json:"rpc.serverName"`

	NodeId string `yaml:"nodeId" json:"nodeId"`
	Secret string `yaml:"secret" json:"secret"`
}

func NewAPIConfig() *APIConfig {
	return &APIConfig{}
}

func (this *APIConfig) Init() error {
	// compatible with old
	if len(this.RPCEndpoints) == 0 && len(this.OldRPC.Endpoints) > 0 {
		this.RPCEndpoints = this.OldRPC.Endpoints
		var legacyDisableUpdate = this.OldRPC.DisableUpdate
		this.RPCDisableUpdate = &legacyDisableUpdate
	}

	if len(this.RPCEndpoints) == 0 {
		return errors.New("no valid 'rpc.endpoints'")
	}

	if len(this.NodeId) == 0 {
		return errors.New("'nodeId' required")
	}
	if len(this.Secret) == 0 {
		return errors.New("'secret' required")
	}
	return nil
}

// DisableUpdate reports whether the node should refrain from automatically syncing its
// rpc.endpoints from the control plane's API-node list. Defaults to true (disabled) when
// 'rpc.disableUpdate' is absent from the config file, since silently trusting endpoint changes
// pushed by the control plane should be an explicit opt-in (see FIX-27); an explicit
// 'rpc.disableUpdate: false' is still honored.
func (this *APIConfig) DisableUpdate() bool {
	if this.RPCDisableUpdate == nil {
		return true
	}
	return *this.RPCDisableUpdate
}

// BoolPtr returns a pointer to b; a small helper for building *bool config fields (such as
// RPCDisableUpdate) that need to distinguish "absent" from "explicitly false".
func BoolPtr(b bool) *bool {
	return &b
}

var startupAllowedEndpointsOnce sync.Once
var startupAllowedEndpoints []string

// recordStartupAllowedEndpoints captures, exactly once per process, the set of RPC endpoints
// this node is allowed to ever adopt for its control-plane connection: 'rpc.endpoints' plus
// 'rpc.allowedEndpoints', as read from api_node.yaml the first time it is loaded in this process
// (i.e. at startup, before any auto-sync task has had a chance to rewrite the file with
// server-supplied endpoints). Later calls are no-ops. See FIX-27.
func recordStartupAllowedEndpoints(config *APIConfig) {
	startupAllowedEndpointsOnce.Do(func() {
		var allowed = make([]string, 0, len(config.RPCEndpoints)+len(config.RPCAllowedEndpoints))
		allowed = append(allowed, config.RPCEndpoints...)
		allowed = append(allowed, config.RPCAllowedEndpoints...)
		startupAllowedEndpoints = allowed
	})
}

// IsAllowedEndpoint reports whether endpoint is part of the node's local startup allowlist (see
// recordStartupAllowedEndpoints): it was present in 'rpc.endpoints' in api_node.yaml at process
// startup, or is explicitly listed in 'rpc.allowedEndpoints'. The control plane cannot expand
// this set at runtime. See FIX-27.
func IsAllowedEndpoint(endpoint string) bool {
	return rpcutils.EndpointIsAllowed(endpoint, startupAllowedEndpoints)
}

func LoadAPIConfig() (*APIConfig, error) {
	for _, filename := range []string{ConfigFileName, oldConfigFileName} {
		data, err := os.ReadFile(Tea.ConfigFile(filename))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}

		var config = &APIConfig{}
		err = yaml.Unmarshal(data, config)
		if err != nil {
			return nil, err
		}

		err = config.Init()
		if err != nil {
			return nil, errors.New("init error: " + err.Error())
		}

		recordStartupAllowedEndpoints(config)

		// 自动生成新的配置文件
		if filename == oldConfigFileName {
			config.OldRPC.Endpoints = nil
			_ = config.WriteFile(Tea.ConfigFile(ConfigFileName))
		}

		return config, nil
	}
	return nil, errors.New("no config file '" + ConfigFileName + "' found")
}

// WriteFile 保存到文件
func (this *APIConfig) WriteFile(path string) error {
	data, err := yaml.Marshal(this)
	if err != nil {
		return err
	}

	// This file contains the node's RPC auth secret, so it must not be world/group readable.
	// os.WriteFile() does not change the mode of a pre-existing file, so also chmod it
	// explicitly in case it was created by an older build that used 0666.
	err = os.WriteFile(path, data, 0600)
	if err != nil {
		return err
	}
	_ = os.Chmod(path, 0600)
	return nil
}
