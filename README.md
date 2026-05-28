# Mass Unfollow - Production Build
## CLI + Web Interface

Bulk unfollow inactive X/Twitter accounts via CLI or Web UI.

### Features
- **CLI Mode**: Terminal-based with full automation support
- **Web UI**: Browser interface with real-time progress
- **Twikit Backend**: Direct X API via cookies (auth_token + ct0)
- **Rate Limit Handling**: Auto-pause and resume on rate limits

### Quick Start

```bash
# Install dependencies
pip install twikit python-dotenv fastapi uvicorn

# CLI Mode - Dry run
python mass_unfollow.py --auth-token TOKEN --ct0 CT0 --user-id ID --dry-run

# CLI Mode - Unfollow
python mass_unfollow.py --auth-token TOKEN --ct0 CT0 --user-id ID --days 90

# Web UI Mode
python server.py

# Then open http://localhost:8777
```

### Project Structure

```
mass-unfollow/
├── mass_unfollow.py       # CLI tool
├── server.py              # Web server (FastAPI)
├── web/
│   ├── index.html         # Frontend UI
│   ├── style.css          # Styles
│   └── app.js             # Frontend logic
├── core/
│   ├── __init__.py
│   ├── client.py          # Twikit wrapper
│   └── models.py          # Data models
├── .env.example
└── README.md
```

### Credentials

Get from x.com cookies (F12 → Application → Cookies):
- `auth_token` - Session token
- `ct0` - CSRF token  
- `twid` - User ID (format: u%3D123456789 → 123456789)
