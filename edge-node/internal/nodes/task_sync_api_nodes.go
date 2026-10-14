package nodes

import (
	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/TeaOSLab/EdgeNode/internal/configs"
	teaconst "github.com/TeaOSLab/EdgeNode/internal/const"
	"github.com/TeaOSLab/EdgeNode/internal/events"
	"github.com/TeaOSLab/EdgeNode/internal/rpc"
	"github.com/TeaOSLab/EdgeNode/internal/utils"
	"github.com/TeaOSLab/EdgeNode/internal/utils/goman"
	"github.com/TeaOSLab/EdgeNode/internal/utils/trackers"
	"github.com/iwind/TeaGo/Tea"
	"github.com/iwind/TeaGo/logs"
	"time"
)

var sharedSyncAPINodesTask = NewSyncAPINodesTask()

func init() {
	if !teaconst.IsMain {
		return
	}

	events.On(events.EventStart, func() {
		goman.New(func() {
			sharedSyncAPINodesTask.Start()
		})
	})
	events.OnClose(func() {
		sharedSyncAPINodesTask.Stop()
	})
}

// SyncAPINodesTask API节点同步任务
type SyncAPINodesTask struct {
	ticker *time.Ticker
}

func NewSyncAPINodesTask() *SyncAPINodesTask {
	return &SyncAPINodesTask{}
}

func (this *SyncAPINodesTask) Start() {
	this.ticker = time.NewTicker(5 * time.Minute)
	if Tea.IsTesting() {
		// 快速测试
		this.ticker = time.NewTicker(1 * time.Minute)
	}
	for range this.ticker.C {
		err := this.Loop()
		if err != nil {
			logs.Println("[TASK][SYNC_API_NODES_TASK]" + err.Error())
		}
	}
}

func (this *SyncAPINodesTask) Stop() {
	if this.ticker != nil {
		this.ticker.Stop()
	}
}

func (this *SyncAPINodesTask) Loop() error {
	// 如果有节点定制的API节点地址
	var hasCustomizedAPINodeAddrs = sharedNodeConfig != nil && len(sharedNodeConfig.APINodeAddrs) > 0

	config, err := configs.LoadAPIConfig()
	if err != nil {
		return err
	}

	// 是否禁止自动升级
	if config.DisableUpdate() {
		return nil
	}

	var tr = trackers.Begin("SYNC_API_NODES")
	defer tr.End()

	// 获取所有可用的节点
	rpcClient, err := rpc.SharedRPC()
	if err != nil {
		return err
	}
	resp, err := rpcClient.APINodeRPC.FindAllEnabledAPINodes(rpcClient.Context(), &pb.FindAllEnabledAPINodesRequest{})
	if err != nil {
		return err
	}

	var candidateEndpoints = []string{}
	for _, node := range resp.ApiNodes {
		if !node.IsOn {
			continue
		}
		candidateEndpoints = append(candidateEndpoints, node.AccessAddrs...)
	}

	// FIX-27：服务端返回的API节点地址必须位于本地白名单内（启动时的rpc.endpoints，或
	// 显式配置的rpc.allowedEndpoints），否则忽略并记录日志，防止被恶意或被攻陷的API
	// 服务端把节点控制连接重定向到任意主机、并写入到本地配置文件中。
	var newEndpoints = []string{}
	for _, endpoint := range candidateEndpoints {
		if configs.IsAllowedEndpoint(endpoint) {
			newEndpoints = append(newEndpoints, endpoint)
		} else {
			logs.Println("[TASK][SYNC_API_NODES_TASK]ignoring endpoint not in local allowlist (rpc.endpoints/rpc.allowedEndpoints): '" + endpoint + "'")
		}
	}

	// 和现有的对比
	if utils.EqualStrings(newEndpoints, config.RPCEndpoints) {
		return nil
	}

	// 测试是否有API节点可用
	var hasOk = rpcClient.TestEndpoints(newEndpoints)
	if !hasOk {
		return nil
	}

	// 修改RPC对象配置
	config.RPCEndpoints = newEndpoints

	// 更新当前RPC
	if !hasCustomizedAPINodeAddrs {
		err = rpcClient.UpdateConfig(config)
		if err != nil {
			return err
		}
	}

	// 保存到文件
	err = config.WriteFile(Tea.ConfigFile(configs.ConfigFileName))
	if err != nil {
		return err
	}

	return nil
}
