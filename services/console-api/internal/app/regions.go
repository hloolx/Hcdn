package app

import (
	"context"
	"strings"
	"time"

	"github.com/TeaOSLab/EdgeCommon/pkg/rpc/pb"
)

type region struct {
	code string // ISO 3166-1 alpha-2, "" when unknown
	name string
}

// loadRegions caches EdgeAPI's country table (id <-> ISO code). EdgeAPI stores
// the ISO code in routeCode as "world:JP".
func (a *App) loadRegions(ctx context.Context) error {
	a.regionMu.Lock()
	defer a.regionMu.Unlock()
	if a.regionByID != nil && time.Since(a.regionsLoaded) < 6*time.Hour {
		return nil
	}
	call, err := a.edge.AsAdmin(ctx, a.cfg.EdgeAPI.AdminID)
	if err != nil {
		return err
	}
	defer call.Done()
	resp, err := call.RegionCountry().FindAllRegionCountries(call.Ctx, &pb.FindAllRegionCountriesRequest{})
	if err != nil {
		return err
	}
	byID := map[int64]region{}
	byCode := map[string]int64{}
	for _, c := range resp.RegionCountries {
		code := isoFromRouteCode(c.RouteCode)
		name := c.DisplayName
		if name == "" {
			name = c.Name
		}
		byID[c.Id] = region{code: code, name: name}
		if code != "" {
			if _, dup := byCode[code]; !dup {
				byCode[code] = c.Id
			}
		}
	}
	// Greater-China pseudo regions have no routeCode (regionconfigs/china.go):
	// 1 = China (all), 261 = HK, 262 = TW, 263 = MO. The node treats HK/TW/MO
	// as provinces of id 1, so blocking them must use these ids.
	for id, code := range map[int64]string{1: "CN", 261: "HK", 262: "TW", 263: "MO"} {
		if r, ok := byID[id]; ok {
			if old, ok := byCode[code]; ok && old != id {
				o := byID[old] // a duplicate "world:XX" entry keeps its name but loses the code
				o.code = ""
				byID[old] = o
			}
			r.code = code
			byID[id] = r
			byCode[code] = id
		}
	}
	a.regionByID, a.regionByCode, a.regionsLoaded = byID, byCode, time.Now()
	return nil
}

func isoFromRouteCode(rc string) string {
	rc = strings.TrimSpace(rc)
	if i := strings.LastIndex(rc, ":"); i >= 0 {
		rc = rc[i+1:]
	}
	if len(rc) != 2 {
		return ""
	}
	rc = strings.ToUpper(rc)
	if rc[0] < 'A' || rc[0] > 'Z' || rc[1] < 'A' || rc[1] > 'Z' {
		return ""
	}
	return rc
}

// regionOf maps a country id to (code, name).
func (a *App) regionOf(ctx context.Context, id int64) region {
	if err := a.loadRegions(ctx); err != nil {
		a.log.Warn("load regions", "err", err)
	}
	a.regionMu.Lock()
	defer a.regionMu.Unlock()
	return a.regionByID[id]
}

// countryIDs maps ISO codes to country ids; unknown codes are returned separately.
func (a *App) countryIDs(ctx context.Context, codes []string) ([]int64, []string, error) {
	if err := a.loadRegions(ctx); err != nil {
		return nil, nil, err
	}
	a.regionMu.Lock()
	defer a.regionMu.Unlock()
	var ids []int64
	var unknown []string
	for _, c := range codes {
		if id, ok := a.regionByCode[strings.ToUpper(strings.TrimSpace(c))]; ok {
			ids = append(ids, id)
		} else {
			unknown = append(unknown, c)
		}
	}
	return ids, unknown, nil
}

// countryCodes maps ids to ISO codes (ids without a code are dropped).
func (a *App) countryCodes(ctx context.Context, ids []int64) []string {
	if err := a.loadRegions(ctx); err != nil {
		a.log.Warn("load regions", "err", err)
	}
	a.regionMu.Lock()
	defer a.regionMu.Unlock()
	out := []string{}
	for _, id := range ids {
		if r, ok := a.regionByID[id]; ok && r.code != "" {
			out = append(out, r.code)
		}
	}
	return out
}
