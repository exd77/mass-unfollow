# Mass Unfollow

Find and unfollow inactive X/Twitter accounts. Two versions available:

1. **Twikit CLI** (recommended) — Python script using Twikit library
2. **Tampermonkey userscript** — Browser-based, runs in your browser

## Quick Start (Twikit CLI)

```bash
# Install dependencies
pip install twikit python-dotenv

# Create .env file with your cookies
cp .env.example .env
# Edit .env with your auth_token and ct0 from x.com

# Dry run - see inactive accounts without unfollowing
python mass_unfollow.py --dry-run

# Unfollow inactive accounts (>90 days)
python mass_unfollow.py

# Custom threshold
python mass_unfollow.py --days 180

# Save results to file
python mass_unfollow.py --output results.json
```

### How to Get Your Cookies

1. Open [x.com](https://x.com) in Chrome/Firefox
2. Press F12 to open DevTools
3. Go to **Application** → **Cookies** → `https://x.com`
4. Find `auth_token` and `ct0`
5. Copy values to `.env` file

### Twikit CLI Options

```
--auth-token    X auth_token cookie (or set AUTH_TOKEN env var)
--ct0           X ct0 cookie (or set CT0 env var)
--days          Days threshold for inactivity (default: 90)
--dry-run       Show inactive accounts but don't unfollow
--output, -o    Save results to JSON file
```

## Browser Userscript (Alternative)

If Twikit doesn't work due to IP blocking, use the Tampermonkey userscript:

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Create new script, copy `mass-unfollow.user.js`
3. Open x.com, click the blue button

## How It Works

- Uses [Twikit](https://github.com/driesroyston/twikit) — Python library for X API
- Authenticates via cookies (auth_token + ct0), no password needed
- Fetches your following list (paginated)
- Checks last tweet date for each account
- Filters accounts inactive > threshold days
- Bulk unfollows with rate limit handling

## Files

```
mass_unfollow.py       — Twikit CLI tool (main)
mass-unfollow.user.js  — Tampermonkey userscript (browser alternative)
.env.example           — Template for cookies
```

## License

MIT
