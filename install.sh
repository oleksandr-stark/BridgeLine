#!/bin/bash
# Installs the built panel into After Effects (asks for your password). Then reopen Window > BridgeLine.jsx.
#   ./install.sh                                      newest release build (or $AE_APP)
#   ./install.sh beta                                 After Effects (Beta)
#   ./install.sh all                                  every After Effects found
#   ./install.sh "/Applications/Adobe After Effects 2025"
set -e
cd "$(dirname "$0")"
BETA="/Applications/Adobe After Effects (Beta)"
case "${1:-}" in
  beta) TARGETS=("$BETA") ;;
  all)  TARGETS=(/Applications/Adobe\ After\ Effects\ 20* "$BETA") ;;
  "")   TARGETS=("${AE_APP:-$(ls -d /Applications/Adobe\ After\ Effects\ 20* | sort | tail -1)}") ;;
  *)    TARGETS=("$1") ;;
esac
for AE in "${TARGETS[@]}"; do
  if [ ! -d "$AE/Scripts/ScriptUI Panels" ]; then echo "skip (not found): $AE"; continue; fi
  sudo install -m 644 BridgeLine.jsx "$AE/Scripts/ScriptUI Panels/"
  echo "Installed into: $AE/Scripts/ScriptUI Panels/BridgeLine.jsx"
done
