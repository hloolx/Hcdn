package app

import "net/http"

func (a *App) routesUserResources(m *http.ServeMux, p string) {
	ni := a.notImplemented
	for _, pat := range []string{
		"GET /overview", "GET /stats",
		"GET /sites", "POST /sites", "GET /sites/{id}", "PATCH /sites/{id}", "DELETE /sites/{id}",
		"PUT /sites/{id}/domains", "PUT /sites/{id}/origins", "POST /sites/{id}/dns-check",
		"GET /sites/{id}/https", "PUT /sites/{id}/https", "GET /sites/{id}/cache", "PUT /sites/{id}/cache",
		"GET /sites/{id}/security", "PUT /sites/{id}/security", "GET /logs",
		"GET /certs", "POST /certs", "DELETE /certs/{id}", "POST /certs/acme", "GET /certs/acme/{id}",
		"POST /cache/purge", "POST /cache/preheat", "GET /cache/tasks", "GET /cache/quota",
		"PUT /account", "PUT /account/password", "GET /account/access-keys", "POST /account/access-keys",
		"PATCH /account/access-keys/{id}", "DELETE /account/access-keys/{id}", "GET /account/activity",
	} {
		method, path, _ := cut(pat)
		m.HandleFunc(method+" "+p+path, ni)
	}
}

func (a *App) routesAdminResources(m *http.ServeMux, p string) {
	ni := a.notImplemented
	for _, pat := range []string{
		"GET /dashboard",
		"GET /nodes", "GET /nodes/{id}", "POST /nodes", "PATCH /nodes/{id}", "DELETE /nodes/{id}",
		"GET /clusters", "POST /clusters", "PATCH /clusters/{id}", "PUT /clusters/{id}/dns",
		"GET /users", "POST /users", "PATCH /users/{id}", "POST /users/{id}/reset-password", "DELETE /users/{id}",
		"GET /sites", "PATCH /sites/{id}", "GET /certs",
		"GET /dns/providers", "POST /dns/providers", "DELETE /dns/providers/{id}",
		"GET /dns/domains", "POST /dns/domains", "POST /dns/domains/{id}/sync",
		"GET /settings", "PUT /settings", "GET /audit-logs",
	} {
		method, path, _ := cut(pat)
		m.HandleFunc(method+" "+p+path, ni)
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
