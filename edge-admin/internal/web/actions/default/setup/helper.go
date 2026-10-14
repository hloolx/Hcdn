package setup

import (
	"github.com/TeaOSLab/EdgeAdmin/internal/setup"
	"github.com/iwind/TeaGo/actions"
	"net/http"
)

type Helper struct {
}

func (this *Helper) BeforeAction(actionPtr actions.ActionWrapper) (goNext bool) {
	// 安装完成后整个/setup*路由集合关闭，统一返回404（而不是重定向到首页），
	// 判断依据是安装标记文件，不受home目录下备份配置文件被删除的影响（FIX-18）。
	if setup.IsInstalled() {
		actionPtr.Object().ResponseWriter.WriteHeader(http.StatusNotFound)
		return false
	}
	return true
}
