# X Unfollower — Chrome Extension

Browser extension untuk mass unfollow akun inactive di X/Twitter. Runs entirely in your browser — no server needed.

## Install

```bash
# Clone repo
git clone https://github.com/exd77/mass-unfollow.git
cd mass-unfollow/extension

# Or just download the extension/ folder directly
```

Then in Chrome:
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

Extension icon appears in toolbar.

## Usage (Auto-Detect)

**That's it — no credentials needed!**

1. Make sure you're logged into x.com in Chrome
2. Click the extension icon
3. It auto-detects your session from browser cookies
4. Click **Fetch Following**

The extension reads `auth_token` and `ct0` directly from your x.com cookies.

## Manual Mode

If auto-detect doesn't work (cookies blocked, incognito, etc.):

1. Press **F12** on x.com → **Application** → **Cookies** → `x.com`
2. Copy `auth_token` and `ct0`
3. Paste into extension and click **Save**

## Inactivity Threshold

| Days | Behavior |
|------|----------|
| 30 | Aggressive — removes recent inactive |
| 90 | Default — good balance |
| 180 | Conservative — only long-term inactive |
| 365 | Ultra-conservative — year+ silent |

## Notes

- X rate-limits unfollows ~1/second
- Too many actions = temporary block (wait 15-30 min)
- Credentials stored locally in browser (chrome.storage)
- No external requests — runs 100% client-side
- Works from your browser IP (no datacenter blocking)

## Project Structure

```
extension/
├── manifest.json      # Chrome Extension Manifest V3
├── popup.html         # Extension popup UI
├── popup.css          # Mac Classic theme
├── popup.js           # Fetch/unfollow logic
├── background.js      # Service worker
├── icons/             # Extension icons
└── README.md
```
