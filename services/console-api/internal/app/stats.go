package app

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
)

// Contract types.

type trafficPoint struct {
	T              int64 `json:"t"`
	Bytes          int64 `json:"bytes"`
	CachedBytes    int64 `json:"cachedBytes"`
	Requests       int64 `json:"requests"`
	CachedRequests int64 `json:"cachedRequests"`
	AttackRequests int64 `json:"attackRequests"`
	BandwidthBps   int64 `json:"bandwidthBps"`
}

type trafficTotals struct {
	Bytes            int64 `json:"bytes"`
	CachedBytes      int64 `json:"cachedBytes"`
	Requests         int64 `json:"requests"`
	CachedRequests   int64 `json:"cachedRequests"`
	AttackRequests   int64 `json:"attackRequests"`
	PeakBandwidthBps int64 `json:"peakBandwidthBps"`
}

type statusCodeCount struct {
	Code  string `json:"code"`
	Count int64  `json:"count"`
}

type regionStat struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Bytes    int64  `json:"bytes"`
	Requests int64  `json:"requests"`
}

type topSite struct {
	SiteID   int64  `json:"siteId"`
	Domain   string `json:"domain"`
	Bytes    int64  `json:"bytes"`
	Requests int64  `json:"requests"`
}

type statsReport struct {
	Range       string            `json:"range"`
	Step        int64             `json:"step"`
	Totals      trafficTotals     `json:"totals"`
	Previous    *trafficTotals    `json:"previous"`
	Series      []trafficPoint    `json:"series"`
	StatusCodes []statusCodeCount `json:"statusCodes"`
	Regions     []regionStat      `json:"regions"`
	TopSites    []topSite         `json:"topSites"`
}

type timeRange struct {
	name string
	dur  time.Duration
	step int64
}

func parseRange(s string) (timeRange, error) {
	switch s {
	case "1h":
		return timeRange{s, time.Hour, 300}, nil
	case "", "24h":
		return timeRange{"24h", 24 * time.Hour, 3600}, nil
	case "7d":
		return timeRange{s, 7 * 24 * time.Hour, 3600}, nil
	case "30d":
		return timeRange{s, 30 * 24 * time.Hour, 86400}, nil
	}
	return timeRange{}, httpx.Validation(map[string]string{"range": "range 只能是 1h、24h、7d 或 30d"})
}

// alignDown aligns t to the bucket start (local midnight for daily buckets;
// EdgeAPI stores stats in its local time zone, which must match ours).
func alignDown(t time.Time, step int64) time.Time {
	if step >= 86400 {
		y, m, d := t.Date()
		return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
	}
	return time.Unix(t.Unix()-t.Unix()%step, 0).In(t.Location())
}

func ymd(t time.Time) string { return t.Format("20060102") }

func parseBucket(day, hms string) (time.Time, bool) {
	if len(hms) == 4 {
		hms += "00"
	}
	t, err := time.ParseInLocation("20060102150405", day+hms, time.Local)
	return t, err == nil
}

// window is a [start,end) period with its buckets.
type window struct {
	start, end time.Time
	step       int64
}

func newWindow(tr timeRange, now time.Time) window {
	end := alignDown(now, tr.step).Add(time.Duration(tr.step) * time.Second)
	if tr.step >= 86400 {
		y, m, d := now.Date()
		end = time.Date(y, m, d+1, 0, 0, 0, 0, now.Location())
	}
	start := end.Add(-tr.dur)
	return window{start: start, end: end, step: tr.step}
}

func (w window) previous() window {
	d := w.end.Sub(w.start)
	return window{start: w.start.Add(-d), end: w.start, step: w.step}
}

// collect gathers series and totals for a user (serverID 0 = all their sites).
func (a *App) collect(call *edgeapi.Call, userID, serverID int64, w window, withSeries bool) ([]trafficPoint, trafficTotals, error) {
	var tot trafficTotals
	dayFrom, dayTo := ymd(w.start), ymd(w.end.Add(-time.Second))
	resp, err := call.ServerDailyStat().FindServerDailyStatsBetweenDays(call.Ctx, &pb.FindServerDailyStatsBetweenDaysRequest{
		UserId: userID, ServerId: serverID, DayFrom: dayFrom, DayTo: dayTo,
	})
	if err != nil {
		return nil, tot, err
	}
	var series []trafficPoint
	idx := map[int64]int{}
	if withSeries {
		for t := w.start; t.Before(w.end); t = nextBucket(t, w.step) {
			idx[t.Unix()] = len(series)
			series = append(series, trafficPoint{T: t.Unix()})
		}
	}
	for _, s := range resp.Stats {
		t, ok := parseBucket(s.Day, s.TimeFrom)
		if !ok || t.Before(w.start) || !t.Before(w.end) {
			continue
		}
		tot.Bytes += s.Bytes
		tot.CachedBytes += s.CachedBytes
		tot.Requests += s.CountRequests
		tot.CachedRequests += s.CountCachedRequests
		if withSeries {
			if i, ok := idx[alignDown(t, w.step).Unix()]; ok {
				p := &series[i]
				p.Bytes += s.Bytes
				p.CachedBytes += s.CachedBytes
				p.Requests += s.CountRequests
				p.CachedRequests += s.CountCachedRequests
			}
		}
	}
	for i := range series {
		series[i].BandwidthBps = series[i].Bytes * 8 / w.step
	}
	// Peak bandwidth (5-minute peaks from the bandwidth tables).
	if bw, err := call.ServerBandwidthStat().FindDailyServerBandwidthStatsBetweenDays(call.Ctx, &pb.FindDailyServerBandwidthStatsBetweenDaysRequest{
		UserId: userID, ServerId: serverID, DayFrom: dayFrom, DayTo: dayTo,
	}); err == nil {
		for _, s := range bw.Stats {
			t, ok := parseBucket(s.Day, s.TimeAt)
			if !ok || t.Before(w.start) || !t.Before(w.end) {
				continue
			}
			tot.PeakBandwidthBps = max(tot.PeakBandwidthBps, s.Bits)
		}
	} else {
		a.log.Debug("bandwidth stats", "err", err)
	}
	// Attack requests are only kept per day.
	if sum, err := call.ServerDailyStat().SumServerDailyStats(call.Ctx, &pb.SumServerDailyStatsRequest{
		UserId: userID, ServerId: serverID, DayFrom: dayFrom, DayTo: dayTo,
	}); err == nil && sum.ServerDailyStat != nil {
		tot.AttackRequests = sum.ServerDailyStat.CountAttackRequests
	}
	if series == nil {
		series = []trafficPoint{}
	}
	return series, tot, nil
}

func nextBucket(t time.Time, step int64) time.Time {
	if step >= 86400 {
		return t.AddDate(0, 0, 1)
	}
	return t.Add(time.Duration(step) * time.Second)
}

// siteTraffic24h sums the last 24 hours of a site.
func (a *App) siteTraffic24h(call *edgeapi.Call, userID, serverID int64) (*traffic24h, error) {
	w := newWindow(timeRange{"24h", 24 * time.Hour, 300}, a.now())
	_, tot, err := a.collectTotalsOnly(call, userID, serverID, w)
	if err != nil {
		return nil, err
	}
	return &traffic24h{Bytes: tot.Bytes, Requests: tot.Requests}, nil
}

func (a *App) collectTotalsOnly(call *edgeapi.Call, userID, serverID int64, w window) ([]trafficPoint, trafficTotals, error) {
	var tot trafficTotals
	resp, err := call.ServerDailyStat().FindServerDailyStatsBetweenDays(call.Ctx, &pb.FindServerDailyStatsBetweenDaysRequest{
		UserId: userID, ServerId: serverID, DayFrom: ymd(w.start), DayTo: ymd(w.end.Add(-time.Second)),
	})
	if err != nil {
		return nil, tot, err
	}
	for _, s := range resp.Stats {
		t, ok := parseBucket(s.Day, s.TimeFrom)
		if !ok || t.Before(w.start) || !t.Before(w.end) {
			continue
		}
		tot.Bytes += s.Bytes
		tot.Requests += s.CountRequests
	}
	return nil, tot, nil
}

// buildReport computes the StatsReport for a user.
func (a *App) buildReport(ctx context.Context, call *edgeapi.Call, userID, siteID int64, tr timeRange, servers []*pb.Server) (*statsReport, error) {
	w := newWindow(tr, a.now())
	series, tot, err := a.collect(call, userID, siteID, w, true)
	if err != nil {
		return nil, err
	}
	rep := &statsReport{Range: tr.name, Step: tr.step, Totals: tot, Series: series,
		StatusCodes: []statusCodeCount{}, Regions: []regionStat{}, TopSites: []topSite{}}
	if _, prev, err := a.collect(call, userID, siteID, w.previous(), false); err == nil {
		rep.Previous = &prev
	}

	// Top sites: per-site totals over the window.
	cand := servers
	if siteID > 0 {
		cand = nil
		for _, s := range servers {
			if s.Id == siteID {
				cand = append(cand, s)
			}
		}
	}
	if len(cand) > 200 {
		cand = cand[:200]
	}
	tops := make([]topSite, len(cand))
	parallel(len(cand), 8, func(i int) {
		s := cand[i]
		domain := s.FirstServerName
		if d := domainsOf(s); domain == "" && len(d) > 0 {
			domain = d[0]
		}
		tops[i] = topSite{SiteID: s.Id, Domain: domain}
		dayFrom, dayTo := ymd(w.start), ymd(w.end.Add(-time.Second))
		sum, err := call.ServerDailyStat().SumServerDailyStats(call.Ctx, &pb.SumServerDailyStatsRequest{
			UserId: userID, ServerId: s.Id, DayFrom: dayFrom, DayTo: dayTo,
		})
		if err == nil && sum.ServerDailyStat != nil {
			tops[i].Bytes, tops[i].Requests = sum.ServerDailyStat.Bytes, sum.ServerDailyStat.CountRequests
		}
	})
	sort.SliceStable(tops, func(i, j int) bool { return tops[i].Bytes > tops[j].Bytes })
	if len(tops) > 10 {
		tops = tops[:10]
	}
	rep.TopSites = tops

	// Regions (monthly per-site stats; requests only).
	regionIDs := []int64{}
	for _, t := range tops {
		if t.Requests > 0 || siteID > 0 {
			regionIDs = append(regionIDs, t.SiteID)
		}
	}
	rep.Regions = a.topRegions(ctx, call, regionIDs)
	return rep, nil
}

func (a *App) topRegions(ctx context.Context, call *edgeapi.Call, serverIDs []int64) []regionStat {
	month := a.now().Format("200601")
	var mu sync.Mutex
	agg := map[int64]*regionStat{}
	parallel(len(serverIDs), 8, func(i int) {
		resp, err := call.ServerRegionCountryStat().FindTopServerRegionCountryMonthlyStats(call.Ctx, &pb.FindTopServerRegionCountryMonthlyStatsRequest{
			Month: month, ServerId: serverIDs[i], Offset: 0, Size: 20,
		})
		if err != nil {
			return
		}
		mu.Lock()
		defer mu.Unlock()
		for _, s := range resp.Stats {
			if s.RegionCountry == nil {
				continue
			}
			r, ok := agg[s.RegionCountry.Id]
			if !ok {
				r = &regionStat{Name: s.RegionCountry.Name}
				agg[s.RegionCountry.Id] = r
			}
			r.Requests += s.Count
		}
	})
	out := make([]regionStat, 0, len(agg))
	for id, r := range agg {
		reg := a.regionOf(ctx, id)
		r.Code = reg.code
		if reg.name != "" {
			r.Name = reg.name
		}
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Requests > out[j].Requests })
	if len(out) > 20 {
		out = out[:20]
	}
	return out
}

func (a *App) statsH(w http.ResponseWriter, r *http.Request, p *principal) error {
	tr, err := parseRange(r.URL.Query().Get("range"))
	if err != nil {
		return err
	}
	siteID := httpx.QueryInt(r, "siteId", 0)
	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	var servers []*pb.Server
	if siteID > 0 {
		s, err := ownedServer(call, p.id(), siteID)
		if err != nil {
			return err
		}
		servers = []*pb.Server{s}
	} else if servers, err = userServers(call, p.id(), 500); err != nil {
		return err
	}
	rep, err := a.buildReport(r.Context(), call, p.id(), siteID, tr, servers)
	if err != nil {
		return err
	}
	return writeJSON(w, rep)
}

type overviewResp struct {
	*statsReport
	Sites struct {
		Total      int `json:"total"`
		Active     int `json:"active"`
		PendingDNS int `json:"pendingDns"`
		Disabled   int `json:"disabled"`
	} `json:"sites"`
	Certs struct {
		Total        int64 `json:"total"`
		ExpiringSoon int64 `json:"expiringSoon"`
	} `json:"certs"`
}

func (a *App) overview(w http.ResponseWriter, r *http.Request, p *principal) error {
	tr, err := parseRange(r.URL.Query().Get("range"))
	if err != nil {
		return err
	}
	ctx := r.Context()
	call, err := a.edge.AsUser(ctx, p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	servers, err := userServers(call, p.id(), 1000)
	if err != nil {
		return err
	}
	rep, err := a.buildReport(ctx, call, p.id(), 0, tr, servers)
	if err != nil {
		return err
	}
	out := overviewResp{statsReport: rep}
	ids := make([]int64, len(servers))
	for i, s := range servers {
		ids[i] = s.Id
	}
	metas, err := a.store.SiteMetas(ctx, ids)
	if err != nil {
		return err
	}
	out.Sites.Total = len(servers)
	for _, s := range servers {
		switch siteStatus(s.IsOn, metas[s.Id]) {
		case "active":
			out.Sites.Active++
		case "disabled":
			out.Sites.Disabled++
		default:
			out.Sites.PendingDNS++
		}
	}
	if c, err := call.SSLCert().CountSSLCerts(call.Ctx, &pb.CountSSLCertRequest{UserId: p.id()}); err == nil {
		out.Certs.Total = c.Count
	}
	if c, err := call.SSLCert().CountSSLCerts(call.Ctx, &pb.CountSSLCertRequest{UserId: p.id(), ExpiringDays: 30}); err == nil {
		out.Certs.ExpiringSoon = c.Count
	}
	return writeJSON(w, out)
}

// ---------------------------------------------------------------- access logs

type accessLog struct {
	ID         string  `json:"id"`
	Time       int64   `json:"time"`
	ClientIP   string  `json:"clientIp"`
	Region     string  `json:"region"`
	Method     string  `json:"method"`
	Scheme     string  `json:"scheme"`
	Host       string  `json:"host"`
	Path       string  `json:"path"`
	Status     int32   `json:"status"`
	Bytes      int64   `json:"bytes"`
	DurationMs int64   `json:"durationMs"`
	Cache      string  `json:"cache"`
	UserAgent  string  `json:"userAgent"`
	Referer    string  `json:"referer"`
	WAFAction  *string `json:"wafAction"`
}

// statusFilter converts "2xx" / "404" / "4xx,5xx" into an EdgeAPI keyword and a local predicate.
func statusFilter(s string) (string, func(int32) bool, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "", nil, true
	}
	if len(s) == 3 && s[1:] == "xx" && s[0] >= '1' && s[0] <= '5' {
		lo := int32(s[0]-'0') * 100
		return "status:" + strconv.Itoa(int(lo)) + "-" + strconv.Itoa(int(lo+99)), func(c int32) bool { return c >= lo && c <= lo+99 }, true
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 100 || n > 599 {
		return "", nil, false
	}
	return "status:" + s, func(c int32) bool { return c == int32(n) }, true
}

func (a *App) logs(w http.ResponseWriter, r *http.Request, p *principal) error {
	q := r.URL.Query()
	siteID := httpx.QueryInt(r, "siteId", 0)
	size := httpx.QueryInt(r, "size", 50)
	if size < 1 || size > 500 {
		size = 50
	}
	now := a.now()
	to := now
	if v := httpx.QueryInt(r, "to", 0); v > 0 {
		to = time.Unix(v, 0)
	}
	from := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, time.Local)
	if v := httpx.QueryInt(r, "from", 0); v > 0 && time.Unix(v, 0).After(from) {
		from = time.Unix(v, 0)
	}
	statusKW, statusOK, valid := statusFilter(q.Get("status"))
	if !valid {
		return httpx.Validation(map[string]string{"status": "状态码格式应为 404 或 4xx"})
	}
	ip := strings.TrimSpace(q.Get("ip"))
	keyword := strings.TrimSpace(q.Get("keyword"))
	if len(keyword) > 256 || len(ip) > 128 {
		return httpx.BadRequest("查询条件过长")
	}
	if keyword == "" && statusKW != "" {
		keyword, statusOK = statusKW, nil
	}
	cursor := q.Get("cursor")
	if len(cursor) > 128 {
		return httpx.BadRequest("cursor 无效")
	}

	call, err := a.edge.AsUser(r.Context(), p.id())
	if err != nil {
		return err
	}
	defer call.Done()
	if siteID > 0 {
		if _, err := ownedServer(call, p.id(), siteID); err != nil {
			return err
		}
	}
	resp, err := call.AccessLog().ListHTTPAccessLogs(call.Ctx, &pb.ListHTTPAccessLogsRequest{
		RequestId: cursor,
		ServerId:  siteID,
		UserId:    p.id(),
		Size:      size,
		Day:       ymd(to),
		HourFrom:  strconv.Itoa(from.Hour()),
		HourTo:    strconv.Itoa(to.Hour()),
		Keyword:   keyword,
		Ip:        ip,
		Partition: -1,
	})
	if err != nil {
		return err
	}
	items := make([]accessLog, 0, len(resp.HttpAccessLogs))
	for _, l := range resp.HttpAccessLogs {
		if statusOK != nil && !statusOK(l.Status) {
			continue
		}
		if l.Timestamp < from.Unix() || l.Timestamp > to.Unix() {
			continue
		}
		items = append(items, convertLog(l))
	}
	var next *string
	if resp.HasMore && resp.RequestId != "" {
		next = &resp.RequestId
	}
	return writeJSON(w, map[string]any{"items": items, "nextCursor": next})
}

func convertLog(l *pb.HTTPAccessLog) accessLog {
	cache := "-"
	switch strings.ToUpper(l.Attrs["cache.status"]) {
	case "HIT", "STALE":
		cache = "HIT"
	default:
		if h, ok := l.SentHeader["X-Cache"]; ok && h != nil && len(h.Values) > 0 {
			v := strings.ToUpper(h.Values[0])
			switch {
			case strings.HasPrefix(v, "HIT"):
				cache = "HIT"
			case strings.HasPrefix(v, "MISS"):
				cache = "MISS"
			case strings.HasPrefix(v, "BYPASS"):
				cache = "BYPASS"
			}
		}
	}
	var waf *string
	if len(l.FirewallActions) > 0 {
		s := strings.Join(l.FirewallActions, ",")
		waf = &s
	}
	scheme := l.Scheme
	if scheme != "https" {
		scheme = "http"
	}
	return accessLog{
		ID: l.RequestId, Time: l.Timestamp, ClientIP: l.RemoteAddr, Region: "",
		Method: l.RequestMethod, Scheme: scheme, Host: l.Host, Path: l.RequestURI,
		Status: l.Status, Bytes: l.BytesSent, DurationMs: int64(l.RequestTime * 1000),
		Cache: cache, UserAgent: l.UserAgent, Referer: l.Referer, WAFAction: waf,
	}
}
