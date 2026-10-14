// Command console-api is the Hcdn backend-for-frontend: it serves the web front
// ends and a JSON API backed by EdgeAPI (gRPC) and its own MySQL schema.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/hloolx/Hcdn/services/console-api/internal/app"
	"github.com/hloolx/Hcdn/services/console-api/internal/config"
	"github.com/hloolx/Hcdn/services/console-api/internal/edgeapi"
	"github.com/hloolx/Hcdn/services/console-api/internal/store"
)

var version = "dev"

func usage() {
	fmt.Fprintf(os.Stderr, `usage: console-api [-c configs/console-api.yaml] <command>

commands:
  serve       run the HTTP server (default)
  migrate     apply database migrations and exit
  bootstrap   create the EdgeAPI user node for console-api (uses the admin credential)
              flags: -write  store the credential into the config file
  version     print the version
`)
}

func main() {
	fs := flag.NewFlagSet("console-api", flag.ExitOnError)
	cfgPath := fs.String("c", "configs/console-api.yaml", "config file")
	fs.Usage = usage
	_ = fs.Parse(os.Args[1:])
	cmd := "serve"
	args := fs.Args()
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	if cmd == "version" {
		fmt.Println("console-api", version)
		return
	}
	cfg, err := config.Load(*cfgPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
	log := newLogger(cfg)
	slog.SetDefault(log)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch cmd {
	case "serve":
		err = serve(ctx, cfg, log)
	case "migrate":
		err = migrate(ctx, cfg)
	case "bootstrap":
		err = bootstrap(ctx, cfg, args)
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		log.Error(cmd+" failed", "err", err)
		os.Exit(1)
	}
}

func newLogger(cfg *config.Config) *slog.Logger {
	level := slog.LevelInfo
	switch strings.ToLower(cfg.Log.Level) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	opts := &slog.HandlerOptions{Level: level}
	if cfg.Log.Format == "json" {
		return slog.New(slog.NewJSONHandler(os.Stderr, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stderr, opts))
}

func newEdge(cfg *config.Config) (*edgeapi.Client, error) {
	return edgeapi.New(edgeapi.Options{
		Endpoints:  cfg.EdgeAPI.Endpoints,
		CAFile:     cfg.EdgeAPI.CAFile,
		ServerName: cfg.EdgeAPI.ServerName,
		User:       cfg.EdgeAPI.User,
		Admin:      cfg.EdgeAPI.Admin,
	})
}

func migrate(ctx context.Context, cfg *config.Config) error {
	st, err := store.Open(cfg.DB.DSN)
	if err != nil {
		return err
	}
	defer st.Close()
	return st.Migrate(ctx)
}

func serve(ctx context.Context, cfg *config.Config, log *slog.Logger) error {
	st, err := store.Open(cfg.DB.DSN)
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	edge, err := newEdge(cfg)
	if err != nil {
		return err
	}
	defer edge.Close()
	if !cfg.EdgeAPI.User.Valid() {
		log.Warn("edgeAPI.user credential missing: customer endpoints will fail; run `console-api bootstrap`")
	}
	if !cfg.EdgeAPI.Admin.Valid() {
		log.Warn("edgeAPI.admin credential missing: admin endpoints will fail")
	}
	a, err := app.New(cfg, st, edge, log)
	if err != nil {
		return err
	}
	log.Info("console-api starting", "version", version)
	return a.Run(ctx)
}
