# Building Hcdn

This document describes how the Hcdn release packages are built and verified.
The build is driven by `scripts/build.sh` and checked by
`scripts/verify-artifacts.sh`. The upstream GoEdge scripts under
`edge-*/build/*.sh` are kept for reference only and are **not** used for
releases (they need `zip` and a musl-cross gcc, cascade into each other and
still contain branches for the commercial edition).

## Outputs

`scripts/build.sh` produces three packages with the same internal layout as
upstream GoEdge:

| Package | Contents |
|---|---|
| `edge-node-linux-<arch>-v<ver>.zip` | `edge-node/bin/edge-node`, `configs/*.template.yaml`, `www/`, `pages/`, empty `logs/` and `data/` |
| `edge-api-linux-<arch>-v<ver>.zip` | `edge-api/bin/edge-api`, `configs/{api,db}.template.yaml`, `deploy/edge-node-linux-<arch>-v<ver>.zip`, `installers/edge-installer-helper-linux-<arch>`, empty `logs/` and `data/` |
| `edge-admin-linux-<arch>-v<ver>.zip` | `edge-admin/bin/edge-admin`, `configs/server.template.yaml`, `web/`, the complete edge-api package under `edge-admin/edge-api/`, empty `logs/` |

Versions come from `Version` in each module's `internal/const/const.go`.
All binaries are Linux ELF executables, statically linked.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Go | exactly the version in the `toolchain` line of `go.work` (currently `go1.26.4`) | The build runs with `GOTOOLCHAIN=local` and refuses any other version; Go never downloads a toolchain on its own. |
| Zig | 0.16.0 | Used only as the C cross compiler (`zig cc`, musl target) for the cgo parts of edge-node. Other versions produce a warning. |
| Python | 3.8 or newer | Standard library only; used for zipping, the pre-check and verification. Always run with `-I`. |
| bash, coreutils, git | any recent | On Windows use Git Bash. `zip`, `make`, `jq` and `strings` are not needed. |

### Verifying the Go download

Download the archive for your platform from <https://go.dev/dl/> and compare
its SHA-256 with the checksum listed on that page:

```sh
sha256sum go1.26.4.linux-amd64.tar.gz
```

### Verifying the Zig download

Download the archive and its `.minisig` signature from
<https://ziglang.org/download/>. Check both the SHA-256 published in
<https://ziglang.org/download/index.json> and the minisign signature. The Zig
signing key is published on the download page; at the time of writing it is:

```text
RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U
```

```sh
sha256sum zig-x86_64-linux-0.16.0.tar.xz          # compare with index.json
minisign -Vm zig-x86_64-linux-0.16.0.tar.xz \
  -P RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U
```

For reference, `zig-x86_64-windows-0.16.0.zip` has SHA-256
`68659eb5f1e4eb1437a722f1dd889c5a322c9954607f5edcf337bc3684a75a7e`.

Zig does not need to be on `PATH`; point `HCDN_ZIG` at the executable instead.

## Building

```sh
# default: linux/amd64, edge-node package for amd64 only, output in ./dist
HCDN_ZIG=/path/to/zig scripts/build.sh

# arm64 edge-api/edge-admin, edge-node packages for both architectures
HCDN_ZIG=/path/to/zig scripts/build.sh --arch arm64 --node-archs "amd64 arm64"

# custom output directory
HCDN_ZIG=/path/to/zig scripts/build.sh --out /tmp/hcdn-dist
```

Environment variables:

- `HCDN_ZIG` - zig executable (default: `zig` from `PATH`)
- `HCDN_PYTHON` - Python interpreter (default: `python3`, then `python`)
- `GOPROXY`, `HTTPS_PROXY` - honoured as usual when modules must be downloaded
- `GOFLAGS` - may only contain `-mod=readonly` (or `-mod=mod`); anything else
  (for example `-toolexec`, `-overlay`, `-gcflags`) aborts the build

What the script does, in order:

1. Sets `GOTOOLCHAIN=local` and checks `go env GOVERSION` against `go.work`.
2. Runs the forbidden-asset pre-check (see below).
3. Builds edge-node for every `--node-archs` entry with cgo
   (`zig cc -target <arch>-linux-musl`, fully static) and packages it.
4. Builds `cmd/installer-helper` for the same architectures and edge-api,
   and packages edge-api with the node packages in `deploy/`.
5. Runs `edge-admin generate` (regenerates `components.src.js`) against a
   staged copy of `edge-admin/web`, so tracked files are never modified, and
   reports whether the tracked `components.src.js` matches the regenerated
   output. Then copies `components.src.js` to `components.js` and `utils.js`
   to `utils.min.js` (upstream's behaviour when `uglifyjs` is not installed;
   a minifier is deliberately not used so the output does not depend on its
   version), removes `web/tmp/*`, `web/public/js/components/`,
   `components.src.js`, `*.less`, `.gitignore` and `.DS_Store`.
6. Builds edge-admin and packages it together with the edge-api package.
7. Writes `build-flags.txt` (exact flags and sha256 of every binary) next to
   the zips.

Zips are written by `scripts/hcdn_build.py` with sorted entries, a fixed
timestamp (2024-05-20 00:00:00), Unix mode 0755 for ELF binaries and scripts
and 0644 for everything else, so identical inputs give identical zips.

The exact build commands are:

```sh
# edge-node (cgo, static)
CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
CC="zig cc -target x86_64-linux-musl" CXX="zig c++ -target x86_64-linux-musl" \
CGO_CFLAGS="-O2 -g0 -D_LARGEFILE64_SOURCE" \
go build -trimpath -tags community \
  -ldflags "-s -w -linkmode external -extldflags '-static -s'" ./cmd/edge-node

# edge-api, edge-admin, installer-helper (pure Go)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
go build -trimpath -tags community -ldflags "-s -w" ./cmd/edge-api
```

## Verifying

```sh
scripts/verify-artifacts.sh                 # checks ./dist
scripts/verify-artifacts.sh --out /tmp/hcdn-dist
scripts/verify-artifacts.sh --strict-domains  # also fail on domain hits
```

It opens every package (including the edge-node zips nested in edge-api) and
writes into the output directory:

- `SHA256SUMS` - the zips and every file inside them. Nested files are
  listed as `<zip>!<path>`; check the zips with
  `sha256sum -c --ignore-missing SHA256SUMS`.
- `buildinfo.txt` - `go version -m` output and ELF header checks for every
  Go binary.
- `domain-scan.txt` - every match of
  `goedge\.cn|goedge\.cloud|dl\.goedge|install\.goedge|jsdelivr\.vip|jsdelivr|unpkg|cdnjs|gitee\.com`
  (case-insensitive) in binaries and web assets, with context.

It fails when:

- a binary was built with a build tag other than `community`;
- ldflags contain `-X` or are anything other than `-s -w`
  (`-s -w -linkmode external -extldflags '-static -s'` for cgo builds);
- a binary was built with a different Go version than `go.work` pins, or
  without `-trimpath`;
- a binary has no matching record in `build-flags.txt`;
- a Linux binary has a `PT_INTERP` segment or `DT_NEEDED` entries, still has
  a `.symtab` or `.debug_*` section, or its ELF machine does not match the
  package architecture.

Domain hits are reported but are not a failure unless `--strict-domains` is
given.

### Reproducibility

Rebuilding the same commit with the same Go and Zig versions must give the
same sha256 for every binary and zip. To check, build twice into different
output directories (ideally with a clean `GOCACHE`) and compare the
`SHA256SUMS` files. An identical rebuild is also the strongest evidence that
a binary was built with the documented flags (see the note on `-ldflags`
below).

### Offline builds

Once the module cache is populated, the build must also succeed without
network access:

```sh
GOPROXY=off GOFLAGS=-mod=readonly HCDN_ZIG=/path/to/zig scripts/build.sh
```

## Rules

These rules come from the security audit and are enforced by the scripts:

- Only the `community` build tag. Never `plus`, `script`, `packet` or `gcc`.
- `-ldflags` is exactly `-s -w` (plus `-linkmode external -extldflags '-static -s'`
  for edge-node). Never `-X`.
- `GOTOOLCHAIN=local`; the Go version must equal the `toolchain` line in
  `go.work` (each `go.mod` carries the same `toolchain` line; their `go 1.21`
  language version is intentionally unchanged).
- Never run `edge-api/build/sql.sh`, `edge-admin/build/build-all.sh` or
  anything in `edge-admin/docker/`.
- The pre-check fails if any of these exist in the source tree:
  `edge-node/build/edge-toa/`, `edge-node/libs/`, any `EdgeDNS/` or
  `EdgePlus/` directory, `edge-admin/web/views/**/*_plus.*`, `*-plus.db`,
  `build-all-plus.sh`, `upload.sh`.
- Generated files are not committed by the build; regenerate and commit them
  in a separate change when needed (`edge-admin/build/generate.sh`).

## Known issues

- **edge-node must be stripped by the external linker.** With
  `-linkmode external`, Go's `-s -w` do not remove what the external linker
  adds; zig's musl libc and compiler_rt objects carry DWARF with absolute
  paths of the build host (zig install dir, zig cache, Go's temporary work
  directory). Passing `-s` to the external linker (`-extldflags '-static -s'`)
  removes them; without it the binary leaks local paths and is not
  reproducible.
- **`_LARGEFILE64_SOURCE` is required for edge-node.** `mattn/go-sqlite3`
  v1.14.17 uses `off64_t`, which recent musl versions only declare when
  `_LARGEFILE64_SOURCE` is defined. Without
  `CGO_CFLAGS=-D_LARGEFILE64_SOURCE` the cgo build fails.
- **`-ldflags` is not embedded in the binaries.** Go omits `-ldflags` and the
  `CGO_*` variables from the build information of `-trimpath` builds
  (golang/go#52372), so `go version -m` cannot show them. The verification
  therefore relies on `build-flags.txt`, which ties the flags to each
  binary's sha256, and on reproducible rebuilds.
- **`edge-admin generate` output depends on directory order.** The generator
  concatenates `web/public/js/components/**/*.js` in the order the file
  system lists them (unsorted `Readdirnames`), so the order of the
  components in `components.js` - and therefore the edge-admin zip hash - can
  differ between machines or file systems even though the content is the
  same. NTFS lists names sorted; on Linux file systems the order is not
  guaranteed. A fix belongs in the generator (sort the names), not in the
  build script.
- `components.js` and `utils.min.js` in the packages are not minified (see
  step 5 above).
