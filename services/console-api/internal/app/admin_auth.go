package app

import (
	"context"
	"net/http"
	"strings"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
	"github.com/hloolx/Hcdn/services/console-api/internal/totp"
)

type adminMe struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Fullname string `json:"fullname"`
	IsSuper  bool   `json:"isSuper"`
}

func (a *App) findAdmin(ctx context.Context, adminID int64) (*pb.Admin, error) {
	call, err := a.edge.AsAdmin(ctx, adminID)
	if err != nil {
		return nil, err
	}
	defer call.Done()
	resp, err := call.Admin().FindEnabledAdmin(call.Ctx, &pb.FindEnabledAdminRequest{AdminId: adminID})
	if err != nil {
		return nil, err
	}
	return resp.Admin, nil
}

func (a *App) adminLogin(w http.ResponseWriter, r *http.Request) error {
	if err := a.authLimit(r); err != nil {
		return err
	}
	var req loginReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" || len(req.Username) > 128 || len(req.Password) > 128 {
		return httpx.Validation(map[string]string{"username": "请输入用户名和密码"})
	}
	ctx := r.Context()
	ip := clientIP(r)
	if err := a.checkLoginAllowed(ctx, store.KindAdmin, req.Username, ip); err != nil {
		return err
	}
	call, err := a.edge.AsAdmin(ctx, 0)
	if err != nil {
		return err
	}
	resp, err := call.Admin().LoginAdmin(call.Ctx, &pb.LoginAdminRequest{Username: req.Username, Password: req.Password})
	call.Done()
	if err != nil {
		return err
	}
	if !resp.IsOk || resp.AdminId <= 0 {
		a.recordLoginFailure(ctx, store.KindAdmin, req.Username, ip)
		a.audit(r, "admin", 0, req.Username, "管理员登录失败", "warning")
		return invalidCredentials()
	}
	adm, err := a.findAdmin(ctx, resp.AdminId)
	if err != nil {
		return err
	}
	if adm == nil || !adm.IsOn || !adm.CanLogin {
		a.recordLoginFailure(ctx, store.KindAdmin, req.Username, ip)
		return invalidCredentials()
	}
	if secret := otpSecretOf(adm.OtpLogin); secret != "" {
		if strings.TrimSpace(req.OTP) == "" {
			return httpx.Errorf(http.StatusBadRequest, "otp_required", "请输入两步验证码")
		}
		if !totp.Verify(secret, req.OTP, a.now()) {
			a.recordLoginFailure(ctx, store.KindAdmin, req.Username, ip)
			return httpx.Errorf(http.StatusBadRequest, "invalid_otp", "两步验证码错误")
		}
	}
	if err := a.startSession(w, r, store.KindAdmin, adminCookie, adm.Id, adm.Username); err != nil {
		return err
	}
	a.clearLoginFailures(ctx, store.KindAdmin, req.Username)
	a.audit(r, "admin", adm.Id, adm.Username, "管理员登录", "info")
	return writeJSON(w, adminMe{ID: adm.Id, Username: adm.Username, Fullname: adm.Fullname, IsSuper: adm.IsSuper})
}

func (a *App) adminMeH(w http.ResponseWriter, r *http.Request, p *principal) error {
	adm, err := a.findAdmin(r.Context(), p.id())
	if err != nil {
		return err
	}
	if adm == nil || !adm.IsOn || !adm.CanLogin {
		_ = a.sessions.DeleteSession(r.Context(), p.raw)
		a.clearSessionCookie(w, adminCookie)
		return httpx.Unauthorized()
	}
	return writeJSON(w, adminMe{ID: adm.Id, Username: adm.Username, Fullname: adm.Fullname, IsSuper: adm.IsSuper})
}
