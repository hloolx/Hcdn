package app

import (
	"context"

	"github.com/hloolx/Hcdn/services/console-api/internal/config"
)

// runtimeSettings are the admin-editable settings (config file values are the
// defaults; the `settings` table row "system" overrides them).
type runtimeSettings struct {
	ProductName      string       `json:"productName"`
	ConsoleURL       string       `json:"consoleUrl"`
	Registration     registration `json:"registration"`
	AdminIPAllowlist []string     `json:"adminIpAllowlist"`
}

type registration struct {
	Open                     bool  `json:"open"`
	DefaultClusterID         int64 `json:"defaultClusterId"`
	RequireEmailVerification bool  `json:"requireEmailVerification"`
}

const settingSystem = "system"

func defaultRuntimeSettings(cfg *config.Config) *runtimeSettings {
	allow := append([]string{}, cfg.AdminIPAllowlist...)
	return &runtimeSettings{
		ProductName: cfg.ProductName,
		ConsoleURL:  cfg.ConsoleURL,
		Registration: registration{
			Open:                     cfg.Registration.Open,
			DefaultClusterID:         cfg.Registration.DefaultClusterID,
			RequireEmailVerification: cfg.Registration.RequireEmailVerification,
		},
		AdminIPAllowlist: allow,
	}
}

func (a *App) loadSettings(ctx context.Context) error {
	s := defaultRuntimeSettings(a.cfg)
	found, err := a.store.GetSetting(ctx, settingSystem, s)
	if err != nil || !found {
		return err
	}
	a.applySettings(s)
	return nil
}

func (a *App) applySettings(s *runtimeSettings) {
	if s.AdminIPAllowlist == nil {
		s.AdminIPAllowlist = []string{}
	}
	if p, err := config.ParsePrefixes(s.AdminIPAllowlist); err == nil {
		a.adminAllow.Store(&p)
	}
	a.settings.Store(s)
}

func (a *App) rs() *runtimeSettings { return a.settings.Load() }

// consoleURL returns the base URL used in emails.
func (a *App) consoleURL() string {
	if u := a.rs().ConsoleURL; u != "" {
		return u
	}
	if len(a.cfg.Hosts.Console) > 0 {
		return "https://" + a.cfg.Hosts.Console[0]
	}
	return ""
}
