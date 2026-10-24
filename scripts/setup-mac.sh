#!/bin/bash
# Run in a normal macOS Terminal. Installs only missing Java 21 and Docker Desktop.
set -euo pipefail
source "$(dirname "$0")/mac-common.sh"
if [[ "$(uname -m)" != arm64 ]]; then
  echo 'This setup targets native Apple Silicon. Open Terminal without Rosetta and run again.' >&2
  exit 1
fi
if [[ ! -x /opt/homebrew/bin/brew ]]; then
  echo 'Native Homebrew is missing. Install it from https://brew.sh and run again.' >&2
  exit 1
fi
# Docker's installer may add its CLI path to shell settings. Back up before either installer runs.
PULSEWATCH_BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
for config in "$HOME/.zshrc" "$HOME/.zprofile"; do
  if [[ -f "$config" ]]; then
    backup="${config}.pulsewatch-before-setup-${PULSEWATCH_BACKUP_STAMP}"
    cp -p "$config" "$backup"
    echo "Shell backup: $backup"
  fi
done
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_UPGRADE=1
if pulsewatch_java21 2>/dev/null; then
  echo "Keeping Java 21: $JAVA_HOME"
else
  /opt/homebrew/bin/brew install --cask temurin@21
  pulsewatch_java21
fi
if [[ -d /Applications/Docker.app || -d "$HOME/Applications/Docker.app" ]]; then
  echo 'Keeping existing Docker Desktop.'
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo 'Keeping existing working Docker engine.'
else
  /opt/homebrew/bin/brew install --cask docker-desktop
fi
pulsewatch_maven
"$JAVA_HOME/bin/java" -version
"$PULSEWATCH_MVN" -version
node -v
npm -v
if [[ -d /Applications/Docker.app ]]; then
  open /Applications/Docker.app
elif [[ -d "$HOME/Applications/Docker.app" ]]; then
  open "$HOME/Applications/Docker.app"
fi
cat <<'EOF'
In Docker Desktop, accept the terms and finish setup if asked.
Approve the macOS installer/password prompts if shown.
Wait until Docker Desktop shows that the engine is running.
Then run: bash scripts/run-local.sh check
This script backs up existing shell settings before installers run.
It does not itself edit them and does not reinstall Node.js or Maven.
EOF
