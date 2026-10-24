#!/usr/bin/env python3
"""Preview a minimal Angular completion fix; --apply backs up before writing."""
import argparse
import difflib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true', help='back up ~/.zshrc, then apply the displayed fix')
args = parser.parse_args()
config = Path.home() / '.zshrc'
if config.is_symlink():
    parser.error('~/.zshrc is a symlink. Review its target manually; no files changed.')
original = config.read_text()
needle = 'source <(ng completion script)'
replacement = '''# PulseWatch: initialize zsh completion before Angular registers compdef.
if (( ! $+functions[compdef] )); then
  autoload -Uz compinit
  compinit
fi
if (( $+commands[ng] )); then
  source <(ng completion script)
fi'''
if '# PulseWatch: initialize zsh completion' in original:
    print('Completion fix is already installed; no files changed.')
    raise SystemExit(0)
lines = original.splitlines(keepends=True)
indices = [i for i, line in enumerate(lines) if line.strip() == needle]
if len(indices) != 1:
    parser.error('Expected exactly one Angular completion hook. Review ~/.zshrc manually; no files changed.')
lines[indices[0]] = replacement + '\n'
updated = ''.join(lines)
print(''.join(difflib.unified_diff(original.splitlines(True), updated.splitlines(True),
                                   fromfile=str(config), tofile=str(config) + ' (proposed)')))
with tempfile.NamedTemporaryFile(mode='w', suffix='.zsh', delete=False) as temporary:
    temporary.write(updated)
    test_file = Path(temporary.name)
try:
    subprocess.run(['/bin/zsh', '-n', str(test_file)], check=True)
finally:
    test_file.unlink()
if not args.apply:
    print('Preview only. Run again with --apply to create a backup and apply.')
    raise SystemExit(0)
if config.read_text() != original:
    parser.error('~/.zshrc changed during review; no files changed. Run again.')
backup = config.with_name('.zshrc.pulsewatch-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + str(os.getpid()))
# Copy must succeed before any modification to the original.
shutil.copy2(config, backup)
with tempfile.NamedTemporaryFile(mode='w', dir=config.parent, prefix='.zshrc-pulsewatch-', delete=False) as temporary:
    temporary.write(updated)
    pending = Path(temporary.name)
try:
    shutil.copystat(config, pending)
    os.replace(pending, config)
finally:
    pending.unlink(missing_ok=True)
print('Applied. Backup:', backup)
print('Open a new Terminal tab to verify. Restore if needed:')
print('cp -p ' + repr(str(backup)) + ' ' + repr(str(config)))
