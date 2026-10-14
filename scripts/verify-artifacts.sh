#!/usr/bin/env bash
#
# Verify the packages produced by scripts/build.sh.
#
# usage: scripts/verify-artifacts.sh [--out DIR] [--strict-domains]
#
# Writes DIR/SHA256SUMS, DIR/domain-scan.txt and DIR/buildinfo.txt and exits
# non-zero if a binary was built with a tag other than "community", with -X or
# other non-allowed ldflags, with a different Go version than go.work pins, or
# is not a stripped, static Linux ELF for the expected architecture.
# Domain-scan hits are reported; they only fail with --strict-domains.

set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
OUT="$REPO/dist"
EXTRA=()
while [ $# -gt 0 ]; do
	case "$1" in
	--out) OUT="${2:-}"; shift 2 ;;
	--out=*) OUT="${1#*=}"; shift ;;
	--strict-domains) EXTRA+=(--strict-domains); shift ;;
	-h | --help) sed -n '4,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
	*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

native() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -m "$1"
	else
		printf '%s\n' "$1"
	fi
}

export GOTOOLCHAIN=local
command -v go >/dev/null 2>&1 || { echo "go not found in PATH" >&2; exit 1; }

PY=""
for cand in "${HCDN_PYTHON:-}" python3 python; do
	[ -n "$cand" ] || continue
	if command -v "$cand" >/dev/null 2>&1 &&
		"$cand" -I -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
		PY="$cand"
		break
	fi
done
[ -n "$PY" ] || { echo "Python >= 3.8 not found (set HCDN_PYTHON)" >&2; exit 1; }

exec "$PY" -I "$(native "$REPO/scripts/verify_artifacts.py")" \
	--out "$(native "$OUT")" \
	--go "$(native "$(command -v go)")" \
	--go-work "$(native "$REPO/go.work")" \
	${EXTRA[@]+"${EXTRA[@]}"}
