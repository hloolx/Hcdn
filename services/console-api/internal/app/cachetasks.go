package app

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
)

type cacheTaskResp struct {
	ID        int64    `json:"id"`
	Type      string   `json:"type"`
	KeyType   string   `json:"keyType"`
	Targets   []string `json:"targets"`
	Status    string   `json:"status"`
	CreatedAt int64    `json:"createdAt"`
	DoneAt    *int64   `json:"doneAt"`
	Done      int      `json:"done"`
	Total     int      `json:"total"`
}

type cacheQuota struct {
	MaxKeysPerTask int64 `json:"maxKeysPerTask"`
	MaxKeysPerDay  int64 `json:"maxKeysPerDay"`
	UsedToday      int64 `json:"usedToday"`
}

// EdgeAPI defaults when userServerConfig leaves the limits at 0.
const (
	defaultKeysPerTask = 1000
	defaultKeysPerDay  = 10000
)

func toCacheTask(t *pb.HTTPCacheTask) cacheTaskResp {
	out := cacheTaskResp{ID: t.Id, Type: "purge", KeyType: "url", Targets: []string{}, CreatedAt: t.CreatedAt}
	if t.Type == "fetch" {
		out.Type = "preheat"
	}
	if t.KeyType == "prefix" {
		out.KeyType = "prefix"
	}
	doing := false
	for _, k := range t.HttpCacheTaskKeys {
		out.Targets = append(out.Targets, k.Key)
		if k.IsDone {
			out.Done++
		}
		doing = doing || k.IsDoing
	}
	out.Total = len(t.HttpCacheTaskKeys)
	switch {
	case t.IsDone && t.IsOk:
		out.Status = "done"
		out.Done = out.Total
	case t.IsDone:
		out.Status = "failed"
	case doing || out.Done > 0:
		out.Status = "running"
	default:
		out.Status = "pending"
	}
	if t.IsDone && t.DoneAt > 0 {
		d := t.DoneAt
		out.DoneAt = &d
	}
	return out
}

func (a *App) quotaLimits(call *edgeapi.Call) (perTask, perDay int64) {
	perTask, perDay = defaultKeysPerTask, defaultKeysPerDay
	resp, err := call.SysSetting().ReadSysSetting(call.Ctx, &pb.ReadSysSettingRequest{Code: "userServerConfig"})
	if err != nil || len(resp.ValueJSON) == 0 {
		return
	}
	var cfg struct {
		Purge *struct {
			MaxKeysPerTask int64 `json:"maxKeysPerTask"`
			MaxKeysPerDay  int64 `json:"maxKeysPerDay"`
		} `json:"httpCacheTaskPurgeConfig"`
	}
	if json.Unmarshal(resp.ValueJSON, &cfg) == nil && cfg.Purge != nil {
		if cfg.Purge.MaxKeysPerTask > 0 {
			perTask = cfg.Purge.MaxKeysPerTask
		}
		if cfg.Purge.MaxKeysPerDay > 0 {
			perDay = cfg.Purge.MaxKeysPerDay
		}
	}
	return
}

// usedToday counts purge keys submitted today (newest tasks first, capped).
func (a *App) usedToday(call *edgeapi.Call, typ string) int64 {
	now := a.now()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local).Unix()
	var ids []int64
	for off := int64(0); off < 300; off += 100 {
		resp, err := call.CacheTask().ListHTTPCacheTasks(call.Ctx, &pb.ListHTTPCacheTasksRequest{Offset: off, Size: 100})
		if err != nil {
			break
		}
		stop := len(resp.HttpCacheTasks) < 100
		for _, t := range resp.HttpCacheTasks {
			if t.CreatedAt < dayStart {
				stop = true
				break
			}
			if t.Type == typ {
				ids = append(ids, t.Id)
			}
		}
		if stop {
			break
		}
	}
	counts := make([]int64, len(ids))
	parallel(len(ids), 8, func(i int) {
		if r, err := call.CacheTask().FindEnabledHTTPCacheTask(call.Ctx, &pb.FindEnabledHTTPCacheTaskRequest{HttpCacheTaskId: ids[i]}); err == nil && r.HttpCacheTask != nil {
			counts[i] = int64(len(r.HttpCacheTask.HttpCacheTaskKeys))
		}
	})
	var n int64
	for _, c := range counts {
		n += c
	}
	return n
}

func (a *App) cacheQuotaH(w http.ResponseWriter, r *http.Request, p *principal) error {
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	perTask, perDay := a.quotaLimits(call)
	return writeJSON(w, cacheQuota{MaxKeysPerTask: perTask, MaxKeysPerDay: perDay, UsedToday: a.usedToday(call, "purge")})
}

func normalizeTargets(in []string, field string, max int64) ([]string, error) {
	f := httpx.Fields{}
	out := []string{}
	seen := map[string]bool{}
	for _, t := range in {
		t = strings.TrimSpace(t)
		if t == "" || seen[t] {
			continue
		}
		u, err := url.Parse(t)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || len(t) > 2048 {
			f.Add(field, "请输入完整的 URL（以 http:// 或 https:// 开头）："+t)
			continue
		}
		if !validHostname(strings.ToLower(u.Hostname()), false) {
			f.Add(field, "URL 域名无效："+t)
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	if len(out) == 0 {
		f.Add(field, "请至少填写一个 URL")
	}
	if int64(len(out)) > max {
		f.Add(field, "单次最多提交 "+itoa(max)+" 条")
	}
	return out, f.Err()
}

func (a *App) createCacheTask(w http.ResponseWriter, r *http.Request, p *principal, typ, keyType string, targets []string, field string) error {
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	perTask, perDay := a.quotaLimits(call)
	keys, err := normalizeTargets(targets, field, perTask)
	if err != nil {
		return err
	}
	if used := a.usedToday(call, typ); used+int64(len(keys)) > perDay {
		return httpx.Errorf(http.StatusTooManyRequests, "quota_exceeded", "今日额度不足（已用 %d / %d）", used, perDay)
	}
	resp, err := call.CacheTask().CreateHTTPCacheTask(call.Ctx, &pb.CreateHTTPCacheTaskRequest{Type: typ, KeyType: keyType, Keys: keys})
	if err != nil {
		return err
	}
	found, err := call.CacheTask().FindEnabledHTTPCacheTask(call.Ctx, &pb.FindEnabledHTTPCacheTaskRequest{HttpCacheTaskId: resp.HttpCacheTaskId})
	if err != nil {
		return err
	}
	if found.HttpCacheTask == nil {
		return httpx.NotFound()
	}
	verb := map[string]string{"purge": "刷新缓存", "fetch": "预热缓存"}[typ]
	a.auditUser(r, p, verb+" "+itoa(int64(len(keys)))+" 条")
	httpx.WriteJSON(w, http.StatusCreated, toCacheTask(found.HttpCacheTask))
	return nil
}

func (a *App) purge(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		KeyType string   `json:"keyType"`
		Targets []string `json:"targets"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	keyType := "key"
	switch req.KeyType {
	case "url", "":
	case "prefix":
		keyType = "prefix"
	default:
		return httpx.Validation(map[string]string{"keyType": "keyType 只能是 url 或 prefix"})
	}
	return a.createCacheTask(w, r, p, "purge", keyType, req.Targets, "targets")
}

func (a *App) preheat(w http.ResponseWriter, r *http.Request, p *principal) error {
	var req struct {
		URLs []string `json:"urls"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return err
	}
	return a.createCacheTask(w, r, p, "fetch", "key", req.URLs, "urls")
}

func (a *App) cacheTasks(w http.ResponseWriter, r *http.Request, p *principal) error {
	page, size := httpx.Paging(r)
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	cnt, err := call.CacheTask().CountHTTPCacheTasks(call.Ctx, &pb.CountHTTPCacheTasksRequest{})
	if err != nil {
		return err
	}
	list, err := call.CacheTask().ListHTTPCacheTasks(call.Ctx, &pb.ListHTTPCacheTasksRequest{Offset: (page - 1) * size, Size: size})
	if err != nil {
		return err
	}
	items := make([]cacheTaskResp, len(list.HttpCacheTasks))
	parallel(len(list.HttpCacheTasks), 8, func(i int) {
		t := list.HttpCacheTasks[i]
		if full, err := call.CacheTask().FindEnabledHTTPCacheTask(call.Ctx, &pb.FindEnabledHTTPCacheTaskRequest{HttpCacheTaskId: t.Id}); err == nil && full.HttpCacheTask != nil {
			t = full.HttpCacheTask
		}
		items[i] = toCacheTask(t)
	})
	return writeJSON(w, httpx.Page[cacheTaskResp]{Items: items, Total: cnt.Count, Page: page, PageSize: size})
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
