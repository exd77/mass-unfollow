# Mass Unfollow

A web app for cleaning up your X/Twitter following list. Finds inactive accounts and lets you unfollow them in bulk.

Built with a classic Macintosh UI because why not.

## Setup

```bash
# Install dependencies
cd frontend && npm install
cd ../backend && npm install

# Build frontend for production
cd frontend && npm run build

# Start the server
cd ../backend && npm start
```

Server runs on port 3000 by default. Change with `PORT=xxxx npm start`.

## Usage

1. Open the app in your browser
2. Paste your X session cookies (auth_token and ct0 from browser DevTools)
3. Hit "Load Following" and wait
4. Filter by inactivity threshold
5. Select accounts to unfollow
6. Click Unfollow

That's it.

## How it works

Uses X's internal v1.1 REST API. Same endpoints the website uses, nothing fancy.

- `/1.1/friends/list.json` — get your following list
- `/1.1/statuses/user_timeline.json` — check when they last posted
- `/1.1/friendships/destroy.json` — unfollow

Rate limits are handled automatically. It pauses when needed and resumes.

## Getting your session cookies

1. Open x.com in your browser and log in
2. Open DevTools (F12)
3. Go to Application > Cookies
4. Copy `auth_token` and `ct0`

Don't share these with anyone. They're basically your login session.

## Tech stack

- React + Vite on the frontend
- Express on the backend  
- No database, no external services, no telemetry
- CSS is custom, no frameworks

## Self-hosting

Works fine on any VPS. Just open port 3000 in your firewall.

For production you probably want nginx in front with HTTPS. That's on you.

## Notes

- Large following lists (5000+) take a while. Be patient.
- Protected accounts can't be checked for activity.
- X might rate limit you if you unfollow too aggressively. Keep the delays in.
- This uses internal APIs that could break if X decides to change them.

## License

MIT. Do whatever you want with it.
