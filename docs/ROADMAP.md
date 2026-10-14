# Hcdn Roadmap

Hcdn is a CDN built on the GoEdge v1.3.9 open-source code base (BSD-3, see
[NOTICE](../NOTICE)). Every binary is built from this repository; no upstream
release artifact, installer, Docker image or "plus" asset is used.

Status legend: ✅ done · 🔄 in progress · ⏳ planned

| Phase | Goal | Status |
|---|---|---|
| 0 | Preparation: environment, repository, secret scanning | 🔄 |
| 1 | Import GoEdge v1.3.9 sources unmodified as the baseline (tree hashes match the upstream tags) | ✅ |
| 2 | Remove self-upgrade paths and upstream outbound links; reproducible cross-build with artifact verification | ✅ |
| 3 | Security hardening required before production (authentication, transport security, file handling, secret storage, CSRF) | ⏳ |
| 4 | Control plane deployment (API + legacy admin, private network only) | ⏳ |
| 5 | Edge nodes, including node-local listener remapping and PROXY protocol support for nodes behind an L4/SNI router | ⏳ |
| 6 | New web front ends: website, customer console, admin console, and a backend-for-frontend service | ⏳ |
| 7 | Domain onboarding and end-to-end acceptance (CNAME, ACME DNS-01, multi-node failover) | ⏳ |
| 8 | Branding, dependency upgrades, monitoring, backups, documentation | ⏳ |

## Principles

- Small, reviewable commits; security fixes reference their internal tracking IDs.
- Builds are reproducible from source with a pinned toolchain (see [BUILD.md](BUILD.md)).
- No secrets, addresses or deployment inventories are ever committed; deployment
  templates use placeholders.
