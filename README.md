# Mass Unfollow

Find and unfollow inactive X/Twitter accounts.

**Note:** The web server version doesn't work because X blocks authenticated requests from datacenter IPs. Use the browser userscript instead — it runs directly in your browser using your IP.

## Installation (Tampermonkey)

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Open `mass-unfollow.user.js` in this repo
3. Copy the entire contents
4. In Tampermonkey, create a new script and paste the code
5. Save
6. Go to x.com — you'll see a blue button on the right side

## Usage

1. Open x.com and log in
2. Click the blue button on the right to open Mass Unfollow
3. Click "Load Following" and wait
4. Filter by tabs: All, No Tweets, Unknown, Inactive, Active
5. Set inactivity threshold (30/90/180/365 days)
6. Click accounts to select them
7. Click "Unfollow" to remove them

## Features

- Analyzes your following list
- Checks last tweet date for each account
- Categorizes: No Tweets, Unknown, Inactive, Active
- Bulk select and unfollow
- Rate limit handling (auto-pause and resume)
- All data stays in your browser

## How it works

Uses X's internal v1.1 REST API directly from your browser:

- `GET /1.1/friends/list.json` — your following list
- `GET /1.1/statuses/user_timeline.json` — last tweet date
- `POST /1.1/friendships/destroy.json` — unfollow

Since it runs in your browser, it uses your session cookies and IP address. No server needed.

## Web Server (not recommended)

The backend server at `/backend` exists but won't work for authenticated X API calls because X blocks datacenter IPs. It's included for reference only.

## Files

```
mass-unfollow.user.js  — Tampermonkey userscript (main file)
backend/               — Express server (reference only, auth issues)
frontend/              — React web app (reference only, auth issues)
```

## License

MIT
