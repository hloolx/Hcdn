package app

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
)

type cacheRule struct {
	ID    string `json:"id"`
	Match struct {
		Type  string `json:"type"`
		Value string `json:"value"`
	} `json:"match"`
	TTLSeconds  int64 `json:"ttlSeconds"`
	IgnoreQuery bool  `json:"ignoreQuery"`
	Enabled     bool  `json:"enabled"`
}

type cacheSettings struct {
	Enabled bool        `json:"enabled"`
	Rules   []cacheRule `json:"rules"`
}

const (
	cacheKeyFull    = "${scheme}://${host}${requestPath}${isArgs}${args}"
	cacheKeyNoQuery = "${scheme}://${host}${requestPath}"
	staticExts      = "css,js,mjs,png,jpg,jpeg,gif,webp,avif,svg,ico,bmp,woff,woff2,ttf,otf,eot,mp4,webm,mp3,ogg,pdf,zip,gz,wasm"
)

func newRule(typ, value string, ttl int64, ignoreQuery bool) cacheRule {
	r := cacheRule{TTLSeconds: ttl, IgnoreQuery: ignoreQuery, Enabled: true}
	r.Match.Type, r.Match.Value = typ, value
	return r
}

// cachePreset returns the settings used at site creation.
func cachePreset(name string) cacheSettings {
	switch name {
	case "none":
		return cacheSettings{Enabled: false, Rules: []cacheRule{}}
	case "dynamic":
		return cacheSettings{Enabled: true, Rules: []cacheRule{newRule("extension", staticExts, 3600, false)}}
	default: // static
		return cacheSettings{Enabled: true, Rules: []cacheRule{
			newRule("extension", staticExts, 7*86400, false),
			newRule("extension", "html,htm", 600, false),
		}}
	}
}

// httpCond is shared.HTTPRequestCond.
type httpCond struct {
	Type              string `json:"type"`
	IsRequest         bool   `json:"isRequest"`
	Param             string `json:"param"`
	Operator          string `json:"operator"`
	Value             string `json:"value"`
	IsCaseInsensitive bool   `json:"isCaseInsensitive"`
	IsReverse         bool   `json:"isReverse"`
}

type sizeCapacity struct {
	Count int64  `json:"count"`
	Unit  string `json:"unit"`
}

// cacheRef is serverconfigs.HTTPCacheRef (fields we set).
type cacheRef struct {
	IsOn                     bool           `json:"isOn"`
	CachePolicyID            int64          `json:"cachePolicyId"`
	Key                      string         `json:"key"`
	Life                     sizeCapacity   `json:"life"`
	Status                   []int          `json:"status"`
	MaxSize                  sizeCapacity   `json:"maxSize"`
	MinSize                  sizeCapacity   `json:"minSize"`
	Methods                  []string       `json:"methods"`
	SkipCacheControlValues   []string       `json:"skipCacheControlValues"`
	SkipSetCookie            bool           `json:"skipSetCookie"`
	EnableRequestCachePragma bool           `json:"enableRequestCachePragma"`
	AllowChunkedEncoding     bool           `json:"allowChunkedEncoding"`
	AllowPartialContent      bool           `json:"allowPartialContent"`
	ForcePartialContent      bool           `json:"forcePartialContent"`
	EnableIfNoneMatch        bool           `json:"enableIfNoneMatch"`
	EnableIfModifiedSince    bool           `json:"enableIfModifiedSince"`
	EnableReadingOriginAsync bool           `json:"enableReadingOriginAsync"`
	IsReverse                bool           `json:"isReverse"`
	ExpiresTime              map[string]any `json:"expiresTime"`
	Conds                    any            `json:"conds"`
	SimpleCond               *httpCond      `json:"simpleCond"`
}

func splitExts(v string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, e := range strings.FieldsFunc(strings.ToLower(v), func(r rune) bool { return r == ',' || r == ' ' || r == ';' || r == '|' }) {
		e = "." + strings.TrimLeft(strings.TrimSpace(e), ".*")
		if e == "." || seen[e] {
			continue
		}
		seen[e] = true
		out = append(out, e)
	}
	return out
}

var extRe = regexp.MustCompile(`^\.[a-z0-9_-]{1,16}$`)

// validateCache normalizes rules and returns field errors.
func validateCache(cs *cacheSettings) error {
	f := httpx.Fields{}
	if len(cs.Rules) > 50 {
		f.Add("rules", "最多 50 条缓存规则")
	}
	for i := range cs.Rules {
		r := &cs.Rules[i]
		key := "rules." + strconv.Itoa(i)
		if r.TTLSeconds < 0 || r.TTLSeconds > 365*86400 {
			f.Add(key+".ttlSeconds", "缓存时间范围为 0 秒到 365 天")
		}
		v := strings.TrimSpace(r.Match.Value)
		switch r.Match.Type {
		case "all":
			v = ""
		case "extension":
			exts := splitExts(v)
			if len(exts) == 0 {
				f.Add(key+".match", "请填写扩展名，例如 jpg,png")
			}
			for _, e := range exts {
				if !extRe.MatchString(e) {
					f.Add(key+".match", "扩展名格式不正确："+e)
				}
			}
			v = strings.Join(trimDots(exts), ",")
		case "path_prefix":
			if !strings.HasPrefix(v, "/") || len(v) > 512 {
				f.Add(key+".match", "路径前缀需以 / 开头")
			}
		case "regex":
			if v == "" || len(v) > 512 {
				f.Add(key+".match", "请填写正则表达式")
			} else if _, err := regexp.Compile(v); err != nil {
				f.Add(key+".match", "正则表达式无效")
			}
		default:
			f.Add(key+".match", "匹配类型无效")
		}
		r.Match.Value = v
		if r.ID == "" {
			r.ID = "r" + strconv.Itoa(i+1)
		}
	}
	return f.Err()
}

func trimDots(exts []string) []string {
	out := make([]string, len(exts))
	for i, e := range exts {
		out[i] = strings.TrimPrefix(e, ".")
	}
	return out
}

func ruleToRef(r cacheRule) cacheRef {
	var cond httpCond
	cond.IsRequest = true
	switch r.Match.Type {
	case "all":
		cond.Type, cond.Param, cond.Operator, cond.Value = "url-all", "${requestPath}", "prefix", "/"
	case "extension":
		data, _ := json.Marshal(splitExts(r.Match.Value))
		cond.Type, cond.Param, cond.Operator, cond.Value = "url-extension", "${requestPathLowerExtension}", "in", string(data)
	case "path_prefix":
		cond.Type, cond.Param, cond.Operator, cond.Value = "url-prefix", "${requestPath}", "prefix", r.Match.Value
	case "regex":
		cond.Type, cond.Param, cond.Operator, cond.Value = "url-regexp", "${requestPath}", "regexp", r.Match.Value
	}
	key := cacheKeyFull
	if r.IgnoreQuery {
		key = cacheKeyNoQuery
	}
	ttl := r.TTLSeconds
	if ttl <= 0 {
		ttl = 1
	}
	return cacheRef{
		IsOn:                   r.Enabled,
		Key:                    key,
		Life:                   sizeCapacity{Count: ttl, Unit: "second"},
		Status:                 []int{200},
		MaxSize:                sizeCapacity{Count: 128, Unit: "mb"},
		MinSize:                sizeCapacity{Count: 0, Unit: "kb"},
		Methods:                []string{},
		SkipCacheControlValues: []string{"private", "no-cache", "no-store"},
		SkipSetCookie:          true,
		AllowChunkedEncoding:   true,
		AllowPartialContent:    true,
		IsReverse:              r.TTLSeconds == 0, // ttl 0 = never cache matching requests
		ExpiresTime: map[string]any{
			"isPrior": false, "isOn": false, "overwrite": true, "autoCalculate": true,
			"duration": map[string]any{"count": -1, "unit": "hour"},
		},
		SimpleCond: &cond,
	}
}

func lifeSeconds(l sizeCapacity) int64 {
	mult := map[string]int64{"ms": 0, "second": 1, "minute": 60, "hour": 3600, "day": 86400, "week": 7 * 86400}
	m, ok := mult[l.Unit]
	if !ok {
		m = 1
	}
	return l.Count * m
}

// parseCache converts the web's HTTPCacheConfig to the contract shape.
func parseCache(raw json.RawMessage) cacheSettings {
	out := cacheSettings{Rules: []cacheRule{}}
	o := parseRawObject(raw)
	o.get("isOn", &out.Enabled)
	var refs []cacheRef
	o.get("cacheRefs", &refs)
	for i, ref := range refs {
		r := cacheRule{ID: "r" + strconv.Itoa(i+1), Enabled: ref.IsOn, TTLSeconds: lifeSeconds(ref.Life)}
		if ref.IsReverse {
			r.TTLSeconds = 0
		}
		r.IgnoreQuery = !strings.Contains(ref.Key, "${args}") && !strings.Contains(ref.Key, "${requestURI}")
		c := ref.SimpleCond
		if c == nil {
			continue // complex conditions are not representable; leave them out
		}
		switch c.Type {
		case "url-all":
			r.Match.Type = "all"
		case "url-extension":
			var exts []string
			_ = json.Unmarshal([]byte(c.Value), &exts)
			r.Match.Type, r.Match.Value = "extension", strings.Join(trimDots(exts), ",")
		case "url-prefix":
			r.Match.Type, r.Match.Value = "path_prefix", c.Value
		case "url-regexp":
			r.Match.Type, r.Match.Value = "regex", c.Value
		default:
			continue
		}
		out.Rules = append(out.Rules, r)
	}
	return out
}

// writeCache stores settings into the web (read-modify-write of HTTPCacheConfig).
func (a *App) writeCache(call *edgeapi.Call, wc *webConfig, cs cacheSettings) error {
	o := parseRawObject(wc.Cache)
	o.set("isOn", cs.Enabled)
	if _, ok := o["addStatusHeader"]; !ok {
		o.set("addStatusHeader", true)
	}
	o.set("isPrior", false)
	// The customer's rules are authoritative: do not fall back to the cluster policy's refs.
	o.set("disablePolicyRefs", true)
	refs := make([]cacheRef, 0, len(cs.Rules))
	for _, r := range cs.Rules {
		refs = append(refs, ruleToRef(r))
	}
	o.set("cacheRefs", refs)
	_, err := call.HTTPWeb().UpdateHTTPWebCache(call.Ctx, &pb.UpdateHTTPWebCacheRequest{HttpWebId: wc.ID, CacheJSON: o.bytes()})
	return err
}

func (a *App) getCache(w http.ResponseWriter, r *http.Request, p *principal) error {
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
	wc, _, err := a.webConfig(call, id)
	if err != nil {
		return err
	}
	return writeJSON(w, parseCache(wc.Cache))
}

func (a *App) putCache(w http.ResponseWriter, r *http.Request, p *principal) error {
	id, err := httpx.PathID(r, "id")
	if err != nil {
		return err
	}
	var cs cacheSettings
	if err := httpx.DecodeJSON(r, &cs); err != nil {
		return err
	}
	if cs.Rules == nil {
		cs.Rules = []cacheRule{}
	}
	if err := validateCache(&cs); err != nil {
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
	wc, _, err := a.webConfig(call, id)
	if err != nil {
		return err
	}
	if err := a.writeCache(call, wc, cs); err != nil {
		return err
	}
	a.auditUser(r, p, "修改站点 #"+strconv.FormatInt(id, 10)+" 的缓存规则")
	wc, _, err = a.webConfig(call, id)
	if err != nil {
		return err
	}
	return writeJSON(w, parseCache(wc.Cache))
}
