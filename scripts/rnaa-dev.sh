#!/usr/bin/env bash
# Maintainer tool for native/rnaa-0.13.5/rnaa.patch (the edits this library makes to react-native-audio-api's own files).
#   scripts/rnaa-dev.sh checkout   # native/.work = pristine react-native-audio-api 0.13.5 (a git repo) + the current patch
#   (edit files under native/.work)
#   scripts/rnaa-dev.sh regen      # rewrite rnaa.patch from native/.work (new files belong in native/rnaa-0.13.5/files)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/native/.work"
PATCH="$ROOT/native/rnaa-0.13.5/rnaa.patch"
case "${1:-}" in
  checkout)
    rm -rf "$WORK" && mkdir -p "$WORK"
    (cd "$WORK" && npm pack react-native-audio-api@0.13.5 --silent >/dev/null && tar xzf react-native-audio-api-0.13.5.tgz && rm react-native-audio-api-0.13.5.tgz)
    cd "$WORK/package"
    git init -q && git add -A && git -c user.name=pristine -c user.email=pristine@localhost commit -qm pristine
    git apply -p1 "$PATCH"
    echo "native/.work/package: pristine + rnaa.patch ($(git diff --stat | tail -1))"
    ;;
  regen)
    cd "$WORK/package"
    git diff > "$PATCH.tmp"
    n=$(grep -c '^diff --git' "$PATCH.tmp" || true)
    [ "$n" -gt 0 ] || { rm "$PATCH.tmp"; echo "no changes found; patch left untouched" >&2; exit 1; }
    mv "$PATCH.tmp" "$PATCH"
    echo "rnaa.patch: $n files"
    ;;
  *) echo "usage: $0 checkout|regen" >&2; exit 2 ;;
esac
