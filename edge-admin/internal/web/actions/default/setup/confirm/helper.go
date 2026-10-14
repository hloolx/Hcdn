package confirm

import (
	"github.com/TeaOSLab/EdgeAdmin/internal/setup"
	"github.com/iwind/TeaGo/actions"
	"net/http"
)

type Helper struct {
}

func (this *Helper) BeforeAction(actionPtr actions.ActionWrapper) (goNext bool) {
	// 安装完成后关闭/setup/confirm，返回404。判断依据是安装标记文件，
	// 不再使用home目录下备份配置文件是否存在来判断（见FIX-18：那个文件
	// 可能被本机其他用户删除，导致该页面在未认证状态下重新开放并泄露
	// nodeId/secret）。
	if setup.IsInstalled() {
		actionPtr.Object().ResponseWriter.WriteHeader(http.StatusNotFound)
		return false
	}
	return true
}
