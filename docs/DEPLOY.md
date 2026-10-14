# Deploying Hcdn

This guide describes a production layout. Every address below is a placeholder.
Build all artifacts yourself first (see [BUILD.md](BUILD.md)); never install
upstream release archives, installers or images.

## Topology

```
                          ┌──────────── control plane host ────────────┐
 browser ── HTTPS ──► edge nodes ──► console-api (origin, TLS, allowlisted)  │
                          │           ├─ /api/v1        customer API       │
                          │           └─ static site / console / admin     │
                          │      edge-api  (gRPC, TLS on a node-only port)  │
                          │      edge-admin (legacy, loopback only)         │
                          │      MySQL      (loopback only)                 │
                          └─────────────────────────────────────────────────┘
 edge node:  TCP 80 ─► edge-node
             TCP 443 ─► L4 SNI router ─┬─ reserved SNI ─► other local TLS service
                                       └─ everything else ─► edge-node (PROXY v2)
```

## Control plane

1. Create a system user (`hcdn`, no login shell) and `/opt/hcdn` (0750).
2. Run MySQL 8.4 bound to `127.0.0.1` only (a dedicated instance or container),
   with a dedicated database and user and a random password.
3. Unpack `edge-admin-linux-amd64-*.zip` into `/opt/hcdn`, set
   `configs/server.yaml` to listen on `127.0.0.1:7788`, start it with
   [`deploy/systemd/hcdn-edge-admin.service`](../deploy/systemd/hcdn-edge-admin.service),
   and complete the setup wizard through an SSH tunnel.
4. After setup, move `edge-admin/edge-api` to `/opt/hcdn/edge-api` and run it with
   [`hcdn-edge-api.service`](../deploy/systemd/hcdn-edge-api.service). Make the
   API node's plain gRPC listener bind `127.0.0.1`.
5. Give the API node an HTTPS listener for edge nodes, using a certificate signed
   by a private CA that only the nodes trust. Open that port in the host
   firewall for the node addresses only.
6. Lock down files: configs 0600, directories 0700, owned by `hcdn`.
7. Block outbound access to the upstream vendor domains at the DNS level, and
   rotate every role secret after the first installation.

## Edge nodes

1. Install the SNI router ([`deploy/haproxy/haproxy.cfg.example`](../deploy/haproxy/haproxy.cfg.example))
   if the server also runs another TLS service on 443; otherwise let
   `edge-node` bind 443 directly.
2. Unpack `edge-node-linux-amd64-*.zip` into `/opt/hcdn/edge-node`, write
   `configs/api_node.yaml` ([example](../deploy/edge-node/api_node.yaml.example))
   and `configs/local.yaml` ([example](../deploy/edge-node/local.yaml.example)),
   and start [`hcdn-edge-node.service`](../deploy/systemd/hcdn-edge-node.service).
3. Allow TCP 80 (and 443 when not behind a router) in the host firewall.
4. Before changing anything on a server that runs other services, back up their
   configuration, write a rollback script and schedule it, for example
   `systemd-run --on-active=15min /root/rollback.sh`; cancel the timer only after
   every check passed.

See [EDGE-NODE-LOCAL-CONFIG.md](EDGE-NODE-LOCAL-CONFIG.md) for the node-local
listener remap and PROXY protocol options.
