"""Data models for Mass Unfollow"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional, List
import time


@dataclass
class User:
    """X/Twitter user with activity tracking"""
    id: str
    screen_name: str
    name: str
    followers_count: int = 0
    following_count: int = 0
    statuses_count: int = 0
    verified: bool = False
    is_blue_verified: bool = False
    protected: bool = False
    profile_image_url: str = ''
    
    # Activity tracking
    last_tweet: Optional[dict] = None
    last_activity: Optional[datetime] = None
    days_inactive: Optional[int] = None
    is_inactive: bool = False
    selected: bool = False
    
    # Status
    unfollow_status: Optional[str] = None  # 'pending', 'success', 'failed'
    error_message: Optional[str] = None
    
    def to_dict(self) -> dict:
        d = asdict(self)
        # Convert datetime to string
        if self.last_activity:
            d['last_activity'] = self.last_activity.isoformat()
        return d
    
    @classmethod
    def from_twikit(cls, user) -> 'User':
        """Create User from Twikit user object"""
        return cls(
            id=str(getattr(user, 'id', '')),
            screen_name=getattr(user, 'screen_name', ''),
            name=getattr(user, 'name', ''),
            followers_count=getattr(user, 'followers_count', 0),
            following_count=getattr(user, 'following_count', 0) or getattr(user, 'friends_count', 0),
            statuses_count=getattr(user, 'statuses_count', 0),
            verified=getattr(user, 'verified', False),
            is_blue_verified=getattr(user, 'is_blue_verified', False),
            protected=getattr(user, 'protected', False),
            profile_image_url=getattr(user, 'profile_image_url', '') or getattr(user, 'profile_image_url_https', ''),
        )


@dataclass
class UnfollowResult:
    """Result of an unfollow operation"""
    total: int = 0
    success: int = 0
    failed: int = 0
    skipped: int = 0
    duration_seconds: float = 0
    errors: List[str] = field(default_factory=list)
    
    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Session:
    """Session state for tracking progress"""
    auth_token: str = ''
    ct0: str = ''
    user_id: str = ''
    authenticated: bool = False
    phase: str = 'idle'  # idle, fetching, enriching, unfollowing, done
    progress: int = 0
    total: int = 0
    message: str = ''
    following: List[User] = field(default_factory=list)
    inactive: List[User] = field(default_factory=list)
    
    def to_dict(self) -> dict:
        return {
            'authenticated': self.authenticated,
            'phase': self.phase,
            'progress': self.progress,
            'total': self.total,
            'message': self.message,
            'following_count': len(self.following),
            'inactive_count': len(self.inactive),
            'following': [u.to_dict() for u in self.following],
            'inactive': [u.to_dict() for u in self.inactive],
        }
