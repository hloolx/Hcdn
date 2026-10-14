package app

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
)

func (a *App) getHTTPS(w http.ResponseWriter, r *http.Request, p *principal) error {
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
	h, err := a.loadHTTPS(call, s, a.siteMeta(r.Context(), id))
	if err != nil {
		return err
	}
	return writeJSON(w, h)
}

func (a *App) putHTTPS(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req siteHTTPS
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	switch req.MinTLSVersion {
	case "":
		req.MinTLSVersion = "1.2"
	case "1.0", "1.1", "1.2", "1.3":
	default:
		return httpx.Validation(map[string]string{"minTlsVersion": "TLS 版本无效"})
	}
	if req.Enabled && (req.CertID == nil || *req.CertID <= 0) && !req.AutoCert {
		return httpx.Validation(map[string]string{"certId": "请选择证书或开启自动申请证书"})
	}
	ctx := r.Context()
	uid := p.id()
	call, err := a.edge.AsUser(ctx, uid)
	if err != nil {
		return err
	}
	defer call.Done()
	s, err := ownedServer(call, uid, id)
	if err != nil {
		return err
	}
	if err := a.store.SetSiteOptions(ctx, id, uid, req.AutoCert, req.ForceRedirect); err != nil {
		return err
	}
	var certID int64
	if req.CertID != nil {
		certID = *req.CertID
	}
	if certID > 0 {
		// Ownership: EdgeAPI's CheckUserCert rejects other users' certificates.
		resp, err := call.SSLCert().FindEnabledSSLCertConfig(call.Ctx, &pb.FindEnabledSSLCertConfigRequest{SslCertId: certID})
		if err != nil || len(resp.SslCertJSON) == 0 || string(resp.SslCertJSON) == "null" {
			return httpx.Validation(map[string]string{"certId": "证书不存在"})
		}
	}
	enable := req.Enabled && certID > 0
	if err := a.applyHTTPS(call, s, enable, certID, req); err != nil {
		return err
	}
	if req.Enabled && certID == 0 && req.AutoCert {
		// Issue a certificate now if DNS already points to us; otherwise the DNS
		// check triggers it.
		if m := a.siteMeta(ctx, id); m != nil && m.DNSOK {
			if _, err := a.startAcmeForSite(ctx, uid, id, nil); err != nil {
				a.log.Warn("auto cert", "server", id, "err", err)
			}
		}
	}
	a.auditUser(r, p, "修改站点 #"+strconv.FormatInt(id, 10)+" 的 HTTPS 设置")
	s, err = ownedServer(call, uid, id)
	if err != nil {
		return err
	}
	h, err := a.loadHTTPS(call, s, a.siteMeta(ctx, id))
	if err != nil {
		return err
	}
	return writeJSON(w, h)
}

// applyHTTPS writes the SSL policy, the https protocol config and the redirect.
func (a *App) applyHTTPS(call *edgeapi.Call, s *pb.Server, enable bool, certID int64, opt siteHTTPS) error {
	pc := parseProtocol(s.HttpsJSON)
	policyID := int64(0)
	if pc.SSLPolicyRef != nil {
		policyID = pc.SSLPolicyRef.SSLPolicyID
	}
	if certID > 0 {
		certs, _ := json.Marshal([]map[string]any{{"isOn": true, "certId": certID}})
		hsts, _ := json.Marshal(map[string]any{"isOn": opt.HSTS, "maxAge": 31536000, "includeSubDomains": false, "preload": false, "domains": []string{}})
		if policyID > 0 {
			// UpdateSSLPolicy runs EdgeAPI's CheckUserPolicy; if the policy is
			// not ours (e.g. created by an admin) create a fresh one instead.
			_, err := call.SSLPolicy().UpdateSSLPolicy(call.Ctx, &pb.UpdateSSLPolicyRequest{
				SslPolicyId: policyID, Http2Enabled: opt.HTTP2, MinVersion: tlsVersionToEdge(opt.MinTLSVersion),
				SslCertsJSON: certs, HstsJSON: hsts,
			})
			if err != nil {
				if mapEdgeErr(err).Status >= 500 {
					return err
				}
				policyID = 0
			}
		}
		if policyID == 0 {
			resp, err := call.SSLPolicy().CreateSSLPolicy(call.Ctx, &pb.CreateSSLPolicyRequest{
				Http2Enabled: opt.HTTP2, MinVersion: tlsVersionToEdge(opt.MinTLSVersion), SslCertsJSON: certs, HstsJSON: hsts,
			})
			if err != nil {
				return err
			}
			policyID = resp.SslPolicyId
		}
	}
	if _, err := call.Server().UpdateServerHTTPS(call.Ctx, &pb.UpdateServerHTTPSRequest{ServerId: s.Id, HttpsJSON: httpsJSON(enable, policyID)}); err != nil {
		return err
	}
	wc, _, err := a.webConfig(call, s.Id)
	if err != nil {
		return err
	}
	redirect, _ := json.Marshal(map[string]any{
		"isPrior": false, "isOn": enable && opt.ForceRedirect, "status": 0, "host": "", "port": 0,
		"onlyDomains": []string{}, "exceptDomains": []string{},
	})
	_, err = call.HTTPWeb().UpdateHTTPWebRedirectToHTTPS(call.Ctx, &pb.UpdateHTTPWebRedirectToHTTPSRequest{HttpWebId: wc.ID, RedirectToHTTPSJSON: redirect})
	return err
}

// ---------------------------------------------------------------- DNS check

type dnsResult struct {
	Results []store.DNSCheck `json:"results"`
	Status  string           `json:"status"`
}

func (a *App) dnsCheck(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	uid := p.id()
	call, err := a.edge.AsUser(ctx, uid)
	if err != nil {
		return err
	}
	defer call.Done()
	s, err := ownedServer(call, uid, id)
	if err != nil {
		return err
	}
	cname := ""
	if dns, err := call.Server().FindEnabledServerDNS(call.Ctx, &pb.FindEnabledServerDNSRequest{ServerId: id}); err == nil && dns.Domain != nil {
		cname = cnameOf(dns.DnsName, dns.Domain.Name)
	} else {
		var clusterID int64
		if s.NodeCluster != nil {
			clusterID = s.NodeCluster.Id
		}
		cname = cnameOf(s.DnsName, a.clusterDNSDomain(ctx, clusterID))
	}
	domains := domainsOf(s)
	checks := checkDomains(ctx, domains, cname)
	allOK := len(checks) > 0
	for _, c := range checks {
		allOK = allOK && c.OK
	}
	if err := a.store.SetSiteDNS(ctx, id, uid, allOK, checks, a.now()); err != nil {
		return err
	}
	meta := a.siteMeta(ctx, id)
	if allOK && meta != nil && meta.AutoCert && !parseProtocol(s.HttpsJSON).IsOn {
		if _, err := a.startAcmeForSite(ctx, uid, id, domains); err != nil {
			a.log.Warn("auto cert after dns check", "server", id, "err", err)
		}
	}
	return writeJSON(w, dnsResult{Results: checks, Status: siteStatus(s.IsOn, meta)})
}

var resolver = &net.Resolver{}

// checkDomains resolves each domain and compares it with the CNAME target. A
// domain passes when its CNAME is the target, or (CNAME flattening at the
// apex) when its addresses are a subset of the target's.
func checkDomains(ctx context.Context, domains []string, target string) []store.DNSCheck {
	target = strings.TrimSuffix(strings.ToLower(target), ".")
	var targetAddrs map[string]bool
	if target != "" {
		tctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		addrs, _ := resolver.LookupHost(tctx, target)
		cancel()
		targetAddrs = map[string]bool{}
		for _, ad := range addrs {
			targetAddrs[ad] = true
		}
	}
	out := make([]store.DNSCheck, len(domains))
	parallel(len(domains), 8, func(i int) {
		d := domains[i]
		host := d
		if strings.HasPrefix(host, "*.") {
			host = "hcdn-dns-check" + host[1:]
		}
		c := store.DNSCheck{Domain: d, Resolved: []string{}}
		dctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if target == "" {
			c.Message = "平台尚未配置 CNAME 域名"
			out[i] = c
			return
		}
		cn, err := resolver.LookupCNAME(dctx, host)
		cn = strings.TrimSuffix(strings.ToLower(cn), ".")
		if err == nil && cn != "" && cn != host {
			c.Resolved = append(c.Resolved, cn)
			if cn == target {
				c.OK = true
				out[i] = c
				return
			}
		}
		addrs, err := resolver.LookupHost(dctx, host)
		if err != nil {
			c.Message = "域名无法解析，请添加 CNAME 记录指向 " + target
			out[i] = c
			return
		}
		match := len(addrs) > 0 && len(targetAddrs) > 0
		for _, ad := range addrs {
			if cn == "" || cn == host {
				c.Resolved = append(c.Resolved, ad)
			}
			if !targetAddrs[ad] {
				match = false
			}
		}
		c.OK = match
		if !match {
			c.Message = "请将 CNAME 记录指向 " + target
		}
		out[i] = c
	})
	return out
}
