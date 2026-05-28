#!/usr/bin/env python3
"""
Mass Unfollow - CLI Tool
Bulk unfollow inactive X/Twitter accounts.

Usage:
    # Dry run
    python mass_unfollow.py --auth-token TOKEN --ct0 CT0 --user-id ID --dry-run
    
    # Unfollow accounts inactive >90 days
    python mass_unfollow.py --auth-token TOKEN --ct0 CT0 --user-id ID
    
    # Using .env file
    python mass_unfollow.py
    
    # Web UI mode
    python server.py
"""

import asyncio
import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from core import TwikitClient, User


def print_summary(inactive: list, threshold: int, total_following: int):
    """Print summary of inactive accounts"""
    print(f"\n{'='*60}")
    print(f"📊 INACTIVE ACCOUNTS ({len(inactive)} found)")
    print(f"{'='*60}\n")
    
    sorted_users = sorted(inactive, key=lambda x: x.days_inactive or 999, reverse=True)
    
    print(f"{'#':>3} | {'@Username':<20} | {'Inactive':>10} | {'Tweets':>8}")
    print("-" * 55)
    
    for i, user in enumerate(sorted_users[:50], 1):
        days = f"{user.days_inactive}d" if user.days_inactive else "?"
        print(f"{i:>3} | @{user.screen_name:<19} | {days:>10} | {user.statuses_count:>8}")
    
    if len(sorted_users) > 50:
        print(f"\n... +{len(sorted_users) - 50} more")
    
    print(f"\n{'='*60}")
    print(f"Total following: {total_following}")
    print(f"Inactive (>{threshold}d): {len(inactive)}")
    print(f"{'='*60}\n")


async def progress_callback(data: dict):
    """Handle progress updates for CLI"""
    phase = data.get('phase', '')
    progress = data.get('progress', 0)
    total = data.get('total', 0)
    message = data.get('message', '')
    
    if total > 0:
        percent = int((progress / total) * 100)
        bar_len = 40
        filled = int(bar_len * progress / total)
        bar = '█' * filled + '░' * (bar_len - filled)
        print(f'\r[{bar}] {percent}% — {message}', end='', flush=True)
    else:
        print(f'\r{message}', end='', flush=True)


async def run_cli(args):
    """Run CLI mode"""
    print(f"\n{'='*60}")
    print(f"🐦 MASS UNFOLLOW - CLI Mode")
    print(f"{'='*60}")
    print(f"Threshold: >{args.days} days")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"{'='*60}\n")
    
    # Initialize client
    client = TwikitClient(
        auth_token=args.auth_token,
        ct0=args.ct0,
        user_id=args.user_id
    )
    
    # Fetch following
    print("📥 Fetching following list...")
    await client.fetch_following(callback=progress_callback, page_size=200)
    print(f"\n✅ Fetched {len(client.session.following)} accounts")
    
    # Enrich activity
    print(f"\n🔍 Checking activity (>{args.days} days threshold)...")
    inactive = await client.enrich_activity(
        days_threshold=args.days,
        callback=progress_callback
    )
    print(f"\n✅ Found {len(inactive)} inactive accounts")
    
    if not inactive:
        print("\n✅ No inactive accounts found!")
        return
    
    # Print summary
    print_summary(inactive, args.days, len(client.session.following))
    
    # Save results if requested
    if args.output:
        output = {
            'timestamp': datetime.now().isoformat(),
            'threshold_days': args.days,
            'total_following': len(client.session.following),
            'inactive_count': len(inactive),
            'dry_run': args.dry_run,
            'accounts': [u.to_dict() for u in inactive]
        }
        with open(args.output, 'w') as f:
            json.dump(output, f, indent=2)
        print(f"💾 Results saved to {args.output}\n")
    
    # Unfollow
    if not args.dry_run:
        print(f"⚠️ This will unfollow {len(inactive)} accounts!")
        if not args.yes:
            confirm = input("\nType 'yes' to confirm: ")
            if confirm.lower() != 'yes':
                print("❌ Cancelled")
                return
        
        print(f"\n🚀 Starting unfollow...")
        result = await client.unfollow_all(callback=progress_callback)
        
        print(f"\n{'='*60}")
        print(f"📊 RESULTS")
        print(f"{'='*60}")
        print(f"Unfollowed: {result['success']}")
        print(f"Failed: {result['failed']}")
        print(f"Total: {result['total']}")
        print(f"{'='*60}\n")
    else:
        print("💡 DRY RUN — No accounts were unfollowed")
        print("   Run without --dry-run to unfollow\n")


def main():
    parser = argparse.ArgumentParser(
        description='Mass Unfollow - Unfollow inactive X/Twitter accounts',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    # Credentials
    cred = parser.add_argument_group('credentials')
    cred.add_argument('--auth-token', default=os.getenv('AUTH_TOKEN1') or os.getenv('AUTH_TOKEN'),
                      help='X auth_token cookie')
    cred.add_argument('--ct0', default=os.getenv('CT0_1') or os.getenv('CT0'),
                      help='X ct0 cookie')
    cred.add_argument('--user-id', default=os.getenv('USER_ID'),
                      help='Your X user ID (from twid cookie)')
    
    # Options
    parser.add_argument('--days', type=int, default=90,
                        help='Inactivity threshold in days (default: 90)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show inactive accounts without unfollowing')
    parser.add_argument('--yes', '-y', action='store_true',
                        help='Auto-confirm unfollow without prompt')
    parser.add_argument('--output', '-o',
                        help='Save results to JSON file')
    
    # Web mode
    parser.add_argument('--web', action='store_true',
                        help='Start web server instead of CLI')
    parser.add_argument('--host', default='0.0.0.0',
                        help='Web server host (default: 0.0.0.0)')
    parser.add_argument('--port', type=int, default=8777,
                        help='Web server port (default: 8777)')
    
    args = parser.parse_args()
    
    # Web mode
    if args.web:
        import uvicorn
        print(f"🚀 Starting web server on http://{args.host}:{args.port}")
        uvicorn.run("server:app", host=args.host, port=args.port, reload=True)
        return
    
    # CLI mode - validate credentials
    if not args.auth_token or not args.ct0 or not args.user_id:
        print("ERROR: Missing credentials!")
        print("\nRequired: --auth-token, --ct0, --user-id")
        print("\nGet these from x.com cookies:")
        print("1. Open x.com → F12 → Application → Cookies → x.com")
        print("2. Copy auth_token, ct0, and twid (user ID)")
        print("\nOr set in .env file (see .env.example)")
        sys.exit(1)
    
    asyncio.run(run_cli(args))


if __name__ == '__main__':
    main()
