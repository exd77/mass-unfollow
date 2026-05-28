#!/usr/bin/env python3
"""
Mass Unfollow - Twikit Edition
Bulk unfollow inactive X/Twitter accounts using Twikit library.

Usage:
    python mass_unfollow.py --auth-token YOUR_AUTH_TOKEN --ct0 YOUR_CT0
    python mass_unfollow.py --dry-run
    python mass_unfollow.py --days 90
"""

import asyncio
import argparse
import json
import os
import sys
import time
import re
from datetime import datetime, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / '.env')
except ImportError:
    pass

try:
    from twikit import Client
except ImportError:
    print("ERROR: twikit not installed. Run: pip install twikit")
    sys.exit(1)


# ===== CONFIG =====
CHECK_DELAY = 1.5
UNFOLLOW_DELAY = 2.0
FETCH_PAGE_SIZE = 200
ENRICH_BATCH_SIZE = 5
MAX_RETRIES = 3


class MassUnfollow:
    def __init__(self, auth_token: str, ct0: str, dry_run: bool = False, 
                 days_threshold: int = 90, output_file: str = None):
        self.auth_token = auth_token
        self.ct0 = ct0
        self.dry_run = dry_run
        self.days_threshold = days_threshold
        self.output_file = output_file
        self.client = None
        self.following = []
        self.my_user_id = None
        self.my_username = None
        
    def log(self, msg: str):
        ts = datetime.now().strftime('%H:%M:%S')
        print(f"[{ts}] {msg}")
        
    async def authenticate(self):
        """Authenticate with X using auth_token and ct0 cookies"""
        self.client = Client('en-US')
        self.client.set_cookies({
            'auth_token': self.auth_token,
            'ct0': self.ct0
        })
        
        # Get our own user ID from twid cookie
        # twid cookie format: u%3D123456789 (URL encoded u=<user_id>)
        twid_match = re.search(r'twid=u%3D(\d+)', self.auth_token)
        if not twid_match:
            # Try to find in ct0 (sometimes twid is stored differently)
            # Actually twid is a separate cookie - let's try another way
            pass
            
        # Alternative: Use the API to get our credentials
        # Twikit might not expose this directly, so let's try getting user by screen name
        # First, let's try to extract from a test API call
        
        # Try to find our user ID by making a request
        try:
            # The simplest way: check who we're following and find ourselves
            # Actually, let's just require user_id input or extract from cookie
            self.log("✅ Twikit client initialized")
        except Exception as e:
            self.log(f"⚠️ Auth warning: {e}")
            
        return True

    async def get_own_user_id(self) -> str:
        """Get our own user ID"""
        # Method 1: From cookies (twid=u%3D123456...)
        # We need to get the twid cookie from the client
        try:
            # Access client's cookies
            cookies = self.client.cookies if hasattr(self.client, 'cookies') else {}
            
            # Try to get twid from various sources
            for cookie_name in ['twid', 'twid_u']:
                if cookie_name in cookies:
                    val = cookies[cookie_name]
                    if 'u%3D' in val:
                        return val.split('u%3D')[1].split('&')[0]
        except:
            pass
            
        # Method 2: Use verify_credentials or similar
        # Twikit doesn't expose this directly, but we can try
        # to get user by checking our following list (we should be there)
        
        # Method 3: Ask user
        return None
        
    async def fetch_all_following(self, user_id: str = None) -> list:
        """Fetch complete following list for a user"""
        if user_id is None:
            user_id = self.my_user_id
            
        if not user_id:
            self.log("❌ No user_id provided")
            return []
            
        self.log(f"📥 Fetching following list for user_id: {user_id}...")
        
        all_users = []
        cursor = None
        page = 0
        max_pages = 50  # Safety limit
        
        while page < max_pages:
            try:
                result = await self.client.get_user_following(
                    user_id=user_id,
                    count=FETCH_PAGE_SIZE,
                    cursor=cursor
                )
                
                if not result:
                    break
                    
                users = list(result) if result else []
                if not users:
                    break
                    
                for user in users:
                    user_data = {
                        'id': getattr(user, 'id', None),
                        'screen_name': getattr(user, 'screen_name', None),
                        'name': getattr(user, 'name', None),
                        'followers_count': getattr(user, 'followers_count', 0),
                        'following_count': getattr(user, 'following_count', 0) or getattr(user, 'friends_count', 0),
                        'statuses_count': getattr(user, 'statuses_count', 0),
                        'verified': getattr(user, 'verified', False),
                        'is_blue_verified': getattr(user, 'is_blue_verified', False),
                        'protected': getattr(user, 'protected', False),
                        'profile_image_url': getattr(user, 'profile_image_url', '') or getattr(user, 'profile_image_url_https', ''),
                        'last_tweet': None,
                        'last_activity': None,
                        'days_inactive': None,
                        'is_inactive': False,
                        'selected': False,
                    }
                    all_users.append(user_data)
                
                page += 1
                self.log(f"   Page {page}: +{len(users)} (total: {len(all_users)})")
                
                # Check if there's more pages
                cursor = getattr(result, 'cursor', None) or getattr(result, 'next_cursor', None)
                if not cursor:
                    # Try to find cursor in the result
                    if hasattr(result, 'has_next') and result.has_next:
                        cursor = getattr(result, 'cursor_id', None)
                    else:
                        break
                        
                await asyncio.sleep(CHECK_DELAY)
                
            except Exception as e:
                error_msg = str(e)
                if '429' in error_msg or 'rate limit' in error_msg.lower():
                    self.log("⚠️ Rate limited, waiting 60s...")
                    await asyncio.sleep(60)
                    continue
                self.log(f"❌ Error: {error_msg[:100]}")
                break
                
        self.following = all_users
        self.log(f"✅ Total: {len(all_users)} following accounts")
        return all_users
        
    async def check_activity(self, user: dict) -> dict:
        """Check last tweet activity for a user"""
        screen_name = user.get('screen_name')
        user_id = user.get('id')
        
        if user.get('protected') or user.get('statuses_count', 0) == 0:
            user['is_inactive'] = user.get('statuses_count', 0) == 0
            user['days_inactive'] = 999 if user['is_inactive'] else None
            return user
            
        retries = 0
        while retries < MAX_RETRIES:
            try:
                tweets = await self.client.get_user_tweets(
                    user_id=user_id,
                    tweet_type='Tweets',
                    count=5
                )
                
                if tweets:
                    for tweet in tweets:
                        created_at = getattr(tweet, 'created_at', None)
                        if created_at:
                            if isinstance(created_at, str):
                                try:
                                    from email.utils import parsedate_to_datetime
                                    tweet_date = parsedate_to_datetime(created_at)
                                except:
                                    # Try other formats
                                    try:
                                        tweet_date = datetime.strptime(created_at, '%a %b %d %H:%M:%S %z %Y')
                                        tweet_date = tweet_date.replace(tzinfo=timezone.utc)
                                    except:
                                        tweet_date = None
                            else:
                                tweet_date = created_at
                                
                            if tweet_date:
                                user['last_activity'] = tweet_date
                                user['last_tweet'] = {
                                    'date': tweet_date.isoformat(),
                                    'text': getattr(tweet, 'full_text', '')[:100] if hasattr(tweet, 'full_text') else str(tweet)[:100]
                                }
                                days = (datetime.now(timezone.utc) - tweet_date.replace(tzinfo=timezone.utc)).days
                                user['days_inactive'] = days
                                user['is_inactive'] = days > self.days_threshold
                                break
                    else:
                        # No tweets with valid dates found
                        user['days_inactive'] = None
                        user['is_inactive'] = False
                else:
                    user['days_inactive'] = None
                    user['is_inactive'] = False
                    
                break
                
            except Exception as e:
                error_msg = str(e)
                if '429' in error_msg or 'rate limit' in error_msg.lower():
                    retries += 1
                    wait_time = 60 * (2 ** retries)
                    self.log(f"⏳ Rate limited on @{screen_name}, waiting {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    self.log(f"⚠️ @{screen_name}: {error_msg[:60]}")
                    break
                    
        return user
        
    async def enrich_all_activity(self):
        """Check activity for all following accounts"""
        self.log("🔍 Checking activity for all accounts...")
        
        total = len(self.following)
        checked = 0
        inactive_count = 0
        
        for i in range(0, total, ENRICH_BATCH_SIZE):
            batch = self.following[i:i + ENRICH_BATCH_SIZE]
            tasks = [self.check_activity(user) for user in batch]
            await asyncio.gather(*tasks, return_exceptions=True)
            
            for user in batch:
                if user.get('is_inactive'):
                    inactive_count += 1
                    
            checked += len(batch)
            progress = (checked / total) * 100 if total > 0 else 100
            self.log(f"   Progress: {checked}/{total} ({progress:.0f}%) — {inactive_count} inactive")
            
            await asyncio.sleep(CHECK_DELAY)
            
        self.log(f"✅ Done: {inactive_count} accounts inactive > {self.days_threshold} days")
        
    def filter_inactive(self) -> list:
        """Filter inactive accounts"""
        inactive = []
        for user in self.following:
            if user.get('is_inactive') or (user.get('statuses_count', 0) == 0):
                user['selected'] = True
                user['is_inactive'] = True
                if user.get('days_inactive') is None:
                    user['days_inactive'] = 999
                inactive.append(user)
        return inactive
        
    async def unfollow_user(self, user: dict) -> bool:
        """Unfollow a single user"""
        screen_name = user.get('screen_name')
        user_id = user.get('id')
        
        if self.dry_run:
            self.log(f"   [DRY] Would unfollow @{screen_name}")
            return True
            
        retries = 0
        while retries < MAX_RETRIES:
            try:
                await self.client.unfollow_user(user_id)
                self.log(f"   ✅ Unfollowed @{screen_name}")
                return True
            except Exception as e:
                error_msg = str(e)
                if '429' in error_msg or 'rate limit' in error_msg.lower():
                    retries += 1
                    wait_time = 60 * (2 ** retries)
                    self.log(f"⏳ Rate limited, waiting {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    self.log(f"   ❌ @{screen_name}: {error_msg[:60]}")
                    return False
        return False
        
    async def unfollow_all(self, users: list):
        """Unfollow all selected users"""
        total = len(users)
        success = 0
        failed = 0
        
        mode = "[DRY RUN]" if self.dry_run else ""
        self.log(f"🚀 {mode} Unfollowing {total} accounts...")
        
        for i, user in enumerate(users, 1):
            self.log(f"[{i}/{total}] @{user.get('screen_name')}...")
            if await self.unfollow_user(user):
                success += 1
            else:
                failed += 1
                
            if i < total:
                await asyncio.sleep(UNFOLLOW_DELAY)
                
        self.log(f"{'='*50}")
        self.log(f"📊 Results: {success} unfollowed, {failed} failed")
        return {'success': success, 'failed': failed, 'total': total}
        
    def print_summary(self, inactive: list):
        """Print summary of inactive accounts"""
        print(f"\n{'='*60}")
        print(f"📊 INACTIVE ACCOUNTS ({len(inactive)} found)")
        print(f"{'='*60}\n")
        
        sorted_users = sorted(inactive, key=lambda x: x.get('days_inactive', 999) or 999, reverse=True)
        
        print(f"{'#':>3} | {'@Username':<20} | {'Inactive':>10} | {'Tweets':>8}")
        print("-" * 55)
        
        for i, user in enumerate(sorted_users[:50], 1):
            days = user.get('days_inactive', '?')
            if days is None: days = '?'
            tweets = user.get('statuses_count', 0)
            print(f"{i:>3} | @{user.get('screen_name', 'unknown'):<19} | {str(days)+'d':>10} | {tweets:>8}")
            
        if len(sorted_users) > 50:
            print(f"\n... +{len(sorted_users) - 50} more")
            
        print(f"\n{'='*60}")
        print(f"Total following: {len(self.following)}")
        print(f"Inactive (>{self.days_threshold}d): {len(inactive)}")
        print(f"{'='*60}\n")
        
    def save_results(self, users: list):
        """Save results to JSON file"""
        if not self.output_file:
            return
            
        output = {
            'timestamp': datetime.now().isoformat(),
            'threshold_days': self.days_threshold,
            'total_following': len(self.following),
            'inactive_count': len(users),
            'dry_run': self.dry_run,
            'accounts': [{
                'id': u.get('id'),
                'screen_name': u.get('screen_name'),
                'name': u.get('name'),
                'days_inactive': u.get('days_inactive'),
                'statuses_count': u.get('statuses_count'),
                'selected': u.get('selected'),
            } for u in users]
        }
        
        with open(self.output_file, 'w') as f:
            json.dump(output, f, indent=2, default=str)
        self.log(f"💾 Saved to {self.output_file}")
        
    async def run(self, user_id: str = None, auto_confirm: bool = False):
        """Main execution"""
        start_time = time.time()
        
        print(f"\n{'='*60}")
        print(f"🐦 MASS UNFOLLOW - Twikit Edition")
        print(f"{'='*60}")
        print(f"Threshold: >{self.days_threshold} days inactive")
        print(f"Mode: {'DRY RUN' if self.dry_run else 'LIVE'}")
        print(f"{'='*60}\n")
        
        await self.authenticate()
        
        # Get own user ID
        if not user_id:
            user_id = await self.get_own_user_id()
            
        if not user_id:
            self.log("❌ Could not determine your user ID.")
            self.log("   Please provide it with --user-id YOUR_USER_ID")
            self.log("   (Find it in DevTools → Application → Cookies → twid)")
            return
            
        self.my_user_id = user_id
        await self.fetch_all_following(user_id)
        
        if not self.following:
            self.log("❌ No following accounts found")
            return
            
        await self.enrich_all_activity()
        inactive = self.filter_inactive()
        
        if not inactive:
            self.log("✅ No inactive accounts found!")
            return
            
        self.print_summary(inactive)
        self.save_results(inactive)
        
        if not self.dry_run:
            print(f"\n⚠️ This will unfollow {len(inactive)} accounts. Cannot be undone!")
            if auto_confirm:
                confirm = 'yes'
            else:
                confirm = input("\nType 'yes' to confirm: ")
            if confirm.lower() == 'yes':
                await self.unfollow_all(inactive)
                self.save_results(self.following)
            else:
                self.log("❌ Cancelled")
        else:
            print(f"\n💡 DRY RUN - No accounts were unfollowed")
            if auto_confirm:
                confirm = 'yes'
            else:
                confirm = input("Start unfollowing now? (yes/no): ")
            if confirm.lower() == 'yes':
                self.dry_run = False
                await self.unfollow_all(inactive)
                self.save_results(self.following)
                
        elapsed = time.time() - start_time
        self.log(f"⏱️ Completed in {elapsed:.1f}s")


def main():
    parser = argparse.ArgumentParser(description='Mass Unfollow - Twikit Edition')
    parser.add_argument('--auth-token', default=os.getenv('AUTH_TOKEN1') or os.getenv('AUTH_TOKEN'),
                       help='X auth_token cookie')
    parser.add_argument('--ct0', default=os.getenv('CT0_1') or os.getenv('CT0'),
                       help='X ct0 cookie')
    parser.add_argument('--user-id', default=os.getenv('USER_ID'),
                       help='Your X user ID (find in cookies → twid)')
    parser.add_argument('--days', type=int, default=90,
                       help='Days threshold (default: 90)')
    parser.add_argument('--dry-run', action='store_true',
                       help='Show inactive accounts without unfollowing')
    parser.add_argument('--yes', '-y', action='store_true',
                       help='Auto-confirm unfollow without prompt')
    parser.add_argument('--output', '-o', help='Save results to JSON file')
    
    args = parser.parse_args()
    
    if not args.auth_token or not args.ct0:
        print("ERROR: Missing credentials!")
        print("Set AUTH_TOKEN and CT0 env vars, or use --auth-token and --ct0 flags")
        print("\nTo get your cookies:")
        print("1. Open x.com → F12 → Application → Cookies → x.com")
        print("2. Copy auth_token and ct0")
        print("3. Also copy twid (u%3D123456789) for --user-id")
        sys.exit(1)
        
    tool = MassUnfollow(
        auth_token=args.auth_token,
        ct0=args.ct0,
        dry_run=args.dry_run,
        days_threshold=args.days,
        output_file=args.output,
    )
    
    asyncio.run(tool.run(user_id=args.user_id, auto_confirm=args.yes))


if __name__ == '__main__':
    main()
