package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/config"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
	"github.com/hloolx/Hcdn/services/console-api/internal/totp"
)

// ---------------------------------------------------------------- contract types

type planSummary struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	TrafficQuotaBytes *int64 `json:"trafficQuotaBytes"`
	DomainsQuota      *int64 `json:"domainsQuota"`
	ExpiresAt         *int64 `json:"expiresAt"`
}

type meResp struct {
	ID            int64       `json:"id"`
	Username      string      `json:"username"`
	Email         string      `json:"email"`
	Fullname      string      `json:"fullname"`
	EmailVerified bool        `json:"emailVerified"`
	OTPEnabled    bool        `json:"otpEnabled"`
	CreatedAt     int64       `json:"createdAt"`
	Plan          planSummary `json:"plan"`
}

type loginReq struct {
	Username       string `json:"username"`
	Password       string `json:"password"`
	OTP            string `json:"otp"`
	TurnstileToken string `json:"turnstileToken"`
}

// ---------------------------------------------------------------- validation helpers

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$`)

func validUsername(s string) bool { return usernameRe.MatchString(s) }

func validEmail(s string) bool {
	if len(s) > 128 {
		return false
	}
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && strings.Contains(s, ".")
}

// passwordProblem returns "" when acceptable.
func passwordProblem(p string) string {
	if len(p) < 8 {
		return "密码至少 8 位"
	}
	if len(p) > 128 {
		return "密码不能超过 128 位"
	}
	var letter, digit bool
	for _, r := range p {
		switch {
		case unicode.IsLetter(r):
			letter = true
		case unicode.IsDigit(r):
			digit = true
		}
	}
	if !letter || !digit {
		return "密码需同时包含字母和数字"
	}
	return ""
}

// ---------------------------------------------------------------- public

func (a *App) publicConfig(w http.ResponseWriter, r *http.Request) error {
	rs := a.rs()
	return writeJSON(w, map[string]any{
		"productName":               rs.ProductName,
		"registrationOpen":          rs.Registration.Open,
		"emailVerificationRequired": a.emailVerificationRequired(),
		"passwordResetAvailable":    a.mail != nil,
		"cnameDomain":               a.cfg.CNAMEDomain,
		"turnstileSiteKey":          a.turnstileSiteKey(),
	})
}

func (a *App) emailVerificationRequired() bool {
	return a.mail != nil && a.rs().Registration.RequireEmailVerification
}

func (a *App) publicPlans(w http.ResponseWriter, r *http.Request) error {
	plans := a.cfg.Plans
	if plans == nil {
		plans = []config.Plan{}
	}
	return writeJSON(w, plans)
}

func (a *App) currentPlan() planSummary {
	for _, p := range a.cfg.Plans {
		if a.cfg.DefaultPlan == "" || p.ID == a.cfg.DefaultPlan {
			return planSummary{ID: p.ID, Name: p.Name, TrafficQuotaBytes: p.TrafficQuotaBytes, DomainsQuota: p.DomainsQuota}
		}
	}
	return planSummary{ID: "default", Name: "标准版"}
}

// ---------------------------------------------------------------- me

func (a *App) buildMe(ctx context.Context, userID int64) (*meResp, *pb.User, error) {
	call, err := a.edge.AsUser(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	defer call.Done()
	resp, err := call.User().FindEnabledUser(call.Ctx, &pb.FindEnabledUserRequest{UserId: userID})
	if err != nil {
		return nil, nil, err
	}
	u := resp.User
	if u == nil {
		return nil, nil, httpx.Unauthorized()
	}
	flags, err := a.store.GetUserFlags(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	secret, err := a.userOTPSecret(ctx, userID)
	if err != nil {
		a.log.Warn("otp lookup failed", "user", userID, "err", err)
	}
	return &meResp{
		ID:            u.Id,
		Username:      u.Username,
		Email:         u.Email,
		Fullname:      u.Fullname,
		EmailVerified: (flags.EmailVerifiedAt > 0 && u.Email != "") || (u.VerifiedEmail != "" && strings.EqualFold(u.VerifiedEmail, u.Email)),
		OTPEnabled:    secret != "",
		CreatedAt:     u.CreatedAt,
		Plan:          a.currentPlan(),
	}, u, nil
}

// userOTPSecret returns the base32 secret when OTP login is enabled for the user.
func (a *App) userOTPSecret(ctx context.Context, userID int64) (string, error) {
	call, err := a.edge.AsUser(ctx, userID)
	if err != nil {
		return "", err
	}
	defer call.Done()
	// AdminId must stay 0: EdgeAPI does not clear it for user callers.
	resp, err := call.Login().FindEnabledLogin(call.Ctx, &pb.FindEnabledLoginRequest{UserId: userID, Type: "otp"})
	if err != nil {
		return "", err
	}
	return otpSecretOf(resp.Login), nil
}

func otpSecretOf(l *pb.Login) string {
	if l == nil || !l.IsOn || len(l.ParamsJSON) == 0 {
		return ""
	}
	var p struct {
		Secret string `json:"secret"`
	}
	if json.Unmarshal(l.ParamsJSON, &p) != nil {
		return ""
	}
	return p.Secret
}

func (a *App) me(w http.ResponseWriter, r *http.Request, p *principal) error {
	m, u, err := a.buildMe(r.Context(), p.id())
	if err != nil {
		return err
	}
	if !u.IsOn {
		_ = a.sessions.DeleteSession(r.Context(), p.raw)
		a.clearSessionCookie(w, userCookie)
		return httpx.Unauthorized()
	}
	return writeJSON(w, m)
}

// ---------------------------------------------------------------- login / logout

func (a *App) login(w http.ResponseWriter, r *http.Request) error {
	if err := a.authLimit(r); err != nil {
		return err
	}
	var req loginReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	req.Username = strings.TrimSpace(req.Username)
	f := httpx.Fields{}
	if req.Username == "" || len(req.Username) > 128 {
		f.Add("username", "请输入用户名")
	}
	if req.Password == "" || len(req.Password) > 128 {
		f.Add("password", "请输入密码")
	}
	if err := f.Err(); err != nil {
		return err
	}
	if err := a.verifyTurnstile(r, req.TurnstileToken); err != nil {
		return err
	}
	ip := clientIP(r)
	ctx := r.Context()
	if err := a.checkLoginAllowed(ctx, store.KindUser, req.Username, ip); err != nil {
		return err
	}
	call, err := a.edge.AsUserNode(ctx)
	if err != nil {
		return err
	}
	resp, err := call.User().LoginUser(call.Ctx, &pb.LoginUserRequest{Username: req.Username, Password: req.Password})
	call.Done()
	if err != nil {
		return err
	}
	if !resp.IsOk || resp.UserId <= 0 {
		a.recordLoginFailure(ctx, store.KindUser, req.Username, ip)
		a.audit(r, "user", 0, req.Username, "登录失败", "warning")
		return invalidCredentials()
	}
	userID := resp.UserId
	secret, err := a.userOTPSecret(ctx, userID)
	if err != nil {
		return err
	}
	if secret != "" {
		if strings.TrimSpace(req.OTP) == "" {
			return httpx.Errorf(http.StatusBadRequest, "otp_required", "请输入两步验证码")
		}
		if !totp.Verify(secret, req.OTP, a.now()) {
			a.recordLoginFailure(ctx, store.KindUser, req.Username, ip)
			return httpx.Errorf(http.StatusBadRequest, "invalid_otp", "两步验证码错误")
		}
	}
	flags, err := a.store.GetUserFlags(ctx, userID)
	if err != nil {
		return err
	}
	if flags.PendingEmail && a.emailVerificationRequired() {
		return httpx.Errorf(http.StatusForbidden, "email_unverified", "请先完成邮箱验证，验证邮件已发送到注册邮箱")
	}
	m, u, err := a.buildMe(ctx, userID)
	if err != nil {
		return err
	}
	if !u.IsOn {
		return httpx.Errorf(http.StatusForbidden, "account_disabled", "账号已被停用，请联系客服")
	}
	if err := a.startSession(w, r, store.KindUser, userCookie, userID, u.Username); err != nil {
		return err
	}
	a.clearLoginFailures(ctx, store.KindUser, req.Username)
	_ = a.store.TouchLogin(ctx, userID, a.now())
	a.audit(r, "user", userID, u.Username, "登录成功", "info")
	return writeJSON(w, m)
}

func (a *App) startSession(w http.ResponseWriter, r *http.Request, kind, cookie string, id int64, name string) error {
	// Drop any session the browser already had (session fixation).
	if ck, err := r.Cookie(cookie); err == nil && ck.Value != "" {
		_ = a.sessions.DeleteSession(r.Context(), ck.Value)
	}
	raw, err := a.sessions.CreateSession(r.Context(), kind, id, name, clientIP(r), r.UserAgent(), a.now())
	if err != nil {
		return err
	}
	a.setSessionCookie(w, cookie, raw)
	return nil
}

func (a *App) logoutWith(cookie string) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		if ck, err := r.Cookie(cookie); err == nil && ck.Value != "" && a.sessions != nil {
			if err := a.sessions.DeleteSession(r.Context(), ck.Value); err != nil {
				return err
			}
		}
		a.clearSessionCookie(w, cookie)
		return noContent(w)
	}
}

// ---------------------------------------------------------------- registration

type registerReq struct {
	Username       string `json:"username"`
	Email          string `json:"email"`
	Password       string `json:"password"`
	Fullname       string `json:"fullname"`
	TurnstileToken string `json:"turnstileToken"`
}

func (a *App) register(w http.ResponseWriter, r *http.Request) error {
	if err := a.authLimit(r); err != nil {
		return err
	}
	rs := a.rs()
	if !rs.Registration.Open {
		return httpx.Errorf(http.StatusForbidden, "registration_closed", "暂未开放注册")
	}
	var req registerReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.TrimSpace(req.Email)
	req.Fullname = strings.TrimSpace(req.Fullname)
	f := httpx.Fields{}
	if !validUsername(req.Username) {
		f.Add("username", "用户名为 3-32 位字母、数字、下划线、点或短横线")
	}
	if !validEmail(req.Email) {
		f.Add("email", "请输入有效的邮箱地址")
	}
	if msg := passwordProblem(req.Password); msg != "" {
		f.Add("password", msg)
	}
	if len([]rune(req.Fullname)) > 64 {
		f.Add("fullname", "姓名不能超过 64 个字符")
	}
	if err := f.Err(); err != nil {
		return err
	}
	if err := a.verifyTurnstile(r, req.TurnstileToken); err != nil {
		return err
	}
	ctx := r.Context()
	call, err := a.edge.AsAdmin(ctx, a.cfg.EdgeAPI.AdminID)
	if err != nil {
		return err
	}
	defer call.Done()
	exists, err := call.User().CheckUserUsername(call.Ctx, &pb.CheckUserUsernameRequest{Username: req.Username})
	if err != nil {
		return err
	}
	if exists.Exists {
		return httpx.Validation(map[string]string{"username": "该用户名已被注册"})
	}
	clusterID, err := a.defaultClusterID(ctx)
	if err != nil {
		return err
	}
	fullname := req.Fullname
	if fullname == "" {
		fullname = req.Username
	}
	created, err := call.User().CreateUser(call.Ctx, &pb.CreateUserRequest{
		Username:      req.Username,
		Password:      req.Password,
		Fullname:      fullname,
		Email:         req.Email,
		Source:        "hcdn-console",
		NodeClusterId: clusterID,
	})
	if err != nil {
		return err
	}
	userID := created.UserId
	a.audit(r, "user", userID, req.Username, "注册账号", "info")

	if a.mail != nil {
		pending := a.emailVerificationRequired()
		if pending {
			if err := a.store.SetPendingEmail(ctx, userID, true); err != nil {
				return err
			}
		}
		a.sendVerifyEmail(userID, req.Username, req.Email)
		if pending {
			httpx.WriteJSON(w, http.StatusCreated, map[string]any{"me": nil, "pendingVerification": true})
			return nil
		}
	}
	m, u, err := a.buildMe(ctx, userID)
	if err != nil {
		return err
	}
	if err := a.startSession(w, r, store.KindUser, userCookie, userID, u.Username); err != nil {
		return err
	}
	_ = a.store.TouchLogin(ctx, userID, a.now())
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"me": m, "pendingVerification": false})
	return nil
}

// defaultClusterID returns the signup cluster (setting, else the oldest cluster).
func (a *App) defaultClusterID(ctx context.Context) (int64, error) {
	if id := a.rs().Registration.DefaultClusterID; id > 0 {
		return id, nil
	}
	call, err := a.edge.AsAdmin(ctx, a.cfg.EdgeAPI.AdminID)
	if err != nil {
		return 0, err
	}
	defer call.Done()
	resp, err := call.NodeCluster().FindAllEnabledNodeClusters(call.Ctx, &pb.FindAllEnabledNodeClustersRequest{})
	if err != nil {
		return 0, err
	}
	var best int64
	for _, c := range resp.NodeClusters {
		if c.IsOn && (best == 0 || c.Id < best) {
			best = c.Id
		}
	}
	if best == 0 {
		return 0, httpx.Errorf(http.StatusServiceUnavailable, "not_configured", "平台尚未配置可用的节点集群")
	}
	return best, nil
}

// ---------------------------------------------------------------- email flows

const (
	verifyTTL = 48 * time.Hour
	resetTTL  = time.Hour
)

// sendVerifyEmail issues a token and mails it in the background.
func (a *App) sendVerifyEmail(userID int64, username, email string) {
	a.bg.Add(1)
	go func() {
		defer a.bg.Done()
		ctx, cancel := context.WithTimeout(a.base, time.Minute)
		defer cancel()
		raw, err := a.store.CreateEmailToken(ctx, store.PurposeVerify, userID, email, verifyTTL, a.now())
		if err != nil {
			a.log.Error("create verify token", "err", err)
			return
		}
		link := a.consoleURL() + "/verify-email?token=" + raw
		body := fmt.Sprintf("%s，您好：\n\n请点击以下链接验证您在 %s 的邮箱（48 小时内有效）：\n\n%s\n\n如果这不是您的操作，请忽略本邮件。\n",
			username, a.rs().ProductName, link)
		if err := a.mail.Send(email, a.rs().ProductName+" 邮箱验证", body); err != nil {
			a.log.Error("send verify email", "err", err)
		}
	}()
}

func (a *App) verifyEmail(w http.ResponseWriter, r *http.Request) error {
	if err := a.authLimit(r); err != nil {
		return err
	}
	var req struct {
		Token string `json:"token"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	ctx := r.Context()
	userID, email, err := a.store.ConsumeEmailToken(ctx, store.PurposeVerify, strings.TrimSpace(req.Token), a.now())
	if errors.Is(err, store.ErrNotFound) {
		return httpx.Errorf(http.StatusBadRequest, "invalid_token", "链接无效或已过期")
	}
	if err != nil {
		return err
	}
	call, err := a.edge.AsUser(ctx, userID)
	if err != nil {
		return err
	}
	defer call.Done()
	resp, err := call.User().FindEnabledUser(call.Ctx, &pb.FindEnabledUserRequest{UserId: userID})
	if err != nil {
		return err
	}
	if resp.User == nil || !strings.EqualFold(resp.User.Email, email) {
		return httpx.Errorf(http.StatusBadRequest, "invalid_token", "链接无效或已过期")
	}
	if err := a.store.MarkEmailVerified(ctx, userID, a.now()); err != nil {
		return err
	}
	a.audit(r, "user", userID, resp.User.Username, "验证邮箱", "info")
	return noContent(w)
}

func (a *App) forgotPassword(w http.ResponseWriter, r *http.Request) error {
	if err := a.authLimit(r); err != nil {
		return err
	}
	var req struct {
		Email          string `json:"email"`
		TurnstileToken string `json:"turnstileToken"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	email := strings.TrimSpace(req.Email)
	if !validEmail(email) {
		return httpx.Validation(map[string]string{"email": "请输入有效的邮箱地址"})
	}
	if err := a.verifyTurnstile(r, req.TurnstileToken); err != nil {
		return err
	}
	if a.mail == nil {
		return noContent(w) // never reveal anything; UI hides the flow via passwordResetAvailable=false
	}
	// Look up and mail asynchronously so timing does not reveal whether the email exists.
	a.bg.Add(1)
	go func() {
		defer a.bg.Done()
		ctx, cancel := context.WithTimeout(a.base, 2*time.Minute)
		defer cancel()
		if err := a.mailResetLinks(ctx, email); err != nil {
			a.log.Warn("password reset mail", "err", err)
		}
	}()
	return noContent(w)
}

func (a *App) mailResetLinks(ctx context.Context, email string) error {
	call, err := a.edge.AsAdmin(ctx, a.cfg.EdgeAPI.AdminID)
	if err != nil {
		return err
	}
	defer call.Done()
	resp, err := call.User().ListEnabledUsers(call.Ctx, &pb.ListEnabledUsersRequest{Keyword: email, MobileIsVerified: -1, Offset: 0, Size: 20})
	if err != nil {
		return err
	}
	for _, u := range resp.Users {
		if !u.IsOn || !strings.EqualFold(u.Email, email) {
			continue
		}
		raw, err := a.store.CreateEmailToken(ctx, store.PurposeReset, u.Id, u.Email, resetTTL, a.now())
		if err != nil {
			return err
		}
		link := a.consoleURL() + "/reset-password?token=" + raw
		body := fmt.Sprintf("%s，您好：\n\n我们收到了重置 %s 账号（用户名 %s）密码的请求。请在 1 小时内点击以下链接设置新密码：\n\n%s\n\n如果这不是您的操作，请忽略本邮件，您的密码不会改变。\n",
			u.Username, a.rs().ProductName, u.Username, link)
		if err := a.mail.Send(u.Email, a.rs().ProductName+" 重置密码", body); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) resetPassword(w http.ResponseWriter, r *http.Request) error {
	if err := a.authLimit(r); err != nil {
		return err
	}
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	if msg := passwordProblem(req.Password); msg != "" {
		return httpx.Validation(map[string]string{"password": msg})
	}
	ctx := r.Context()
	userID, email, err := a.store.ConsumeEmailToken(ctx, store.PurposeReset, strings.TrimSpace(req.Token), a.now())
	if errors.Is(err, store.ErrNotFound) {
		return httpx.Errorf(http.StatusBadRequest, "invalid_token", "链接无效或已过期")
	}
	if err != nil {
		return err
	}
	call, err := a.edge.AsUser(ctx, userID)
	if err != nil {
		return err
	}
	defer call.Done()
	u, err := call.User().FindEnabledUser(call.Ctx, &pb.FindEnabledUserRequest{UserId: userID})
	if err != nil {
		return err
	}
	if u.User == nil || !u.User.IsOn {
		return httpx.Errorf(http.StatusBadRequest, "invalid_token", "链接无效或已过期")
	}
	if _, err := call.User().UpdateUserLogin(call.Ctx, &pb.UpdateUserLoginRequest{UserId: userID, Username: u.User.Username, Password: req.Password}); err != nil {
		return err
	}
	_ = a.sessions.DeleteSessionsFor(ctx, store.KindUser, userID, "")
	if strings.EqualFold(u.User.Email, email) {
		_ = a.store.MarkEmailVerified(ctx, userID, a.now())
	}
	a.clearLoginFailures(ctx, store.KindUser, u.User.Username)
	a.audit(r, "user", userID, u.User.Username, "通过邮件重置密码", "warning")
	return noContent(w)
}
