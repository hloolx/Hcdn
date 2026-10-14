package setup

import (
	"github.com/TeaOSLab/EdgeAdmin/internal/configs"
)

var isConfigured bool

// IsConfigured 判断系统是否已经配置过
func IsConfigured() bool {
	if isConfigured {
		return true
	}

	_, err := configs.LoadAPIConfig()
	isConfigured = err == nil
	return isConfigured
}

// IsNewInstalled IsNew 检查是否新安装
func IsNewInstalled() bool {
	return configs.IsNewInstalled()
}

// IsInstalled 判断安装是否已经完成——用于决定/setup*路由是否应该关闭（返回404）。
//
// 以安装标记文件为权威依据，而不是home目录下的备份配置文件是否存在
// （那个备份文件可能被本机其他用户删除，不能作为安全判断依据，见
// configs.IsInstalled的说明）。为了兼容升级前就已经安装完成、从未
// 写过标记文件的既有实例：如果标记文件不存在，但本机已经有一份可用
// 的api_admin.yaml，也视为已安装，并顺手补写标记文件。
func IsInstalled() bool {
	if configs.IsInstalled() {
		return true
	}
	if IsConfigured() {
		_ = configs.MarkInstalled()
		return true
	}
	return false
}
