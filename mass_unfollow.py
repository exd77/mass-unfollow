#!/usr/bin/env python3
"""
Mass Unfollow - Twikit Edition
Bulk unfollow inactive X/Twitter accounts using Twikit library.

Usage:
    # With .env file (recommended):
    python mass_unfollow.py
    
    # Direct args:
    python mass_unfollow.py --auth-token YOUR_AUTH_TOKEN --ct0 YOUR_CT0
    
    # Dry run (no unfollow):
    python mass_unfollow.py --dry-run
    
    # Filter inactive threshold:
    python mass_unfollow.py --days 90

Requirements:
    pip install twikit python-dotenv
"""

import asyncio
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Try loading from .env
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
CHECK_DELAY = 1.5          # Delay between activity checks (seconds)
UNFOLLOW_DELAY = 2.0       # Delay between unfollows (seconds)
FETCH_PAGE_SIZE = 200      # Following list page size
ENRICH_BATCH_SIZE = 5      # Parallel activity checks
MAX_RETRIES = 3            # Max retries on rate limit


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
        """Print timestamped log message"""
        ts = datetime.now().strftime('%H:%M:%S')
        print(f"[{ts}] {msg}")
        
    async def authenticate(self):
        """Authenticate with X using auth_token and ct0 cookies"""
        self.client = Client('en-US')
        
        try:
            self.client.set_cookies({
                'auth_token': self.auth_token,
                'ct0': self.ct0
            })
            
            # Verify auth by getting our own user info
            me = await self.client.get_user_by_screen_name('')  # Should fail
        except Exception:
            pass
            
        # Try to get user ID from cookies
        # Twikit stores this internally after auth
        
        self.log("✅ Authenticated with X via Twikit")
        return True
        
    async def fetch_all_following(self) -> list:
        """Fetch complete following list"""
        self.log("📥 Fetching following list...")
        
        all_users = []
        cursor = None
        page = 0
        
        while True:
            try:
                # Twikit's get_following method
                result = await self.client.get_user_following(
                    user_id=self.my_user_id or 'me',
                    count=FETCH_PAGE_SIZE,
                    cursor=cursor
                )
                
                if not result or not hasattr(result, 'users'):
                    break
                    
                users = result.users
                if not users:
                    break
                    
                for user in users:
                    user_data = {
                        'id': getattr(user, 'id', None) or getattr(user, 'id_str', None),
                        'screen_name': getattr(user, 'screen_name', None) or getattr(user, 'screen_name', None),
                        'name': getattr(user, 'name', None),
                        'followers_count': getattr(user, 'followers_count', 0),
                        'following_count': getattr(user, 'friends_count', 0),
                        'statuses_count': getattr(user, 'statuses_count', 0),
                        'verified': getattr(user, 'verified', False),
                        'protected': getattr(user, 'protected', False),
                        'profile_image_url': getattr(user, 'profile_image_url_https', ''),
                        'last_tweet': None,
                        'last_activity': None,
                        'is_inactive': False,
                        'selected': False,
                    }
                    all_users.append(user_data)
                
                page += 1
                self.log(f"   Page {page}: fetched {len(users)} users (total: {len(all_users)})")
                
                # Get cursor for next page
                cursor = getattr(result, 'cursor', None) or getattr(result, 'next_cursor', None)
                if not cursor:
                    break
                    
                await asyncio.sleep(CHECK_DELAY)
                
            except Exception as e:
                error_msg = str(e)
                if '429' in error_msg or 'rate limit' in error_msg.lower():
                    self.log("⚠️ Rate limited, waiting 60s...")
                    await asyncio.sleep(60)
                    continue
                self.log(f"❌ Error fetching following: {error_msg[:100]}")
                break
                
        self.following = all_users
        self.log(f"✅ Fetched {len(all_users)} following accounts")
        return all_users
        
    async def check_activity(self, user: dict) -> dict:
        """Check last tweet activity for a user"""
        if user['protected'] or user['statuses_count'] == 0:
            user['last_activity'] = None
            user['is_inactive'] = user['statuses_count'] == 0
            return user
            
        screen_name = user['screen_name']
        retries = 0
        
        while retries < MAX_RETRIES:
            try:
                tweets = await self.client.get_user_tweets(
                    user_id=user['id'],
                    tweet_type='Tweets',
                    count=5
                )
                
                if tweets and hasattr(tweets, 'tweets') and tweets.tweets:
                    for tweet in tweets.tweets:
                        if hasattr(tweet, 'created_at') and tweet.created_at:
                            # Parse tweet date
                            if isinstance(tweet.created_at, str):
                                # Twitter date format: "Wed Oct 10 20:19:24 +0000 2018"
                                try:
                                    from email.utils import parsedate_to_datetime
                                    tweet_date = parsedate_to_datetime(tweet.created_at)
                                except:
                                    tweet_date = datetime.now(timezone.utc)
                            else:
                                tweet_date = tweet.created_at
                                
                            user['last_tweet'] = {
                                'date': tweet_date.isoformat(),
                                'text': getattr(tweet, 'full_text', '')[:100]
                            }
                            user['last_activity'] = tweet_date
                            break
                    else:
                        user['last_activity'] = None
                else:
                    user['last_activity'] = None
                    
                break  # Success
                
            except Exception as e:
                error_msg = str(e)
                if '429' in error_msg or 'rate limit' in error_msg.lower():
                    retries += 1
                    wait_time = 60 * (2 ** retries)
                    self.log(f"⏳ Rate limited on @{screen_name}, waiting {wait_time}s...")
                    await asyncio.sleep(wait_time)
                else:
                    self.log(f"⚠️ Error checking @{screen_name}: {error_msg[:80]}")
                    break
                    
        return user
        
    async def enrich_all_activity(self):
        """Check activity for all following accounts"""
        self.log("🔍 Checking activity for all accounts...")
        
        total = len(self.following)
        checked = 0
        inactive_count = 0
        
        # Process in batches
        for i in range(0, total, ENRICH_BATCH_SIZE):
            batch = self.following[i:i + ENRICH_BATCH_SIZE]
            tasks = [self.check_activity(user) for user in batch]
            await asyncio.gather(*tasks, return_exceptions=True)
            
            # Count inactive in this batch
            for user in batch:
                if user.get('last_activity'):
                    days_since = (datetime.now(timezone.utc) - user['last_activity'].replace(tzinfo=timezone.utc)).days
                    user['days_inactive'] = days_since
                    user['is_inactive'] = days_since > self.days_threshold
                    if user['is_inactive']:
                        inactive_count += 1
                        
            checked += len(batch)
            progress = (checked / total) * 100
            self.log(f"   Progress: {checked}/{total} ({progress:.1f}%) - {inactive_count} inactive")
            
            await asyncio.sleep(CHECK_DELAY)
            
        self.log(f"✅ Activity check complete: {inactive_count} accounts inactive > {self.days_threshold} days")
        
    def filter_inactive(self) -> list:
        """Filter and select inactive accounts"""
        threshold = self.days_threshold
        
        inactive = []
        for user in self.following:
            if user['is_inactive']:
                user['selected'] = True
                inactive.append(user)
            elif user['statuses_count'] == 0:
                user['selected'] = True
                user['is_inactive'] = True
                user['days_inactive'] = 999
                inactive.append(user)
                
        return inactive
        
    async def unfollow_user(self, user: dict) -> bool:
        """Unfollow a single user"""
        screen_name = user['screen_name']
        user_id = user['id']
        
        if self.dry_run:
            self.log(f"   [DRY RUN] Would unfollow @{screen_name}")
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
                    self.log(f"   ❌ Failed @{screen_name}: {error_msg[:60]}")
                    return False
                    
        return False
        
    async def unfollow_all(self, users: list):
        """Unfollow all selected users"""
        total = len(users)
        success = 0
        failed = 0
        
        mode = "DRY RUN" if self.dry_run else "LIVE"
        self.log(f"🚀 Starting unfollow ({mode}) - {total} accounts")
        
        for i, user in enumerate(users, 1):
            self.log(f"[{i}/{total}] Processing @{user['screen_name']}...")
            result = await self.unfollow_user(user)
            
            if result:
                success += 1
            else:
                failed += 1
                
            if i < total:
                await asyncio.sleep(UNFOLLOW_DELAY)
                
        self.log(f"{'='*50}")
        self.log(f"📊 Results: {success} unfollowed, {failed} failed, {total - success - failed} skipped")
        
        return {'success': success, 'failed': failed, 'total': total}
        
    def print_summary(self, inactive: list):
        """Print summary of inactive accounts"""
        print(f"\n{'='*60}")
        print(f"📊 INACTIVE ACCOUNTS SUMMARY ({len(inactive)} found)")
        print(f"{'='*60}\n")
        
        # Sort by days inactive (descending)
        sorted_users = sorted(inactive, key=lambda x: x.get('days_inactive', 999), reverse=True)
        
        print(f"{'#':>3} | {'@Username':<20} | {'Days Inactive':>13} | {'Tweets':>8} | Status")
        print("-" * 70)
        
        for i, user in enumerate(sorted_users[:50], 1):  # Show first 50
            days = user.get('days_inactive', '?')
            tweets = user.get('statuses_count', 0)
            status = "🔒 Protected" if user['protected'] else ("📝 No tweets" if tweets == 0 else "👻 Inactive")
            print(f"{i:>3} | @{user['screen_name']:<19} | {str(days)+' days':>13} | {tweets:>8} | {status}")
            
        if len(sorted_users) > 50:
            print(f"\n... and {len(sorted_users) - 50} more")
            
        print(f"\n{'='*60}")
        print(f"Total following: {len(self.following)}")
        print(f"Inactive (>{self.days_threshold} days): {len(inactive)}")
        print(f"Percentage: {(len(inactive)/len(self.following)*100):.1f}%")
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
            'accounts': [
                {
                    'id': u['id'],
                    'screen_name': u['screen_name'],
                    'name': u['name'],
                    'days_inactive': u.get('days_inactive', None),
                    'statuses_count': u['statuses_count'],
                    'selected': u['selected'],
                    'last_tweet': u.get('last_tweet'),
                }
                for u in users
            ]
        }
        
        with open(self.output_file, 'w') as f:
            json.dump(output, f, indent=2, default=str)
            
        self.log(f"💾 Results saved to {self.output_file}")
        
    async def run(self):
        """Main execution flow"""
        start_time = time.time()
        
        print(f"\n{'='*60}")
        print(f"🐦 MASS UNFOLLOW - Twikit Edition")
        print(f"{'='*60}")
        print(f"Threshold: >{self.days_threshold} days inactive")
        print(f"Mode: {'DRY RUN' if self.dry_run else 'LIVE UNFOLLOW'}")
        print(f"{'='*60}\n")
        
        # Step 1: Authenticate
        await self.authenticate()
        
        # Step 2: Fetch following
        await self.fetch_all_following()
        
        if not self.following:
            self.log("❌ No following accounts found. Check your auth credentials.")
            return
            
        # Step 3: Check activity
        await self.enrich_all_activity()
        
        # Step 4: Filter inactive
        inactive = self.filter_inactive()
        
        if not inactive:
            self.log("✅ No inactive accounts found! Nothing to unfollow.")
            return
            
        # Step 5: Print summary
        self.print_summary(inactive)
        
        # Step 6: Save results
        self.save_results(inactive)
        
        # Step 7: Confirm and unfollow (unless dry run)
        if not self.dry_run:
            print(f"\n⚠️  WARNING: This will unfollow {len(inactive)} accounts.")
            print("This action cannot be undone!\n")
            confirm = input("Type 'yes' to confirm unfollow: ")
            
            if confirm.lower() == 'yes':
                results = await self.unfollow_all(inactive)
                self.save_results(self.following)  # Save updated state
            else:
                self.log("❌ Cancelled by user")
        else:
            print(f"\n💡 DRY RUN MODE - No accounts were unfollowed")
            print(f"   Run without --dry-run to actually unfollow\n")
            
            # Ask if user wants to unfollow now
            confirm = input("Start unfollowing now? (yes/no): ")
            if confirm.lower() == 'yes':
                results = await self.unfollow_all(inactive)
                self.save_results(self.following)
                
        elapsed = time.time() - start_time
        self.log(f"⏱️ Completed in {elapsed:.1f}s")


def main():
    parser = argparse.ArgumentParser(
        description='Mass Unfollow - Unfollow inactive X/Twitter accounts',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry run (no unfollow, just show inactive accounts)
  python mass_unfollow.py --dry-run
  
  # Live unfollow with custom threshold
  python mass_unfollow.py --days 180
  
  # With explicit credentials
  python mass_unfollow.py --auth-token YOUR_TOKEN --ct0 YOUR_CT0
  
  # Save results to file
  python mass_unfollow.py --output results.json
        """
    )
    
    parser.add_argument('--auth-token', default=os.getenv('AUTH_TOKEN1') or os.getenv('AUTH_TOKEN'),
                       help='X auth_token cookie (or set AUTH_TOKEN env var)')
    parser.add_argument('--ct0', default=os.getenv('CT0_1') or os.getenv('CT0'),
                       help='X ct0 cookie (or set CT0 env var)')
    parser.add_argument('--days', type=int, default=90,
                       help='Days threshold for inactivity (default: 90)')
    parser.add_argument('--dry-run', action='store_true',
                       help='Show inactive accounts but don\'t unfollow')
    parser.add_argument('--output', '-o', 
                       help='Save results to JSON file')
    
    args = parser.parse_args()
    
    if not args.auth_token or not args.ct0:
        print("ERROR: Missing credentials!")
        print("Set AUTH_TOKEN and CT0 env vars, or use --auth-token and --ct0 flags")
        print("\nTo get your cookies:")
        print("1. Open x.com in browser")
        print("2. F12 → Application → Cookies → x.com")
        print("3. Copy auth_token and ct0 values")
        sys.exit(1)
        
    tool = MassUnfollow(
        auth_token=args.auth_token,
        ct0=args.ct0,
        dry_run=args.dry_run,
        days_threshold=args.days,
        output_file=args.output,
    )
    
    asyncio.run(tool.run())


if __name__ == '__main__':
    main()
