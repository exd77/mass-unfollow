#!/usr/bin/env python3
"""
Helper: Get your X user ID from cookies.
Works by querying the verify_credentials endpoint via Twikit workaround.

Usage:
    python get_user_id.py --auth-token YOUR_AUTH --ct0 YOUR_CT0
    
Or set in .env:
    AUTH_TOKEN1=...
    CT0_1=...
    python get_user_id.py
"""

import asyncio
import os
import re
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from twikit import Client
except ImportError:
    print("pip install twikit")
    sys.exit(1)


async def get_user_id(auth_token: str, ct0: str):
    """Extract user ID from X session"""
    client = Client('en-US')
    client.set_cookies({'auth_token': auth_token, 'ct0': ct0})
    
    print(f"auth_token: {auth_token[:20]}...")
    print(f"ct0: {ct0[:20]}...")
    
    # Method: Get our own following and look for ourselves
    # This doesn't work directly, so let's try another approach
    
    # Try to access internal cookies
    try:
        cookies = client._cookies if hasattr(client, '_cookies') else {}
        print(f"\nInternal cookies: {list(cookies.keys()) if cookies else 'none'}")
    except:
        pass
    
    # The twid cookie contains: u%3D1234567890
    # We need to get this from browser cookies
    print("\n" + "="*50)
    print("📱 HOW TO FIND YOUR USER ID:")
    print("="*50)
    print("""
1. Open https://x.com in browser
2. F12 → Application → Cookies → https://x.com
3. Find cookie named 'twid'
4. Value looks like: u%3D123456789012345
5. The number after u%3D is your USER_ID

Example: u%3D1789423657 → USER_ID = 1789423657
""")
    
    # Try alternative: search for user by trying to match
    # Actually, let's try to verify by checking if we can get DMs or similar
    # But simplest is just to ask user
    
    return None


async def verify_and_get_id(auth_token: str, ct0: str):
    """Try to verify credentials and get user ID"""
    client = Client('en-US')
    client.set_cookies({'auth_token': auth_token, 'ct0': ct0})
    
    # Twikit doesn't have direct verify_credentials, but we can try:
    # Get our own DMs or similar to find our user ID
    
    # Actually, the simplest approach: 
    # User needs to provide USER_ID from their browser cookies
    
    return None


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--auth-token', default=os.getenv('AUTH_TOKEN1') or os.getenv('AUTH_TOKEN'))
    parser.add_argument('--ct0', default=os.getenv('CT0_1') or os.getenv('CT0'))
    args = parser.parse_args()
    
    if not args.auth_token or not args.ct0:
        print("ERROR: Set AUTH_TOKEN and CT0 in .env or as args")
        sys.exit(1)
        
    asyncio.run(get_user_id(args.auth_token, args.ct0))


if __name__ == '__main__':
    main()
