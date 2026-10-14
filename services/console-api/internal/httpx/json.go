package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// Error is an API error rendered as the contract's ApiErrorBody.
type Error struct {
	Status     int               `json:"-"`
	Code       string            `json:"code"`
	Message    string            `json:"message"`
	Fields     map[string]string `json:"fields,omitempty"`
	RetryAfter int               `json:"retryAfter,omitempty"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// Errorf builds an Error.
func Errorf(status int, code, format string, args ...any) *Error {
	return &Error{Status: status, Code: code, Message: fmt.Sprintf(format, args...)}
}

// Common errors.
func BadRequest(msg string) *Error { return Errorf(http.StatusBadRequest, "bad_request", "%s", msg) }
func NotFound() *Error             { return Errorf(http.StatusNotFound, "not_found", "资源不存在") }
func Forbidden() *Error {
	return Errorf(http.StatusForbidden, "forbidden", "没有权限执行此操作")
}
func Unauthorized() *Error {
	return Errorf(http.StatusUnauthorized, "unauthorized", "请先登录")
}
func NotImplemented() *Error {
	return Errorf(http.StatusNotImplemented, "not_implemented", "该功能暂未开放")
}

// Validation builds a 400 with per-field messages.
func Validation(fields map[string]string) *Error {
	msg := "提交的数据有误"
	for _, v := range fields {
		msg = v
		break
	}
	return &Error{Status: http.StatusBadRequest, Code: "validation", Message: msg, Fields: fields}
}

// Fields accumulates validation errors.
type Fields map[string]string

// Add records the first message for a field.
func (f Fields) Add(field, msg string) {
	if _, ok := f[field]; !ok {
		f[field] = msg
	}
}

// Err returns nil when empty.
func (f Fields) Err() error {
	if len(f) == 0 {
		return nil
	}
	return Validation(f)
}

// WriteJSON writes v with status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if status == http.StatusNoContent {
		w.WriteHeader(status)
		return
	}
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(true)
	_ = enc.Encode(v)
}

// WriteError renders err; unknown errors become 500 internal.
func WriteError(w http.ResponseWriter, err error) {
	var e *Error
	if !errors.As(err, &e) {
		e = Errorf(http.StatusInternalServerError, "internal", "服务器内部错误，请稍后重试")
	}
	if e.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(e.RetryAfter))
	}
	WriteJSON(w, e.Status, map[string]any{"error": e})
}

// MaxBody is the default JSON body limit.
const MaxBody = 1 << 20

// DecodeJSON reads a JSON body into v (unknown fields are ignored).
func DecodeJSON(r *http.Request, v any) error {
	ct := r.Header.Get("Content-Type")
	if ct != "" && !strings.HasPrefix(strings.ToLower(ct), "application/json") {
		return Errorf(http.StatusUnsupportedMediaType, "unsupported_media_type", "请求体必须是 JSON")
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, MaxBody+1))
	if err := dec.Decode(v); err != nil {
		if errors.Is(err, io.EOF) {
			return nil // empty body = zero value
		}
		return BadRequest("请求体格式错误: " + trimJSONErr(err))
	}
	return nil
}

func trimJSONErr(err error) string {
	s := err.Error()
	s = strings.TrimPrefix(s, "json: ")
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

// QueryInt parses an integer query param with default.
func QueryInt(r *http.Request, name string, def int64) int64 {
	v := r.URL.Query().Get(name)
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}

// PathID parses a positive integer path value.
func PathID(r *http.Request, name string) (int64, error) {
	n, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil || n <= 0 {
		return 0, NotFound()
	}
	return n, nil
}

// Paging reads page/pageSize (1-based, pageSize 1..100, default 20).
func Paging(r *http.Request) (page, size int64) {
	page = QueryInt(r, "page", 1)
	if page < 1 {
		page = 1
	}
	size = QueryInt(r, "pageSize", 20)
	if size < 1 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	return page, size
}

// Page is the contract's Page<T>.
type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int64 `json:"page"`
	PageSize int64 `json:"pageSize"`
}
