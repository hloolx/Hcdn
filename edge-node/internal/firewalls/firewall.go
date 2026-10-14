// Copyright 2022 GoEdge goedge.cdn@gmail.com. All rights reserved.

package firewalls

import (
	"github.com/TeaOSLab/EdgeNode/internal/configs/localconfig"
	teaconst "github.com/TeaOSLab/EdgeNode/internal/const"
	"github.com/TeaOSLab/EdgeNode/internal/events"
	"github.com/TeaOSLab/EdgeNode/internal/remotelogs"
	"os"
	"runtime"
	"sync"
	"time"
)

var currentFirewall FirewallInterface
var firewallLocker = &sync.Mutex{}

// 初始化
func init() {
	if !teaconst.IsMain {
		return
	}

	events.On(events.EventLoaded, func() {
		var firewall = Firewall()
		if firewall.Name() != "mock" {
			remotelogs.Println("FIREWALL", "found local firewall '"+firewall.Name()+"'")
		}
	})
}

// KernelFirewallEnabled 是否允许使用系统防火墙（nftables、firewalld等）安装封禁规则
// 可以在节点本地的 configs/local.yaml 中通过 firewall.kernel: false 关闭
func KernelFirewallEnabled() bool {
	return localconfig.SharedConfig().KernelFirewallEnabled()
}

// Firewall 查找当前系统中最适合的防火墙
func Firewall() FirewallInterface {
	firewallLocker.Lock()
	defer firewallLocker.Unlock()
	if currentFirewall != nil {
		return currentFirewall
	}

	// kernel firewall disabled in configs/local.yaml: application-level blocking only
	if !KernelFirewallEnabled() {
		currentFirewall = NewMockFirewall()
		return currentFirewall
	}

	// http firewall
	{
		endpoint, _ := os.LookupEnv("EDGE_HTTP_FIREWALL_ENDPOINT")
		if len(endpoint) > 0 {
			var httpFirewall = NewHTTPFirewall(endpoint)
			for i := 0; i < 10; i++ {
				if httpFirewall.IsReady() {
					currentFirewall = httpFirewall
					remotelogs.Println("FIREWALL", "using http firewall '"+endpoint+"'")
					break
				}
				time.Sleep(1 * time.Second)
			}
			return httpFirewall
		}
	}

	// nftables
	if runtime.GOOS == "linux" {
		nftables, err := NewNFTablesFirewall()
		if err != nil {
			remotelogs.Warn("FIREWALL", "'nftables' should be installed on the system to enhance security (init failed: "+err.Error()+")")
		} else {
			if nftables.IsReady() {
				currentFirewall = nftables
				events.Notify(events.EventNFTablesReady)
				return nftables
			} else {
				remotelogs.Warn("FIREWALL", "'nftables' should be enabled on the system to enhance security")
			}
		}
	}

	// firewalld
	if runtime.GOOS == "linux" {
		var firewalld = NewFirewalld()
		if firewalld.IsReady() {
			currentFirewall = firewalld
			return currentFirewall
		}
	}

	// 至少返回一个
	currentFirewall = NewMockFirewall()
	return currentFirewall
}
