package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// ---------------------------------------------------------------- login failures

// RecordFailure stores one failed login for key.
func (s *Store) RecordFailure(ctx context.Context, scope, keyType, key string, now time.Time) error {
	if len(key) > 255 {
		key = key[:255]
	}
	_, err := s.DB.ExecContext(ctx, "INSERT INTO login_failures (scope, key_type, key_value, created_at) VALUES (?, ?, ?, ?)",
		scope, keyType, key, now.Unix())
	return err
}

// Failures counts failures for key since `since`, returning the latest timestamp.
func (s *Store) Failures(ctx context.Context, scope, keyType, key string, since time.Time) (int, int64, error) {
	if len(key) > 255 {
		key = key[:255]
	}
	var n int
	var last sql.NullInt64
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*), MAX(created_at) FROM login_failures
WHERE scope = ? AND key_type = ? AND key_value = ? AND created_at >= ?`, scope, keyType, key, since.Unix()).Scan(&n, &last)
	return n, last.Int64, err
}

// ClearFailures forgets failures for key (after a successful login).
func (s *Store) ClearFailures(ctx context.Context, scope, keyType, key string) error {
	if len(key) > 255 {
		key = key[:255]
	}
	_, err := s.DB.ExecContext(ctx, "DELETE FROM login_failures WHERE scope = ? AND key_type = ? AND key_value = ?", scope, keyType, key)
	return err
}

// ---------------------------------------------------------------- email tokens

// Email token purposes.
const (
	PurposeVerify = "verify"
	PurposeReset  = "reset"
)

// CreateEmailToken stores a single-use token and returns its raw value.
// Older unused tokens of the same purpose for the user are invalidated.
func (s *Store) CreateEmailToken(ctx context.Context, purpose string, userID int64, email string, ttl time.Duration, now time.Time) (string, error) {
	raw := NewSessionID()
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?", userID, purpose); err != nil {
		return "", err
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO email_tokens (token_hash, purpose, user_id, email, created_at, expires_at)
VALUES (?, ?, ?, ?, ?, ?)`, HashToken(raw), purpose, userID, email, now.Unix(), now.Add(ttl).Unix())
	return raw, err
}

// ConsumeEmailToken marks a token used and returns its user/email.
func (s *Store) ConsumeEmailToken(ctx context.Context, purpose, raw string, now time.Time) (int64, string, error) {
	if raw == "" || len(raw) > 128 {
		return 0, "", ErrNotFound
	}
	h := HashToken(raw)
	res, err := s.DB.ExecContext(ctx, `UPDATE email_tokens SET used_at = ?
WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?`, now.Unix(), h, purpose, now.Unix())
	if err != nil {
		return 0, "", err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return 0, "", ErrNotFound
	}
	var uid int64
	var email string
	err = s.DB.QueryRowContext(ctx, "SELECT user_id, email FROM email_tokens WHERE token_hash = ?", h).Scan(&uid, &email)
	return uid, email, err
}

// ---------------------------------------------------------------- user flags

// UserFlags is per-customer state EdgeAPI does not keep.
type UserFlags struct {
	EmailVerifiedAt int64
	PendingEmail    bool
	LastLoginAt     int64
}

// GetUserFlags returns zero flags when absent.
func (s *Store) GetUserFlags(ctx context.Context, userID int64) (UserFlags, error) {
	var f UserFlags
	var verified, last sql.NullInt64
	var pending int
	err := s.DB.QueryRowContext(ctx, "SELECT email_verified_at, pending_email, last_login_at FROM user_flags WHERE user_id = ?", userID).
		Scan(&verified, &pending, &last)
	if errors.Is(err, sql.ErrNoRows) {
		return f, nil
	}
	f.EmailVerifiedAt, f.PendingEmail, f.LastLoginAt = verified.Int64, pending == 1, last.Int64
	return f, err
}

// LastLogins returns last_login_at for several users.
func (s *Store) LastLogins(ctx context.Context, ids []int64) (map[int64]int64, error) {
	out := map[int64]int64{}
	if len(ids) == 0 {
		return out, nil
	}
	q, args := inClause("SELECT user_id, last_login_at FROM user_flags WHERE last_login_at IS NOT NULL AND user_id IN ", ids)
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, t int64
		if err := rows.Scan(&id, &t); err != nil {
			return out, err
		}
		out[id] = t
	}
	return out, rows.Err()
}

// SetPendingEmail marks a user as needing verification (or not).
func (s *Store) SetPendingEmail(ctx context.Context, userID int64, pending bool) error {
	p := 0
	if pending {
		p = 1
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO user_flags (user_id, pending_email) VALUES (?, ?)
ON DUPLICATE KEY UPDATE pending_email = VALUES(pending_email)`, userID, p)
	return err
}

// MarkEmailVerified records verification and clears the pending flag.
func (s *Store) MarkEmailVerified(ctx context.Context, userID int64, now time.Time) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO user_flags (user_id, email_verified_at, pending_email) VALUES (?, ?, 0)
ON DUPLICATE KEY UPDATE email_verified_at = VALUES(email_verified_at), pending_email = 0`, userID, now.Unix())
	return err
}

// ClearEmailVerified resets verification (after an email change).
func (s *Store) ClearEmailVerified(ctx context.Context, userID int64) error {
	_, err := s.DB.ExecContext(ctx, "UPDATE user_flags SET email_verified_at = NULL WHERE user_id = ?", userID)
	return err
}

// TouchLogin records a successful login.
func (s *Store) TouchLogin(ctx context.Context, userID int64, now time.Time) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO user_flags (user_id, last_login_at) VALUES (?, ?)
ON DUPLICATE KEY UPDATE last_login_at = VALUES(last_login_at)`, userID, now.Unix())
	return err
}

// ---------------------------------------------------------------- activity / audit

// Activity is one audit entry.
type Activity struct {
	ID        int64  `json:"id"`
	ActorType string `json:"actorType"`
	ActorID   int64  `json:"-"`
	ActorName string `json:"actor"`
	Action    string `json:"action"`
	IP        string `json:"ip"`
	Level     string `json:"level"`
	CreatedAt int64  `json:"time"`
}

// AddActivity appends an entry (errors are returned but callers usually log them).
func (s *Store) AddActivity(ctx context.Context, a Activity) error {
	if a.Level == "" {
		a.Level = "info"
	}
	if a.CreatedAt == 0 {
		a.CreatedAt = time.Now().Unix()
	}
	if len(a.Action) > 512 {
		a.Action = a.Action[:512]
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO activity (actor_type, actor_id, actor_name, action, ip, level, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?)`, a.ActorType, a.ActorID, a.ActorName, a.Action, a.IP, a.Level, a.CreatedAt)
	return err
}

// ListActivity returns the latest entries for one actor.
func (s *Store) ListActivity(ctx context.Context, actorType string, actorID int64, limit int) ([]Activity, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, actor_type, actor_id, actor_name, action, ip, level, created_at FROM activity
WHERE actor_type = ? AND actor_id = ? ORDER BY id DESC LIMIT ?`, actorType, actorID, limit)
	if err != nil {
		return nil, err
	}
	return scanActivity(rows)
}

// ListAudit pages through all entries, optionally filtered.
func (s *Store) ListAudit(ctx context.Context, actorType, keyword string, offset, limit int64) ([]Activity, int64, error) {
	where := []string{"1=1"}
	var args []any
	if actorType != "" {
		where = append(where, "actor_type = ?")
		args = append(args, actorType)
	}
	if keyword != "" {
		where = append(where, "(action LIKE ? OR actor_name LIKE ? OR ip LIKE ?)")
		k := "%" + escapeLike(keyword) + "%"
		args = append(args, k, k, k)
	}
	w := strings.Join(where, " AND ")
	var total int64
	if err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM activity WHERE "+w, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id, actor_type, actor_id, actor_name, action, ip, level, created_at FROM activity
WHERE `+w+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	items, err := scanActivity(rows)
	return items, total, err
}

func scanActivity(rows *sql.Rows) ([]Activity, error) {
	defer rows.Close()
	out := []Activity{}
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.ActorType, &a.ActorID, &a.ActorName, &a.Action, &a.IP, &a.Level, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func inClause(prefix string, ids []int64) (string, []any) {
	args := make([]any, len(ids))
	ph := make([]string, len(ids))
	for i, id := range ids {
		args[i] = id
		ph[i] = "?"
	}
	return prefix + "(" + strings.Join(ph, ",") + ")", args
}

// ---------------------------------------------------------------- site meta

// DNSCheck mirrors the contract's DnsCheck.
type DNSCheck struct {
	Domain   string   `json:"domain"`
	OK       bool     `json:"ok"`
	Resolved []string `json:"resolved"`
	Message  string   `json:"message,omitempty"`
}

// SiteMeta is per-site state kept by console-api.
type SiteMeta struct {
	ServerID     int64
	UserID       int64
	AutoCert     bool
	ForceHTTPS   bool
	DNSCheckedAt int64
	DNSOK        bool
	DNSChecks    []DNSCheck
}

// SiteMetas loads metadata for several servers.
func (s *Store) SiteMetas(ctx context.Context, ids []int64) (map[int64]*SiteMeta, error) {
	out := map[int64]*SiteMeta{}
	if len(ids) == 0 {
		return out, nil
	}
	q, args := inClause("SELECT server_id, user_id, auto_cert, force_https, dns_checked_at, dns_ok, dns_checks FROM site_meta WHERE server_id IN ", ids)
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		m := &SiteMeta{}
		var auto, force, ok int
		var checked sql.NullInt64
		var checks sql.NullString
		if err := rows.Scan(&m.ServerID, &m.UserID, &auto, &force, &checked, &ok, &checks); err != nil {
			return out, err
		}
		m.AutoCert, m.ForceHTTPS, m.DNSOK, m.DNSCheckedAt = auto == 1, force == 1, ok == 1, checked.Int64
		if checks.Valid && checks.String != "" {
			_ = json.Unmarshal([]byte(checks.String), &m.DNSChecks)
		}
		out[m.ServerID] = m
	}
	return out, rows.Err()
}

// SetSiteOptions stores the autoCert / forceHTTPS wishes of a site.
func (s *Store) SetSiteOptions(ctx context.Context, serverID, userID int64, autoCert, forceHTTPS bool) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO site_meta (server_id, user_id, auto_cert, force_https) VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE auto_cert = VALUES(auto_cert), force_https = VALUES(force_https)`, serverID, userID, b2i(autoCert), b2i(forceHTTPS))
	return err
}

// ResetSiteDNS marks a site as not yet DNS-verified (after a domain change).
func (s *Store) ResetSiteDNS(ctx context.Context, serverID, userID int64) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO site_meta (server_id, user_id, dns_ok) VALUES (?, ?, 0)
ON DUPLICATE KEY UPDATE dns_ok = 0, dns_checked_at = NULL, dns_checks = NULL`, serverID, userID)
	return err
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// SetSiteDNS stores a DNS check result.
func (s *Store) SetSiteDNS(ctx context.Context, serverID, userID int64, ok bool, checks []DNSCheck, now time.Time) error {
	data, _ := json.Marshal(checks)
	v := 0
	if ok {
		v = 1
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO site_meta (server_id, user_id, dns_checked_at, dns_ok, dns_checks) VALUES (?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE dns_checked_at = VALUES(dns_checked_at), dns_ok = VALUES(dns_ok), dns_checks = VALUES(dns_checks)`,
		serverID, userID, now.Unix(), v, string(data))
	return err
}

// DeleteSiteMeta drops metadata of a deleted server.
func (s *Store) DeleteSiteMeta(ctx context.Context, serverID int64) error {
	_, err := s.DB.ExecContext(ctx, "DELETE FROM site_meta WHERE server_id = ?", serverID)
	return err
}

// ---------------------------------------------------------------- ACME jobs

// AcmeJob tracks an asynchronous ACME issuance.
type AcmeJob struct {
	ID         int64
	UserID     int64
	ServerID   int64
	EdgeTaskID int64
	Domains    []string
	Status     string
	CertID     int64
	Error      string
	CreatedAt  int64
}

// CreateAcmeJob inserts a pending job.
func (s *Store) CreateAcmeJob(ctx context.Context, j *AcmeJob) error {
	d, _ := json.Marshal(j.Domains)
	now := time.Now().Unix()
	res, err := s.DB.ExecContext(ctx, `INSERT INTO acme_jobs (user_id, server_id, edge_task_id, domains, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)`, j.UserID, j.ServerID, j.EdgeTaskID, string(d), j.Status, now, now)
	if err != nil {
		return err
	}
	j.ID, err = res.LastInsertId()
	j.CreatedAt = now
	return err
}

// UpdateAcmeJob stores status/result.
func (s *Store) UpdateAcmeJob(ctx context.Context, j *AcmeJob) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE acme_jobs SET edge_task_id = ?, status = ?, cert_id = ?, error = ?, updated_at = ? WHERE id = ?`,
		j.EdgeTaskID, j.Status, j.CertID, nullStr(j.Error), time.Now().Unix(), j.ID)
	return err
}

// GetAcmeJob loads a job owned by userID.
func (s *Store) GetAcmeJob(ctx context.Context, userID, id int64) (*AcmeJob, error) {
	j := &AcmeJob{}
	var domains string
	var errStr sql.NullString
	err := s.DB.QueryRowContext(ctx, `SELECT id, user_id, server_id, edge_task_id, domains, status, cert_id, error, created_at
FROM acme_jobs WHERE id = ? AND user_id = ?`, id, userID).Scan(&j.ID, &j.UserID, &j.ServerID, &j.EdgeTaskID, &domains, &j.Status, &j.CertID, &errStr, &j.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(domains), &j.Domains)
	j.Error = errStr.String
	return j, nil
}

// FailStaleAcmeJobs marks jobs left running by a previous process as failed.
func (s *Store) FailStaleAcmeJobs(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE acme_jobs SET status = 'failed', error = 'interrupted by restart', updated_at = ?
WHERE status IN ('pending', 'running')`, time.Now().Unix())
	return err
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ---------------------------------------------------------------- access key meta

// RecordAccessKey remembers when console-api created an access key.
func (s *Store) RecordAccessKey(ctx context.Context, keyID, userID int64, now time.Time) error {
	_, err := s.DB.ExecContext(ctx, "INSERT IGNORE INTO access_key_meta (key_id, user_id, created_at) VALUES (?, ?, ?)", keyID, userID, now.Unix())
	return err
}

// AccessKeyCreated returns creation times for a user's keys.
func (s *Store) AccessKeyCreated(ctx context.Context, userID int64) (map[int64]int64, error) {
	out := map[int64]int64{}
	rows, err := s.DB.QueryContext(ctx, "SELECT key_id, created_at FROM access_key_meta WHERE user_id = ?", userID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, t int64
		if err := rows.Scan(&id, &t); err != nil {
			return out, err
		}
		out[id] = t
	}
	return out, rows.Err()
}
