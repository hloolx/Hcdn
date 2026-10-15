package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/hloolx/Hcdn/services/console-api/internal/httpx"
)

// turnstileSiteverifyURL is Cloudflare's verification endpoint.
const turnstileSiteverifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

type turnstileVerifyResponse struct {
	Success    bool     `json:"success"`
	ErrorCodes []string `json:"error-codes"`
}

// turnstileEnabled reports whether captcha verification is required.
func (a *App) turnstileEnabled() bool { return a.cfg.Turnstile.Enabled() }

// turnstileSiteKey is the key exposed to the frontend ("" hides the widget
// and disables the server-side check).
func (a *App) turnstileSiteKey() string {
	if a.turnstileEnabled() {
		return a.cfg.Turnstile.SiteKey
	}
	return ""
}

func captchaFailed() *httpx.Error {
	return httpx.Errorf(http.StatusBadRequest, "captcha_failed", "人机验证失败，请重试")
}

func captchaUnavailable() *httpx.Error {
	return httpx.Errorf(http.StatusBadRequest, "captcha_unavailable", "人机验证服务暂不可用，请稍后重试")
}

// verifyTurnstile enforces Cloudflare Turnstile when enabled. Callers must run
// this before any password check or login-failure bookkeeping so that
// unverified requests never reach them and never count as a credential
// attempt. It fails CLOSED: any problem reaching Cloudflare is treated as a
// failed request (not skipped) and is logged.
func (a *App) verifyTurnstile(r *http.Request, token string) error {
	if !a.turnstileEnabled() {
		return nil
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return captchaFailed()
	}
	verifyURL := a.turnstileVerifyURL
	if verifyURL == "" {
		verifyURL = turnstileSiteverifyURL
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	form := url.Values{
		"secret":   {a.cfg.Turnstile.SecretKey},
		"response": {token},
	}
	if ip := clientIP(r); ip != "" {
		form.Set("remoteip", ip)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, verifyURL, strings.NewReader(form.Encode()))
	if err != nil {
		a.log.Error("turnstile verify: build request", "err", err)
		return captchaUnavailable()
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		a.log.Error("turnstile verify: unreachable", "err", err)
		return captchaUnavailable()
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		a.log.Error("turnstile verify: unexpected status", "status", resp.StatusCode)
		return captchaUnavailable()
	}
	var out turnstileVerifyResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		a.log.Error("turnstile verify: decode response", "err", err)
		return captchaUnavailable()
	}
	if !out.Success {
		a.log.Info("turnstile verify: rejected", "errorCodes", out.ErrorCodes)
		return captchaFailed()
	}
	return nil
}
