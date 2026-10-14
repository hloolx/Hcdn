package app

import (
	"net/http"

	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
)

func (a *App) notImplemented(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, httpx.NotImplemented())
}

func (a *App) notFoundAPI(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, httpx.NotFound())
}

// routesUser registers the customer API (/api/v1).
func (a *App) routesUser(m *http.ServeMux) {
	const p = "/api/v1"
	m.HandleFunc(p+"/", a.notFoundAPI)

	// public
	m.HandleFunc("GET "+p+"/public/config", a.h(a.publicConfig))
	m.HandleFunc("GET "+p+"/public/plans", a.h(a.publicPlans))

	// auth
	m.HandleFunc("GET "+p+"/auth/me", a.user(a.me))
	m.HandleFunc("POST "+p+"/auth/login", a.h(a.login))
	m.HandleFunc("POST "+p+"/auth/register", a.h(a.register))
	m.HandleFunc("POST "+p+"/auth/logout", a.h(a.logoutWith(userCookie)))
	m.HandleFunc("POST "+p+"/auth/password/forgot", a.h(a.forgotPassword))
	m.HandleFunc("POST "+p+"/auth/password/reset", a.h(a.resetPassword))
	m.HandleFunc("POST "+p+"/auth/email/verify", a.h(a.verifyEmail))

	a.routesUserResources(m, p)
}

// routesAdmin registers the admin API (/api/admin/v1).
func (a *App) routesAdmin(m *http.ServeMux) {
	const p = "/api/admin/v1"
	m.HandleFunc(p+"/", a.notFoundAPI)

	m.HandleFunc("GET "+p+"/auth/me", a.admin(a.adminMeH))
	m.HandleFunc("POST "+p+"/auth/login", a.h(a.adminLogin))
	m.HandleFunc("POST "+p+"/auth/logout", a.h(a.logoutWith(adminCookie)))

	a.routesAdminResources(m, p)
}
