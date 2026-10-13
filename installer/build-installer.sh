#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-$ROOT/../windows-installer.exe}"
makensis -DSOURCE_DIR="$ROOT" -DOUTPUT_FILE="$OUTPUT" "$ROOT/installer/hostman.nsi"
