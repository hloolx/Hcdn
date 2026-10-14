package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"time"
)

// Session lifetimes.
const (
	SessionIdle     = 12 * time.Hour
	SessionAbsolute = 7 * 24 * time.Hour
	touchEvery      = time.Minute
)

// Session kinds.
const (
	KindUser  = "user"
	KindAdmin = "admin"
)

// Session is a logged-in principal.
type Session struct {
	IDHash     string
	Kind       string
	SubjectID  int64
	Username   string
	IP         string
	CreatedAt  int64
	LastSeenAt int64
	ExpiresAt  int64
}

// SessionStore is the subset used by the HTTP layer (mockable in tests).
type SessionStore interface {
	CreateSession(ctx context.Context, kind string, subjectID int64, username, ip, ua string, now time.Time) (string, error)
	GetSession(ctx context.Context, kind, raw string, now time.Time) (*Session, error)
	DeleteSession(ctx context.Context, raw string) error
	DeleteSessionsFor(ctx context.Context, kind string, subjectID int64, exceptRaw string) error
}

// NewSessionID returns 32 random bytes, base64url encoded.
func NewSessionID() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// CreateSession stores a new session and returns the raw (cookie) id.
func (s *Store) CreateSession(ctx context.Context, kind string, subjectID int64, username, ip, ua string, now time.Time) (string, error) {
	raw := NewSessionID()
	if len(ua) > 255 {
		ua = ua[:255]
	}
	n := now.Unix()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO sessions
(id_hash, kind, subject_id, username, ip, user_agent, created_at, last_seen_at, expires_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		HashToken(raw), kind, subjectID, username, ip, ua, n, n, now.Add(SessionAbsolute).Unix())
	if err != nil {
		return "", err
	}
	return raw, nil
}

// GetSession loads a live session of the given kind; expired ones are deleted.
func (s *Store) GetSession(ctx context.Context, kind, raw string, now time.Time) (*Session, error) {
	if raw == "" || len(raw) > 128 {
		return nil, ErrNotFound
	}
	h := HashToken(raw)
	var ss Session
	err := s.DB.QueryRowContext(ctx, `SELECT id_hash, kind, subject_id, username, ip, created_at, last_seen_at, expires_at
FROM sessions WHERE id_hash = ?`, h).Scan(&ss.IDHash, &ss.Kind, &ss.SubjectID, &ss.Username, &ss.IP, &ss.CreatedAt, &ss.LastSeenAt, &ss.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	n := now.Unix()
	if ss.Kind != kind {
		return nil, ErrNotFound
	}
	if n >= ss.ExpiresAt || n-ss.LastSeenAt >= int64(SessionIdle/time.Second) {
		_, _ = s.DB.ExecContext(ctx, "DELETE FROM sessions WHERE id_hash = ?", h)
		return nil, ErrNotFound
	}
	if n-ss.LastSeenAt >= int64(touchEvery/time.Second) {
		_, _ = s.DB.ExecContext(ctx, "UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?", n, h)
		ss.LastSeenAt = n
	}
	return &ss, nil
}

// DeleteSession removes a session by raw id.
func (s *Store) DeleteSession(ctx context.Context, raw string) error {
	_, err := s.DB.ExecContext(ctx, "DELETE FROM sessions WHERE id_hash = ?", HashToken(raw))
	return err
}

// DeleteSessionsFor removes all sessions of a principal except exceptRaw (may be "").
func (s *Store) DeleteSessionsFor(ctx context.Context, kind string, subjectID int64, exceptRaw string) error {
	except := ""
	if exceptRaw != "" {
		except = HashToken(exceptRaw)
	}
	_, err := s.DB.ExecContext(ctx, "DELETE FROM sessions WHERE kind = ? AND subject_id = ? AND id_hash <> ?", kind, subjectID, except)
	return err
}
