package proxyprotocol_test

import (
	"io"
	"net"
	"testing"
	"time"

	"github.com/TeaOSLab/EdgeNode/internal/configs/localconfig"
	"github.com/TeaOSLab/EdgeNode/internal/utils/proxyprotocol"
	"github.com/pires/go-proxyproto"
)

func newListener(t *testing.T, trusted ...string) *proxyprotocol.Listener {
	rawListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var nets []*net.IPNet
	for _, s := range trusted {
		ipNet, err := localconfig.ParseCIDR(s)
		if err != nil {
			t.Fatal(err)
		}
		nets = append(nets, ipNet)
	}
	var listener = proxyprotocol.NewListener(rawListener, nets, 2*time.Second)
	t.Cleanup(func() { _ = listener.Close() })
	return listener
}

// dial connects and optionally sends a PROXY v2 header with the given client address
func dial(t *testing.T, listener net.Listener, clientIP string, payload string) net.Conn {
	conn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if len(clientIP) > 0 {
		var header = &proxyproto.Header{
			Version:           2,
			Command:           proxyproto.PROXY,
			TransportProtocol: proxyproto.TCPv4,
			SourceAddr:        &net.TCPAddr{IP: net.ParseIP(clientIP), Port: 50000},
			DestinationAddr:   &net.TCPAddr{IP: net.ParseIP("198.51.100.1"), Port: 443},
		}
		if _, err := header.WriteTo(conn); err != nil {
			t.Fatal(err)
		}
	}
	if len(payload) > 0 {
		if _, err := conn.Write([]byte(payload)); err != nil {
			t.Fatal(err)
		}
	}
	return conn
}

func accept(t *testing.T, listener net.Listener) net.Conn {
	var ch = make(chan net.Conn, 1)
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			ch <- conn
		}
	}()
	select {
	case conn := <-ch:
		t.Cleanup(func() { _ = conn.Close() })
		return conn
	case <-time.After(1 * time.Second):
		t.Fatal("accept timeout")
	}
	return nil
}

func expectClosed(t *testing.T, conn net.Conn) {
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, err := conn.Read(make([]byte, 1))
	if err == nil {
		t.Fatal("expected connection to be closed by server")
	}
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		t.Fatal("connection was not closed by server")
	}
}

func TestListener_RealClientAddr(t *testing.T) {
	var listener = newListener(t, "127.0.0.1/32")
	dial(t, listener, "192.0.2.10", "hello")

	var conn = accept(t, listener)
	if conn.RemoteAddr().String() != "192.0.2.10:50000" {
		t.Fatal("unexpected remote addr:", conn.RemoteAddr())
	}
	if conn.LocalAddr().String() != "198.51.100.1:443" {
		t.Fatal("unexpected local addr:", conn.LocalAddr())
	}
	if _, ok := conn.(*proxyproto.Conn).TCPConn(); !ok {
		t.Fatal("expected underlying *net.TCPConn")
	}
	var buf = make([]byte, 5)
	if _, err := io.ReadFull(conn, buf); err != nil || string(buf) != "hello" {
		t.Fatal("unexpected payload:", string(buf), err)
	}
}

func TestListener_RejectWithoutHeader(t *testing.T) {
	var listener = newListener(t, "127.0.0.1/32")

	// a silent peer must not block other peers
	var silent = dial(t, listener, "", "")
	// a peer without header is closed and never returned by Accept()
	var noHeader = dial(t, listener, "", "GET / HTTP/1.1\r\n\r\n")
	dial(t, listener, "192.0.2.20", "")

	var conn = accept(t, listener)
	if conn.RemoteAddr().String() != "192.0.2.20:50000" {
		t.Fatal("unexpected remote addr:", conn.RemoteAddr())
	}
	expectClosed(t, noHeader)
	expectClosed(t, silent) // closed after header timeout
}

func TestListener_RejectUntrustedSource(t *testing.T) {
	var listener = newListener(t, "192.0.2.0/24") // loopback not trusted
	var conn = dial(t, listener, "", "") // closed before any header is read
	expectClosed(t, conn)
}

func TestListener_Close(t *testing.T) {
	var listener = newListener(t, "127.0.0.1/32")
	var errCh = make(chan error, 1)
	go func() {
		_, err := listener.Accept()
		errCh <- err
	}()
	_ = listener.Close()
	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("expected error after close")
		}
		if opErr, ok := err.(*net.OpError); !ok || opErr.Op != "accept" {
			t.Fatal("expected accept *net.OpError, got:", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Accept() not returned after Close()")
	}
}
