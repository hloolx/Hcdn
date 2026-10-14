package configs

import (
	"github.com/iwind/TeaGo/Tea"
	"os"
	"time"
)

// InstalledMarkerFileName 安装标记文件名
//
// 这个文件只在安装/迁移确认完成后写入一次，之后一直存在，用来判断
// /setup*路由是否应该关闭。之所以单独用一个标记文件、而不是复用
// ~/.edge-admin/下的备份配置文件是否存在来判断，是因为那个备份文件
// 所在目录权限较松（历史遗留0777），本机任意用户都能删除它，一旦被
// 删除，/setup/confirm就会被误判为"新安装"状态重新对外开放，从而在
// 未认证的情况下泄露当前的nodeId/secret（见审计ADMIN-04）。标记文件
// 本身放在configs/目录下并以0600保存，不受那个问题影响。
const InstalledMarkerFileName = ".installed"

// IsInstalled 判断是否已经写入了安装标记文件
func IsInstalled() bool {
	_, err := os.Stat(Tea.ConfigFile(InstalledMarkerFileName))
	return err == nil
}

// MarkInstalled 写入安装标记文件（安装向导/迁移确认成功后调用，可重复调用）
func MarkInstalled() error {
	return os.WriteFile(Tea.ConfigFile(InstalledMarkerFileName), []byte(time.Now().Format(time.RFC3339)), 0600)
}
