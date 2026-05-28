# Mass Unfollow

Bulk unfollow inactive X/Twitter accounts using Twikit.

## Requirements

```bash
pip install twikit python-dotenv
```

## Getting Your Credentials

1. Open [x.com](https://x.com) in Chrome/Firefox
2. Press **F12** → **Application** → **Cookies** → `https://x.com`
3. Copy these 3 values:

| Cookie | Example | Description |
|--------|---------|-------------|
| `auth_token` | `46e6dbb656e552...` | Your session token |
| `ct0` | `b27b788bd5a4ba...` | CSRF token |
| `twid` | `u%3D1234567890` | **User ID** is after `u%3D` |

Example: `twid=u%3D1789423657` → User ID = `1789423657`

## Setup .env

```bash
cp .env.example .env
```

Edit `.env`:
```
AUTH_TOKEN1=your_auth_token
CT0_1=your_ct0
USER_ID=your_user_id
```

## Usage

```bash
# Dry run - see inactive accounts
python mass_unfollow.py --dry-run

# Unfollow accounts inactive >90 days
python mass_unfollow.py

# Custom threshold
python mass_unfollow.py --days 180

# Direct args (no .env needed)
python mass_unfollow.py --auth-token TOKEN --ct0 CT0 --user-id ID

# Save results
python mass_unfollow.py --output results.json
```

## Options

| Flag | Description |
|------|-------------|
| `--auth-token` | X auth_token cookie |
| `--ct0` | X ct0 cookie |
| `--user-id` | Your X user ID (from twid cookie) |
| `--days` | Inactivity threshold in days (default: 90) |
| `--dry-run` | Show inactive accounts without unfollowing |
| `--output` | Save results to JSON file |

## How It Works

1. Authenticates with X via cookies using [Twikit](https://github.com/driesroyston/twikit)
2. Fetches your following list (paginated, 200 per page)
3. Checks last tweet date for each account
4. Filters accounts inactive > threshold
5. Unfollows selected accounts with rate limit handling

## Files

```
mass_unfollow.py       — Main CLI tool
mass-unfollow.user.js  — Browser alternative (Tampermonkey)
.env.example           — Credential template
```
