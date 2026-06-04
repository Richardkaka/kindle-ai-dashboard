# Kindle AI Coding Dashboard

A low-refresh e-ink dashboard for jailbroken Kindle devices. It renders a local web page on macOS, captures a `758x1024` PNG with Chromium, converts it to Kindle-friendly grayscale, then pushes and displays it on the Kindle over USB or SSH.

The current dashboard includes:

- Codex usage status, filled manually for now.
- Claude Code usage status, filled manually for now.
- Weather, using `wttr.in` first and Open-Meteo as fallback.
- Todos and break reminders from local files/config.

The layout is tuned for Kindle Paperwhite 2, but the render size can be adapted for other e-ink devices.

## Requirements

- macOS
- Node.js 18+
- Python 3
- A Kindle that can either be mounted over USB or reached over SSH
- For full-screen automatic refresh: a jailbroken Kindle with `eips` available, such as a KOReader/KUAL setup

## Setup

```bash
npm install
cp config.example.json config.json
cp todos.example.md todos.md
```

Edit `config.json` and `todos.md` for your own city, quota text, reset time, break rhythm, and todo list.

## Local Preview

```bash
npm start
```

The server prints a LAN URL, for example:

```text
LAN: http://192.168.1.100:8787
```

Useful pages:

- `http://127.0.0.1:8787/d` dashboard render target
- `http://127.0.0.1:8787/c` clean white page for reducing e-ink ghosting

## Render PNG

```bash
npm run render
```

Output:

```text
output/dashboard.png
```

The render script starts a temporary local server when needed, screenshots `/d`, then post-processes the PNG into grayscale so Kindle `eips` displays it correctly.

## USB Sync

Mount the Kindle over USB, then run:

```bash
npm run sync
```

By default this copies the image to:

```text
/Volumes/Kindle/documents/dashboard.png
```

If your Kindle volume path is different:

```bash
KINDLE_VOLUME=/Volumes/Kindle npm run sync
```

USB sync is useful for quick testing, but a mounted Kindle is usually in USB storage mode and cannot display with KOReader at the same time.

## SSH Push

If SSH is enabled on the Kindle and your Mac can reach it over Wi-Fi:

```bash
KINDLE_HOST=<KINDLE_IP> KINDLE_PORT=2222 npm run push:ssh
```

This does three things:

1. Render `output/dashboard.png`
2. Copy it to `/mnt/us/documents/dashboard.png`
3. Refresh the Kindle screen with `eips`

Optional environment variables:

```bash
KINDLE_USER=root
KINDLE_IDENTITY=~/.ssh/id_ed25519
KINDLE_REMOTE_TARGET=/mnt/us/documents/dashboard.png
```

Useful individual commands:

```bash
KINDLE_HOST=<KINDLE_IP> KINDLE_PORT=2222 npm run sync:ssh
KINDLE_HOST=<KINDLE_IP> KINDLE_PORT=2222 npm run display:ssh
```

## Automatic Refresh

Foreground loop:

```bash
KINDLE_HOST=<KINDLE_IP> KINDLE_PORT=2222 SYNC_INTERVAL_MINUTES=30 npm run auto:ssh
```

macOS LaunchAgent:

```bash
KINDLE_HOST=<KINDLE_IP> KINDLE_PORT=2222 SYNC_INTERVAL_MINUTES=30 npm run service:install
```

Uninstall:

```bash
npm run service:uninstall
```

Logs are written to:

```text
logs/launchd.out.log
logs/launchd.err.log
```

## Configuration

`config.json` controls:

- `server.refreshMinutes`
- `display.title` and `display.timezone`
- `location.label`, `location.query`, `location.latitude`, `location.longitude`
- `codex.remaining`, `codex.resetAt`, `codex.note`
- `claude.remaining`, `claude.resetAt`, `claude.note`
- `breakReminder.workMinutes`, `breakReminder.breakMinutes`, `breakReminder.dayStart`, `breakReminder.dayEnd`

`todos.md` supports GitHub-style checkboxes:

```markdown
- [ ] Unfinished task
- [x] Finished task
```

Only the first six todo items are shown.

## Kindle Notes

- Use a fixed DHCP reservation for your Kindle to avoid changing `KINDLE_HOST`.
- A 30 minute or longer refresh interval is friendlier to battery life.
- E-ink ghosting is normal. A full `eips -c` clear is run before drawing the dashboard.
- Keep personal files such as `config.json`, `todos.md`, generated `output/`, and `logs/` out of Git.

## License

MIT
