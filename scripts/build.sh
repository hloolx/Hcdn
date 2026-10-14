#!/usr/bin/env bash
#
# Reproducible build of the Hcdn packages (edge-node, edge-api, edge-admin).
#
# usage: scripts/build.sh [--arch amd64|arm64] [--node-archs "amd64 arm64"] [--out DIR]
#
#   --arch        target architecture of edge-api / edge-admin (default amd64)
#   --node-archs  architectures of the edge-node packages (and installer
#                 helpers) shipped in edge-api's deploy/ and installers/
#                 dirs (default: "amd64")
#   --out         output directory (default: <repo>/dist)
#
# Environment:
#   HCDN_ZIG      path to the zig executable (default: zig from PATH)
#   HCDN_PYTHON   path to a Python 3 interpreter (default: python3 or python)
#
# Rules enforced here (see docs/BUILD.md): only the "community" build tag,
# ldflags exactly "-s -w" (+ static-link flags for cgo edge-node), never -X,
# GOTOOLCHAIN=local with the Go version pinned in go.work, and no plus-only
# assets in the source tree.

set -euo pipefail

ARCH="amd64"
NODE_ARCHS="amd64"
OUT=""

usage() {
	sed -n '4,15p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
}

while [ $# -gt 0 ]; do
	case "$1" in
	--arch) ARCH="${2:-}"; shift 2 ;;
	--arch=*) ARCH="${1#*=}"; shift ;;
	--node-archs) NODE_ARCHS="${2:-}"; shift 2 ;;
	--node-archs=*) NODE_ARCHS="${1#*=}"; shift ;;
	--out) OUT="${2:-}"; shift 2 ;;
	--out=*) OUT="${1#*=}"; shift ;;
	-h | --help) usage ;;
	*) echo "unknown argument: $1" >&2; usage ;;
	esac
done

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

check_arch() {
	case "$1" in
	amd64 | arm64) ;;
	*) die "unsupported architecture '$1' (supported: amd64 arm64)" ;;
	esac
}
check_arch "$ARCH"
[ -n "$NODE_ARCHS" ] || die "--node-archs must not be empty"
for a in $NODE_ARCHS; do check_arch "$a"; done

# Convert a path for native Windows tools (go.exe, python.exe, zig.exe) when
# running under Git Bash / MSYS; a no-op on Linux and macOS.
native() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -m "$1"
	else
		printf '%s\n' "$1"
	fi
}

REPO=$(cd "$(dirname "$0")/.." && pwd)
[ -n "$OUT" ] || OUT="$REPO/dist"
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
WORK="$OUT/.work"

# ---------------------------------------------------------------- toolchain
export GOTOOLCHAIN=local
export GOWORK="$(native "$REPO/go.work")"
unset GOOS GOARCH CC CXX CGO_ENABLED CGO_CFLAGS CGO_CXXFLAGS CGO_CPPFLAGS CGO_LDFLAGS TEAROOT

command -v go >/dev/null 2>&1 || die "go not found in PATH"
WANT_GO=$(sed -n 's/^toolchain[[:space:]]\{1,\}\(go[0-9.]*\)[[:space:]]*$/\1/p' "$REPO/go.work")
[ -n "$WANT_GO" ] || die "no 'toolchain' line found in go.work"
HAVE_GO=$(go env GOVERSION)
[ "$HAVE_GO" = "$WANT_GO" ] || die "go version mismatch: have $HAVE_GO, go.work requires $WANT_GO"
log "go: $HAVE_GO (GOTOOLCHAIN=local)"
# GOFLAGS (environment or "go env -w") could inject -toolexec, -overlay,
# -gcflags, ...; only the module mode switch is accepted.
for f in $(go env GOFLAGS); do
	case "$f" in
	-mod=readonly | -mod=mod) ;;
	*) die "GOFLAGS contains '$f'; only -mod=readonly is allowed" ;;
	esac
done

PY=""
for cand in "${HCDN_PYTHON:-}" python3 python; do
	[ -n "$cand" ] || continue
	if command -v "$cand" >/dev/null 2>&1 &&
		"$cand" -I -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
		PY="$cand"
		break
	fi
done
[ -n "$PY" ] || die "Python >= 3.8 not found (set HCDN_PYTHON)"
HELPER="$(native "$REPO/scripts/hcdn_build.py")"
py() { "$PY" -I "$HELPER" "$@"; }
log "python: $("$PY" -I -c 'import sys; print(sys.version.split()[0])')"

ZIG="${HCDN_ZIG:-}"
if [ -z "$ZIG" ]; then
	ZIG=$(command -v zig 2>/dev/null || true)
fi
[ -n "$ZIG" ] && [ -x "$ZIG" ] || die "zig not found (set HCDN_ZIG or put zig in PATH)"
ZIG="$(native "$ZIG")"
case "$ZIG" in *" "*) die "zig path must not contain spaces: $ZIG" ;; esac
ZIG_VERSION=$("$ZIG" version)
log "zig: $ZIG_VERSION ($ZIG)"
[ "$ZIG_VERSION" = "0.16.0" ] || echo "WARNING: builds were verified with zig 0.16.0, found $ZIG_VERSION" >&2

# ---------------------------------------------------------------- pre-check
log "checking for forbidden assets ..."
py precheck "$(native "$REPO")" --skip "$(native "$OUT")"

NODE_VERSION=$(py version "$(native "$REPO/edge-node/internal/const/const.go")")
API_VERSION=$(py version "$(native "$REPO/edge-api/internal/const/const.go")")
ADMIN_VERSION=$(py version "$(native "$REPO/edge-admin/internal/const/const.go")")
log "versions: edge-node v$NODE_VERSION, edge-api v$API_VERSION, edge-admin v$ADMIN_VERSION"

TAGS="community"
LDFLAGS="-s -w"
# With external linking, Go's -s/-w do not strip what the external linker
# adds: zig links its musl libc and compiler_rt with DWARF that embeds local
# absolute paths (zig install dir, zig cache, Go's temp work dir), which both
# leaks build-host details and breaks reproducibility. "-s" for the external
# linker removes .symtab and all .debug_* sections.
LDFLAGS_STATIC="-s -w -linkmode external -extldflags '-static -s'"

rm -rf "$WORK"
mkdir -p "$WORK"

zig_target() {
	case "$1" in
	amd64) echo "x86_64-linux-musl" ;;
	arm64) echo "aarch64-linux-musl" ;;
	esac
}

# Provenance record of every Go binary: Go omits -ldflags and CGO_* from the
# embedded build info when -trimpath is used (golang/go#52372), so the exact
# flags are written to build-flags.txt next to the packages and checked by
# scripts/verify-artifacts.sh against the binaries' sha256.
record_build() { # FILE GOARCH CGO_ENABLED LDFLAGS [CGO_CFLAGS]
	local sum
	sum=$(py sha256 "$(native "$1")" | cut -d' ' -f1)
	printf '%s	%s	linux/%s	CGO_ENABLED=%s	CGO_CFLAGS=%s	-tags=%s	-ldflags=%s	%s
' 		"$sum" "$(basename "$1")" "$2" "$3" "${5:-}" "$TAGS" "$4" "$HAVE_GO" >>"$WORK/build-flags.txt"
}

clean_hidden() {
	find "$1" \( -name .DS_Store -o -name .gitignore \) -type f -exec rm -f {} +
}

# ---------------------------------------------------------------- edge-node
build_node() {
	local arch="$1" stage="$WORK/node-$1" target
	target=$(zig_target "$arch")
	local dist="$stage/edge-node"
	log "building edge-node v$NODE_VERSION linux/$arch (cgo, zig cc -target $target) ..."
	mkdir -p "$dist/bin" "$dist/configs" "$dist/logs" "$dist/data"
	cp "$REPO/edge-node/build/configs/api_node.template.yaml" "$dist/configs/"
	cp "$REPO/edge-node/build/configs/cluster.template.yaml" "$dist/configs/"
	cp -R "$REPO/edge-node/build/www" "$dist/"
	cp -R "$REPO/edge-node/build/pages" "$dist/"

	(
		cd "$REPO/edge-node"
		env CGO_ENABLED=1 GOOS=linux GOARCH="$arch" \
			CC="$ZIG cc -target $target" \
			CXX="$ZIG c++ -target $target" \
			CGO_CFLAGS="-O2 -g0 -D_LARGEFILE64_SOURCE" \
			go build -trimpath -tags "$TAGS" -ldflags "$LDFLAGS_STATIC" \
			-o "$(native "$dist/bin/edge-node")" ./cmd/edge-node
	)
	[ -f "$dist/bin/edge-node" ] || die "edge-node build failed"
	record_build "$dist/bin/edge-node" "$arch" 1 "$LDFLAGS_STATIC" "-O2 -g0 -D_LARGEFILE64_SOURCE"

	clean_hidden "$dist"
	py zip "$(native "$stage")" edge-node "$(native "$WORK/edge-node-linux-$arch-v$NODE_VERSION.zip")"
}

for a in $NODE_ARCHS; do
	build_node "$a"
done

# ---------------------------------------------------------------- edge-api
API_STAGE="$WORK/api"
API_DIST="$API_STAGE/edge-api"
mkdir -p "$API_DIST/bin" "$API_DIST/configs" "$API_DIST/logs" "$API_DIST/data" \
	"$API_DIST/deploy" "$API_DIST/installers"
cp "$REPO/edge-api/build/configs/api.template.yaml" "$API_DIST/configs/"
cp "$REPO/edge-api/build/configs/db.template.yaml" "$API_DIST/configs/"
for a in $NODE_ARCHS; do
	cp "$WORK/edge-node-linux-$a-v$NODE_VERSION.zip" "$API_DIST/deploy/"
done

for a in $NODE_ARCHS; do
	log "building installer-helper linux/$a ..."
	(
		cd "$REPO/edge-api"
		env CGO_ENABLED=0 GOOS=linux GOARCH="$a" \
			go build -trimpath -tags "$TAGS" -ldflags "$LDFLAGS" \
			-o "$(native "$API_DIST/installers/edge-installer-helper-linux-$a")" ./cmd/installer-helper
	)
	record_build "$API_DIST/installers/edge-installer-helper-linux-$a" "$a" 0 "$LDFLAGS"
done

log "building edge-api v$API_VERSION linux/$ARCH ..."
(
	cd "$REPO/edge-api"
	env CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" \
		go build -trimpath -tags "$TAGS" -ldflags "$LDFLAGS" \
		-o "$(native "$API_DIST/bin/edge-api")" ./cmd/edge-api
)
[ -f "$API_DIST/bin/edge-api" ] || die "edge-api build failed"
record_build "$API_DIST/bin/edge-api" "$ARCH" 0 "$LDFLAGS"
clean_hidden "$API_DIST"
py zip "$(native "$API_STAGE")" edge-api "$(native "$WORK/edge-api-linux-$ARCH-v$API_VERSION.zip")"

# ---------------------------------------------------------------- edge-admin
ADMIN_STAGE="$WORK/admin"
ADMIN_DIST="$ADMIN_STAGE/edge-admin"
mkdir -p "$ADMIN_DIST/bin" "$ADMIN_DIST/configs" "$ADMIN_DIST/logs"
cp -R "$REPO/edge-admin/web" "$ADMIN_DIST/"
cp "$REPO/edge-admin/build/configs/server.template.yaml" "$ADMIN_DIST/configs/"

# Generate components.src.js the way upstream does ("edge-admin generate"),
# but against the staged copy of web/ so the source tree is never modified.
# TeaGo resolves its web root from $PWD (the nearest dir holding a go.mod)
# when the program runs from a "go run" binary named "main"; a marker go.mod
# in the staging dir pins that root to the staged copy.
log "generating components.src.js (go run ... generate) ..."
JS_STAGE="$ADMIN_DIST/web/public/js"
rm -f "$JS_STAGE/components.src.js"
: >"$ADMIN_DIST/go.mod"
(
	cd "$REPO/edge-admin"
	env CGO_ENABLED=0 PWD="$(native "$ADMIN_DIST")" \
		go run -trimpath -tags "$TAGS" ./cmd/edge-admin/main.go generate
)
rm -f "$ADMIN_DIST/go.mod"
rm -rf "$ADMIN_DIST/build"
[ -s "$JS_STAGE/components.src.js" ] || die "generate step did not produce components.src.js"

# Report whether a clean checkout regenerates the tracked file byte for byte.
# (The tracked file is not modified; the package always uses fresh output.)
TRACKED_SRC="$REPO/edge-admin/web/public/js/components.src.js"
if cmp -s "$TRACKED_SRC" "$JS_STAGE/components.src.js"; then
	log "generate: regenerated components.src.js is identical to the tracked file"
else
	echo "WARNING: edge-admin/web/public/js/components.src.js differs from the regenerated output;"
	echo "         the package uses the regenerated file. Summary (tracked => regenerated):"
	git -C "$REPO" diff --no-index --stat=120 -- "$TRACKED_SRC" "$JS_STAGE/components.src.js" | sed 's/^/    /' || true
fi

# Upstream fallback when uglifyjs is absent: plain copies. uglifyjs is never
# used here so the output does not depend on the installed minifier.
cp "$JS_STAGE/components.src.js" "$JS_STAGE/components.js"
cp "$JS_STAGE/utils.js" "$JS_STAGE/utils.min.js"
for f in components.js utils.min.js; do
	cmp -s "$REPO/edge-admin/web/public/js/$f" "$JS_STAGE/$f" ||
		echo "NOTE: packaged web/public/js/$f (unminified copy) differs from the tracked $f"
done

if [ -d "$ADMIN_DIST/web/tmp" ]; then
	find "$ADMIN_DIST/web/tmp" -mindepth 1 -delete
fi
rm -rf "$JS_STAGE/components"
rm -f "$JS_STAGE/components.src.js"

log "building edge-admin v$ADMIN_VERSION linux/$ARCH ..."
(
	cd "$REPO/edge-admin"
	env CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" \
		go build -trimpath -tags "$TAGS" -ldflags "$LDFLAGS" \
		-o "$(native "$ADMIN_DIST/bin/edge-admin")" ./cmd/edge-admin
)
[ -f "$ADMIN_DIST/bin/edge-admin" ] || die "edge-admin build failed"
record_build "$ADMIN_DIST/bin/edge-admin" "$ARCH" 0 "$LDFLAGS"

# bundled edge-api (upstream unzips the edge-api package here)
cp -R "$API_DIST" "$ADMIN_DIST/edge-api"

clean_hidden "$ADMIN_DIST"
find "$ADMIN_DIST" -name '*.less' -type f -exec rm -f {} +
py zip "$(native "$ADMIN_STAGE")" edge-admin "$(native "$WORK/edge-admin-linux-$ARCH-v$ADMIN_VERSION.zip")"

# ---------------------------------------------------------------- output
ZIPS=""
for a in $NODE_ARCHS; do
	ZIPS="$ZIPS edge-node-linux-$a-v$NODE_VERSION.zip"
done
ZIPS="$ZIPS edge-api-linux-$ARCH-v$API_VERSION.zip edge-admin-linux-$ARCH-v$ADMIN_VERSION.zip"
for z in $ZIPS; do
	mv -f "$WORK/$z" "$OUT/$z"
done
mv -f "$WORK/build-flags.txt" "$OUT/build-flags.txt"

log "binaries:"
BINS="$API_DIST/bin/edge-api $ADMIN_DIST/bin/edge-admin"
for a in $NODE_ARCHS; do
	BINS="$WORK/node-$a/edge-node/bin/edge-node $BINS"
done
for b in $BINS; do
	py sha256 "$(native "$b")"
done

rm -rf "$WORK"

log "packages in $OUT:"
(cd "$OUT" && for z in $ZIPS; do py sha256 "$z"; done)
log "done. Run scripts/verify-artifacts.sh --out \"$OUT\" to verify."
