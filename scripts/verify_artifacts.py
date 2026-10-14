#!/usr/bin/env python3
"""Verify the Hcdn release packages produced by scripts/build.sh.

Reads every edge-{node,api,admin}-linux-<arch>-v<ver>.zip in the output dir
(nested zips such as edge-api/deploy/edge-node-*.zip are opened recursively)
and writes:

  SHA256SUMS       sha256 of the zips and of every file inside them.
                   Nested entries are written as "<zip>!<path>"; check the zips
                   with "sha256sum -c --ignore-missing SHA256SUMS".
  domain-scan.txt  every match of the upstream/third-party domain pattern in
                   binaries and assets, with context.
  buildinfo.txt    "go version -m" output for every Go binary.

Go does not embed -ldflags / CGO_* in the build info of -trimpath builds
(golang/go#52372), so ldflags are taken from build-flags.txt, which
scripts/build.sh writes with the sha256 of every binary it built; a binary
without a matching record fails. An independent rebuild that reproduces the
same sha256 is the strongest evidence that no -X was used.

Fails (exit 1) on: a build tag other than "community", -X or any ldflags other
than "-s -w" (+ "-linkmode external -extldflags -static" for cgo builds), a Go
version other than go.work's toolchain, a non-trimpath build, or an ELF binary
that is dynamically linked or built for the wrong machine. Domain hits are
reported but only fail with --strict-domains.
"""

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile

PACKAGE_RE = re.compile(r"^edge-(node|api|admin)-linux-(amd64|arm64)-v[0-9.]+\.zip$")
ARCH_RE = re.compile(r"linux-(amd64|arm64)(?:-|$)")
DOMAIN_RE = re.compile(
    rb"goedge\.cn|goedge\.cloud|dl\.goedge|install\.goedge|jsdelivr\.vip|jsdelivr|unpkg|cdnjs|gitee\.com",
    re.IGNORECASE,
)
ALLOWED_TAGS = "community"
LDFLAGS_PURE = "-s -w"
LDFLAGS_CGO = "-s -w -linkmode external -extldflags -static"
ELF_MACHINES = {"amd64": 62, "arm64": 183}  # EM_X86_64, EM_AARCH64


class Entry:
    def __init__(self, path, data, arch, package):
        self.path = path  # logical path, nested zips joined with "!"
        self.data = data
        self.arch = arch  # expected architecture or None
        self.package = package  # top-level zip name
        self.sha256 = hashlib.sha256(data).hexdigest()


def walk_zip(name, data, arch, package, out):
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in sorted(zf.infolist(), key=lambda i: i.filename):
            if info.is_dir():
                continue
            content = zf.read(info.filename)
            path = name + "!" + info.filename
            base = os.path.basename(info.filename)
            m = ARCH_RE.search(base)
            entry_arch = m.group(1) if m else arch
            out.append(Entry(path, content, entry_arch, package))
            if base.endswith(".zip"):
                walk_zip(path, content, entry_arch, package, out)


# ------------------------------------------------------------------ ELF
def elf_check(data, arch):
    """Return (summary, [errors]) for an ELF file."""
    errors = []
    if len(data) < 64 or data[:4] != b"\x7fELF":
        return "not ELF", ["not an ELF file"]
    if data[4] != 2 or data[5] != 1:
        return "unsupported ELF class/endianness", ["not a 64-bit little-endian ELF"]
    e_type, e_machine = struct.unpack_from("<HH", data, 16)
    e_phoff = struct.unpack_from("<Q", data, 32)[0]
    e_phentsize, e_phnum = struct.unpack_from("<HH", data, 54)

    has_interp = False
    dynamic = None
    for i in range(e_phnum):
        off = e_phoff + i * e_phentsize
        p_type = struct.unpack_from("<I", data, off)[0]
        p_offset = struct.unpack_from("<Q", data, off + 8)[0]
        p_filesz = struct.unpack_from("<Q", data, off + 32)[0]
        if p_type == 3:  # PT_INTERP
            has_interp = True
        elif p_type == 2:  # PT_DYNAMIC
            dynamic = (p_offset, p_filesz)

    needed = 0
    if dynamic:
        off, size = dynamic
        for pos in range(off, off + size - 15, 16):
            tag = struct.unpack_from("<q", data, pos)[0]
            if tag == 0:
                break
            if tag == 1:  # DT_NEEDED
                needed += 1

    machine_name = {62: "x86-64", 183: "aarch64"}.get(e_machine, str(e_machine))
    if arch is None:
        errors.append("cannot determine the expected architecture")
    elif e_machine != ELF_MACHINES[arch]:
        errors.append("machine %s does not match expected %s" % (machine_name, arch))
    if has_interp:
        errors.append("has PT_INTERP (dynamically linked)")
    if needed:
        errors.append("has %d DT_NEEDED entries (dynamically linked)" % needed)
    kind = {2: "EXEC", 3: "DYN"}.get(e_type, str(e_type))
    summary = "ELF64 %s %s, %s, %s" % (
        kind,
        machine_name,
        "no PT_INTERP" if not has_interp else "PT_INTERP",
        "no PT_DYNAMIC" if dynamic is None else "PT_DYNAMIC (%d DT_NEEDED)" % needed,
    )
    return summary, errors


# ------------------------------------------------------------------ build info
def parse_buildinfo(text):
    info = {"go": None, "path": None, "build": {}}
    for line in text.splitlines():
        if not line.startswith("\t"):
            m = re.match(r"^.*: (go\S+)\s*$", line)
            if m and info["go"] is None:
                info["go"] = m.group(1)
            continue
        fields = [p for p in line.split("\t") if p != ""]
        if len(fields) >= 2 and fields[0] == "path":
            info["path"] = fields[1]
        if len(fields) >= 2 and fields[0] == "build":
            kv = fields[1]
            if "=" in kv:
                k, v = kv.split("=", 1)
                if v.startswith('"'):
                    try:
                        v = json.loads(v)
                    except ValueError:
                        pass
                info["build"][k] = v
    return info


def read_provenance(path):
    """build-flags.txt written by scripts/build.sh, keyed by sha256."""
    records = {}
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as fp:
        for line in fp:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 8:
                continue
            rec = {"sha256": cols[0], "name": cols[1], "platform": cols[2], "go": cols[7]}
            for c in cols[3:7]:
                k, _, v = c.partition("=")
                rec[k] = v
            records[cols[0]] = rec
    return records


def check_ldflags(ldflags, cgo, source):
    errors = []
    if re.search(r"(^|\s)-X", ldflags):
        errors.append("-X found in ldflags (%s): %r" % (source, ldflags))
    allowed = {LDFLAGS_PURE} | ({LDFLAGS_CGO} if cgo == "1" else set())
    if ldflags not in allowed:
        errors.append("ldflags %r (%s) not in allowed set %s" % (ldflags, source, sorted(allowed)))
    return errors


def check_buildinfo(info, arch, want_go, prov):
    """prov: provenance record for this binary (or None)."""
    errors = []
    b = info["build"]
    tags = b.get("-tags")
    cgo = b.get("CGO_ENABLED")
    if tags != ALLOWED_TAGS:
        errors.append("build tags are %r, expected %r" % (tags, ALLOWED_TAGS))
    if "-ldflags" in b:
        errors += check_ldflags(b["-ldflags"], cgo, "go version -m")
    elif b.get("-trimpath") == "true":
        # Go does not record -ldflags for -trimpath builds; use the provenance
        # record that build.sh wrote for exactly this sha256.
        if prov is None:
            errors.append("-ldflags not recorded (-trimpath) and no build-flags.txt record for this sha256")
        else:
            errors += check_ldflags(prov.get("-ldflags", ""), cgo, "build-flags.txt")
            if prov.get("-tags") != ALLOWED_TAGS:
                errors.append("build-flags.txt tags are %r" % prov.get("-tags"))
            if prov.get("CGO_ENABLED") != cgo:
                errors.append("build-flags.txt CGO_ENABLED=%s, binary says %s" % (prov.get("CGO_ENABLED"), cgo))
    else:
        errors.append("-ldflags missing from build info")
    if b.get("-trimpath") != "true":
        errors.append("not built with -trimpath")
    if want_go and info["go"] != want_go:
        errors.append("built with %s, expected %s" % (info["go"], want_go))
    if b.get("GOOS") != "linux":
        errors.append("GOOS=%s, expected linux" % b.get("GOOS"))
    if arch and b.get("GOARCH") != arch:
        errors.append("GOARCH=%s, expected %s" % (b.get("GOARCH"), arch))
    return errors


# ------------------------------------------------------------------ domain scan
def printable_context(data, start, end, limit=80):
    lo = start
    while lo > 0 and start - lo < limit and 0x20 <= data[lo - 1] < 0x7F:
        lo -= 1
    hi = end
    while hi < len(data) and hi - end < limit and 0x20 <= data[hi] < 0x7F:
        hi += 1
    return data[lo:hi].decode("ascii", "replace")


def text_context(data, start, end, limit=100):
    line_no = data.count(b"\n", 0, start) + 1
    ls = data.rfind(b"\n", 0, start) + 1
    le = data.find(b"\n", end)
    if le < 0:
        le = len(data)
    before = data[ls:start].decode("utf-8", "replace")[-limit:]
    after = data[end:le].decode("utf-8", "replace")[:limit]
    snippet = (before + data[start:end].decode("utf-8", "replace") + after).strip()
    return line_no, snippet


def scan_domains(data):
    is_binary = b"\x00" in data[:8192]
    hits = []
    for m in DOMAIN_RE.finditer(data):
        if is_binary:
            hits.append((m.group().decode("ascii", "replace"), "offset 0x%x" % m.start(),
                         printable_context(data, m.start(), m.end())))
        else:
            line_no, snippet = text_context(data, m.start(), m.end())
            hits.append((m.group().decode("utf-8", "replace"), "line %d" % line_no, snippet))
    return hits


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="directory holding the dist zips")
    ap.add_argument("--go", default="go", help="go executable")
    ap.add_argument("--go-work", help="go.work whose toolchain line pins the Go version")
    ap.add_argument("--strict-domains", action="store_true", help="fail on any domain hit")
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    zips = sorted(f for f in os.listdir(out) if PACKAGE_RE.match(f))
    kinds = {PACKAGE_RE.match(f).group(1) for f in zips}
    failures = []
    for k in ("node", "api", "admin"):
        if k not in kinds:
            failures.append("missing edge-%s package in %s" % (k, out))
    if not zips:
        print("\n".join("FAIL: " + f for f in failures), file=sys.stderr)
        return 1

    want_go = None
    if args.go_work:
        with open(args.go_work, encoding="utf-8") as fp:
            m = re.search(r"^toolchain\s+(go[0-9.]+)\s*$", fp.read(), re.M)
        if m:
            want_go = m.group(1)
        else:
            failures.append("no toolchain line in " + args.go_work)

    prov_path = os.path.join(out, "build-flags.txt")
    provenance = read_provenance(prov_path)
    if provenance is None:
        print("note: %s not found; ldflags of -trimpath builds cannot be checked" % prov_path)

    sums = []
    entries = []
    for z in zips:
        with open(os.path.join(out, z), "rb") as fp:
            data = fp.read()
        sums.append((hashlib.sha256(data).hexdigest(), z))
        walk_zip(z, data, PACKAGE_RE.match(z).group(2), z, entries)

    # ---- SHA256SUMS
    with open(os.path.join(out, "SHA256SUMS"), "w", encoding="utf-8", newline="\n") as fp:
        for h, p in sums:
            fp.write("%s  %s\n" % (h, p))
        for e in sorted(entries, key=lambda e: e.path):
            fp.write("%s  %s\n" % (e.sha256, e.path))

    # group identical contents (the same file appears in several packages)
    by_hash = {}
    for e in entries:
        by_hash.setdefault(e.sha256, []).append(e)

    # ---- ELF + build info
    tmp = tempfile.mkdtemp(prefix="hcdn-verify-")
    elf_lines = []
    bi_out = []
    bi_summary = []
    try:
        for h in sorted(by_hash, key=lambda h: by_hash[h][0].path):
            group = by_hash[h]
            first = group[0]
            if first.data[:4] != b"\x7fELF":
                continue
            archs = {e.arch for e in group}
            arch = archs.pop() if len(archs) == 1 else None
            summary, errs = elf_check(first.data, arch)
            elf_lines.append((group, summary, errs))
            for err in errs:
                failures.append("%s: %s" % (first.path, err))

            fpath = os.path.join(tmp, h)
            with open(fpath, "wb") as fp:
                fp.write(first.data)
            env = dict(os.environ, GOTOOLCHAIN="local")
            r = subprocess.run([args.go, "version", "-m", fpath], capture_output=True, text=True, env=env)
            text = r.stdout.replace(fpath, os.path.basename(first.path.split("!")[-1]))
            bi_out.append("## sha256 %s\n" % h)
            for e in group:
                bi_out.append("## %s\n" % e.path)
            if r.returncode != 0 or not text.strip():
                bi_out.append("(not a Go binary or no build info: %s)\n\n" % r.stderr.strip())
                failures.append("%s: no Go build info" % first.path)
                continue
            bi_out.append(text if text.endswith("\n") else text + "\n")
            bi_out.append("\n")
            info = parse_buildinfo(text)
            prov = provenance.get(h) if provenance else None
            errs = check_buildinfo(info, arch, want_go, prov)
            for err in errs:
                failures.append("%s: %s" % (first.path, err))
            b = info["build"]
            if "-ldflags" in b:
                ld = "%r (go version -m)" % b["-ldflags"]
            elif prov:
                ld = "%r (build-flags.txt; Go does not embed it for -trimpath builds)" % prov.get("-ldflags")
            else:
                ld = "not recorded"
            cflags = b.get("CGO_CFLAGS", prov.get("CGO_CFLAGS") if prov else None)
            bi_summary.append(
                "%s  sha256=%s\n    path=%s go=%s GOOS=%s GOARCH=%s -tags=%s -trimpath=%s CGO_ENABLED=%s CGO_CFLAGS=%r\n    -ldflags=%s\n    %s"
                % (first.path.split("!")[-1] + " [" + first.package + "]", h, info["path"], info["go"],
                   b.get("GOOS"), b.get("GOARCH"), b.get("-tags"), b.get("-trimpath"), b.get("CGO_ENABLED"),
                   cflags, ld, "OK" if not errs else "FAIL: " + "; ".join(errs)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    with open(os.path.join(out, "buildinfo.txt"), "w", encoding="utf-8", newline="\n") as fp:
        fp.write("# Summary\n")
        for s in bi_summary:
            fp.write(s + "\n")
        fp.write("\n# ELF checks\n")
        for group, summary, errs in elf_lines:
            fp.write("%s\n    %s%s\n" % (group[0].path, summary, "" if not errs else "  FAIL: " + "; ".join(errs)))
        fp.write("\n# go version -m\n")
        fp.writelines(bi_out)

    # ---- domain scan
    per_package = {}
    total = 0
    details = []
    for h in sorted(by_hash, key=lambda h: by_hash[h][0].path):
        group = by_hash[h]
        hits = scan_domains(group[0].data)
        if not hits:
            continue
        for e in group:
            per_package.setdefault(e.package, []).append((e.path, len(hits)))
        total += len(hits)
        details.append((group, hits))

    with open(os.path.join(out, "domain-scan.txt"), "w", encoding="utf-8", newline="\n") as fp:
        fp.write("# pattern (case-insensitive): %s\n" % DOMAIN_RE.pattern.decode())
        fp.write("# distinct files with hits: %d, total hits in distinct files: %d\n\n" % (len(details), total))
        fp.write("## Hits per package (every copy counted)\n")
        for z in zips:
            rows = per_package.get(z, [])
            fp.write("%s: %d hits in %d files\n" % (z, sum(n for _, n in rows), len(rows)))
            for path, n in sorted(rows):
                fp.write("    %5d  %s\n" % (n, path.split("!", 1)[1]))
        fp.write("\n## Details (identical files are listed once)\n")
        for group, hits in details:
            fp.write("\n### %s  (%d hits)\n" % (group[0].path, len(hits)))
            for e in group[1:]:
                fp.write("    same content: %s\n" % e.path)
            for match, where, ctx in hits:
                fp.write("    [%s] %s: %s\n" % (match, where, ctx))

    # ---- console summary
    print("packages: " + ", ".join(zips))
    print("files hashed: %d (SHA256SUMS)" % (len(entries) + len(zips)))
    for s in bi_summary:
        print(s)
    for group, summary, errs in elf_lines:
        print("ELF %s: %s%s" % (group[0].path, summary, "" if not errs else " FAIL"))
    print("domain hits: %d in %d distinct files (see domain-scan.txt)" % (total, len(details)))
    for z in zips:
        rows = per_package.get(z, [])
        print("    %s: %d hits in %d files" % (z, sum(n for _, n in rows), len(rows)))
    if args.strict_domains and total:
        failures.append("domain scan found %d hits" % total)

    if failures:
        for f in failures:
            print("FAIL: " + f, file=sys.stderr)
        return 1
    print("verify: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
