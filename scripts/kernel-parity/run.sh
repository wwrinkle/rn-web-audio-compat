#!/usr/bin/env bash
# Desktop parity check of the C++ kernels against their JS processors (no device needed).
#   run.sh <jest test path that writes the refs> [extension files dir]
# The extension dir (e.g. rn-strudel's native/.../dsp/rnwac_ext) is compiled in as dsp/rnwac_ext, exactly as it is when
# installed into react-native-audio-api, so its kernels register through the same __has_include hook.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
COMPAT="$(cd "$HERE/../.." && pwd)"
TEST="${1:?usage: run.sh <jest test path> [extension files dir]}"
EXT="${2:-}"
OUT="${KERNEL_PARITY_OUT:-${TMPDIR:-/tmp}/rnwac-kernel-parity-$$}"
rm -rf "$OUT"
KERNEL_PARITY_OUT="$OUT" npx jest "$TEST" --silent
INC="$OUT/include"
mkdir -p "$INC/audioapi/dsp"
cp -r "$COMPAT/native/rnaa-0.13.5/files/common/cpp/audioapi/dsp/rnwac" "$INC/audioapi/dsp/"
SOURCES=("$INC/audioapi/dsp/rnwac/Kernels.cpp")
if [ -n "$EXT" ]; then
  cp -r "$EXT" "$INC/audioapi/dsp/rnwac_ext"
  while IFS= read -r f; do SOURCES+=("$f"); done < <(find "$INC/audioapi/dsp/rnwac_ext" -name '*.cpp')
fi
g++ -std=c++17 -O2 -Wall -I"$INC" "$HERE/parity.cpp" "${SOURCES[@]}" -o "$OUT/parity"
"$OUT/parity" "$OUT"
