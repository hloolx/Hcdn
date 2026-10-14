// Package mailer sends plain-text mail over SMTP (STARTTLS or implicit TLS).
package mailer

import (
	"crypto/tls"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/hloolx/Hcdn/services/console-api/internal/config"
)

// Mailer sends messages; a nil *Mailer means "not configured".
type Mailer struct {
	cfg config.SMTP
}

// New returns nil when SMTP is not configured.
func New(cfg config.SMTP) *Mailer {
	if !cfg.Configured() {
		return nil
	}
	return &Mailer{cfg: cfg}
}

// Send delivers a text/plain UTF-8 message to one recipient.
func (m *Mailer) Send(to, subject, body string) error {
	if m == nil {
		return errors.New("smtp not configured")
	}
	from, err := mail.ParseAddress(m.cfg.From)
	if err != nil {
		return fmt.Errorf("smtp.from: %w", err)
	}
	rcpt, err := mail.ParseAddress(to)
	if err != nil {
		return fmt.Errorf("recipient: %w", err)
	}
	if strings.ContainsAny(subject, "\r\n") {
		return errors.New("invalid subject")
	}
	var msg strings.Builder
	msg.WriteString("From: " + from.String() + "\r\n")
	msg.WriteString("To: " + rcpt.String() + "\r\n")
	msg.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", subject) + "\r\n")
	msg.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	msg.WriteString("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n")
	msg.WriteString(strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\n", "\r\n"))

	addr := net.JoinHostPort(m.cfg.Host, strconv.Itoa(m.cfg.Port))
	tlsConf := &tls.Config{ServerName: m.cfg.Host, MinVersion: tls.VersionTLS12}
	dialer := &net.Dialer{Timeout: 15 * time.Second}

	var c *smtp.Client
	switch m.cfg.TLS {
	case "tls":
		conn, err := tls.DialWithDialer(dialer, "tcp", addr, tlsConf)
		if err != nil {
			return err
		}
		c, err = smtp.NewClient(conn, m.cfg.Host)
		if err != nil {
			conn.Close()
			return err
		}
	default:
		conn, err := dialer.Dial("tcp", addr)
		if err != nil {
			return err
		}
		c, err = smtp.NewClient(conn, m.cfg.Host)
		if err != nil {
			conn.Close()
			return err
		}
		if m.cfg.TLS == "starttls" {
			if ok, _ := c.Extension("STARTTLS"); !ok {
				c.Close()
				return errors.New("smtp server does not support STARTTLS")
			}
			if err := c.StartTLS(tlsConf); err != nil {
				c.Close()
				return err
			}
		}
	}
	defer c.Close()
	if m.cfg.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)); err != nil {
			return err
		}
	}
	if err := c.Mail(from.Address); err != nil {
		return err
	}
	if err := c.Rcpt(rcpt.Address); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte(msg.String())); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}
