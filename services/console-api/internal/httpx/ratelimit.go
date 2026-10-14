package httpx

import (
	"math"
	"sync"
	"time"
)

// Limiter is a keyed token bucket (in memory, per process).
type Limiter struct {
	rate  float64 // tokens per second
	burst float64
	now   func() time.Time

	mu      sync.Mutex
	buckets map[string]*bucket
	lastGC  time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

// NewLimiter creates a limiter refilling `rate` tokens per second up to `burst`.
func NewLimiter(rate, burst float64) *Limiter {
	if burst < 1 {
		burst = 1
	}
	return &Limiter{rate: rate, burst: burst, now: time.Now, buckets: map[string]*bucket{}}
}

// Allow consumes one token for key. When denied it returns the seconds until a
// token is available (at least 1).
func (l *Limiter) Allow(key string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.gc(now)
	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	} else {
		elapsed := now.Sub(b.last).Seconds()
		if elapsed > 0 {
			b.tokens = math.Min(l.burst, b.tokens+elapsed*l.rate)
		}
		b.last = now
	}
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	wait := 1.0
	if l.rate > 0 {
		wait = math.Ceil((1 - b.tokens) / l.rate)
	}
	if wait < 1 {
		wait = 1
	}
	return false, int(wait)
}

// gc drops buckets that are full again (idle long enough). Called with mu held.
func (l *Limiter) gc(now time.Time) {
	if now.Sub(l.lastGC) < time.Minute {
		return
	}
	l.lastGC = now
	full := time.Duration(float64(time.Second) * l.burst / math.Max(l.rate, 1e-9))
	for k, b := range l.buckets {
		if now.Sub(b.last) > full {
			delete(l.buckets, k)
		}
	}
}

// Len returns the number of tracked keys (tests/metrics).
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}
