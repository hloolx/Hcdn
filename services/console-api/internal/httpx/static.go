package httpx

import (
	"net/http"
	"os"
	"path"
	"strings"
)

// SPA serves a built front end from a directory: real files are served as-is,
// extension-less paths fall back to index.html (client-side routing), hashed
// assets under /assets/ get a one-year immutable cache and HTML is no-cache.
type SPA struct {
	root *os.Root
}

// NewSPA opens dir. An empty dir yields a handler that always 404s.
func NewSPA(dir string) (*SPA, error) {
	if dir == "" {
		return &SPA{}, nil
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	return &SPA{root: root}, nil
}

func (s *SPA) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.root == nil {
		http.NotFound(w, r)
		return
	}
	p := path.Clean("/" + r.URL.Path)
	rel := strings.TrimPrefix(p, "/")
	if rel == "" {
		rel = "."
	}
	if s.serveFile(w, r, rel) {
		return
	}
	// Directory with its own index.html (multi-page static site).
	if rel != "." {
		if fi, err := s.root.Stat(rel); err == nil && fi.IsDir() {
			if s.serveFile(w, r, path.Join(rel, "index.html")) {
				return
			}
		}
	}
	// Missing file with an extension, or anything under /assets/: real 404.
	if strings.HasPrefix(p, "/assets/") || path.Ext(p) != "" {
		http.NotFound(w, r)
		return
	}
	if !s.serveFile(w, r, "index.html") {
		http.NotFound(w, r)
	}
}

// serveFile serves rel when it is a regular file; reports whether it did.
func (s *SPA) serveFile(w http.ResponseWriter, r *http.Request, rel string) bool {
	if rel == "." {
		rel = "index.html"
	}
	f, err := s.root.Open(rel)
	if err != nil {
		return false
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil || fi.IsDir() || !fi.Mode().IsRegular() {
		return false
	}
	h := w.Header()
	switch {
	case strings.HasPrefix(rel, "assets/"):
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	case strings.HasSuffix(rel, ".html"):
		h.Set("Cache-Control", "no-cache")
	default:
		h.Set("Cache-Control", "public, max-age=3600")
	}
	http.ServeContent(w, r, fi.Name(), fi.ModTime(), f)
	return true
}

// Close releases the directory handle.
func (s *SPA) Close() error {
	if s.root == nil {
		return nil
	}
	return s.root.Close()
}
