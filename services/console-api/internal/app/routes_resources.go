package app

import "net/http"

func (a *App) routesUserResources(m *http.ServeMux, p string) {
	u := a.user
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
		"PUT /account":                     u(a.updateProfile),
		"PUT /account/password":            u(a.changePassword),
		"GET /account/access-keys":         u(a.listAccessKeys),
		"POST /account/access-keys":        u(a.createAccessKey),
		"PATCH /account/access-keys/{id}":  u(a.updateAccessKey),
		"DELETE /account/access-keys/{id}": u(a.deleteAccessKey),
		"GET /account/activity":            u(a.activity),
	}
	register(m, p, routes)
}

func (a *App) routesAdminResources(m *http.ServeMux, p string) {
	ad := a.admin
	routes := map[string]http.HandlerFunc{
		"GET /dashboard": ad(a.adminDashboard),

		"GET /nodes":         ad(a.adminNodes),
		"GET /nodes/{id}":    ad(a.adminNode),
		"POST /nodes":        ad(a.adminCreateNode),
		"PATCH /nodes/{id}":  ad(a.adminUpdateNode),
		"DELETE /nodes/{id}": ad(a.adminDeleteNode),

		"GET /clusters":          ad(a.adminClusters),
		"POST /clusters":         ad(a.adminCreateCluster),
		"PATCH /clusters/{id}":   ad(a.adminUpdateCluster),
		"PUT /clusters/{id}/dns": ad(a.adminClusterDNS),

		"GET /users":                      ad(a.adminUsers),
		"POST /users":                     ad(a.adminCreateUser),
		"PATCH /users/{id}":               ad(a.adminUpdateUser),
		"POST /users/{id}/reset-password": ad(a.adminResetPassword),
		"DELETE /users/{id}":              ad(a.adminDeleteUser),

		"GET /sites":        ad(a.adminSites),
		"PATCH /sites/{id}": ad(a.adminUpdateSite),
		"GET /certs":        ad(a.adminCerts),

		"GET /dns/providers":          ad(a.adminDNSProviders),
		"POST /dns/providers":         ad(a.adminCreateDNSProvider),
		"DELETE /dns/providers/{id}":  ad(a.adminDeleteDNSProvider),
		"GET /dns/domains":            ad(a.adminDNSDomains),
		"POST /dns/domains":           ad(a.adminCreateDNSDomain),
		"POST /dns/domains/{id}/sync": ad(a.adminSyncDNSDomain),

		"GET /settings":   ad(a.adminSettings),
		"PUT /settings":   ad(a.adminUpdateSettings),
		"GET /audit-logs": ad(a.adminAuditLogs),
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
