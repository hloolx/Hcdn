package app

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
)

// loginPolicy is the brute-force policy (pure, unit-tested).
type loginPolicy struct {
	FreeAttempts int           // failures before backoff starts
	MaxFailures  int           // per-username lock threshold
	MaxIP        int           // per-IP lock threshold
	Lockout      time.Duration // lock length after the last failure
	MaxBackoff   time.Duration
}

// retryAfter returns seconds to wait given failures in the window and the time
// of the latest failure (0 = allowed now).
func (p loginPolicy) retryAfter(count, threshold int, last, now time.Time) int {
	if count <= 0 {
		return 0
	}
	var until time.Time
	switch {
	case count >= threshold:
		until = last.Add(p.Lockout)
	case count > p.FreeAttempts:
		exp := count - p.FreeAttempts - 1
		if exp > 16 {
			exp = 16
		}
		d := time.Second << exp // 1s, 2s, 4s, ...
		if d > p.MaxBackoff {
			d = p.MaxBackoff
		}
		until = last.Add(d)
	default:
		return 0
	}
	if !until.After(now) {
		return 0
	}
	s := int(until.Sub(now).Seconds() + 0.999)
	if s < 1 {
		s = 1
	}
	return s
}

func (a *App) policy() loginPolicy {
	return loginPolicy{
		FreeAttempts: 3,
		MaxFailures:  a.cfg.Login.MaxFailures,
		MaxIP:        a.cfg.Login.MaxIPFailures,
		Lockout:      time.Duration(a.cfg.Login.LockoutMinutes) * time.Minute,
		MaxBackoff:   5 * time.Minute,
	}
}

func normName(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// checkLoginAllowed returns a 429 when username or IP is in backoff/locked.
func (a *App) checkLoginAllowed(ctx context.Context, scope, username, ip string) error {
	now := a.now()
	since := now.Add(-a.cfg.LoginWindow())
	p := a.policy()
	wait := 0
	if n, last, err := a.store.Failures(ctx, scope, "name", normName(username), since); err != nil {
		return err
	} else {
		wait = max(wait, p.retryAfter(n, p.MaxFailures, time.Unix(last, 0), now))
	}
	if n, last, err := a.store.Failures(ctx, scope, "ip", ip, since); err != nil {
		return err
	} else {
		wait = max(wait, p.retryAfter(n, p.MaxIP, time.Unix(last, 0), now))
	}
	if wait > 0 {
		e := httpx.Errorf(http.StatusTooManyRequests, "rate_limited", "登录失败次数过多，请 %d 秒后重试", wait)
		e.RetryAfter = wait
		return e
	}
	return nil
}

func (a *App) recordLoginFailure(ctx context.Context, scope, username, ip string) {
	now := a.now()
	if err := a.store.RecordFailure(ctx, scope, "name", normName(username), now); err != nil {
		a.log.Warn("record failure", "err", err)
	}
	if err := a.store.RecordFailure(ctx, scope, "ip", ip, now); err != nil {
		a.log.Warn("record failure", "err", err)
	}
}

func (a *App) clearLoginFailures(ctx context.Context, scope, username string) {
	_ = a.store.ClearFailures(ctx, scope, "name", normName(username))
}

// authLimit applies the per-IP /auth/* token bucket.
func (a *App) authLimit(r *http.Request) error {
	if ok, wait := a.authRL.Allow("a:" + clientIP(r)); !ok {
		return rateLimited(wait)
	}
	return nil
}

func invalidCredentials() *httpx.Error {
	return httpx.Errorf(http.StatusBadRequest, "invalid_credentials", "用户名或密码错误")
}
