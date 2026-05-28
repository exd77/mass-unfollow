# Mass Unfollow

Bulk unfollow inactive X/Twitter accounts. Three ways to run: CLI, Web UI, or Chrome Extension.

## Features

- **CLI Mode** — Terminal-based, full automation support
- **Web UI** — Browser interface with real-time progress
- **Chrome Extension** — Runs in browser, no server needed
- **Twikit Backend** — Direct X API via cookies (auth_token + ct0)
- **Rate Limit Handling** — Auto-pause and resume

## Quick Start

### Option 1: Chrome Extension (Easiest)

```bash
# Clone repo
git clone https://github.com/exd77/mass-unfollow.git

# Load extension in Chrome
# 1. chrome://extensions → Developer mode
# 2. Load unpacked → select mass-unfollow/extension/
# 3. Make sure you're logged into x.com
# 4. Click extension icon — auto-detects your session!
```

See [extension/README.md](extension/README.md) for details.

### Option 2: CLI

```bash
# Install dependencies
pip install twikit python-dotenv

# Dry run first
python mass_unfollow.py --auth-token TOKEN --ct0 CT0 --user-id ID --dry-run

# Unfollow inactive (90+ days)
python mass_unfollow.py --auth-token TOKEN --ct0 CT0 --user-id ID --days 90

# Skip confirmation
python mass_unfollow.py --auth-token TOKEN --ct0 CT0 --user-id ID --days 90 --yes
```

### Option 3: Web UI

```bash
# Install dependencies
pip install twikit fastapi uvicorn

# Start server
python server.py --host 0.0.0.0 --port 3002

# Open http://localhost:3002
```

## Get Credentials

From x.com cookies (F12 → Application → Cookies):

| Cookie | Description |
|--------|-------------|
| `auth_token` | Session token |
| `ct0` | CSRF token |
| `twid` | User ID (extract number from `u%3D123456789`) |

## Project Structure

```
mass-unfollow/
├── extension/              # Chrome Extension
│   ├── manifest.json
│   ├── popup.html/css/js
│   └── background.js
├── web/                    # Web UI
│   ├── index.html
│   ├── style.css
│   └── app.js
├── core/                   # Python backend
│   ├── client.py           # Twikit wrapper
│   └── models.py           # Data models
├── mass_unfollow.py        # CLI tool
├── server.py               # Web server (FastAPI)
├── mass-unfollow.user.js   # Tampermonkey userscript
└── README.md
```

## Comparison

| Method | Setup | Best For |
|--------|-------|----------|
| Extension | Load unpacked | Quick use, no terminal |
| CLI | pip install | Automation, scripts |
| Web UI | pip install | Visual feedback, shared access |

## Notes

- X rate-limits unfollows (~1/sec)
- Temporary blocks if too many actions → wait 15-30 min
- Datacenter IPs may get blocked — extension runs from your browser IP
- Credentials stored locally, never sent to external servers
