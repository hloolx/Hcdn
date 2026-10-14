#!/usr/bin/env python3
"""Helper commands for scripts/build.sh (stdlib only, Python >= 3.8).

Subcommands:
  precheck ROOT [--skip DIR ...]   fail if forbidden (plus-only) assets exist
  version CONST_GO                  print the Version constant of a module
  zip SRC_PARENT NAME OUT_ZIP       deterministic zip of SRC_PARENT/NAME
  sha256 FILE ...                   print "<sha256>  <file>" lines
"""

import argparse
import fnmatch
import hashlib
import os
import re
import stat
import sys
import zipfile

# Fixed timestamp for every zip entry (zip has no time zone; local time).
ZIP_DATE_TIME = (2024, 5, 20, 0, 0, 0)

# Forbidden assets (security audit): plus-only build inputs must not exist in
# the tree that is being built.
FORBIDDEN_DIRS_EXACT = [
    "edge-node/build/edge-toa",
    "edge-node/libs",
]
FORBIDDEN_DIR_NAMES = {"EdgeDNS", "EdgePlus"}
FORBIDDEN_FILE_GLOBS = ["*-plus.db", "build-all-plus.sh", "upload.sh"]
FORBIDDEN_VIEWS_ROOT = "edge-admin/web/views"
FORBIDDEN_VIEWS_GLOB = "*_plus.*"


def cmd_precheck(args):
    root = os.path.abspath(args.root)
    skip = {os.path.normcase(os.path.abspath(s)) for s in (args.skip or [])}
    problems = []

    for rel in FORBIDDEN_DIRS_EXACT:
        if os.path.lexists(os.path.join(root, rel)):
            problems.append("forbidden path exists: " + rel)

    for dirpath, dirnames, filenames in os.walk(root):
        # never descend into VCS metadata or the build output directory
        keep = []
        for d in sorted(dirnames):
            full = os.path.join(dirpath, d)
            if d == ".git" or os.path.normcase(os.path.abspath(full)) in skip:
                continue
            keep.append(d)
        dirnames[:] = keep

        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        for d in dirnames:
            if d in FORBIDDEN_DIR_NAMES:
                problems.append("forbidden directory: " + _join(rel_dir, d))
        for f in sorted(filenames):
            rel_file = _join(rel_dir, f)
            for pattern in FORBIDDEN_FILE_GLOBS:
                if fnmatch.fnmatchcase(f, pattern):
                    problems.append("forbidden file: " + rel_file)
            if (rel_dir == FORBIDDEN_VIEWS_ROOT or rel_dir.startswith(FORBIDDEN_VIEWS_ROOT + "/")) \
                    and fnmatch.fnmatchcase(f, FORBIDDEN_VIEWS_GLOB):
                problems.append("forbidden plus view: " + rel_file)

    if problems:
        for p in problems:
            print("PRECHECK FAIL: " + p, file=sys.stderr)
        return 1
    print("precheck: no forbidden assets found")
    return 0


def _join(rel_dir, name):
    return name if rel_dir in ("", ".") else rel_dir + "/" + name


def cmd_version(args):
    with open(args.const_go, encoding="utf-8") as fp:
        data = fp.read()
    # same expression as the upstream build scripts: first match wins
    m = re.search(r'Version[ ]+=[ ]+"([0-9.]+)"', data)
    if not m:
        print("could not find Version in " + args.const_go, file=sys.stderr)
        return 1
    print(m.group(1))
    return 0


def _is_executable(path):
    """0755 for ELF binaries and scripts with a shebang, 0644 otherwise."""
    if path.endswith(".sh"):
        return True
    with open(path, "rb") as fp:
        head = fp.read(4)
    return head == b"\x7fELF" or head[:2] == b"#!"


def cmd_zip(args):
    parent = os.path.abspath(args.src_parent)
    top = os.path.join(parent, args.name)
    if not os.path.isdir(top):
        print("not a directory: " + top, file=sys.stderr)
        return 1

    entries = []  # (arcname, fullpath or None for dirs)
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames.sort()
        rel = os.path.relpath(dirpath, parent).replace(os.sep, "/")
        entries.append((rel + "/", None))
        for f in sorted(filenames):
            full = os.path.join(dirpath, f)
            if os.path.islink(full):
                print("refusing to zip symlink: " + full, file=sys.stderr)
                return 1
            entries.append((rel + "/" + f, full))
    entries.sort(key=lambda e: e[0])

    out = os.path.abspath(args.out_zip)
    tmp = out + ".tmp"
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for arcname, full in entries:
            zi = zipfile.ZipInfo(arcname, date_time=ZIP_DATE_TIME)
            zi.create_system = 3  # unix, so external_attr carries the mode
            if full is None:
                zi.external_attr = ((stat.S_IFDIR | 0o755) << 16) | 0x10
                zi.compress_type = zipfile.ZIP_STORED
                zf.writestr(zi, b"")
            else:
                mode = 0o755 if _is_executable(full) else 0o644
                zi.external_attr = (stat.S_IFREG | mode) << 16
                zi.compress_type = zipfile.ZIP_DEFLATED
                with open(full, "rb") as fp:
                    zf.writestr(zi, fp.read(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    os.replace(tmp, out)
    print("zip: %s (%d entries)" % (out, len(entries)))
    return 0


def cmd_sha256(args):
    for f in args.files:
        h = hashlib.sha256()
        with open(f, "rb") as fp:
            for chunk in iter(lambda: fp.read(1 << 20), b""):
                h.update(chunk)
        print("%s  %s" % (h.hexdigest(), f))
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("precheck")
    s.add_argument("root")
    s.add_argument("--skip", action="append")
    s.set_defaults(func=cmd_precheck)

    s = sub.add_parser("version")
    s.add_argument("const_go")
    s.set_defaults(func=cmd_version)

    s = sub.add_parser("zip")
    s.add_argument("src_parent")
    s.add_argument("name")
    s.add_argument("out_zip")
    s.set_defaults(func=cmd_zip)

    s = sub.add_parser("sha256")
    s.add_argument("files", nargs="+")
    s.set_defaults(func=cmd_sha256)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
