#!/usr/bin/env bash
# Compatibility entry point for v1.0 updater calls.
set -euo pipefail
exec bash "$(dirname -- "${BASH_SOURCE[0]}")/setup-linux.sh" "$@"
