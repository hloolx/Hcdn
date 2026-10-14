package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/config"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
)

// ---------------------------------------------------------------- users

type adminUserResp struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	Email       string `json:"email"`
	Fullname    string `json:"fullname"`
	IsOn        bool   `json:"isOn"`
	SitesCount  int64  `json:"sitesCount"`
	ClusterID   int64  `json:"clusterId"`
	ClusterName string `json:"clusterName"`
	CreatedAt   int64  `json:"createdAt"`
	LastLoginAt *int64 `json:"lastLoginAt"`
}

func (a *App) toAdminUsers(ctx context.Context, call *edgeapi.Call, users []*pb.User) []adminUserResp {
	ids := make([]int64, len(users))
	for i, u := range users {
		ids[i] = u.Id
	}
	logins, _ := a.store.LastLogins(ctx, ids)
	clusters := map[int64]string{}
	if resp, err := call.NodeCluster().FindAllEnabledNodeClusters(call.Ctx, &pb.FindAllEnabledNodeClustersRequest{}); err == nil {
		for _, c := range resp.NodeClusters {
			clusters[c.Id] = c.Name
		}
	}
	out := make([]adminUserResp, len(users))
	parallel(len(users), 8, func(i int) {
		u := users[i]
		r := adminUserResp{ID: u.Id, Username: u.Username, Email: u.Email, Fullname: u.Fullname, IsOn: u.IsOn, CreatedAt: u.CreatedAt}
		if u.NodeCluster != nil && u.NodeCluster.Id > 0 {
			r.ClusterID = u.NodeCluster.Id
		} else if c, err := call.User().FindUserNodeClusterId(call.Ctx, &pb.FindUserNodeClusterIdRequest{UserId: u.Id}); err == nil {
			r.ClusterID = c.NodeClusterId
		}
		r.ClusterName = clusters[r.ClusterID]
		if c, err := call.Server().CountAllEnabledServersMatch(call.Ctx, &pb.CountAllEnabledServersMatchRequest{UserId: u.Id}); err == nil {
			r.SitesCount = c.Count
		}
		if t, ok := logins[u.Id]; ok {
			r.LastLoginAt = &t
		}
		out[i] = r
	})
	return out
}

func (a *App) adminUsers(w http.ResponseWriter, r *http.Request, p *principal) error {
	page, size := httpx.Paging(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	// MobileIsVerified -1: EdgeAPI's default 0 means "only unverified mobiles".
	cnt, err := call.User().CountAllEnabledUsers(call.Ctx, &pb.CountAllEnabledUsersRequest{Keyword: keyword, MobileIsVerified: -1})
	if err != nil {
		return err
	}
	list, err := call.User().ListEnabledUsers(call.Ctx, &pb.ListEnabledUsersRequest{Keyword: keyword, MobileIsVerified: -1, Offset: (page - 1) * size, Size: size})
	if err != nil {
		return err
	}
	return writeJSON(w, httpx.Page[adminUserResp]{Items: a.toAdminUsers(r.Context(), call, list.Users), Total: cnt.Count, Page: page, PageSize: size})
}

func findUserAdmin(call *edgeapi.Call, id int64) (*pb.User, error) {
	resp, err := call.User().FindEnabledUser(call.Ctx, &pb.FindEnabledUserRequest{UserId: id})
	if err != nil {
		return nil, err
	}
	if resp.User == nil {
		return nil, httpx.NotFound()
	}
	return resp.User, nil
}

func (a *App) adminUserOne(r *http.Request, call *edgeapi.Call, id int64) (adminUserResp, error) {
	u, err := findUserAdmin(call, id)
	if err != nil {
		return adminUserResp{}, err
	}
	return a.toAdminUsers(r.Context(), call, []*pb.User{u})[0], nil
}

func (a *App) adminCreateUser(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		Username  string `json:"username"`
		Password  string `json:"password"`
		Email     string `json:"email"`
		Fullname  string `json:"fullname"`
		ClusterID int64  `json:"clusterId"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	req.Username, req.Email, req.Fullname = strings.TrimSpace(req.Username), strings.TrimSpace(req.Email), strings.TrimSpace(req.Fullname)
	f := httpx.Fields{}
	if !validUsername(req.Username) {
		f.Add("username", "用户名为 3-32 位字母、数字、下划线、点或短横线")
	}
	if msg := passwordProblem(req.Password); msg != "" {
		f.Add("password", msg)
	}
	if req.Email != "" && !validEmail(req.Email) {
		f.Add("email", "邮箱格式不正确")
	}
	if len([]rune(req.Fullname)) > 64 {
		f.Add("fullname", "姓名不能超过 64 个字符")
	}
	if req.ClusterID <= 0 {
		f.Add("clusterId", "请选择集群")
	}
	if err := f.Err(); err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	ex, err := call.User().CheckUserUsername(call.Ctx, &pb.CheckUserUsernameRequest{Username: req.Username})
	if err != nil {
		return err
	}
	if ex.Exists {
		return httpx.Validation(map[string]string{"username": "该用户名已存在"})
	}
	fullname := req.Fullname
	if fullname == "" {
		fullname = req.Username
	}
	created, err := call.User().CreateUser(call.Ctx, &pb.CreateUserRequest{
		Username: req.Username, Password: req.Password, Fullname: fullname, Email: req.Email,
		Source: "hcdn-admin", NodeClusterId: req.ClusterID,
	})
	if err != nil {
		return err
	}
	a.auditAdmin(r, p, "创建用户 "+req.Username)
	u, err := a.adminUserOne(r, call, created.UserId)
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusCreated, u)
	return nil
}

// updateUserFull calls UpdateUser (which overwrites every field) with changes applied.
func updateUserFull(call *edgeapi.Call, u *pb.User, password string, clusterID int64) error {
	_, err := call.User().UpdateUser(call.Ctx, &pb.UpdateUserRequest{
		UserId: u.Id, Username: u.Username, Password: password, Fullname: u.Fullname, Mobile: u.Mobile, Tel: u.Tel,
		Email: u.Email, Remark: u.Remark, IsOn: u.IsOn, NodeClusterId: clusterID, BandwidthAlgo: u.BandwidthAlgo,
	})
	return err
}

func (a *App) adminUpdateUser(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req struct {
		IsOn      *bool   `json:"isOn"`
		Fullname  *string `json:"fullname"`
		Email     *string `json:"email"`
		ClusterID *int64  `json:"clusterId"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	u, err := findUserAdmin(call, id)
	if err != nil {
		return err
	}
	f := httpx.Fields{}
	if req.Fullname != nil {
		u.Fullname = strings.TrimSpace(*req.Fullname)
		if u.Fullname == "" || len([]rune(u.Fullname)) > 64 {
			f.Add("fullname", "姓名为 1-64 个字符")
		}
	}
	emailChanged := false
	if req.Email != nil {
		e := strings.TrimSpace(*req.Email)
		if e != "" && !validEmail(e) {
			f.Add("email", "邮箱格式不正确")
		}
		emailChanged = !strings.EqualFold(e, u.Email)
		u.Email = e
	}
	if req.IsOn != nil {
		u.IsOn = *req.IsOn
	}
	clusterID := int64(0)
	if u.NodeCluster != nil {
		clusterID = u.NodeCluster.Id
	}
	if clusterID == 0 {
		if c, err := call.User().FindUserNodeClusterId(call.Ctx, &pb.FindUserNodeClusterIdRequest{UserId: id}); err == nil {
			clusterID = c.NodeClusterId
		}
	}
	if req.ClusterID != nil {
		if *req.ClusterID <= 0 {
			f.Add("clusterId", "请选择集群")
		}
		clusterID = *req.ClusterID
	}
	if err := f.Err(); err != nil {
		return err
	}
	if err := updateUserFull(call, u, "", clusterID); err != nil {
		return err
	}
	if !u.IsOn {
		_ = a.sessions.DeleteSessionsFor(r.Context(), store.KindUser, id, "")
	}
	if emailChanged {
		_ = a.store.ClearEmailVerified(r.Context(), id)
	}
	a.auditAdmin(r, p, "修改用户 "+u.Username)
	out, err := a.adminUserOne(r, call, id)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}

func (a *App) adminResetPassword(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	if msg := passwordProblem(req.Password); msg != "" {
		return httpx.Validation(map[string]string{"password": msg})
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	u, err := findUserAdmin(call, id)
	if err != nil {
		return err
	}
	clusterID := int64(0)
	if c, err := call.User().FindUserNodeClusterId(call.Ctx, &pb.FindUserNodeClusterIdRequest{UserId: id}); err == nil {
		clusterID = c.NodeClusterId
	}
	if err := updateUserFull(call, u, req.Password, clusterID); err != nil {
		return err
	}
	_ = a.sessions.DeleteSessionsFor(r.Context(), store.KindUser, id, "")
	a.audit(r, "admin", p.id(), p.sess.Username, "重置用户 "+u.Username+" 的密码", "warning")
	return noContent(w)
}

func (a *App) adminDeleteUser(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	u, err := findUserAdmin(call, id)
	if err != nil {
		return err
	}
	if _, err := call.User().DeleteUser(call.Ctx, &pb.DeleteUserRequest{UserId: id}); err != nil {
		return err
	}
	_ = a.sessions.DeleteSessionsFor(r.Context(), store.KindUser, id, "")
	a.audit(r, "admin", p.id(), p.sess.Username, "删除用户 "+u.Username, "warning")
	return noContent(w)
}

// ---------------------------------------------------------------- sites (all tenants)

type adminSiteResp struct {
	siteResp
	UserID      int64  `json:"userId"`
	Username    string `json:"username"`
	ClusterID   int64  `json:"clusterId"`
	ClusterName string `json:"clusterName"`
}

func (a *App) toAdminSite(ctx context.Context, s *pb.Server, meta *store.SiteMeta) adminSiteResp {
	out := adminSiteResp{siteResp: a.summarize(ctx, s, meta), UserID: s.UserId}
	if s.User != nil {
		out.Username = s.User.Username
		if out.Username == "" {
			out.Username = s.User.Fullname
		}
	}
	if s.NodeCluster != nil {
		out.ClusterID, out.ClusterName = s.NodeCluster.Id, s.NodeCluster.Name
	}
	return out
}

func (a *App) adminSites(w http.ResponseWriter, r *http.Request, p *principal) error {
	page, size := httpx.Paging(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	userID := httpx.QueryInt(r, "userId", 0)
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	cnt, err := call.Server().CountAllEnabledServersMatch(call.Ctx, &pb.CountAllEnabledServersMatchRequest{UserId: userID, Keyword: keyword, ProtocolFamily: "http"})
	if err != nil {
		return err
	}
	list, err := call.Server().ListEnabledServersMatch(call.Ctx, &pb.ListEnabledServersMatchRequest{
		UserId: userID, Keyword: keyword, ProtocolFamily: "http", Offset: (page - 1) * size, Size: size,
	})
	if err != nil {
		return err
	}
	ids := make([]int64, len(list.Servers))
	for i, s := range list.Servers {
		ids[i] = s.Id
	}
	metas, _ := a.store.SiteMetas(r.Context(), ids)
	items := make([]adminSiteResp, 0, len(list.Servers))
	for _, s := range list.Servers {
		items = append(items, a.toAdminSite(r.Context(), s, metas[s.Id]))
	}
	return writeJSON(w, httpx.Page[adminSiteResp]{Items: items, Total: cnt.Count, Page: page, PageSize: size})
}

func (a *App) adminUpdateSite(w http.ResponseWriter, r *http.Request, p *principal) error {
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
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	if _, err := call.Server().UpdateServerIsOn(call.Ctx, &pb.UpdateServerIsOnRequest{ServerId: id, IsOn: *req.IsOn}); err != nil {
		return err
	}
	resp, err := call.Server().FindEnabledServer(call.Ctx, &pb.FindEnabledServerRequest{ServerId: id, IgnoreSSLCerts: true})
	if err != nil {
		return err
	}
	if resp.Server == nil {
		return httpx.NotFound()
	}
	a.auditAdmin(r, p, map[bool]string{true: "启用", false: "停用"}[*req.IsOn]+"站点 "+resp.Server.Name)
	return writeJSON(w, a.toAdminSite(r.Context(), resp.Server, a.siteMeta(r.Context(), id)))
}

// ---------------------------------------------------------------- certs (all tenants)

type adminCertResp struct {
	certResp
	UserID   int64  `json:"userId"`
	Username string `json:"username"`
}

func (a *App) adminCerts(w http.ResponseWriter, r *http.Request, p *principal) error {
	page, size := httpx.Paging(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	userID := httpx.QueryInt(r, "userId", 0)
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	// Customer certificates (userOnly) or one customer's; EdgeAPI's JSON does
	// not carry the owner, so username is only known when filtering by user.
	cnt, err := call.SSLCert().CountSSLCerts(call.Ctx, &pb.CountSSLCertRequest{Keyword: keyword, UserId: userID, UserOnly: userID == 0})
	if err != nil {
		return err
	}
	resp, err := call.SSLCert().ListSSLCerts(call.Ctx, &pb.ListSSLCertsRequest{Keyword: keyword, UserId: userID, UserOnly: userID == 0, Offset: (page - 1) * size, Size: size})
	if err != nil {
		return err
	}
	var certs []sslCertConfig
	if err := json.Unmarshal(resp.SslCertsJSON, &certs); err != nil {
		return err
	}
	username := ""
	if userID > 0 {
		if u, err := findUserAdmin(call, userID); err == nil {
			username = u.Username
		}
	}
	base := a.enrichCerts(call, certs, acmeAutoRenew(call, userID, 0))
	items := make([]adminCertResp, len(base))
	for i, c := range base {
		items[i] = adminCertResp{certResp: c, UserID: userID, Username: username}
	}
	return writeJSON(w, httpx.Page[adminCertResp]{Items: items, Total: cnt.Count, Page: page, PageSize: size})
}

// ---------------------------------------------------------------- DNS

type dnsProviderResp struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Type         string `json:"type"`
	DomainsCount int64  `json:"domainsCount"`
	CreatedAt    int64  `json:"createdAt"`
}

type dnsDomainResp struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	ProviderID   int64  `json:"providerId"`
	ProviderName string `json:"providerName"`
	IsOn         bool   `json:"isOn"`
	RecordsCount int64  `json:"recordsCount"`
	SyncedAt     *int64 `json:"syncedAt"`
}

func cloudflareProviders(call *edgeapi.Call) ([]*pb.DNSProvider, error) {
	resp, err := call.DNSProvider().FindAllEnabledDNSProviders(call.Ctx, &pb.FindAllEnabledDNSProvidersRequest{})
	if err != nil {
		return nil, err
	}
	var out []*pb.DNSProvider
	for _, p := range resp.DnsProviders {
		if strings.EqualFold(p.Type, "cloudFlare") {
			p.ApiParamsJSON = nil // never forward credentials
			out = append(out, p)
		}
	}
	return out, nil
}

func (a *App) adminDNSProviders(w http.ResponseWriter, r *http.Request, p *principal) error {
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	provs, err := cloudflareProviders(call)
	if err != nil {
		return err
	}
	out := make([]dnsProviderResp, len(provs))
	parallel(len(provs), 8, func(i int) {
		pr := provs[i]
		out[i] = dnsProviderResp{ID: pr.Id, Name: pr.Name, Type: "cloudflare", CreatedAt: pr.DataUpdatedAt}
		if c, err := call.DNSDomain().CountAllDNSDomainsWithDNSProviderId(call.Ctx, &pb.CountAllDNSDomainsWithDNSProviderIdRequest{DnsProviderId: pr.Id}); err == nil {
			out[i].DomainsCount = c.Count
		}
	})
	return writeJSON(w, out)
}

func (a *App) adminCreateDNSProvider(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		Name     string `json:"name"`
		Type     string `json:"type"`
		APIToken string `json:"apiToken"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	f := httpx.Fields{}
	req.Name, req.APIToken = strings.TrimSpace(req.Name), strings.TrimSpace(req.APIToken)
	if req.Name == "" || len([]rune(req.Name)) > 64 {
		f.Add("name", "名称为 1-64 个字符")
	}
	if req.Type != "cloudflare" {
		f.Add("type", "目前仅支持 cloudflare")
	}
	if len(req.APIToken) < 20 || len(req.APIToken) > 256 {
		f.Add("apiToken", "请填写有效的 Cloudflare API Token")
	}
	if err := f.Err(); err != nil {
		return err
	}
	params, _ := json.Marshal(map[string]string{"apiToken": req.APIToken})
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	resp, err := call.DNSProvider().CreateDNSProvider(call.Ctx, &pb.CreateDNSProviderRequest{Name: req.Name, Type: "cloudFlare", ApiParamsJSON: params})
	if err != nil {
		return err
	}
	a.auditAdmin(r, p, "添加 DNS 服务商 "+req.Name)
	httpx.WriteJSON(w, http.StatusCreated, dnsProviderResp{ID: resp.DnsProviderId, Name: req.Name, Type: "cloudflare", CreatedAt: a.now().Unix()})
	return nil
}

func (a *App) adminDeleteDNSProvider(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	if _, err := call.DNSProvider().DeleteDNSProvider(call.Ctx, &pb.DeleteDNSProviderRequest{DnsProviderId: id}); err != nil {
		return err
	}
	a.auditAdmin(r, p, "删除 DNS 服务商 #"+strconv.FormatInt(id, 10))
	return noContent(w)
}

func toDNSDomain(d *pb.DNSDomain, providerName string) dnsDomainResp {
	out := dnsDomainResp{ID: d.Id, Name: d.Name, ProviderID: d.ProviderId, ProviderName: providerName, IsOn: d.IsOn,
		RecordsCount: d.CountServerRecords + d.CountNodeRecords}
	if d.DataUpdatedAt > 0 {
		t := d.DataUpdatedAt
		out.SyncedAt = &t
	}
	return out
}

func (a *App) adminDNSDomains(w http.ResponseWriter, r *http.Request, p *principal) error {
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	provs, err := cloudflareProviders(call)
	if err != nil {
		return err
	}
	out := []dnsDomainResp{}
	for _, pr := range provs {
		resp, err := call.DNSDomain().FindAllDNSDomainsWithDNSProviderId(call.Ctx, &pb.FindAllDNSDomainsWithDNSProviderIdRequest{DnsProviderId: pr.Id})
		if err != nil {
			return err
		}
		for _, d := range resp.DnsDomains {
			if d.IsDeleted {
				continue
			}
			if d.ProviderId == 0 {
				d.ProviderId = pr.Id
			}
			out = append(out, toDNSDomain(d, pr.Name))
		}
	}
	return writeJSON(w, out)
}

func (a *App) findDNSDomain(call *edgeapi.Call, id int64) (dnsDomainResp, error) {
	resp, err := call.DNSDomain().FindDNSDomain(call.Ctx, &pb.FindDNSDomainRequest{DnsDomainId: id})
	if err != nil {
		return dnsDomainResp{}, err
	}
	if resp.DnsDomain == nil {
		return dnsDomainResp{}, httpx.NotFound()
	}
	name := ""
	if pr, err := call.DNSProvider().FindEnabledDNSProvider(call.Ctx, &pb.FindEnabledDNSProviderRequest{DnsProviderId: resp.DnsDomain.ProviderId}); err == nil && pr.DnsProvider != nil {
		name = pr.DnsProvider.Name
	}
	return toDNSDomain(resp.DnsDomain, name), nil
}

func (a *App) adminCreateDNSDomain(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		ProviderID int64  `json:"providerId"`
		Name       string `json:"name"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	req.Name = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(req.Name)), ".")
	f := httpx.Fields{}
	if req.ProviderID <= 0 {
		f.Add("providerId", "请选择 DNS 服务商")
	}
	if !validHostname(req.Name, false) {
		f.Add("name", "域名格式不正确")
	}
	if err := f.Err(); err != nil {
		return err
	}
	call, err := a.adminCall(r, p)
	if err != nil {
		return err
	}
	defer call.Done()
	resp, err := call.DNSDomain().CreateDNSDomain(call.Ctx, &pb.CreateDNSDomainRequest{DnsProviderId: req.ProviderID, Name: req.Name})
	if err != nil {
		return err
	}
	a.auditAdmin(r, p, "添加 DNS 域名 "+req.Name)
	d, err := a.findDNSDomain(call, resp.DnsDomainId)
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusCreated, d)
	return nil
}

func (a *App) adminSyncDNSDomain(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	call, err := a.edge.AsAdmin(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	res, err := call.DNSDomain().SyncDNSDomainData(call.Ctx, &pb.SyncDNSDomainDataRequest{DnsDomainId: id})
	if err != nil {
		return err
	}
	if !res.IsOk {
		msg := res.Error
		if msg == "" {
			msg = "同步失败"
		}
		return httpx.Errorf(http.StatusBadGateway, "sync_failed", "%s", msg)
	}
	a.auditAdmin(r, p, "同步 DNS 域名 #"+strconv.FormatInt(id, 10))
	d, err := a.findDNSDomain(call, id)
	if err != nil {
		return err
	}
	return writeJSON(w, d)
}

// ---------------------------------------------------------------- settings & audit

type systemSettingsResp struct {
	ProductName      string       `json:"productName"`
	ConsoleURL       string       `json:"consoleUrl"`
	Registration     registration `json:"registration"`
	AdminIPAllowlist []string     `json:"adminIpAllowlist"`
	SMTP             struct {
		Host       string `json:"host"`
		Port       int    `json:"port"`
		Username   string `json:"username"`
		From       string `json:"from"`
		Configured bool   `json:"configured"`
	} `json:"smtp"`
}

func (a *App) settingsResp() systemSettingsResp {
	rs := a.rs()
	out := systemSettingsResp{ProductName: rs.ProductName, ConsoleURL: rs.ConsoleURL, Registration: rs.Registration, AdminIPAllowlist: rs.AdminIPAllowlist}
	if out.AdminIPAllowlist == nil {
		out.AdminIPAllowlist = []string{}
	}
	s := a.cfg.SMTP
	out.SMTP.Host, out.SMTP.Port, out.SMTP.Username, out.SMTP.From, out.SMTP.Configured = s.Host, s.Port, s.Username, s.From, s.Configured()
	return out
}

func (a *App) adminSettings(w http.ResponseWriter, r *http.Request, p *principal) error {
	return writeJSON(w, a.settingsResp())
}

func (a *App) adminUpdateSettings(w http.ResponseWriter, r *http.Request, p *principal) error {
	adm, err := a.findAdmin(r.Context(), p.id())
	if err != nil {
		return err
	}
	if adm == nil || !adm.IsSuper {
		return httpx.Forbidden()
	}
	var req struct {
		ProductName      *string       `json:"productName"`
		ConsoleURL       *string       `json:"consoleUrl"`
		Registration     *registration `json:"registration"`
		AdminIPAllowlist *[]string     `json:"adminIpAllowlist"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	cur := *a.rs()
	f := httpx.Fields{}
	if req.ProductName != nil {
		cur.ProductName = strings.TrimSpace(*req.ProductName)
		if cur.ProductName == "" || len([]rune(cur.ProductName)) > 64 {
			f.Add("productName", "产品名称为 1-64 个字符")
		}
	}
	if req.ConsoleURL != nil {
		cur.ConsoleURL = strings.TrimRight(strings.TrimSpace(*req.ConsoleURL), "/")
		if cur.ConsoleURL != "" {
			u, err := url.Parse(cur.ConsoleURL)
			if err != nil || u.Scheme != "https" || u.Host == "" || u.Path != "" {
				f.Add("consoleUrl", "请填写 https://域名 形式的地址")
			}
		}
	}
	if req.Registration != nil {
		cur.Registration = *req.Registration
		if cur.Registration.DefaultClusterID < 0 {
			f.Add("registration.defaultClusterId", "集群无效")
		}
	}
	if req.AdminIPAllowlist != nil {
		list := []string{}
		for _, s := range *req.AdminIPAllowlist {
			if s = strings.TrimSpace(s); s != "" {
				list = append(list, s)
			}
		}
		prefixes, err := config.ParsePrefixes(list)
		if err != nil {
			f.Add("adminIpAllowlist", "IP/CIDR 格式不正确")
		} else if len(prefixes) > 0 {
			// Refuse a list that would lock out the admin making the change.
			ip := clientIPAddr(r)
			ok := false
			for _, pf := range prefixes {
				ok = ok || pf.Contains(ip)
			}
			if !ok {
				f.Add("adminIpAllowlist", "白名单必须包含您当前的 IP（"+ip.String()+"）")
			}
		}
		cur.AdminIPAllowlist = list
	}
	if err := f.Err(); err != nil {
		return err
	}
	if cur.Registration.DefaultClusterID > 0 {
		call, err := a.adminCall(r, p)
		if err != nil {
			return err
		}
		_, err = findCluster(call, cur.Registration.DefaultClusterID)
		call.Done()
		if err != nil {
			return httpx.Validation(map[string]string{"registration.defaultClusterId": "集群不存在"})
		}
	}
	if err := a.store.PutSetting(r.Context(), settingSystem, &cur); err != nil {
		return err
	}
	a.applySettings(&cur)
	a.audit(r, "admin", p.id(), p.sess.Username, "修改系统设置", "warning")
	return writeJSON(w, a.settingsResp())
}

func (a *App) adminAuditLogs(w http.ResponseWriter, r *http.Request, p *principal) error {
	page, size := httpx.Paging(r)
	q := r.URL.Query()
	actorType := q.Get("actorType")
	switch actorType {
	case "", "admin", "user", "system":
	default:
		return httpx.Validation(map[string]string{"actorType": "actorType 无效"})
	}
	keyword := strings.TrimSpace(q.Get("keyword"))
	if len(keyword) > 128 {
		keyword = keyword[:128]
	}
	items, total, err := a.store.ListAudit(r.Context(), actorType, keyword, (page-1)*size, size)
	if err != nil {
		return err
	}
	return writeJSON(w, httpx.Page[store.Activity]{Items: items, Total: total, Page: page, PageSize: size})
}
