"""Twikit client wrapper for Mass Unfollow"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Callable, Optional, List

from twikit import Client

from .models import User, Session

logger = logging.getLogger(__name__)


class TwikitClient:
    """Wrapper around Twikit for mass unfollow operations"""
    
    def __init__(self, auth_token: str, ct0: str, user_id: str):
        self.auth_token = auth_token
        self.ct0 = ct0
        self.user_id = user_id
        self.client = Client('en-US')
        self.session = Session(auth_token=auth_token, ct0=ct0, user_id=user_id)
        
        # Set cookies
        self.client.set_cookies({
            'auth_token': auth_token,
            'ct0': ct0
        })
        self.session.authenticated = True
    
    async def fetch_following(
        self,
        callback: Optional[Callable] = None,
        page_size: int = 200,
        max_pages: int = 100
    ) -> List[User]:
        """Fetch all following accounts"""
        self.session.phase = 'fetching'
        self.session.progress = 0
        self.session.following = []
        
        all_users = []
        cursor = None
        page = 0
        
        while page < max_pages:
            try:
                result = await self.client.get_user_following(
                    user_id=self.user_id,
                    count=page_size,
                    cursor=cursor
                )
                
                if not result:
                    break
                    
                users = list(result) if result else []
                if not users:
                    break
                
                for user_obj in users:
                    user = User.from_twikit(user_obj)
                    all_users.append(user)
                
                page += 1
                self.session.progress = len(all_users)
                self.session.message = f'Page {page}: +{len(users)} (total: {len(all_users)})'
                
                if callback:
                    callback(self.session.to_dict())
                
                # Check for more pages
                cursor = getattr(result, 'cursor', None) or getattr(result, 'next_cursor', None)
                if not cursor:
                    break
                    
                await asyncio.sleep(1.5)
                
            except Exception as e:
                error_msg = str(e)
                if '429' in error_msg or 'rate limit' in error_msg.lower():
                    logger.warning('Rate limited, waiting 60s...')
                    self.session.message = 'Rate limited, waiting 60s...'
                    if callback:
                        callback(self.session.to_dict())
                    await asyncio.sleep(60)
                    continue
                logger.error(f'Error fetching following: {error_msg}')
                break
        
        self.session.following = all_users
        self.session.total = len(all_users)
        return all_users
    
    async def check_activity(
        self,
        user: User,
        days_threshold: int = 90
    ) -> User:
        """Check last tweet activity for a user"""
        if user.protected or user.statuses_count == 0:
            user.is_inactive = user.statuses_count == 0
            user.days_inactive = 999 if user.is_inactive else None
            return user
        
        max_retries = 3
        for retry in range(max_retries):
            try:
                tweets = await self.client.get_user_tweets(
                    user_id=user.id,
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
                                    try:
                                        tweet_date = datetime.strptime(
                                            created_at, '%a %b %d %H:%M:%S %z %Y'
                                        )
                                        tweet_date = tweet_date.replace(tzinfo=timezone.utc)
                                    except:
                                        tweet_date = None
                            else:
                                tweet_date = created_at
                            
                            if tweet_date:
                                user.last_activity = tweet_date
                                user.last_tweet = {
                                    'date': tweet_date.isoformat(),
                                    'text': getattr(tweet, 'full_text', '')[:100] if hasattr(tweet, 'full_text') else str(tweet)[:100]
                                }
                                days = (datetime.now(timezone.utc) - tweet_date.replace(tzinfo=timezone.utc)).days
                                user.days_inactive = days
                                user.is_inactive = days > days_threshold
                                break
                    else:
                        user.days_inactive = None
                        user.is_inactive = False
                else:
                    user.days_inactive = None
                    user.is_inactive = False
                
                break
                
            except Exception as e:
                error_msg = str(e)
                if '429' in error_msg or 'rate limit' in error_msg.lower():
                    wait_time = 60 * (2 ** retry)
                    logger.warning(f'Rate limited on @{user.screen_name}, waiting {wait_time}s')
                    await asyncio.sleep(wait_time)
                else:
                    logger.warning(f'Error checking @{user.screen_name}: {error_msg[:60]}')
                    break
        
        return user
    
    async def enrich_activity(
        self,
        days_threshold: int = 90,
        callback: Optional[Callable] = None,
        batch_size: int = 5
    ) -> List[User]:
        """Check activity for all following accounts"""
        self.session.phase = 'enriching'
        self.session.progress = 0
        
        following = self.session.following
        total = len(following)
        inactive_count = 0
        
        for i in range(0, total, batch_size):
            batch = following[i:i + batch_size]
            tasks = [self.check_activity(user, days_threshold) for user in batch]
            await asyncio.gather(*tasks, return_exceptions=True)
            
            for user in batch:
                if user.is_inactive:
                    inactive_count += 1
            
            self.session.progress = i + len(batch)
            self.session.message = f'Checking activity: {self.session.progress}/{total} ({inactive_count} inactive)'
            
            if callback:
                callback(self.session.to_dict())
            
            await asyncio.sleep(1.5)
        
        inactive = [u for u in following if u.is_inactive]
        self.session.inactive = inactive
        self.session.phase = 'done'
        self.session.message = f'Found {len(inactive)} inactive accounts'
        
        if callback:
            callback(self.session.to_dict())
        
        return inactive
    
    async def unfollow_user(self, user: User) -> bool:
        """Unfollow a single user"""
        max_retries = 3
        for retry in range(max_retries):
            try:
                await self.client.unfollow_user(user.id)
                user.unfollow_status = 'success'
                return True
            except Exception as e:
                error_msg = str(e)
                if '429' in error_msg or 'rate limit' in error_msg.lower():
                    wait_time = 60 * (2 ** retry)
                    logger.warning(f'Rate limited, waiting {wait_time}s')
                    await asyncio.sleep(wait_time)
                else:
                    user.unfollow_status = 'failed'
                    user.error_message = error_msg[:100]
                    return False
        
        user.unfollow_status = 'failed'
        user.error_message = 'Max retries exceeded'
        return False
    
    async def unfollow_all(
        self,
        users: Optional[List[User]] = None,
        callback: Optional[Callable] = None,
        delay: float = 2.0
    ) -> dict:
        """Unfollow multiple users"""
        if users is None:
            users = self.session.inactive
        
        self.session.phase = 'unfollowing'
        self.session.progress = 0
        self.session.total = len(users)
        
        success = 0
        failed = 0
        
        for i, user in enumerate(users):
            self.session.message = f'Unfollowing @{user.screen_name} ({i+1}/{len(users)})'
            
            if callback:
                callback(self.session.to_dict())
            
            if await self.unfollow_user(user):
                success += 1
            else:
                failed += 1
            
            self.session.progress = i + 1
            
            if callback:
                callback(self.session.to_dict())
            
            if i < len(users) - 1:
                await asyncio.sleep(delay)
        
        self.session.phase = 'done'
        self.session.message = f'Done! {success} unfollowed, {failed} failed'
        
        if callback:
            callback(self.session.to_dict())
        
        return {
            'total': len(users),
            'success': success,
            'failed': failed,
            'users': [u.to_dict() for u in users]
        }
    
    def get_session(self) -> dict:
        """Get current session state"""
        return self.session.to_dict()
