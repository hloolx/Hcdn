package login

import (
	"github.com/TeaOSLab/EdgeAdmin/internal/configloaders"
	"github.com/TeaOSLab/EdgeAdmin/internal/web/actions/actionutils"
	"github.com/TeaOSLab/EdgeCommon/pkg/langs/codes"
	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/iwind/TeaGo/actions"
	"github.com/iwind/TeaGo/maps"
)

type IndexAction struct {
	actionutils.ParentAction
}

func (this *IndexAction) Init() {
	this.Nav("", "", "")
}

func (this *IndexAction) RunGet(params struct{}) {
	adminResp, err := this.RPC().AdminRPC().FindEnabledAdmin(this.AdminContext(), &pb.FindEnabledAdminRequest{AdminId: this.AdminId()})
	if err != nil {
		this.ErrorPage(err)
		return
	}
	admin := adminResp.Admin
	if admin == nil {
		this.NotFound("admin", this.AdminId())
		return
	}
	this.Data["admin"] = maps.Map{
		"username": admin.Username,
		"fullname": admin.Fullname,
	}

	this.Show()
}

func (this *IndexAction) RunPost(params struct {
	OldPassword string
	Username    string
	Password    string
	Password2   string

	Must *actions.Must
}) {
	defer this.CreateLogInfo(codes.AdminLogin_LogUpdateLogin)

	params.Must.
		Field("oldPassword", params.OldPassword).
		Require("请输入当前密码").
		Field("username", params.Username).
		Require("请输入登录用户名").
		Match(`^[a-zA-Z0-9_]+$`, "用户名中只能包含英文、数字或下划线")

	// 修改登录用户名或密码前，必须先验证当前密码
	currentAdminResp, err := this.RPC().AdminRPC().FindEnabledAdmin(this.AdminContext(), &pb.FindEnabledAdminRequest{AdminId: this.AdminId()})
	if err != nil {
		this.ErrorPage(err)
		return
	}
	if currentAdminResp.Admin == nil {
		this.NotFound("admin", this.AdminId())
		return
	}
	checkResp, err := this.RPC().AdminRPC().LoginAdmin(this.AdminContext(), &pb.LoginAdminRequest{
		Username: currentAdminResp.Admin.Username,
		Password: params.OldPassword,
	})
	if err != nil {
		this.ErrorPage(err)
		return
	}
	if !checkResp.IsOk {
		this.FailField("oldPassword", "当前密码不正确")
	}

	existsResp, err := this.RPC().AdminRPC().CheckAdminUsername(this.AdminContext(), &pb.CheckAdminUsernameRequest{
		AdminId:  this.AdminId(),
		Username: params.Username,
	})
	if err != nil {
		this.ErrorPage(err)
		return
	}
	if existsResp.Exists {
		this.FailField("username", "此用户名已经被别的管理员使用，请换一个")
	}

	if len(params.Password) > 0 {
		if params.Password != params.Password2 {
			this.FailField("password2", "两次输入的密码不一致")
		}
	}

	_, err = this.RPC().AdminRPC().UpdateAdminLogin(this.AdminContext(), &pb.UpdateAdminLoginRequest{
		AdminId:  this.AdminId(),
		Username: params.Username,
		Password: params.Password,
	})
	if err != nil {
		this.ErrorPage(err)
		return
	}

	// 通知更新
	err = configloaders.NotifyAdminModuleMappingChange()
	if err != nil {
		this.ErrorPage(err)
		return
	}

	this.Success()
}
