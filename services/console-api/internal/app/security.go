package app

import (
	"encoding/json"
	"net/http"
	"net/netip"
	"slices"
	"strconv"
	"strings"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
)

type rateLimit struct {
	Enabled       bool  `json:"enabled"`
	Requests      int64 `json:"requests"`
	PeriodSeconds int64 `json:"periodSeconds"`
	BlockSeconds  int64 `json:"blockSeconds"`
}

type securitySettings struct {
	WAF struct {
		Enabled bool   `json:"enabled"`
		Mode    string `json:"mode"`
	} `json:"waf"`
	IPAllow          []string  `json:"ipAllow"`
	IPDeny           []string  `json:"ipDeny"`
	BlockedCountries []string  `json:"blockedCountries"`
	RateLimit        rateLimit `json:"rateLimit"`
}

// Managed WAF rule groups (codes of firewallconfigs.HTTPFirewallTemplate) that
// waf.enabled switches on.
var managedWAFCodes = []string{"xss", "upload", "webShell", "commandInjection", "pathTraversal", "denyDirs", "sqlInjection"}

const rateLimitCode = "hcdn-ratelimit"

// Composed policy (subset of firewallconfigs.HTTPFirewallPolicy).
type fwPolicy struct {
	ID       int64           `json:"id"`
	IsOn     bool            `json:"isOn"`
	ServerID int64           `json:"serverId"`
	Mode     string          `json:"mode"`
	Inbound  json.RawMessage `json:"inbound"`
	Outbound json.RawMessage `json:"outbound"`
}

type fwInbound struct {
	Groups []fwGroup `json:"groups"`
	Region *struct {
		DenyCountryIDs []int64 `json:"denyCountryIds"`
	} `json:"region"`
	WhiteListRef *ipListRef `json:"whiteListRef"`
	BlackListRef *ipListRef `json:"blackListRef"`
}

type ipListRef struct {
	IsOn   bool  `json:"isOn"`
	ListID int64 `json:"listId"`
}

type fwGroup struct {
	ID         int64   `json:"id"`
	IsOn       bool    `json:"isOn"`
	Code       string  `json:"code"`
	IsTemplate bool    `json:"isTemplate"`
	Sets       []fwSet `json:"sets"`
}

type fwSet struct {
	ID      int64 `json:"id"`
	IsOn    bool  `json:"isOn"`
	Actions []struct {
		Code    string         `json:"code"`
		Options map[string]any `json:"options"`
	} `json:"actions"`
	Rules []struct {
		Param             string         `json:"param"`
		Operator          string         `json:"operator"`
		Value             string         `json:"value"`
		CheckpointOptions map[string]any `json:"checkpointOptions"`
	} `json:"rules"`
}

func defaultSecurity() securitySettings {
	var s securitySettings
	s.WAF.Mode = "block"
	s.IPAllow, s.IPDeny, s.BlockedCountries = []string{}, []string{}, []string{}
	s.RateLimit = rateLimit{Requests: 300, PeriodSeconds: 60, BlockSeconds: 600}
	return s
}

// sitePolicy returns the web config and the site's own WAF policy (nil when
// the site has none or the referenced policy does not belong to this site).
func (a *App) sitePolicy(call *edgeapi.Call, serverID int64) (*webConfig, *fwPolicy, error) {
	wc, _, err := a.webConfig(call, serverID)
	if err != nil {
		return nil, nil, err
	}
	if wc.FirewallRef == nil || wc.FirewallRef.FirewallPolicyID <= 0 {
		return wc, nil, nil
	}
	resp, err := call.FirewallPolicy().FindEnabledHTTPFirewallPolicyConfig(call.Ctx, &pb.FindEnabledHTTPFirewallPolicyConfigRequest{HttpFirewallPolicyId: wc.FirewallRef.FirewallPolicyID})
	if err != nil {
		if mapEdgeErr(err).Status < 500 {
			return wc, nil, nil
		}
		return nil, nil, err
	}
	var pol fwPolicy
	if len(resp.HttpFirewallPolicyJSON) == 0 || json.Unmarshal(resp.HttpFirewallPolicyJSON, &pol) != nil || pol.ID == 0 || pol.ServerID != serverID {
		return wc, nil, nil
	}
	return wc, &pol, nil
}

func listValues(call *edgeapi.Call, listID int64) ([]*pb.IPItem, error) {
	if listID <= 0 {
		return nil, nil
	}
	resp, err := call.IPItem().ListIPItemsWithListId(call.Ctx, &pb.ListIPItemsWithListIdRequest{IpListId: listID, Offset: 0, Size: 1000})
	if err != nil {
		return nil, err
	}
	return resp.IpItems, nil
}

func itemValue(it *pb.IPItem) string {
	if it.Value != "" {
		return it.Value
	}
	if it.IpTo != "" && it.IpTo != it.IpFrom {
		return it.IpFrom + "-" + it.IpTo
	}
	return it.IpFrom
}

func (a *App) readSecurity(call *edgeapi.Call, r *http.Request, serverID int64) (securitySettings, error) {
	out := defaultSecurity()
	wc, pol, err := a.sitePolicy(call, serverID)
	if err != nil || pol == nil {
		return out, err
	}
	var in fwInbound
	_ = json.Unmarshal(pol.Inbound, &in)
	refOn := wc.FirewallRef != nil && wc.FirewallRef.IsOn && pol.IsOn
	managedOn := false
	for _, g := range in.Groups {
		if g.IsOn && slices.Contains(managedWAFCodes, g.Code) {
			managedOn = true
		}
		if g.Code == rateLimitCode {
			out.RateLimit.Enabled = refOn && g.IsOn
			for _, s := range g.Sets {
				out.RateLimit.Enabled = out.RateLimit.Enabled && s.IsOn
				for _, rule := range s.Rules {
					if rule.Param == "${cc2}" {
						if n, err := strconv.ParseInt(rule.Value, 10, 64); err == nil {
							out.RateLimit.Requests = n
						}
						if v := anyInt(rule.CheckpointOptions["period"]); v > 0 {
							out.RateLimit.PeriodSeconds = v
						}
					}
				}
				for _, act := range s.Actions {
					if act.Code == "block" {
						if v := anyInt(act.Options["timeout"]); v > 0 {
							out.RateLimit.BlockSeconds = v
						}
					}
				}
				break
			}
		}
	}
	out.WAF.Enabled = refOn && managedOn
	if pol.Mode == "observe" {
		out.WAF.Mode = "log"
	}
	if in.Region != nil {
		out.BlockedCountries = a.countryCodes(r.Context(), in.Region.DenyCountryIDs)
	}
	for _, pair := range []struct {
		ref *ipListRef
		dst *[]string
	}{{in.WhiteListRef, &out.IPAllow}, {in.BlackListRef, &out.IPDeny}} {
		if pair.ref == nil {
			continue
		}
		items, err := listValues(call, pair.ref.ListID)
		if err != nil {
			return out, err
		}
		for _, it := range items {
			*pair.dst = append(*pair.dst, itemValue(it))
		}
	}
	return out, nil
}

func anyInt(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case string:
		n, _ := strconv.ParseInt(x, 10, 64)
		return n
	}
	return 0
}

func (a *App) getSecurity(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	if _, err := ownedServer(call, p.id(), id); err != nil {
		return err
	}
	s, err := a.readSecurity(call, r, id)
	if err != nil {
		return err
	}
	return writeJSON(w, s)
}

// normalizeIPs accepts IPs, CIDRs and a-b ranges.
func normalizeIPs(in []string, field string, f httpx.Fields) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		var norm string
		switch {
		case strings.Contains(v, "/"):
			pfx, err := netip.ParsePrefix(v)
			if err != nil {
				f.Add(field, "IP 格式不正确："+v)
				continue
			}
			norm = pfx.Masked().String()
		case strings.Contains(v, "-"):
			lo, hi, _ := strings.Cut(v, "-")
			a1, e1 := netip.ParseAddr(strings.TrimSpace(lo))
			a2, e2 := netip.ParseAddr(strings.TrimSpace(hi))
			if e1 != nil || e2 != nil || a1.Is4() != a2.Is4() || a2.Less(a1) {
				f.Add(field, "IP 范围不正确："+v)
				continue
			}
			norm = a1.String() + "-" + a2.String()
		default:
			ad, err := netip.ParseAddr(v)
			if err != nil {
				f.Add(field, "IP 格式不正确："+v)
				continue
			}
			norm = ad.Unmap().String()
		}
		if !seen[norm] {
			seen[norm] = true
			out = append(out, norm)
		}
	}
	if len(out) > 1000 {
		f.Add(field, "最多 1000 条")
	}
	return out
}

func ipType(v string) string {
	if strings.Contains(v, ":") {
		return "ipv6"
	}
	return "ipv4"
}

func (a *App) putSecurity(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var req securitySettings
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	f := httpx.Fields{}
	switch req.WAF.Mode {
	case "":
		req.WAF.Mode = "block"
	case "block", "log":
	default:
		f.Add("waf.mode", "模式只能是 block 或 log")
	}
	allow := normalizeIPs(req.IPAllow, "ipAllow", f)
	deny := normalizeIPs(req.IPDeny, "ipDeny", f)
	rl := req.RateLimit
	if rl.Enabled || rl.Requests != 0 {
		if rl.Requests < 1 || rl.Requests > 1000000 {
			f.Add("rateLimit.requests", "请求数范围为 1-1000000")
		}
		if rl.PeriodSeconds < 1 || rl.PeriodSeconds > 86400 {
			f.Add("rateLimit.periodSeconds", "统计周期范围为 1-86400 秒")
		}
		if rl.BlockSeconds < 1 || rl.BlockSeconds > 7*86400 {
			f.Add("rateLimit.blockSeconds", "封禁时长范围为 1 秒到 7 天")
		}
	}
	ctx := r.Context()
	var countryIDs []int64
	if len(req.BlockedCountries) > 0 {
		if len(req.BlockedCountries) > 300 {
			f.Add("blockedCountries", "国家/地区过多")
		}
		ids, unknown, err := a.countryIDs(ctx, req.BlockedCountries)
		if err != nil {
			return err
		}
		if len(unknown) > 0 {
			f.Add("blockedCountries", "无法识别的国家/地区代码："+strings.Join(unknown, ","))
		}
		countryIDs = ids
	}
	if err := f.Err(); err != nil {
		return err
	}
	uid := p.id()
	call, err := a.edge.AsUser(ctx, uid)
	if err != nil {
		return err
	}
	defer call.Done()
	if _, err := ownedServer(call, uid, id); err != nil {
		return err
	}
	wc, pol, err := a.sitePolicy(call, id)
	if err != nil {
		return err
	}

	// 1. Make sure the site has its own policy (never reuse one we cannot prove is the site's).
	if pol == nil {
		created, err := call.FirewallPolicy().CreateHTTPFirewallPolicy(call.Ctx, &pb.CreateHTTPFirewallPolicyRequest{
			IsOn: true, Name: "站点防护 #" + strconv.FormatInt(id, 10), ServerId: id, HttpFirewallGroupCodes: []string{},
		})
		if err != nil {
			return err
		}
		ref, _ := json.Marshal(firewallRef{IsOn: true, FirewallPolicyID: created.HttpFirewallPolicyId})
		if _, err := call.HTTPWeb().UpdateHTTPWebFirewall(call.Ctx, &pb.UpdateHTTPWebFirewallRequest{HttpWebId: wc.ID, FirewallJSON: ref}); err != nil {
			return err
		}
		if wc, pol, err = a.sitePolicy(call, id); err != nil {
			return err
		}
		if pol == nil {
			return httpx.Errorf(http.StatusBadGateway, "upstream_error", "创建防护策略失败")
		}
	} else if wc.FirewallRef == nil || !wc.FirewallRef.IsOn {
		ref, _ := json.Marshal(firewallRef{IsOn: true, FirewallPolicyID: pol.ID})
		if _, err := call.HTTPWeb().UpdateHTTPWebFirewall(call.Ctx, &pb.UpdateHTTPWebFirewallRequest{HttpWebId: wc.ID, FirewallJSON: ref}); err != nil {
			return err
		}
	}
	inbound := parseRawObject(pol.Inbound)
	var in fwInbound
	_ = json.Unmarshal(pol.Inbound, &in)

	// 2. IP lists (created on demand, owned by the site).
	ensureList := func(ref *ipListRef, typ, name string) (int64, error) {
		if ref != nil && ref.ListID > 0 {
			return ref.ListID, nil
		}
		resp, err := call.IPList().CreateIPList(call.Ctx, &pb.CreateIPListRequest{Type: typ, Name: name, Code: typ, ServerId: id, TimeoutJSON: []byte("null")})
		if err != nil {
			return 0, err
		}
		return resp.IpListId, nil
	}
	whiteID, err := ensureList(in.WhiteListRef, "white", "站点白名单")
	if err != nil {
		return err
	}
	blackID, err := ensureList(in.BlackListRef, "black", "站点黑名单")
	if err != nil {
		return err
	}
	inbound.set("whiteListRef", ipListRef{IsOn: true, ListID: whiteID})
	inbound.set("blackListRef", ipListRef{IsOn: true, ListID: blackID})

	// 3. Region blocking.
	region := parseRawObject(inbound["region"])
	region.set("isOn", len(countryIDs) > 0)
	if countryIDs == nil {
		countryIDs = []int64{}
	}
	region.set("denyCountryIds", countryIDs)
	region.set("allowCountryIds", []int64{})
	inbound["region"] = region.bytes()

	// 4. Rate limit group (cc2 checkpoint, block scope "service" so other sites are unaffected).
	var rlGroup *fwGroup
	for i := range in.Groups {
		if in.Groups[i].Code == rateLimitCode {
			rlGroup = &in.Groups[i]
		}
	}
	var groupRefs []map[string]any
	inbound.get("groupRefs", &groupRefs)
	if rl.Enabled && rlGroup == nil {
		g, err := call.FirewallRuleGroup().CreateHTTPFirewallRuleGroup(call.Ctx, &pb.CreateHTTPFirewallRuleGroupRequest{
			IsOn: true, Name: "速率限制", Code: rateLimitCode, Description: "Hcdn console",
		})
		if err != nil {
			return err
		}
		rlGroup = &fwGroup{ID: g.FirewallRuleGroupId, Code: rateLimitCode, IsOn: true}
		groupRefs = append(groupRefs, map[string]any{"isOn": true, "groupId": g.FirewallRuleGroupId})
	}
	if groupRefs == nil {
		groupRefs = []map[string]any{}
	}
	inbound.set("groupRefs", groupRefs)
	inbound.set("isOn", true)
	delete(inbound, "groups") // composed, read-only
	if _, err := call.FirewallPolicy().UpdateHTTPFirewallInboundConfig(call.Ctx, &pb.UpdateHTTPFirewallInboundConfigRequest{
		HttpFirewallPolicyId: pol.ID, InboundJSON: inbound.bytes(),
	}); err != nil {
		return err
	}
	if rlGroup != nil && rl.Enabled {
		setID := int64(0)
		if len(rlGroup.Sets) > 0 {
			setID = rlGroup.Sets[0].ID
		}
		set := map[string]any{
			"id": setID, "isOn": true, "name": "每 IP 请求数限制", "code": "hcdn-cc", "description": "",
			"connector": "and", "ignoreLocal": true, "ignoreSearchEngine": false,
			"actions": []map[string]any{{"code": "block", "options": map[string]any{
				"timeout": rl.BlockSeconds, "scope": "service", "statusCode": 429,
			}}},
			"rules": []map[string]any{{
				"id": 0, "isOn": true, "param": "${cc2}", "operator": "gt", "value": strconv.FormatInt(rl.Requests, 10),
				"isCaseInsensitive": false,
				"checkpointOptions": map[string]any{
					"keys": []string{"${remoteAddr}"}, "period": strconv.FormatInt(rl.PeriodSeconds, 10),
					"threshold": rl.Requests, "enableFingerprint": true, "ignoreCommonFiles": false,
				},
			}},
		}
		setJSON, _ := json.Marshal(set)
		resp, err := call.FirewallRuleSet().CreateOrUpdateHTTPFirewallRuleSetFromConfig(call.Ctx, &pb.CreateOrUpdateHTTPFirewallRuleSetFromConfigRequest{FirewallRuleSetConfigJSON: setJSON})
		if err != nil {
			return err
		}
		refs, _ := json.Marshal([]map[string]any{{"isOn": true, "setId": resp.FirewallRuleSetId}})
		if _, err := call.FirewallRuleGroup().UpdateHTTPFirewallRuleGroupSets(call.Ctx, &pb.UpdateHTTPFirewallRuleGroupSetsRequest{
			FirewallRuleGroupId: rlGroup.ID, FirewallRuleSetsJSON: refs,
		}); err != nil {
			return err
		}
	}

	// 5. Group switches: managed rules follow waf.enabled, our group follows rateLimit.enabled.
	for _, g := range in.Groups {
		want := g.IsOn
		switch {
		case slices.Contains(managedWAFCodes, g.Code):
			want = req.WAF.Enabled
		case g.Code == rateLimitCode:
			want = rl.Enabled
		case g.IsTemplate:
			want = false // bot/cc2/referer templates stay off; they need tuning
		}
		if want != g.IsOn {
			if _, err := call.FirewallRuleGroup().UpdateHTTPFirewallRuleGroupIsOn(call.Ctx, &pb.UpdateHTTPFirewallRuleGroupIsOnRequest{FirewallRuleGroupId: g.ID, IsOn: want}); err != nil {
				return err
			}
		}
	}
	if req.WAF.Enabled && !hasManaged(in.Groups) {
		a.log.Info("site policy has no managed rule groups", "server", id, "policy", pol.ID)
	}

	// 6. IP items: diff current against desired.
	if err := syncIPList(call, whiteID, allow); err != nil {
		return err
	}
	if err := syncIPList(call, blackID, deny); err != nil {
		return err
	}

	// 7. Mode needs admin rights (UpdateHTTPFirewallPolicy is admin-only).
	wantMode := "defend"
	if req.WAF.Mode == "log" {
		wantMode = "observe"
	}
	curMode := pol.Mode
	if curMode == "" {
		curMode = "defend"
	}
	if wantMode != curMode {
		if err := a.setPolicyMode(r, pol.ID, id, wantMode); err != nil {
			return err
		}
	}
	a.auditUser(r, p, "修改站点 #"+strconv.FormatInt(id, 10)+" 的安全设置")
	out, err := a.readSecurity(call, r, id)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}

func hasManaged(groups []fwGroup) bool {
	for _, g := range groups {
		if slices.Contains(managedWAFCodes, g.Code) {
			return true
		}
	}
	return false
}

func syncIPList(call *edgeapi.Call, listID int64, want []string) error {
	items, err := listValues(call, listID)
	if err != nil {
		return err
	}
	have := map[string]bool{}
	for _, it := range items {
		v := itemValue(it)
		if !slices.Contains(want, v) {
			if _, err := call.IPItem().DeleteIPItem(call.Ctx, &pb.DeleteIPItemRequest{IpItemId: it.Id}); err != nil {
				return err
			}
			continue
		}
		have[v] = true
	}
	for _, v := range want {
		if have[v] {
			continue
		}
		if _, err := call.IPItem().CreateIPItem(call.Ctx, &pb.CreateIPItemRequest{
			IpListId: listID, Value: v, Type: ipType(v), Reason: "console", EventLevel: "critical",
		}); err != nil {
			return err
		}
	}
	return nil
}

// setPolicyMode changes a site policy's mode with the admin credential. The
// policy was verified to belong to the customer's server by the caller.
// UpdateHTTPFirewallPolicy overwrites everything, so the full config is sent back.
func (a *App) setPolicyMode(r *http.Request, policyID, serverID int64, mode string) error {
	call, err := a.edge.AsAdmin(r.Context(), a.cfg.EdgeAPI.AdminID)
	if err != nil {
		return httpx.Errorf(http.StatusServiceUnavailable, "not_configured", "暂不支持切换防护模式")
	}
	defer call.Done()
	resp, err := call.FirewallPolicy().FindEnabledHTTPFirewallPolicyConfig(call.Ctx, &pb.FindEnabledHTTPFirewallPolicyConfigRequest{HttpFirewallPolicyId: policyID})
	if err != nil {
		return err
	}
	full := parseRawObject(resp.HttpFirewallPolicyJSON)
	var sid int64
	full.get("serverId", &sid)
	if sid != serverID {
		return httpx.Forbidden()
	}
	var isOn bool
	var name, desc, denyCountryHTML, denyProvinceHTML string
	var useLocal bool
	var maxBody int64
	full.get("isOn", &isOn)
	full.get("name", &name)
	full.get("description", &desc)
	full.get("useLocalFirewall", &useLocal)
	full.get("maxRequestBodySize", &maxBody)
	full.get("denyCountryHTML", &denyCountryHTML)
	full.get("denyProvinceHTML", &denyProvinceHTML)
	// Codes of groups currently switched on (UpdateHTTPFirewallPolicy toggles groups by code).
	var codes []string
	for _, key := range []string{"inbound", "outbound"} {
		var b struct {
			Groups []fwGroup `json:"groups"`
		}
		full.get(key, &b)
		for _, g := range b.Groups {
			if g.IsOn && g.Code != "" {
				codes = append(codes, g.Code)
			}
		}
	}
	raw := func(k string) []byte { return rawOrNil(full[k]) }
	_, err = call.FirewallPolicy().UpdateHTTPFirewallPolicy(call.Ctx, &pb.UpdateHTTPFirewallPolicyRequest{
		HttpFirewallPolicyId: policyID,
		IsOn:                 isOn,
		Name:                 name,
		Description:          desc,
		FirewallGroupCodes:   codes,
		BlockOptionsJSON:     raw("blockOptions"),
		PageOptionsJSON:      raw("pageOptions"),
		CaptchaOptionsJSON:   raw("captchaOptions"),
		JsCookieOptionsJSON:  raw("jsCookieOptions"),
		Mode:                 mode,
		UseLocalFirewall:     useLocal,
		SynFloodJSON:         raw("synFlood"),
		LogJSON:              raw("log"),
		MaxRequestBodySize:   maxBody,
		DenyCountryHTML:      denyCountryHTML,
		DenyProvinceHTML:     denyProvinceHTML,
	})
	return err
}
