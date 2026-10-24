#!/bin/bash
# Sourced by our bash launchers. These changes affect only their child processes.
set -euo pipefail
PULSEWATCH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/opt/homebrew/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

pulsewatch_java21() {
  local candidate="" detected=""
  for candidate in "${JAVA_HOME:-}" /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home /Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home; do
    if [[ -n "$candidate" && -x "$candidate/bin/java" ]]; then
      detected="$("$candidate/bin/java" -version 2>&1)"
      if [[ "$detected" == *'version "21.'* || "$detected" == *'version "21"'* ]]; then
        export JAVA_HOME="$candidate"
        export PATH="$JAVA_HOME/bin:$PATH"
        return 0
      fi
    fi
  done
  candidate="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
  if [[ -n "$candidate" && -x "$candidate/bin/java" ]]; then
    detected="$("$candidate/bin/java" -version 2>&1)"
    if [[ "$detected" == *'version "21.'* || "$detected" == *'version "21"'* ]]; then
      export JAVA_HOME="$candidate"
      export PATH="$JAVA_HOME/bin:$PATH"
      return 0
    fi
  fi
  echo 'Java 21 is missing. Run: bash scripts/setup-mac.sh' >&2
  return 1
}

pulsewatch_maven() {
  if command -v mvn >/dev/null 2>&1; then
    PULSEWATCH_MVN="$(command -v mvn)"
  elif [[ -x '/Applications/IntelliJ IDEA.app/Contents/plugins/maven/lib/maven3/bin/mvn' ]]; then
    PULSEWATCH_MVN='/Applications/IntelliJ IDEA.app/Contents/plugins/maven/lib/maven3/bin/mvn'
  elif [[ -x "$HOME/Applications/IntelliJ IDEA.app/Contents/plugins/maven/lib/maven3/bin/mvn" ]]; then
    PULSEWATCH_MVN="$HOME/Applications/IntelliJ IDEA.app/Contents/plugins/maven/lib/maven3/bin/mvn"
  else
    echo 'Maven not found. Install it only if IntelliJ no longer supplies it: brew install maven' >&2
    return 1
  fi
}

pulsewatch_env() {
  cd "$PULSEWATCH_ROOT"
  if [[ ! -e .env ]]; then cp -n .env.example .env; fi
  set -a
  source .env
  set +a
}
