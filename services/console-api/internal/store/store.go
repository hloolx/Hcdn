// Package store is console-api's own MySQL state (sessions, login failures,
// email tokens, activity, settings and a little per-site metadata).
package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Store wraps the database handle.
type Store struct {
	DB *sql.DB
}

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("store: not found")

// Open connects using a go-sql-driver DSN ("user:pass@tcp(127.0.0.1:3306)/hcdn_console").
func Open(dsn string) (*Store, error) {
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("db.dsn: %w", err)
	}
	cfg.ParseTime = false
	if cfg.Params == nil {
		cfg.Params = map[string]string{}
	}
	if _, ok := cfg.Params["charset"]; !ok {
		cfg.Params["charset"] = "utf8mb4"
	}
	cfg.MultiStatements = false
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(32)
	db.SetMaxIdleConns(8)
	db.SetConnMaxLifetime(30 * time.Minute)
	return &Store{DB: db}, nil
}

// Close closes the pool.
func (s *Store) Close() error { return s.DB.Close() }

// Migrate applies embedded migrations idempotently (guarded by a named lock).
func (s *Store) Migrate(ctx context.Context) error {
	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var got sql.NullInt64
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK('hcdn_console_migrate', 60)").Scan(&got); err != nil {
		return err
	}
	if !got.Valid || got.Int64 != 1 {
		return errors.New("could not acquire migration lock")
	}
	defer conn.ExecContext(context.Background(), "SELECT RELEASE_LOCK('hcdn_console_migrate')") //nolint:errcheck

	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT NOT NULL, applied_at BIGINT NOT NULL, PRIMARY KEY (version)) ENGINE=InnoDB`); err != nil {
		return err
	}
	applied := map[int]bool{}
	rows, err := conn.QueryContext(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		return err
	}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		applied[v] = true
	}
	rows.Close()

	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, e := range entries {
		name := e.Name()
		num, err := strconv.Atoi(strings.SplitN(name, "_", 2)[0])
		if err != nil {
			return fmt.Errorf("bad migration name %s", name)
		}
		if applied[num] {
			continue
		}
		data, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		for _, stmt := range splitSQL(string(data)) {
			if _, err := conn.ExecContext(ctx, stmt); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
		}
		if _, err := conn.ExecContext(ctx, "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", num, time.Now().Unix()); err != nil {
			return err
		}
		slog.Info("applied migration", "name", name)
	}
	return nil
}

// splitSQL splits on ";" at line ends and drops "--" comment lines.
func splitSQL(src string) []string {
	var out []string
	var cur strings.Builder
	for _, line := range strings.Split(src, "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "--") {
			continue
		}
		cur.WriteString(line)
		cur.WriteString("\n")
		if strings.HasSuffix(t, ";") {
			stmt := strings.TrimSuffix(strings.TrimSpace(cur.String()), ";")
			out = append(out, stmt)
			cur.Reset()
		}
	}
	if s := strings.TrimSpace(cur.String()); s != "" {
		out = append(out, s)
	}
	return out
}

// HashToken returns hex(SHA-256(token)).
func HashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// ---------------------------------------------------------------- settings

// GetSetting decodes setting `name` into v; returns false when absent.
func (s *Store) GetSetting(ctx context.Context, name string, v any) (bool, error) {
	var raw string
	err := s.DB.QueryRowContext(ctx, "SELECT value FROM settings WHERE name = ?", name).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal([]byte(raw), v)
}

// PutSetting stores v as JSON.
func (s *Store) PutSetting(ctx context.Context, name string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`, name, string(data), time.Now().Unix())
	return err
}

// ---------------------------------------------------------------- housekeeping

// Purge deletes expired sessions, old failures and used/expired tokens.
func (s *Store) Purge(ctx context.Context, now time.Time, failureWindow time.Duration) {
	n := now.Unix()
	stmts := []struct {
		q    string
		args []any
	}{
		{"DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?", []any{n, n - int64(SessionIdle/time.Second)}},
		{"DELETE FROM login_failures WHERE created_at < ?", []any{n - int64(failureWindow/time.Second) - 86400}},
		{"DELETE FROM email_tokens WHERE expires_at < ?", []any{n - 86400}},
		{"DELETE FROM activity WHERE created_at < ?", []any{n - 400*86400}},
	}
	for _, st := range stmts {
		if _, err := s.DB.ExecContext(ctx, st.q, st.args...); err != nil {
			slog.Warn("purge failed", "err", err)
		}
	}
}
