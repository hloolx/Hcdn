package app

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
)

type certResp struct {
	ID         int64    `json:"id"`
	Name       string   `json:"name"`
	Domains    []string `json:"domains"`
	Issuer     string   `json:"issuer"`
	NotBefore  int64    `json:"notBefore"`
	NotAfter   int64    `json:"notAfter"`
	IsACME     bool     `json:"isAcme"`
	AutoRenew  bool     `json:"autoRenew"`
	SitesCount int64    `json:"sitesCount"`
	Status     string   `json:"status"`
}

const expiringWindow = 30 * 24 * time.Hour

func certStatus(notAfter int64, now time.Time) string {
	switch {
	case notAfter <= now.Unix():
		return "expired"
	case notAfter-now.Unix() < int64(expiringWindow/time.Second):
		return "expiring"
	}
	return "valid"
}

func (a *App) toCert(c sslCertConfig, sites int64, autoRenew bool) certResp {
	issuer := ""
	if len(c.CommonNames) > 0 {
		issuer = c.CommonNames[0]
	}
	domains := c.DNSNames
	if domains == nil {
		domains = []string{}
	}
	return certResp{
		ID: c.ID, Name: c.Name, Domains: domains, Issuer: issuer,
		NotBefore: c.TimeBeginAt, NotAfter: c.TimeEndAt, IsACME: c.IsACME,
		AutoRenew: autoRenew, SitesCount: sites, Status: certStatus(c.TimeEndAt, a.now()),
	}
}

// acmeAutoRenew maps certificate ids to the autoRenew flag of their ACME task.
func acmeAutoRenew(call *edgeapi.Call, userID, adminID int64) map[int64]bool {
	out := map[int64]bool{}
	resp, err := call.ACMETask().ListEnabledACMETasks(call.Ctx, &pb.ListEnabledACMETasksRequest{UserId: userID, AdminId: adminID, Offset: 0, Size: 1000, UserOnly: userID == 0 && adminID == 0})
	if err != nil {
		return out
	}
	for _, t := range resp.AcmeTasks {
		if t.SslCert != nil && t.SslCert.Id > 0 {
			out[t.SslCert.Id] = out[t.SslCert.Id] || t.AutoRenew
		}
	}
	return out
}

// enrichCerts adds sitesCount and autoRenew.
func (a *App) enrichCerts(call *edgeapi.Call, certs []sslCertConfig, renew map[int64]bool) []certResp {
	out := make([]certResp, len(certs))
	parallel(len(certs), 8, func(i int) {
		var n int64
		if resp, err := call.Server().CountAllEnabledServersWithSSLCertId(call.Ctx, &pb.CountAllEnabledServersWithSSLCertIdRequest{SslCertId: certs[i].ID}); err == nil {
			n = resp.Count
		}
		out[i] = a.toCert(certs[i], n, renew[certs[i].ID])
	})
	return out
}

func (a *App) listCerts(w http.ResponseWriter, r *http.Request, p *principal) error {
	page, size := httpx.Paging(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	cnt, err := call.SSLCert().CountSSLCerts(call.Ctx, &pb.CountSSLCertRequest{UserId: p.id(), Keyword: keyword})
	if err != nil {
		return err
	}
	resp, err := call.SSLCert().ListSSLCerts(call.Ctx, &pb.ListSSLCertsRequest{UserId: p.id(), Keyword: keyword, Offset: (page - 1) * size, Size: size})
	if err != nil {
		return err
	}
	var certs []sslCertConfig
	if err := json.Unmarshal(resp.SslCertsJSON, &certs); err != nil {
		return err
	}
	items := a.enrichCerts(call, certs, acmeAutoRenew(call, p.id(), 0))
	return writeJSON(w, httpx.Page[certResp]{Items: items, Total: cnt.Count, Page: page, PageSize: size})
}

// parseCertPair validates PEM data like sslconfigs.SSLCertConfig.Init does.
func parseCertPair(certPEM, keyPEM string) (*sslCertConfig, error) {
	if len(certPEM) > 64<<10 || len(keyPEM) > 64<<10 {
		return nil, httpx.Validation(map[string]string{"certPem": "证书或私钥过大"})
	}
	pair, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
	if err != nil {
		return nil, httpx.Validation(map[string]string{"certPem": "证书与私钥无效或不匹配"})
	}
	c := &sslCertConfig{IsOn: true, DNSNames: []string{}, CommonNames: []string{}}
	for i, der := range pair.Certificate {
		x, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, httpx.Validation(map[string]string{"certPem": "证书解析失败"})
		}
		if i == 0 {
			c.TimeBeginAt, c.TimeEndAt = x.NotBefore.Unix(), x.NotAfter.Unix()
			if x.IsCA {
				return nil, httpx.Validation(map[string]string{"certPem": "请上传站点证书（而不是 CA 证书）"})
			}
			for _, d := range x.DNSNames {
				if !slices.Contains(c.DNSNames, d) {
					c.DNSNames = append(c.DNSNames, d)
				}
			}
			for _, ip := range x.IPAddresses {
				c.DNSNames = append(c.DNSNames, ip.String())
			}
			if len(c.DNSNames) == 0 && x.Subject.CommonName != "" {
				c.DNSNames = append(c.DNSNames, x.Subject.CommonName)
			}
		}
		c.CommonNames = append(c.CommonNames, x.Issuer.CommonName)
	}
	return c, nil
}

func (a *App) uploadCert(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		Name    string `json:"name"`
		CertPEM string `json:"certPem"`
		KeyPEM  string `json:"keyPem"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	c, err := parseCertPair(req.CertPEM, req.KeyPEM)
	if err != nil {
		return err
	}
	if c.TimeEndAt <= a.now().Unix() {
		return httpx.Validation(map[string]string{"certPem": "证书已过期"})
	}
	name := strings.TrimSpace(req.Name)
	if len([]rune(name)) > 128 {
		return httpx.Validation(map[string]string{"name": "名称不能超过 128 个字符"})
	}
	if name == "" && len(c.DNSNames) > 0 {
		name = c.DNSNames[0]
	}
	serverName := ""
	if len(c.DNSNames) > 0 {
		serverName = c.DNSNames[0]
	}
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	resp, err := call.SSLCert().CreateSSLCert(call.Ctx, &pb.CreateSSLCertRequest{
		IsOn: true, Name: name, ServerName: serverName,
		CertData: []byte(req.CertPEM), KeyData: []byte(req.KeyPEM),
		TimeBeginAt: c.TimeBeginAt, TimeEndAt: c.TimeEndAt, DnsNames: c.DNSNames, CommonNames: c.CommonNames,
	})
	if err != nil {
		return err
	}
	c.ID, c.Name = resp.SslCertId, name
	a.auditUser(r, p, "上传证书 "+name)
	httpx.WriteJSON(w, http.StatusCreated, a.toCert(*c, 0, false))
	return nil
}

func (a *App) deleteCert(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	// CheckUserCert inside EdgeAPI rejects other users' certificates.
	c, err := call.SSLCert().FindEnabledSSLCertConfig(call.Ctx, &pb.FindEnabledSSLCertConfigRequest{SslCertId: id})
	if err != nil || len(c.SslCertJSON) == 0 || string(c.SslCertJSON) == "null" {
		return httpx.NotFound()
	}
	cnt, err := call.Server().CountAllEnabledServersWithSSLCertId(call.Ctx, &pb.CountAllEnabledServersWithSSLCertIdRequest{SslCertId: id})
	if err != nil {
		return err
	}
	if cnt.Count > 0 {
		return httpx.Errorf(http.StatusConflict, "cert_in_use", "证书正在被 %d 个站点使用，请先解除关联", cnt.Count)
	}
	if _, err := call.SSLCert().DeleteSSLCert(call.Ctx, &pb.DeleteSSLCertRequest{SslCertId: id}); err != nil {
		return err
	}
	a.auditUser(r, p, "删除证书 #"+strconv.FormatInt(id, 10))
	return noContent(w)
}

// ---------------------------------------------------------------- ACME

type acmeTaskResp struct {
	ID        int64    `json:"id"`
	Domains   []string `json:"domains"`
	Status    string   `json:"status"`
	CertID    *int64   `json:"certId"`
	Error     *string  `json:"error"`
	CreatedAt int64    `json:"createdAt"`
}

func toAcmeResp(j *store.AcmeJob) acmeTaskResp {
	out := acmeTaskResp{ID: j.ID, Domains: j.Domains, Status: j.Status, CreatedAt: j.CreatedAt}
	if j.CertID > 0 {
		id := j.CertID
		out.CertID = &id
	}
	if j.Error != "" {
		e := j.Error
		out.Error = &e
	}
	return out
}

func (a *App) requestAcme(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		Domains []string `json:"domains"`
		SiteID  int64    `json:"siteId"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	f := httpx.Fields{}
	domains := normalizeDomains(req.Domains, f, "domains")
	for _, d := range domains {
		if strings.HasPrefix(d, "*.") {
			f.Add("domains", "HTTP 验证不支持泛域名证书")
		}
	}
	if len(domains) > 50 {
		f.Add("domains", "单张证书最多 50 个域名")
	}
	if err := f.Err(); err != nil {
		return err
	}
	ctx := r.Context()
	call, err := a.edge.AsUser(ctx, p.id())
	if err != nil {
		return err
	}
	// Every domain must belong to one of the customer's sites: issuance goes
	// through the edge (HTTP-01), and we must not mint certs for foreign names.
	var servers []*pb.Server
	if req.SiteID > 0 {
		s, err := ownedServer(call, p.id(), req.SiteID)
		if err != nil {
			call.Done()
			return err
		}
		servers = []*pb.Server{s}
	} else if servers, err = userServers(call, p.id(), 1000); err != nil {
		call.Done()
		return err
	}
	call.Done()
	owned := map[string]bool{}
	for _, s := range servers {
		for _, d := range domainsOf(s) {
			owned[d] = true
		}
	}
	for _, d := range domains {
		if !owned[d] {
			return httpx.Validation(map[string]string{"domains": "域名不属于您的站点：" + d})
		}
	}
	job, err := a.startAcme(ctx, p.id(), req.SiteID, domains)
	if err != nil {
		return err
	}
	a.auditUser(r, p, "申请免费证书 "+strings.Join(domains, ","))
	httpx.WriteJSON(w, http.StatusAccepted, toAcmeResp(job))
	return nil
}

func (a *App) getAcme(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	j, err := a.store.GetAcmeJob(r.Context(), p.id(), id)
	if errors.Is(err, store.ErrNotFound) {
		return httpx.NotFound()
	}
	if err != nil {
		return err
	}
	return writeJSON(w, toAcmeResp(j))
}

// startAcmeForSite issues a certificate for a site's (non-wildcard) domains
// and enables HTTPS with it when done.
func (a *App) startAcmeForSite(ctx context.Context, userID, serverID int64, domains []string) (int64, error) {
	if domains == nil {
		call, err := a.edge.AsUser(ctx, userID)
		if err != nil {
			return 0, err
		}
		s, err := ownedServer(call, userID, serverID)
		call.Done()
		if err != nil {
			return 0, err
		}
		domains = domainsOf(s)
	}
	var plain []string
	for _, d := range domains {
		if !strings.HasPrefix(d, "*.") {
			plain = append(plain, d)
		}
	}
	if len(plain) == 0 {
		return 0, errors.New("no domains eligible for HTTP-01")
	}
	if len(plain) > 50 {
		plain = plain[:50]
	}
	j, err := a.startAcme(ctx, userID, serverID, plain)
	if err != nil {
		return 0, err
	}
	return j.ID, nil
}

func (a *App) startAcme(ctx context.Context, userID, serverID int64, domains []string) (*store.AcmeJob, error) {
	j := &store.AcmeJob{UserID: userID, ServerID: serverID, Domains: domains, Status: "pending"}
	if err := a.store.CreateAcmeJob(ctx, j); err != nil {
		return nil, err
	}
	a.bg.Add(1)
	go func() {
		defer a.bg.Done()
		select {
		case a.acmeSem <- struct{}{}:
		case <-a.base.Done():
			return // restart marks the job failed
		}
		defer func() { <-a.acmeSem }()
		a.runAcme(j)
	}()
	return j, nil
}

func (a *App) runAcme(j *store.AcmeJob) {
	ctx := a.base
	fail := func(msg string, err error) {
		a.log.Warn("acme failed", "job", j.ID, "msg", msg, "err", err)
		j.Status, j.Error = "failed", msg
		_ = a.store.UpdateAcmeJob(context.WithoutCancel(ctx), j)
	}
	j.Status = "running"
	_ = a.store.UpdateAcmeJob(ctx, j)

	call, err := a.edge.AsUser(ctx, j.UserID)
	if err != nil {
		fail("服务暂不可用", err)
		return
	}
	acmeUserID, err := a.ensureAcmeUser(call, j.UserID)
	if err != nil {
		call.Done()
		fail("无法创建 ACME 账号："+errMsg(err), err)
		return
	}
	task, err := call.ACMETask().CreateACMETask(call.Ctx, &pb.CreateACMETaskRequest{
		AcmeUserId: acmeUserID, DnsDomain: j.Domains[0], Domains: j.Domains, AutoRenew: true, AuthType: "http",
	})
	call.Done()
	if err != nil {
		fail("创建证书任务失败", err)
		return
	}
	j.EdgeTaskID = task.AcmeTaskId
	_ = a.store.UpdateAcmeJob(ctx, j)

	long, err := a.edge.AsUserFor(ctx, j.UserID, 10*time.Minute)
	if err != nil {
		fail("服务暂不可用", err)
		return
	}
	res, err := long.ACMETask().RunACMETask(long.Ctx, &pb.RunACMETaskRequest{AcmeTaskId: task.AcmeTaskId})
	long.Done()
	if err != nil {
		fail("证书签发失败", err)
		return
	}
	if !res.IsOk || res.SslCertId <= 0 {
		msg := strings.TrimSpace(res.Error)
		if msg == "" {
			msg = "证书签发失败"
		}
		if len(msg) > 500 {
			msg = msg[:500]
		}
		fail(msg, nil)
		return
	}
	j.Status, j.CertID = "success", res.SslCertId
	_ = a.store.UpdateAcmeJob(ctx, j)

	if j.ServerID > 0 {
		if err := a.attachCert(ctx, j.UserID, j.ServerID, res.SslCertId); err != nil {
			a.log.Warn("attach acme cert", "server", j.ServerID, "err", err)
		}
	}
}

func errMsg(err error) string {
	var he *httpx.Error
	if errors.As(err, &he) {
		return he.Message
	}
	return "请稍后重试"
}

// ensureAcmeUser returns the customer's Let's Encrypt account (created on demand).
func (a *App) ensureAcmeUser(call *edgeapi.Call, userID int64) (int64, error) {
	list, err := call.ACMEUser().ListACMEUsers(call.Ctx, &pb.ListACMEUsersRequest{UserId: userID, Offset: 0, Size: 100})
	if err != nil {
		return 0, err
	}
	for _, u := range list.AcmeUsers {
		if u.AcmeProviderCode == "" || u.AcmeProviderCode == "letsencrypt" {
			return u.Id, nil
		}
	}
	u, err := call.User().FindEnabledUser(call.Ctx, &pb.FindEnabledUserRequest{UserId: userID})
	if err != nil {
		return 0, err
	}
	if u.User == nil || !validEmail(u.User.Email) {
		return 0, httpx.Validation(map[string]string{"email": "请先在账号设置中填写有效邮箱"})
	}
	created, err := call.ACMEUser().CreateACMEUser(call.Ctx, &pb.CreateACMEUserRequest{
		Email: u.User.Email, Description: "Hcdn console", AcmeProviderCode: "letsencrypt",
	})
	if err != nil {
		return 0, err
	}
	return created.AcmeUserId, nil
}

// attachCert enables HTTPS on a site with certID, keeping its other options.
func (a *App) attachCert(ctx context.Context, userID, serverID, certID int64) error {
	call, err := a.edge.AsUser(ctx, userID)
	if err != nil {
		return err
	}
	defer call.Done()
	s, err := ownedServer(call, userID, serverID)
	if err != nil {
		return err
	}
	meta := a.siteMeta(ctx, serverID)
	cur, err := a.loadHTTPS(call, s, meta)
	if err != nil {
		return err
	}
	opt := cur
	opt.HTTP2 = cur.HTTP2 || cur.CertID == nil // sensible default for a fresh policy
	if cur.CertID == nil {
		opt.MinTLSVersion = "1.2"
	}
	opt.ForceRedirect = meta != nil && meta.ForceHTTPS
	return a.applyHTTPS(call, s, true, certID, opt)
}
