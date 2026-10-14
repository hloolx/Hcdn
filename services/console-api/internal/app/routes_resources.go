package app

import "net/http"

func (a *App) routesUserResources(m *http.ServeMux, p string) {
	u := a.user
	ni := a.notImplemented
	routes := map[string]http.HandlerFunc{
		"GET /overview": u(a.overview),
		"GET /stats":    u(a.statsH),
		"GET /logs":     u(a.logs),

		"GET /sites":                       u(a.listSites),
		"POST /sites":                      u(a.createSite),
		"GET /sites/{id}":                  u(a.getSite),
		"PATCH /sites/{id}":                u(a.updateSite),
		"DELETE /sites/{id}":               u(a.deleteSite),
		"PUT /sites/{id}/domains":          u(a.updateDomains),
		"PUT /sites/{id}/origins":          u(a.updateOrigins),
		"POST /sites/{id}/dns-check":       u(a.dnsCheck),
		"GET /sites/{id}/https":            u(a.getHTTPS),
		"PUT /sites/{id}/https":            u(a.putHTTPS),
		"GET /sites/{id}/cache":            u(a.getCache),
		"PUT /sites/{id}/cache":            u(a.putCache),
		"GET /sites/{id}/security":         u(a.getSecurity),
		"PUT /sites/{id}/security":         u(a.putSecurity),
		"GET /certs":                       u(a.listCerts),
		"POST /certs":                      u(a.uploadCert),
		"DELETE /certs/{id}":               u(a.deleteCert),
		"POST /certs/acme":                 u(a.requestAcme),
		"GET /certs/acme/{id}":             u(a.getAcme),
		"POST /cache/purge":                u(a.purge),
		"POST /cache/preheat":              u(a.preheat),
		"GET /cache/tasks":                 u(a.cacheTasks),
		"GET /cache/quota":                 u(a.cacheQuotaH),
		"PUT /account":                     ni,
		"PUT /account/password":            ni,
		"GET /account/access-keys":         ni,
		"POST /account/access-keys":        ni,
		"PATCH /account/access-keys/{id}":  ni,
		"DELETE /account/access-keys/{id}": ni,
		"GET /account/activity":            ni,
	}
	register(m, p, routes)
}

func (a *App) routesAdminResources(m *http.ServeMux, p string) {
	ni := a.notImplemented
	routes := map[string]http.HandlerFunc{
		"GET /dashboard": ni,
		"GET /nodes":     ni, "GET /nodes/{id}": ni, "POST /nodes": ni, "PATCH /nodes/{id}": ni, "DELETE /nodes/{id}": ni,
		"GET /clusters": ni, "POST /clusters": ni, "PATCH /clusters/{id}": ni, "PUT /clusters/{id}/dns": ni,
		"GET /users": ni, "POST /users": ni, "PATCH /users/{id}": ni, "POST /users/{id}/reset-password": ni, "DELETE /users/{id}": ni,
		"GET /sites": ni, "PATCH /sites/{id}": ni, "GET /certs": ni,
		"GET /dns/providers": ni, "POST /dns/providers": ni, "DELETE /dns/providers/{id}": ni,
		"GET /dns/domains": ni, "POST /dns/domains": ni, "POST /dns/domains/{id}/sync": ni,
		"GET /settings": ni, "PUT /settings": ni, "GET /audit-logs": ni,
	}
	register(m, p, routes)
}

func register(m *http.ServeMux, prefix string, routes map[string]http.HandlerFunc) {
	for pat, h := range routes {
		method, path, _ := cut(pat)
		m.HandleFunc(method+" "+prefix+path, h)
	}
}

func cut(s string) (string, string, bool) {
	for i := 0; i < len(s); i++ {
		if s[i] == ' ' {
			return s[:i], s[i+1:], true
		}
	}
	return "", s, false
}
