package nodes

import (
	"fmt"
	"os"
	"strconv"

	"github.com/TeaOSLab/EdgeNode/internal/configs/localconfig"
	teaconst "github.com/TeaOSLab/EdgeNode/internal/const"
	"github.com/TeaOSLab/EdgeNode/internal/events"
	"github.com/TeaOSLab/EdgeNode/internal/remotelogs"
)

func init() {
	if !teaconst.IsMain {
		return
	}

	events.On(events.EventStart, func() {
		config, err := localconfig.Shared()
		if err != nil {
			// an explicit but broken node-local config must not be silently ignored
			var msg = "load 'configs/" + localconfig.FileName + "' failed: " + err.Error() + ", refusing to start"
			remotelogs.Error("LOCAL_CONFIG", msg)
			_, _ = fmt.Fprintln(os.Stderr, "[ERROR]"+msg)
			os.Exit(1)
		}

		for _, remap := range config.Listen.Remap {
			var proxyProtocol = "off"
			if remap.RequireProxyProtocol() {
				proxyProtocol = "required"
			}
			remotelogs.Println("LOCAL_CONFIG", "TCP port "+strconv.Itoa(remap.Port)+" is bound at '"+remap.Addr+"' (PROXY protocol: "+proxyProtocol+")")
		}
		if !config.KernelFirewallEnabled() {
			remotelogs.Println("LOCAL_CONFIG", "kernel firewall rules are disabled, using application-level blocking only")
		}
	})
}
