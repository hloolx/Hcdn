# edge-node local configuration (`configs/local.yaml`)

`configs/local.yaml` holds settings that belong to one machine rather than to
the cluster. It is meant for nodes that run behind an L4 load balancer or SNI
router, or that share the server with other services.

- The file is optional. If it is missing, edge-node behaves like upstream.
- edge-node reads it once at startup. Restart edge-node after you change it.
- edge-node never writes the file, and the API never syncs it.
- edge-node refuses to start when the file is invalid, for example when it
  contains an unknown key such as `kernal` or a malformed address. The error
  goes to the node log and to stderr.

The package ships a fully commented template at
`configs/local.template.yaml`.

## Schema

```yaml
listen:
  remap:
    - port: 443                # configured (control-plane) TCP port
      addr: "127.0.0.1:10443"  # actual local bind address, IP:port
      proxyProtocol: true      # require a PROXY v1/v2 header (default: true)
  proxyProtocolTrusted: ["127.0.0.1/32", "::1/128"]  # default: loopback only
  proxyProtocolHeaderTimeout: 2s                     # default: 2s
firewall:
  kernel: true                 # false = application-level blocking only
```

### `listen.remap`

Sites keep their normal listen addresses in the control plane, for example
`https://:443`. A remap entry binds every TCP-based listener on the given port
(`http`, `https`, `tcp` and `tls`, plus their `4`/`6` variants) on `addr`
instead. Ports without an entry work as before. UDP listeners and HTTP/3 are
never remapped.

Remapping is invisible to the HTTP and TCP layers:

- Server matching, `${serverPort}`, access logs, HTTPS redirects, FastCGI
  `SERVER_PORT` and origin "follow port" use the configured group address,
  for example `:443`, not the bind address.
- `LocalAddr()` of accepted connections reports the destination address from
  the PROXY header. When the header has no address (LOCAL/UNKNOWN) or uses
  another port, the local IP is combined with the configured port. As a
  result, `${serverAddr}`, the empty-Host fallback, TLS server selection
  without SNI, and PROXY headers sent to origins all see port 443.

If several configured addresses on the same port resolve to the same bind
address (for example `https://:443` and `https://192.0.2.1:443`), only one
listener is started. An already running listener wins; otherwise the first
address in sorted order wins. An error naming the skipped addresses is logged
once.

### PROXY protocol (`proxyProtocol: true`)

A remapped listener with `proxyProtocol: true`:

- closes, immediately, connections whose socket peer is not in
  `proxyProtocolTrusted`.
- closes connections that do not send a valid PROXY v1 or v2 header within
  `proxyProtocolHeaderTimeout`. Headers are read in a separate goroutine per
  connection, so a slow peer cannot block other connections.
- uses the client address from the header as `RemoteAddr()`. WAF, IP lists,
  connection limits, rate limits, access logs and statistics all see the real
  client IP.
- treats LOCAL headers (v2) and `PROXY UNKNOWN` (v1), which proxy health
  checks use, as connections from the proxy itself.

Configure the load balancer to send PROXY protocol to the remapped address.
For example, with HAProxy use `send-proxy-v2` on the server line.

### `firewall.kernel`

When edge-node blocks an IP, it can also add a temporary kernel drop rule with
nftables or firewalld. On a shared server, that rule also cuts the IP off from
the other services. With `kernel: false`:

- edge-node uses a no-op firewall. Blocked IPs are rejected at application
  level only, both when connections are accepted and per request.
- edge-node creates no nftables tables and installs no nftables DDoS
  protection rules.

`kernel: false` does not affect:

- IP list actions that run external commands (`iptables`, `ipset`,
  `firewalld`, `script`). They are configured in the control plane and stay
  under its control.
- The "auto open ports" option, which only adds allow rules.

## Example: node behind an SNI router on port 443

```yaml
listen:
  remap:
    - port: 443
      addr: "127.0.0.1:10443"
firewall:
  kernel: false
```

The router owns public TCP 443 and forwards non-reserved SNI names to
`127.0.0.1:10443` with a PROXY v2 header. Port 80 is not remapped, so edge-node
still binds it directly.
