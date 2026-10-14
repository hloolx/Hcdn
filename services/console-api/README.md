# console-api

`console-api` is the backend-for-frontend of Hcdn. It serves the three web
front ends (marketing site, customer console, admin console) and a JSON API
for them, and talks to EdgeAPI (the GoEdge control plane) over gRPC. It has
its own MySQL schema for state that EdgeAPI has no place for.

The API contract lives in `web/packages/api/src` (`types.ts`, `console.ts`,
`admin.ts`). Customer endpoints are under `/api/v1`, admin endpoints under
`/api/admin/v1`.

```
browser ──HTTPS──> (TLS proxy or Hcdn edge) ──> console-api ──gRPC──> EdgeAPI
                                                    │
                                                    └──> MySQL (hcdn_console)
```

## Build and run

```sh
cd services/console-api
GOTOOLCHAIN=local CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o console-api .
cp configs/console-api.example.yaml configs/console-api.yaml   # git-ignored
chmod 600 configs/console-api.yaml
./console-api -c configs/console-api.yaml bootstrap -write     # see below
./console-api -c configs/console-api.yaml                      # = serve
```

Commands: `serve` (default), `migrate` (apply DB migrations and exit),
`bootstrap [-write] [-sql]`, `version`.

## Configuration

`configs/console-api.example.yaml` documents every key. The main ones:

| Key | Meaning |
| --- | --- |
| `listen` | Listen address, default `127.0.0.1:18080`. |
| `tls.certFile`, `tls.keyFile` | Optional: serve HTTPS directly. |
| `trustedProxies` | CIDRs whose `X-Forwarded-For` / `X-Forwarded-Proto` are honoured. |
| `hosts.site/console/admin/api` | Host names routed to each front end. Unknown hosts get 421. |
| `static.site/console/admin` | Built front-end directories (SPA fallback to `index.html`). |
| `edgeAPI.endpoints` | EdgeAPI gRPC endpoints (`https://` or `http://`). |
| `edgeAPI.caFile`, `edgeAPI.serverName` | Verify EdgeAPI's TLS certificate. |
| `edgeAPI.user` | API token (nodeId/secret) of the console-api user node, role `user`. |
| `edgeAPI.admin` | API token with role `admin`. |
| `edgeAPI.adminId` | EdgeAPI admin id used for the few customer flows needing admin rights. |
| `db.dsn` | go-sql-driver DSN of the console-api schema. |
| `cookie.secure` | `Secure` flag on cookies (default `true`; `false` only for local http). |
| `adminIpAllowlist` | CIDRs allowed to reach the admin host (empty = anywhere). |
| `smtp.*` | Optional mail relay (`starttls`, `tls` or `none`). |
| `registration.*` | Self-service signup: open, default cluster, email verification. |
| `cnameDomain`, `productName`, `consoleUrl` | Shown in the UI / used in emails. |
| `plans`, `defaultPlan` | Static plan list for `/public/plans` and the customer's plan. |
| `rateLimit.*`, `login.*` | Abuse protection limits. |

Admins can override `productName`, `consoleUrl`, `registration` and
`adminIpAllowlist` at runtime (`PUT /api/admin/v1/settings`, stored in the
`settings` table). SMTP settings are read from the config file only.

## Bootstrap (EdgeAPI credentials)

console-api uses two EdgeAPI API tokens:

1. **admin** (`edgeAPI.admin`): a row in `edgeAPITokens` with role `admin`,
   e.g. the token edge-admin uses (`api_admin.yaml`). Used for admin endpoints
   and a few customer flows (signup, cluster DNS lookup, WAF mode switch).
2. **user** (`edgeAPI.user`): the token of an EdgeAPI *user node*
   (`edgeUserNodes` + `edgeAPITokens` role `user`). Every customer call is made
   with it and carries `{"type":"user","userId":<customer>}`, so EdgeAPI's own
   ownership checks apply.

`console-api bootstrap` creates (or reuses) a user node named
`hcdn-console-api` through `UserNodeService` with the admin token and prints
the credential (`-write` stores it into the config file with mode 0600).
The open-source EdgeAPI does not register `UserNodeService`; in that case (or
with `-sql`) the command generates a random credential and prints the SQL to
run against the EdgeAPI database:

```sql
INSERT INTO edgeUserNodes (isOn, uniqueId, secret, name, description, accessAddrs, `order`, state, createdAt, adminId, weight)
  VALUES (1, '<nodeId>', '<secret>', 'hcdn-console-api', 'Hcdn console-api (BFF)', '[]', 0, 1, UNIX_TIMESTAMP(), 0, 0);
INSERT INTO edgeAPITokens (nodeId, secret, role, state) VALUES ('<nodeId>', '<secret>', 'user', 1);
```

## Database

Create an empty schema and a user for it; tables are created at startup from
the embedded, numbered migrations (`internal/store/migrations`), guarded by a
MySQL named lock:

| Table | Purpose |
| --- | --- |
| `sessions` | Session id hashes (SHA-256), kind, subject, idle/absolute expiry. |
| `login_failures` | Failed logins per username and per IP (sliding window). |
| `email_tokens` | Hashed single-use email verification / password reset tokens. |
| `user_flags` | Email verified / pending verification, last login. |
| `activity` | Customer activity and admin audit log. |
| `settings` | Admin-editable runtime settings. |
| `site_meta` | Per-site DNS check result, autoCert / forceHttps wishes. |
| `acme_jobs` | Asynchronous ACME issuance jobs. |
| `access_key_meta` | Creation time of access keys created through the console. |
| `schema_migrations` | Applied migration versions. |

## Security model

- **Sessions**: 32 random bytes per session; only the SHA-256 is stored.
  Cookies `hcdn_sid` (customer) and `hcdn_asid` (admin) are `HttpOnly`,
  `Secure`, `SameSite=Strict`, `Path=/`. Idle timeout 12 h, absolute 7 d.
  Logout deletes the row; password changes and resets end other sessions;
  disabling/deleting a customer ends all of theirs.
- **CSRF**: double-submit cookie `hcdn_csrf` (readable by the SPA). Every
  non-GET/HEAD API request must send `X-CSRF-Token` equal to the cookie and an
  `Origin` (or `Referer`) naming the request host; otherwise 403 `csrf`.
- **Abuse protection**: per-IP token buckets (global and for `POST /auth/*`);
  failed logins are counted per username and per IP with exponential backoff
  and a lockout (429 with `retryAfter`). The client IP is the TCP peer, or the
  right-most untrusted `X-Forwarded-For` hop when the peer is a trusted proxy.
- **TOTP**: when EdgeAPI has OTP enabled for the account, login requires
  `otp` (code `otp_required` first); RFC 6238, SHA-1, 30 s, 6 digits, ±1 step.
- **Email**: never reveals whether an address exists; reset and verification
  mails are sent asynchronously.
- **EdgeAPI**: tokens are AES-256-CFB encrypted with fresh timestamps per
  request. Customer calls never use `userId` 0 (EdgeAPI skips ownership checks
  for it). Because several EdgeAPI RPCs skip ownership checks
  (`FindEnabledServerDNS`, `FindAndInitServerReverseProxyConfig`,
  `UpdateServerHTTPS` policy ids, origin/WAF policy references, ...),
  console-api always loads the server as the customer first and never takes
  policy/list/origin ids from the browser. Secrets (private keys, DNS provider
  credentials, node secrets except at creation) are never returned.
- **Hosting**: `/api/admin/v1` is only served on the admin host, which is
  restricted to `adminIpAllowlist`. Every response carries a strict CSP,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options` and,
  over TLS, HSTS.

## Known limitations

- Stats come from EdgeAPI's 5-minute server stats; there is no status-code
  breakdown (`statusCodes` is empty) and attack counts are per day. EdgeAPI
  stats are in its local time zone, which must match console-api's.
- Site list items carry summary fields only (`origins` empty,
  `traffic24h` null); `GET /sites/{id}` has the full object.
- Access logs have no geo region; cache status is HIT when EdgeAPI recorded it.
- The cross-tenant admin certificate list cannot show the owner unless
  filtered by `userId`.
