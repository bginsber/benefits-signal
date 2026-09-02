#!/bin/zsh
# Install (or reinstall) the weekly Benefits Signal run as a macOS launchd agent.
# Runs scripts/weekly.sh every Tuesday at 18:00 local time, ahead of the Wednesday issue.
# Usage: scripts/install-schedule.sh [--uninstall]
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.benefits-signal.weekly"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"; echo "removed $LABEL"; exit 0
fi
NODE_DIR="$(dirname "$(command -v node)")"
CLAUDE_DIR="$(dirname "$(command -v claude)")"
mkdir -p "$HOME/Library/LaunchAgents" "$REPO/data/logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$REPO/scripts/weekly.sh</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict>
    <key>BENEFITS_SIGNAL_PATH</key><string>$NODE_DIR:$CLAUDE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$REPO/data/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$REPO/data/logs/launchd.err.log</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL → Tuesdays 18:00 local; node from $NODE_DIR, claude from $CLAUDE_DIR"
echo "run now:  launchctl kickstart -k gui/$(id -u)/$LABEL"
echo "logs:     $REPO/data/logs/"
