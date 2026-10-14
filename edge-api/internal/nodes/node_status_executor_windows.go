//go:build windows

package nodes

import (
	"github.com/TeaOSLab/EdgeCommon/pkg/nodeconfigs"
	"github.com/shirou/gopsutil/v3/mem"
)

// Windows is only used for local development builds; load averages are not
// available there.

func (this *NodeStatusExecutor) updateMem(status *nodeconfigs.NodeStatus) {
	stat, err := mem.VirtualMemory()
	if err != nil {
		status.Error = err.Error()
		return
	}
	status.MemoryUsage = stat.UsedPercent
	status.MemoryTotal = stat.Total
}

func (this *NodeStatusExecutor) updateLoad(status *nodeconfigs.NodeStatus) {}
