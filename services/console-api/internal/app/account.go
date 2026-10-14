package app

import (
	"net/http"
	"strings"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
)

func (a *App) updateProfile(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		Fullname *string `json:"fullname"`
		Email    *string `json:"email"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	ctx := r.Context()
	uid := p.id()
	call, err := a.edge.AsUser(ctx, uid)
	if err != nil {
		return err
	}
	defer call.Done()
	cur, err := call.User().FindEnabledUser(call.Ctx, &pb.FindEnabledUserRequest{UserId: uid})
	if err != nil {
		return err
	}
	if cur.User == nil {
		return httpx.Unauthorized()
	}
	fullname, email := cur.User.Fullname, cur.User.Email
	f := httpx.Fields{}
	if req.Fullname != nil {
		fullname = strings.TrimSpace(*req.Fullname)
		if fullname == "" || len([]rune(fullname)) > 64 {
			f.Add("fullname", "姓名为 1-64 个字符")
		}
	}
	if req.Email != nil {
		email = strings.TrimSpace(*req.Email)
		if !validEmail(email) {
			f.Add("email", "请输入有效的邮箱地址")
		}
	}
	if err := f.Err(); err != nil {
		return err
	}
	if _, err := call.User().UpdateUserInfo(call.Ctx, &pb.UpdateUserInfoRequest{UserId: uid, Fullname: fullname, Mobile: cur.User.Mobile, Email: email}); err != nil {
		return err
	}
	if !strings.EqualFold(email, cur.User.Email) {
		_ = a.store.ClearEmailVerified(ctx, uid)
		if a.mail != nil {
			a.sendVerifyEmail(uid, cur.User.Username, email)
		}
		a.auditUser(r, p, "修改邮箱")
	} else {
		a.auditUser(r, p, "修改个人资料")
	}
	m, _, err := a.buildMe(ctx, uid)
	if err != nil {
		return err
	}
	return writeJSON(w, m)
}

func (a *App) changePassword(w http.ResponseWriter, r *http.Request, p *principal) error {
	if err := a.authLimit(r); err != nil {
		return err
	}
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	if msg := passwordProblem(req.NewPassword); msg != "" {
		return httpx.Validation(map[string]string{"newPassword": msg})
	}
	if req.CurrentPassword == "" || len(req.CurrentPassword) > 128 {
		return httpx.Validation(map[string]string{"currentPassword": "请输入当前密码"})
	}
	ctx := r.Context()
	uid := p.id()
	ip := clientIP(r)
	username := p.sess.Username
	if err := a.checkLoginAllowed(ctx, store.KindUser, username, ip); err != nil {
		return err
	}
	anon, err := a.edge.AsUserNode(ctx)
	if err != nil {
		return err
	}
	res, err := anon.User().LoginUser(anon.Ctx, &pb.LoginUserRequest{Username: username, Password: req.CurrentPassword})
	anon.Done()
	if err != nil {
		return err
	}
	if !res.IsOk || res.UserId != uid {
		a.recordLoginFailure(ctx, store.KindUser, username, ip)
		return httpx.Validation(map[string]string{"currentPassword": "当前密码错误"})
	}
	call, err := a.edge.AsUser(ctx, uid)
	if err != nil {
		return err
	}
	defer call.Done()
	if _, err := call.User().UpdateUserLogin(call.Ctx, &pb.UpdateUserLoginRequest{UserId: uid, Username: username, Password: req.NewPassword}); err != nil {
		return err
	}
	_ = a.sessions.DeleteSessionsFor(ctx, store.KindUser, uid, p.raw)
	a.audit(r, "user", uid, username, "修改密码", "warning")
	return noContent(w)
}

// ---------------------------------------------------------------- access keys

type accessKeyResp struct {
	ID          int64  `json:"id"`
	AccessKeyID string `json:"accessKeyId"`
	Description string `json:"description"`
	IsOn        bool   `json:"isOn"`
	CreatedAt   int64  `json:"createdAt"`
	LastUsedAt  *int64 `json:"lastUsedAt"`
}

func toAccessKey(k *pb.UserAccessKey, created map[int64]int64) accessKeyResp {
	out := accessKeyResp{ID: k.Id, AccessKeyID: k.UniqueId, Description: k.Description, IsOn: k.IsOn, CreatedAt: created[k.Id]}
	if k.AccessedAt > 0 {
		t := k.AccessedAt
		out.LastUsedAt = &t
	}
	return out
}

func userKeys(call *edgeapi.Call, uid int64) ([]*pb.UserAccessKey, error) {
	// AdminId must stay 0: EdgeAPI filters on adminId AND userId.
	resp, err := call.AccessKey().FindAllEnabledUserAccessKeys(call.Ctx, &pb.FindAllEnabledUserAccessKeysRequest{UserId: uid})
	if err != nil {
		return nil, err
	}
	var out []*pb.UserAccessKey
	for _, k := range resp.UserAccessKeys {
		if k.UserId == uid && k.SubUserId == 0 {
			out = append(out, k)
		}
	}
	return out, nil
}

func (a *App) listAccessKeys(w http.ResponseWriter, r *http.Request, p *principal) error {
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	keys, err := userKeys(call, p.id())
	if err != nil {
		return err
	}
	created, _ := a.store.AccessKeyCreated(r.Context(), p.id())
	out := make([]accessKeyResp, 0, len(keys))
	for _, k := range keys {
		out = append(out, toAccessKey(k, created))
	}
	return writeJSON(w, out)
}

const maxAccessKeys = 10

func (a *App) createAccessKey(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		Description string `json:"description"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	desc := strings.TrimSpace(req.Description)
	if len([]rune(desc)) > 100 {
		return httpx.Validation(map[string]string{"description": "描述不能超过 100 个字符"})
	}
	ctx := r.Context()
	uid := p.id()
	call, err := a.edge.AsUser(ctx, uid)
	if err != nil {
		return err
	}
	defer call.Done()
	keys, err := userKeys(call, uid)
	if err != nil {
		return err
	}
	if len(keys) >= maxAccessKeys {
		return httpx.Errorf(http.StatusConflict, "limit_reached", "最多创建 %d 个 AccessKey", maxAccessKeys)
	}
	created, err := call.AccessKey().CreateUserAccessKey(call.Ctx, &pb.CreateUserAccessKeyRequest{UserId: uid, Description: desc})
	if err != nil {
		return err
	}
	_ = a.store.RecordAccessKey(ctx, created.UserAccessKeyId, uid, a.now())
	keys, err = userKeys(call, uid)
	if err != nil {
		return err
	}
	for _, k := range keys {
		if k.Id == created.UserAccessKeyId {
			a.auditUser(r, p, "创建 AccessKey "+k.UniqueId)
			httpx.WriteJSON(w, http.StatusCreated, map[string]any{
				"key":    toAccessKey(k, map[int64]int64{k.Id: a.now().Unix()}),
				"secret": k.Secret,
			})
			return nil
		}
	}
	return httpx.Errorf(http.StatusBadGateway, "upstream_error", "AccessKey 创建后无法读取")
}

func (a *App) ownedKey(call *edgeapi.Call, uid, id int64) (*pb.UserAccessKey, error) {
	keys, err := userKeys(call, uid)
	if err != nil {
		return nil, err
	}
	for _, k := range keys {
		if k.Id == id {
			return k, nil
		}
	}
	return nil, httpx.NotFound()
}

func (a *App) updateAccessKey(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req struct {
		IsOn *bool `json:"isOn"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	if req.IsOn == nil {
		return httpx.Validation(map[string]string{"isOn": "缺少 isOn"})
	}
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	k, err := a.ownedKey(call, p.id(), id)
	if err != nil {
		return err
	}
	if _, err := call.AccessKey().UpdateUserAccessKeyIsOn(call.Ctx, &pb.UpdateUserAccessKeyIsOnRequest{UserAccessKeyId: id, IsOn: *req.IsOn}); err != nil {
		return err
	}
	k.IsOn = *req.IsOn
	a.auditUser(r, p, map[bool]string{true: "启用", false: "停用"}[k.IsOn]+" AccessKey "+k.UniqueId)
	created, _ := a.store.AccessKeyCreated(r.Context(), p.id())
	return writeJSON(w, toAccessKey(k, created))
}

func (a *App) deleteAccessKey(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	k, err := a.ownedKey(call, p.id(), id)
	if err != nil {
		return err
	}
	if _, err := call.AccessKey().DeleteUserAccessKey(call.Ctx, &pb.DeleteUserAccessKeyRequest{UserAccessKeyId: id}); err != nil {
		return err
	}
	a.auditUser(r, p, "删除 AccessKey "+k.UniqueId)
	return noContent(w)
}

func (a *App) activity(w http.ResponseWriter, r *http.Request, p *principal) error {
	items, err := a.store.ListActivity(r.Context(), "user", p.id(), 100)
	if err != nil {
		return err
	}
	type item struct {
		ID     int64  `json:"id"`
		Time   int64  `json:"time"`
		Action string `json:"action"`
		IP     string `json:"ip"`
	}
	out := make([]item, 0, len(items))
	for _, it := range items {
		out = append(out, item{ID: it.ID, Time: it.CreatedAt, Action: it.Action, IP: it.IP})
	}
	return writeJSON(w, out)
}
