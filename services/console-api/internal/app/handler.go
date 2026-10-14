package app

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Session cookie names.
const (
	userCookie  = "hcdn_sid"
	adminCookie = "hcdn_asid"
)

type handlerFunc func(w http.ResponseWriter, r *http.Request) error

// principal is the authenticated caller of a handler.
type principal struct {
	sess *store.Session
	raw  string // raw cookie value (for logout / "other sessions")
}

func (p *principal) id() int64 { return p.sess.SubjectID }

type authedFunc func(w http.ResponseWriter, r *http.Request, p *principal) error

// h adapts an error-returning handler.
func (a *App) h(fn handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			a.writeErr(w, r, err)
		}
	}
}

// user requires a customer session.
func (a *App) user(fn authedFunc) http.HandlerFunc {
	return a.authed(store.KindUser, userCookie, fn)
}

// admin requires an admin session.
func (a *App) admin(fn authedFunc) http.HandlerFunc {
	return a.authed(store.KindAdmin, adminCookie, fn)
}

func (a *App) authed(kind, cookie string, fn authedFunc) http.HandlerFunc {
	return a.h(func(w http.ResponseWriter, r *http.Request) error {
		p, err := a.session(r, kind, cookie)
		if err != nil {
			return err
		}
		return fn(w, r, p)
	})
}

func (a *App) session(r *http.Request, kind, cookie string) (*principal, error) {
	ck, err := r.Cookie(cookie)
	if err != nil || ck.Value == "" {
		return nil, httpx.Unauthorized()
	}
	if a.sessions == nil {
		return nil, httpx.Unauthorized()
	}
	s, err := a.sessions.GetSession(r.Context(), kind, ck.Value, a.now())
	if errors.Is(err, store.ErrNotFound) {
		return nil, httpx.Unauthorized()
	}
	if err != nil {
		return nil, err
	}
	return &principal{sess: s, raw: ck.Value}, nil
}

func (a *App) setSessionCookie(w http.ResponseWriter, name, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   a.csrf.Secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(store.SessionAbsolute.Seconds()),
	})
}

func (a *App) clearSessionCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: "", Path: "/", HttpOnly: true, Secure: a.csrf.Secure,
		SameSite: http.SameSiteStrictMode, MaxAge: -1,
	})
}

// writeErr maps internal and EdgeAPI errors to contract errors.
func (a *App) writeErr(w http.ResponseWriter, r *http.Request, err error) {
	var he *httpx.Error
	if errors.As(err, &he) {
		httpx.WriteError(w, he)
		return
	}
	mapped := mapEdgeErr(err)
	if mapped.Status >= 500 {
		a.log.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	} else {
		a.log.Info("request rejected", "method", r.Method, "path", r.URL.Path, "err", err)
	}
	httpx.WriteError(w, mapped)
}

func mapEdgeErr(err error) *httpx.Error {
	if errors.Is(err, edgeapi.ErrNotConfigured) {
		return httpx.Errorf(http.StatusServiceUnavailable, "not_configured", "服务尚未完成配置")
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return httpx.Errorf(http.StatusGatewayTimeout, "upstream_timeout", "上游服务响应超时，请稍后重试")
	}
	st, ok := status.FromError(err)
	if !ok {
		return httpx.Errorf(http.StatusInternalServerError, "internal", "服务器内部错误，请稍后重试")
	}
	msg := strings.ToLower(st.Message())
	switch st.Code() {
	case codes.PermissionDenied, codes.Unauthenticated:
		return httpx.Forbidden()
	case codes.NotFound:
		return httpx.NotFound()
	case codes.InvalidArgument:
		return httpx.Errorf(http.StatusBadRequest, "validation", "%s", st.Message())
	case codes.Unavailable:
		return httpx.Errorf(http.StatusServiceUnavailable, "upstream_unavailable", "上游服务暂不可用，请稍后重试")
	case codes.DeadlineExceeded:
		return httpx.Errorf(http.StatusGatewayTimeout, "upstream_timeout", "上游服务响应超时，请稍后重试")
	}
	// EdgeAPI mostly returns codes.Unknown with a message.
	switch {
	case strings.Contains(msg, "permission denied"), strings.Contains(msg, "context: "), strings.Contains(msg, "not supported node type"):
		return httpx.Forbidden()
	case strings.Contains(msg, "not found"):
		return httpx.NotFound()
	}
	return httpx.Errorf(http.StatusBadGateway, "upstream_error", "上游服务处理失败，请稍后重试")
}

// isNotFound reports an EdgeAPI not-found style error.
func isNotFound(err error) bool {
	return mapEdgeErr(err).Status == http.StatusNotFound
}

// ok writes a 204.
func noContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func writeJSON(w http.ResponseWriter, v any) error {
	httpx.WriteJSON(w, http.StatusOK, v)
	return nil
}

// audit records an activity entry; failures are only logged.
func (a *App) audit(r *http.Request, actorType string, actorID int64, actorName, action, level string) {
	if a.store == nil {
		return
	}
	err := a.store.AddActivity(context.WithoutCancel(r.Context()), store.Activity{
		ActorType: actorType, ActorID: actorID, ActorName: actorName, Action: action,
		IP: clientIP(r), Level: level, CreatedAt: a.now().Unix(),
	})
	if err != nil {
		a.log.Warn("audit write failed", "err", err)
	}
}

func (a *App) auditUser(r *http.Request, p *principal, action string) {
	a.audit(r, "user", p.id(), p.sess.Username, action, "info")
}

func (a *App) auditAdmin(r *http.Request, p *principal, action string) {
	a.audit(r, "admin", p.id(), p.sess.Username, action, "info")
}
