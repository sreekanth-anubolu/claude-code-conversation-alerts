# Conversation Alerts for Claude Code

Running several Claude Code conversations in VS Code? Conversation Alerts tells you the moment one needs you, and takes you straight to that conversation.

> Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.

- 🚨 **Needs input** (permission prompt, question, MCP form): a siren, and an alert naming the project and the conversation.
- ✓ **Finished**, your turn: a softer sound and alert. Skipped if you're already looking at that conversation.
- **Open conversation** brings up the right VS Code window and opens that exact conversation in the Claude Code chat panel, even across several windows.
- **In VS Code** you get a VS Code notification. **In another app** you get a macOS banner instead, never both.
- **Status bar**: `🔔 2 waiting ✓ 1`. Click it to list conversations and jump to one, or to mute sounds for an hour.
- **Repeats** the siren about every 2 minutes while something is still waiting, and clears as soon as you answer.
- Subagents never alert. The hooks run in the background, so Claude is never slowed down.

Works on macOS with VS Code and the Claude Code VS Code extension 2.1.233 or newer.

## Install

    git clone https://github.com/sreekanth-anubolu/claude-code-conversation-alerts.git
    cd claude-code-conversation-alerts
    ./install.sh

`install.sh` also works from the unzipped `conversation-alerts.zip` package (see [Build from source](#build-from-source)).

Then reload every VS Code window (Cmd+Shift+P → **Developer: Reload Window**).

For banners you can click, also run `brew install terminal-notifier` and allow its notifications in System Settings → Notifications.

## Uninstall

    ./uninstall.sh

## Good to know

- Install adds five hooks to `~/.claude/settings.json`, backs the file up first, and keeps all your other settings and hooks. If the file isn't valid JSON, it changes nothing.
- Everything lives in `~/.claude/conversation-alerts/`. Nothing is added to any project.
- If you deny a permission prompt, the alert stays until Claude replies or you send a message, because Claude Code sends no hook for a denial.
- **Open conversation** uses an undocumented command of the Claude Code extension. If an update breaks it, the alerts still work.
- If macOS blocks the scripts as downloaded from the internet: `xattr -dr com.apple.quarantine conversation-alerts`

## How it works

1. A Python hook (`notify.py`) runs on `Notification`, `Stop`, `UserPromptSubmit`, `PostToolUse` and `SessionEnd`. It appends what each conversation needs to `~/.claude/conversation-alerts/events.jsonl`.
2. Each VS Code window registers its open folders and whether it's focused. If a window is focused, the hook leaves the alert to it. Otherwise the hook shows a macOS banner and plays the sound.
3. The VS Code extension in every window reads the event log. It shows the alert, keeps the status-bar list, and repeats the siren.
4. **Open conversation** finds the window whose folder contains the conversation's project. It raises that window and opens the conversation through the Claude Code extension.

## Build from source

    ./build.sh

This writes `dist/conversation-alerts.vsix` and `dist/conversation-alerts.zip`, the package with the install script. No Node or npm needed.

## Inspired by

[dimokol/claude-notifications](https://github.com/dimokol/claude-notifications), [ryuk2098/claude-code-notify](https://github.com/ryuk2098/claude-code-notify), [Tri9ster/hooknotice](https://github.com/Tri9ster/hooknotice) and [zekunyan/claude-code-notifier-plus](https://github.com/zekunyan/claude-code-notifier-plus).

## License

[MIT](LICENSE)
