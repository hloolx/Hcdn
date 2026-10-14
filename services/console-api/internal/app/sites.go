package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/netip"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
)

// ---------------------------------------------------------------- contract types

type origin struct {
	Protocol string `json:"protocol"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Weight   int    `json:"weight,omitempty"`
}

type siteHTTPS struct {
	Enabled       bool   `json:"enabled"`
	CertID        *int64 `json:"certId"`
	AutoCert      bool   `json:"autoCert"`
	ForceRedirect bool   `json:"forceRedirect"`
	HSTS          bool   `json:"hsts"`
	HTTP2         bool   `json:"http2"`
	MinTLSVersion string `json:"minTlsVersion"`
}

type traffic24h struct {
	Bytes    int64 `json:"bytes"`
	Requests int64 `json:"requests"`
}

type siteResp struct {
	ID           int64            `json:"id"`
	Name         string           `json:"name"`
	Domains      []string         `json:"domains"`
	CNAME        string           `json:"cname"`
	Status       string           `json:"status"`
	IsOn         bool             `json:"isOn"`
	Origins      []origin         `json:"origins"`
	OriginHost   string           `json:"originHost"`
	HTTPS        siteHTTPS        `json:"https"`
	CreatedAt    int64            `json:"createdAt"`
	Traffic24h   *traffic24h      `json:"traffic24h"`
	DNSCheckedAt *int64           `json:"dnsCheckedAt"`
	DNSChecks    []store.DNSCheck `json:"dnsChecks"`
}

// ---------------------------------------------------------------- validation

func validHostname(h string, allowWildcard bool) bool {
	if allowWildcard && strings.HasPrefix(h, "*.") {
		h = h[2:]
	}
	if len(h) == 0 || len(h) > 253 || !strings.Contains(h, ".") {
		return false
	}
	for _, label := range strings.Split(h, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			c := label[i]
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	// The last label must not be all-numeric (that would be an IP).
	last := h[strings.LastIndex(h, ".")+1:]
	if _, err := strconv.Atoi(last); err == nil {
		return false
	}
	return true
}

func normalizeDomains(in []string, f httpx.Fields, field string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, d := range in {
		d = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(d)), ".")
		if d == "" || seen[d] {
			continue
		}
		if !validHostname(d, true) {
			f.Add(field, "域名格式不正确："+d+"（中文域名请使用 punycode）")
			continue
		}
		seen[d] = true
		out = append(out, d)
	}
	if len(out) == 0 {
		f.Add(field, "请至少填写一个域名")
	}
	if len(out) > 100 {
		f.Add(field, "单个站点最多 100 个域名")
	}
	return out
}

func normalizeOrigins(in []origin, f httpx.Fields) []origin {
	out := []origin{}
	for _, o := range in {
		o.Protocol = strings.ToLower(strings.TrimSpace(o.Protocol))
		o.Host = strings.ToLower(strings.Trim(strings.TrimSpace(o.Host), "[]"))
		if o.Protocol != "http" && o.Protocol != "https" {
			f.Add("origins", "回源协议只能是 http 或 https")
			continue
		}
		if ip, err := netip.ParseAddr(o.Host); err == nil {
			if !ip.IsGlobalUnicast() || ip.IsPrivate() {
				f.Add("origins", "源站地址不能是内网或保留地址："+o.Host)
				continue
			}
		} else if !validHostname(o.Host, false) {
			f.Add("origins", "源站地址格式不正确："+o.Host)
			continue
		}
		if o.Port == 0 {
			o.Port = 80
			if o.Protocol == "https" {
				o.Port = 443
			}
		}
		if o.Port < 1 || o.Port > 65535 {
			f.Add("origins", "端口范围为 1-65535")
			continue
		}
		if o.Weight == 0 {
			o.Weight = 10
		}
		if o.Weight < 1 || o.Weight > 100 {
			f.Add("origins", "权重范围为 1-100")
			continue
		}
		out = append(out, o)
	}
	if len(out) == 0 {
		f.Add("origins", "请至少填写一个源站")
	}
	if len(out) > 20 {
		f.Add("origins", "最多 20 个源站")
	}
	return out
}

func normalizeOriginHost(h string, f httpx.Fields) string {
	h = strings.ToLower(strings.TrimSpace(h))
	if h == "" {
		return ""
	}
	host := h
	if i := strings.LastIndex(h, ":"); i > 0 && !strings.Contains(h, "]") {
		host = h[:i]
		if p, err := strconv.Atoi(h[i+1:]); err != nil || p < 1 || p > 65535 {
			f.Add("originHost", "回源 Host 格式不正确")
			return ""
		}
	}
	if _, err := netip.ParseAddr(host); err != nil && !validHostname(host, false) {
		f.Add("originHost", "回源 Host 格式不正确")
		return ""
	}
	return h
}

// ---------------------------------------------------------------- loading

// clusterDNSDomain returns the DNS domain bound to a cluster (cached).
func (a *App) clusterDNSDomain(ctx context.Context, clusterID int64) string {
	if clusterID <= 0 {
		return a.cfg.CNAMEDomain
	}
	a.dnsMu.Lock()
	if e, ok := a.dnsCache[clusterID]; ok && time.Since(e.at) < 5*time.Minute {
		a.dnsMu.Unlock()
		return e.domain
	}
	a.dnsMu.Unlock()
	domain := a.cfg.CNAMEDomain
	if call, err := a.edge.AsAdmin(ctx, a.cfg.EdgeAPI.AdminID); err == nil {
		resp, err := call.NodeCluster().FindEnabledNodeClusterDNS(call.Ctx, &pb.FindEnabledNodeClusterDNSRequest{NodeClusterId: clusterID})
		call.Done()
		if err == nil && resp.Domain != nil && resp.Domain.Name != "" {
			domain = resp.Domain.Name
		}
	}
	a.dnsMu.Lock()
	a.dnsCache[clusterID] = dnsCacheEntry{domain: domain, at: time.Now()}
	a.dnsMu.Unlock()
	return domain
}

type dnsCacheEntry struct {
	domain string
	at     time.Time
}

func cnameOf(dnsName, domain string) string {
	if dnsName == "" || domain == "" {
		return ""
	}
	return dnsName + "." + domain
}

func siteStatus(isOn bool, meta *store.SiteMeta) string {
	switch {
	case !isOn:
		return "disabled"
	case meta != nil && meta.DNSOK && meta.DNSCheckedAt > 0:
		return "active"
	}
	return "pending_dns"
}

func domainsOf(s *pb.Server) []string {
	if s.IsAuditing && len(s.AuditingServerNamesJSON) > 0 {
		if d := parseServerNames(s.AuditingServerNamesJSON); len(d) > 0 {
			return d
		}
	}
	return parseServerNames(s.ServerNamesJSON)
}

// summarize builds a list item (no per-site RPCs: origins empty, https partial).
func (a *App) summarize(ctx context.Context, s *pb.Server, meta *store.SiteMeta) siteResp {
	var clusterID int64
	if s.NodeCluster != nil {
		clusterID = s.NodeCluster.Id
	}
	https := parseProtocol(s.HttpsJSON)
	out := siteResp{
		ID:        s.Id,
		Name:      s.Name,
		Domains:   domainsOf(s),
		CNAME:     cnameOf(s.DnsName, a.clusterDNSDomain(ctx, clusterID)),
		Status:    siteStatus(s.IsOn, meta),
		IsOn:      s.IsOn,
		Origins:   []origin{},
		HTTPS:     siteHTTPS{Enabled: https.IsOn, MinTLSVersion: "1.2"},
		CreatedAt: s.CreatedAt,
		DNSChecks: []store.DNSCheck{},
	}
	if meta != nil {
		out.HTTPS.AutoCert, out.HTTPS.ForceRedirect = meta.AutoCert, meta.ForceHTTPS && https.IsOn
		if meta.DNSCheckedAt > 0 {
			t := meta.DNSCheckedAt
			out.DNSCheckedAt = &t
		}
		if meta.DNSChecks != nil {
			out.DNSChecks = meta.DNSChecks
		}
	}
	return out
}

// ownedServer loads a server as the user (EdgeAPI enforces ownership).
func ownedServer(call *edgeapi.Call, userID, serverID int64) (*pb.Server, error) {
	resp, err := call.Server().FindEnabledServer(call.Ctx, &pb.FindEnabledServerRequest{ServerId: serverID, IgnoreSSLCerts: true})
	if err != nil {
		if isNotFound(err) || mapEdgeErr(err).Status == http.StatusForbidden {
			return nil, httpx.NotFound()
		}
		return nil, err
	}
	s := resp.Server
	if s == nil || s.UserId != userID || s.Type != "httpProxy" {
		return nil, httpx.NotFound()
	}
	return s, nil
}

func (a *App) siteMeta(ctx context.Context, id int64) *store.SiteMeta {
	m, err := a.store.SiteMetas(ctx, []int64{id})
	if err != nil {
		a.log.Warn("site meta", "err", err)
	}
	return m[id]
}

// loadSite builds the full Site for an owned server.
func (a *App) loadSite(ctx context.Context, call *edgeapi.Call, userID, serverID int64) (*siteResp, error) {
	s, err := ownedServer(call, userID, serverID)
	if err != nil {
		return nil, err
	}
	meta := a.siteMeta(ctx, serverID)
	out := a.summarize(ctx, s, meta)
	if dns, err := call.Server().FindEnabledServerDNS(call.Ctx, &pb.FindEnabledServerDNSRequest{ServerId: serverID}); err == nil && dns.Domain != nil {
		out.CNAME = cnameOf(dns.DnsName, dns.Domain.Name)
	}

	// Origins and origin Host.
	var ref reverseProxyRef
	if len(s.ReverseProxyJSON) > 0 && json.Unmarshal(s.ReverseProxyJSON, &ref) == nil && ref.ReverseProxyID > 0 {
		rp, err := a.reverseProxy(call, ref.ReverseProxyID)
		if err != nil {
			return nil, err
		}
		for _, o := range rp.PrimaryOrigins {
			if !o.IsOn {
				continue
			}
			def := 80
			if o.Addr.Protocol == "https" {
				def = 443
			}
			out.Origins = append(out.Origins, origin{Protocol: o.Addr.Protocol, Host: o.Addr.Host, Port: portOf(o.Addr.PortRange, def), Weight: o.Weight})
		}
		if rp.RequestHostType == 2 {
			out.OriginHost = rp.RequestHost
		}
	}

	// HTTPS.
	h, err := a.loadHTTPS(call, s, meta)
	if err != nil {
		return nil, err
	}
	out.HTTPS = h

	if t, err := a.siteTraffic24h(call, userID, serverID); err == nil {
		out.Traffic24h = t
	} else {
		a.log.Debug("traffic24h", "err", err)
	}
	return &out, nil
}

func (a *App) reverseProxy(call *edgeapi.Call, id int64) (*reverseProxyConfig, error) {
	resp, err := call.ReverseProxy().FindEnabledReverseProxyConfig(call.Ctx, &pb.FindEnabledReverseProxyConfigRequest{ReverseProxyId: id})
	if err != nil {
		return nil, err
	}
	var rp reverseProxyConfig
	if err := json.Unmarshal(resp.ReverseProxyJSON, &rp); err != nil {
		return nil, err
	}
	return &rp, nil
}

func (a *App) webConfig(call *edgeapi.Call, serverID int64) (*webConfig, []byte, error) {
	resp, err := call.Server().FindAndInitServerWebConfig(call.Ctx, &pb.FindAndInitServerWebConfigRequest{ServerId: serverID})
	if err != nil {
		return nil, nil, err
	}
	var w webConfig
	if err := json.Unmarshal(resp.WebJSON, &w); err != nil {
		return nil, nil, err
	}
	return &w, resp.WebJSON, nil
}

func (a *App) loadHTTPS(call *edgeapi.Call, s *pb.Server, meta *store.SiteMeta) (siteHTTPS, error) {
	h := siteHTTPS{MinTLSVersion: "1.2"}
	pc := parseProtocol(s.HttpsJSON)
	h.Enabled = pc.IsOn
	if meta != nil {
		h.AutoCert = meta.AutoCert
	}
	if pc.SSLPolicyRef != nil && pc.SSLPolicyRef.SSLPolicyID > 0 {
		resp, err := call.SSLPolicy().FindEnabledSSLPolicyConfig(call.Ctx, &pb.FindEnabledSSLPolicyConfigRequest{SslPolicyId: pc.SSLPolicyRef.SSLPolicyID, IgnoreData: true})
		if err != nil {
			return h, err
		}
		var pol sslPolicyConfig
		if len(resp.SslPolicyJSON) > 0 && json.Unmarshal(resp.SslPolicyJSON, &pol) == nil {
			for _, r := range pol.CertRefs {
				if r.IsOn && r.CertID > 0 {
					id := r.CertID
					h.CertID = &id
					break
				}
			}
			h.MinTLSVersion = tlsVersionFromEdge(pol.MinVersion)
			h.HTTP2 = pol.HTTP2Enabled
			h.HSTS = pol.HSTS != nil && pol.HSTS.IsOn
		}
	}
	w, _, err := a.webConfig(call, s.Id)
	if err != nil {
		return h, err
	}
	h.ForceRedirect = w.RedirectToHTTPS != nil && w.RedirectToHTTPS.IsOn
	return h, nil
}

// ---------------------------------------------------------------- handlers

func (a *App) listSites(w http.ResponseWriter, r *http.Request, p *principal) error {
	page, size := httpx.Paging(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	cnt, err := call.Server().CountAllEnabledServersMatch(call.Ctx, &pb.CountAllEnabledServersMatchRequest{UserId: p.id(), Keyword: keyword, ProtocolFamily: "http"})
	if err != nil {
		return err
	}
	list, err := call.Server().ListEnabledServersMatch(call.Ctx, &pb.ListEnabledServersMatchRequest{
		UserId: p.id(), Keyword: keyword, ProtocolFamily: "http", Offset: (page - 1) * size, Size: size,
	})
	if err != nil {
		return err
	}
	ids := make([]int64, 0, len(list.Servers))
	for _, s := range list.Servers {
		ids = append(ids, s.Id)
	}
	metas, err := a.store.SiteMetas(r.Context(), ids)
	if err != nil {
		return err
	}
	items := make([]siteResp, 0, len(list.Servers))
	for _, s := range list.Servers {
		items = append(items, a.summarize(r.Context(), s, metas[s.Id]))
	}
	return writeJSON(w, httpx.Page[siteResp]{Items: items, Total: cnt.Count, Page: page, PageSize: size})
}

func (a *App) getSite(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	s, err := a.loadSite(r.Context(), call, p.id(), id)
	if err != nil {
		return err
	}
	return writeJSON(w, s)
}

type createSiteReq struct {
	Domains     []string `json:"domains"`
	Origins     []origin `json:"origins"`
	OriginHost  string   `json:"originHost"`
	AutoCert    bool     `json:"autoCert"`
	ForceHTTPS  bool     `json:"forceHttps"`
	CachePreset string   `json:"cachePreset"`
}

func (a *App) createSite(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req createSiteReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	f := httpx.Fields{}
	domains := normalizeDomains(req.Domains, f, "domains")
	origins := normalizeOrigins(req.Origins, f)
	originHost := normalizeOriginHost(req.OriginHost, f)
	switch req.CachePreset {
	case "":
		req.CachePreset = "static"
	case "static", "dynamic", "none":
	default:
		f.Add("cachePreset", "缓存预设无效")
	}
	if err := f.Err(); err != nil {
		return err
	}
	ctx := r.Context()
	uid := p.id()
	call, err := a.edge.AsUser(ctx, uid)
	if err != nil {
		return err
	}
	defer call.Done()

	cl, err := call.User().FindUserNodeClusterId(call.Ctx, &pb.FindUserNodeClusterIdRequest{UserId: uid})
	if err != nil {
		return err
	}
	if cl.NodeClusterId <= 0 {
		return httpx.Errorf(http.StatusConflict, "no_cluster", "账号尚未分配节点集群，请联系客服")
	}
	if err := a.checkDuplicateDomains(call, cl.NodeClusterId, domains, 0); err != nil {
		return err
	}

	rpID, err := a.createReverseProxy(call, origins, originHost)
	if err != nil {
		return err
	}
	refJSON, _ := json.Marshal(reverseProxyRef{IsOn: true, ReverseProxyID: rpID})
	created, err := call.Server().CreateServer(call.Ctx, &pb.CreateServerRequest{
		UserId:           uid,
		Type:             "httpProxy",
		Name:             domains[0],
		ServerNamesJSON:  serverNamesJSON(domains),
		HttpJSON:         httpJSON(),
		HttpsJSON:        httpsJSON(false, 0),
		ReverseProxyJSON: refJSON,
		NodeClusterId:    cl.NodeClusterId,
		IncludeNodesJSON: []byte("[]"),
		ExcludeNodesJSON: []byte("[]"),
	})
	if err != nil {
		return err
	}
	serverID := created.ServerId
	if err := a.store.SetSiteOptions(ctx, serverID, uid, req.AutoCert, req.ForceHTTPS); err != nil {
		return err
	}
	if wc, _, err := a.webConfig(call, serverID); err == nil {
		if err := a.writeCache(call, wc, cachePreset(req.CachePreset)); err != nil {
			a.log.Warn("apply cache preset", "server", serverID, "err", err)
		}
	} else {
		a.log.Warn("init web config", "server", serverID, "err", err)
	}
	a.auditUser(r, p, "创建站点 "+domains[0])
	s, err := a.loadSite(ctx, call, uid, serverID)
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusCreated, s)
	return nil
}

func (a *App) checkDuplicateDomains(call *edgeapi.Call, clusterID int64, domains []string, exclude int64) error {
	dup, err := call.Server().CheckServerNameDuplicationInNodeCluster(call.Ctx, &pb.CheckServerNameDuplicationInNodeClusterRequest{
		NodeClusterId: clusterID, ServerNames: domains, ExcludeServerId: exclude,
	})
	if err != nil {
		return err
	}
	if len(dup.DuplicatedServerNames) > 0 {
		return httpx.Validation(map[string]string{"domains": "以下域名已被其他站点使用：" + strings.Join(dup.DuplicatedServerNames, ", ")})
	}
	return nil
}

func (a *App) createOrigins(call *edgeapi.Call, origins []origin) ([]originRef, error) {
	refs := make([]originRef, 0, len(origins))
	for _, o := range origins {
		resp, err := call.Origin().CreateOrigin(call.Ctx, &pb.CreateOriginRequest{
			Name:   o.Host,
			Addr:   &pb.NetworkAddress{Protocol: o.Protocol, Host: o.Host, PortRange: strconv.Itoa(o.Port)},
			Weight: int32(o.Weight),
			IsOn:   true,
		})
		if err != nil {
			return nil, err
		}
		refs = append(refs, originRef{IsOn: true, OriginID: resp.OriginId})
	}
	return refs, nil
}

func (a *App) createReverseProxy(call *edgeapi.Call, origins []origin, originHost string) (int64, error) {
	refs, err := a.createOrigins(call, origins)
	if err != nil {
		return 0, err
	}
	refsJSON, _ := json.Marshal(refs)
	rp, err := call.ReverseProxy().CreateReverseProxy(call.Ctx, &pb.CreateReverseProxyRequest{
		SchedulingJSON:     []byte(`{"code":"random","options":null}`),
		PrimaryOriginsJSON: refsJSON,
		BackupOriginsJSON:  []byte("[]"),
	})
	if err != nil {
		return 0, err
	}
	if originHost != "" {
		if err := a.setOriginHost(call, rp.ReverseProxyId, originHost); err != nil {
			return 0, err
		}
	}
	return rp.ReverseProxyId, nil
}

// setOriginHost rewrites the reverse proxy's request host (UpdateReverseProxy
// overwrites every field, so the current config is read first).
func (a *App) setOriginHost(call *edgeapi.Call, rpID int64, host string) error {
	rp, err := a.reverseProxy(call, rpID)
	if err != nil {
		return err
	}
	hostType := int32(0) // follow the CDN domain (the requested host)
	if host != "" {
		hostType = 2
	}
	if rp.RequestHostType == hostType && rp.RequestHost == host {
		return nil
	}
	_, err = call.ReverseProxy().UpdateReverseProxy(call.Ctx, &pb.UpdateReverseProxyRequest{
		ReverseProxyId:           rpID,
		RequestHostType:          hostType,
		RequestHost:              host,
		RequestHostExcludingPort: rp.RequestHostExcludingPort,
		RequestURI:               rp.RequestURI,
		StripPrefix:              rp.StripPrefix,
		AutoFlush:                rp.AutoFlush,
		AddHeaders:               rp.AddHeaders,
		ConnTimeoutJSON:          rawOrNil(rp.ConnTimeout),
		ReadTimeoutJSON:          rawOrNil(rp.ReadTimeout),
		IdleTimeoutJSON:          rawOrNil(rp.IdleTimeout),
		MaxConns:                 rp.MaxConns,
		MaxIdleConns:             rp.MaxIdleConns,
		ProxyProtocolJSON:        rawOrNil(rp.ProxyProtocol),
		FollowRedirects:          rp.FollowRedirects,
		Retry50X:                 rp.Retry50X,
		Retry40X:                 rp.Retry40X,
	})
	return err
}

func (a *App) updateSite(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req struct {
		Name *string `json:"name"`
		IsOn *bool   `json:"isOn"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" || len([]rune(n)) > 64 {
			return httpx.Validation(map[string]string{"name": "名称为 1-64 个字符"})
		}
		req.Name = &n
	}
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	if _, err := ownedServer(call, p.id(), id); err != nil {
		return err
	}
	if req.Name != nil {
		if _, err := call.Server().UpdateEnabledUserServerBasic(call.Ctx, &pb.UpdateEnabledUserServerBasicRequest{ServerId: id, Name: *req.Name}); err != nil {
			return err
		}
	}
	if req.IsOn != nil {
		if _, err := call.Server().UpdateServerIsOn(call.Ctx, &pb.UpdateServerIsOnRequest{ServerId: id, IsOn: *req.IsOn}); err != nil {
			return err
		}
		a.auditUser(r, p, map[bool]string{true: "启用", false: "停用"}[*req.IsOn]+"站点 #"+strconv.FormatInt(id, 10))
	}
	s, err := a.loadSite(r.Context(), call, p.id(), id)
	if err != nil {
		return err
	}
	return writeJSON(w, s)
}

func (a *App) updateDomains(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req struct {
		Domains []string `json:"domains"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	f := httpx.Fields{}
	domains := normalizeDomains(req.Domains, f, "domains")
	if err := f.Err(); err != nil {
		return err
	}
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	s, err := ownedServer(call, p.id(), id)
	if err != nil {
		return err
	}
	if s.NodeCluster != nil {
		if err := a.checkDuplicateDomains(call, s.NodeCluster.Id, domains, id); err != nil {
			return err
		}
	}
	if _, err := call.Server().UpdateServerNames(call.Ctx, &pb.UpdateServerNamesRequest{ServerId: id, ServerNamesJSON: serverNamesJSON(domains)}); err != nil {
		return err
	}
	if err := a.store.ResetSiteDNS(r.Context(), id, p.id()); err != nil {
		return err
	}
	a.auditUser(r, p, "修改站点 #"+strconv.FormatInt(id, 10)+" 的域名")
	out, err := a.loadSite(r.Context(), call, p.id(), id)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}

func (a *App) updateOrigins(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req struct {
		Origins    []origin `json:"origins"`
		OriginHost string   `json:"originHost"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	f := httpx.Fields{}
	origins := normalizeOrigins(req.Origins, f)
	originHost := normalizeOriginHost(req.OriginHost, f)
	if err := f.Err(); err != nil {
		return err
	}
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	s, err := ownedServer(call, p.id(), id)
	if err != nil {
		return err
	}
	var ref reverseProxyRef
	_ = json.Unmarshal(s.ReverseProxyJSON, &ref)
	if ref.ReverseProxyID <= 0 {
		// No proxy yet: create one owned by this user (never use FindAndInit...,
		// which skips EdgeAPI's ownership check).
		rpID, err := a.createReverseProxy(call, origins, originHost)
		if err != nil {
			return err
		}
		ref = reverseProxyRef{IsOn: true, ReverseProxyID: rpID}
	} else {
		refs, err := a.createOrigins(call, origins)
		if err != nil {
			return err
		}
		refsJSON, _ := json.Marshal(refs)
		if _, err := call.ReverseProxy().UpdateReverseProxyPrimaryOrigins(call.Ctx, &pb.UpdateReverseProxyPrimaryOriginsRequest{
			ReverseProxyId: ref.ReverseProxyID, OriginsJSON: refsJSON,
		}); err != nil {
			return err
		}
		if err := a.setOriginHost(call, ref.ReverseProxyID, originHost); err != nil {
			return err
		}
		ref.IsOn = true
	}
	refJSON, _ := json.Marshal(ref)
	if _, err := call.Server().UpdateServerReverseProxy(call.Ctx, &pb.UpdateServerReverseProxyRequest{ServerId: id, ReverseProxyJSON: refJSON}); err != nil {
		return err
	}
	a.auditUser(r, p, "修改站点 #"+strconv.FormatInt(id, 10)+" 的源站")
	out, err := a.loadSite(r.Context(), call, p.id(), id)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}

func (a *App) deleteSite(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	s, err := ownedServer(call, p.id(), id)
	if err != nil {
		return err
	}
	if _, err := call.Server().DeleteServer(call.Ctx, &pb.DeleteServerRequest{ServerId: id}); err != nil {
		return err
	}
	_ = a.store.DeleteSiteMeta(r.Context(), id)
	a.auditUser(r, p, "删除站点 "+s.Name)
	return noContent(w)
}

// ---------------------------------------------------------------- helpers

// parallel runs fn(i) for i in [0,n) with at most `limit` goroutines.
func parallel(n, limit int, fn func(i int)) {
	if limit < 1 {
		limit = 1
	}
	sem := make(chan struct{}, limit)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer func() { <-sem; wg.Done() }()
			fn(i)
		}(i)
	}
	wg.Wait()
}

// userServers lists up to max http servers of a user.
func userServers(call *edgeapi.Call, userID int64, max int64) ([]*pb.Server, error) {
	var out []*pb.Server
	const pageSize = 100
	for off := int64(0); off < max; off += pageSize {
		resp, err := call.Server().ListEnabledServersMatch(call.Ctx, &pb.ListEnabledServersMatchRequest{
			UserId: userID, ProtocolFamily: "http", Offset: off, Size: pageSize,
		})
		if err != nil {
			return nil, err
		}
		out = append(out, resp.Servers...)
		if len(resp.Servers) < pageSize {
			break
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Id < out[j].Id })
	return out, nil
}
