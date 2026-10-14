// Package proxyprotocol wraps a TCP listener which sits behind a trusted
// L4 load balancer / SNI router speaking PROXY protocol v1/v2.
package proxyprotocol

import (
	"errors"
	"net"
	"sync"
	"time"

	"github.com/TeaOSLab/EdgeNode/internal/configs/localconfig"
	"github.com/pires/go-proxyproto"
)

var errInvalidHeader = errors.New("PROXY protocol header without TCP addresses")

// Listener requires a PROXY protocol header on every connection and only
// accepts connections from trusted sources. Connections from other sources,
// or without a valid header within the timeout, are closed silently.
//
// Headers are read in a goroutine per connection, so a slow peer can not
// block Accept() for other connections. Every returned conn is a
// *proxyproto.Conn whose header has already been read: RemoteAddr() is the
// real client address and LocalAddr() the destination address from the header.
type Listener struct {
	rawListener   net.Listener
	trusted       []*net.IPNet
	headerTimeout time.Duration

	connCh chan net.Conn
	done   chan struct{}
	err    error
	locker sync.Mutex
}

// NewListener wraps a listener; headerTimeout <= 0 uses the default timeout
func NewListener(rawListener net.Listener, trusted []*net.IPNet, headerTimeout time.Duration) *Listener {
	if headerTimeout <= 0 {
		headerTimeout = localconfig.DefaultProxyProtocolHeaderTimeout
	}
	var listener = &Listener{
		rawListener:   rawListener,
		trusted:       trusted,
		headerTimeout: headerTimeout,
		connCh:        make(chan net.Conn),
		done:          make(chan struct{}),
	}
	go listener.loop()
	return listener
}

// Accept returns the next connection with a valid PROXY protocol header
func (this *Listener) Accept() (net.Conn, error) {
	select {
	case conn := <-this.connCh:
		return conn, nil
	case <-this.done:
		this.locker.Lock()
		var err = this.err
		this.locker.Unlock()
		return nil, err
	}
}

// Close closes the underlying listener
func (this *Listener) Close() error {
	return this.rawListener.Close()
}

// Addr returns the actual bind address
func (this *Listener) Addr() net.Addr {
	return this.rawListener.Addr()
}

func (this *Listener) loop() {
	var tempDelay time.Duration
	for {
		conn, err := this.rawListener.Accept()
		if err != nil {
			var netErr net.Error
			if errors.As(err, &netErr) && netErr.Timeout() || isTemporary(err) {
				if tempDelay == 0 {
					tempDelay = 5 * time.Millisecond
				} else {
					tempDelay *= 2
				}
				if tempDelay > time.Second {
					tempDelay = time.Second
				}
				time.Sleep(tempDelay)
				continue
			}

			this.locker.Lock()
			this.err = err
			this.locker.Unlock()
			close(this.done)
			return
		}
		tempDelay = 0

		if !this.isTrusted(conn.RemoteAddr()) {
			_ = conn.Close()
			continue
		}

		go this.readHeader(conn)
	}
}

func (this *Listener) readHeader(conn net.Conn) {
	_ = conn.SetReadDeadline(time.Now().Add(this.headerTimeout))
	var proxyConn = proxyproto.NewConn(conn,
		proxyproto.WithPolicy(proxyproto.REQUIRE),
		proxyproto.ValidateHeader(validateHeader))
	var header = proxyConn.ProxyHeader() // nil if missing, invalid or timed out
	_ = conn.SetReadDeadline(time.Time{})
	if header == nil {
		_ = conn.Close()
		return
	}

	select {
	case this.connCh <- proxyConn:
	case <-this.done:
		_ = conn.Close()
	}
}

func (this *Listener) isTrusted(addr net.Addr) bool {
	tcpAddr, ok := addr.(*net.TCPAddr)
	if !ok {
		return false
	}
	return localconfig.IsTrusted(this.trusted, tcpAddr.IP)
}

// LOCAL (and v1 UNKNOWN) headers are accepted as connections from the proxy
// itself; PROXY headers must carry TCP addresses.
func validateHeader(header *proxyproto.Header) error {
	if header.Command.IsLocal() {
		return nil
	}
	src, ok := header.SourceAddr.(*net.TCPAddr)
	if !ok || src == nil || src.IP == nil {
		return errInvalidHeader
	}
	dst, ok := header.DestinationAddr.(*net.TCPAddr)
	if !ok || dst == nil || dst.IP == nil {
		return errInvalidHeader
	}
	return nil
}

func isTemporary(err error) bool {
	type temporary interface {
		Temporary() bool
	}
	var t temporary
	return errors.As(err, &t) && t.Temporary()
}
