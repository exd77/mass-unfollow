#!/usr/bin/env python3
"""
Mass Unfollow - Web Server
FastAPI server with WebSocket support for real-time progress.

Usage:
    python server.py
    python server.py --host 0.0.0.0 --port 8777
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel

from core import TwikitClient, Session, UnfollowResult

# Config
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Mass Unfollow", version="1.0.0")

# Static files
web_dir = Path(__file__).parent / "web"
app.mount("/static", StaticFiles(directory=str(web_dir)), name="static")

# Session store (in-memory, single user)
sessions: Dict[str, TwikitClient] = {}
active_websockets: list = []


class LoginRequest(BaseModel):
    auth_token: str
    ct0: str
    user_id: str
    days_threshold: int = 90


class UnfollowRequest(BaseModel):
    user_ids: Optional[list] = None  # None = all inactive
    days_threshold: int = 90


# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass


manager = ConnectionManager()


def get_session_id(auth_token: str) -> str:
    """Generate session ID from auth token"""
    import hashlib
    return hashlib.sha256(auth_token.encode()).hexdigest()[:16]


@app.get("/")
async def index():
    """Serve main page"""
    return FileResponse(str(web_dir / "index.html"))


@app.post("/api/login")
async def login(req: LoginRequest):
    """Initialize session and fetch following list"""
    session_id = get_session_id(req.auth_token)
    
    try:
        client = TwikitClient(
            auth_token=req.auth_token,
            ct0=req.ct0,
            user_id=req.user_id
        )
        sessions[session_id] = client
        
        return {
            "success": True,
            "session_id": session_id,
            "message": "Authenticated successfully"
        }
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/fetch")
async def fetch_following(req: LoginRequest):
    """Fetch following list with progress via WebSocket"""
    session_id = get_session_id(req.auth_token)
    
    client = TwikitClient(
        auth_token=req.auth_token,
        ct0=req.ct0,
        user_id=req.user_id
    )
    sessions[session_id] = client
    
    async def progress_callback(data: dict):
        await manager.broadcast({
            "type": "progress",
            "phase": data.get("phase"),
            "progress": data.get("progress"),
            "total": data.get("total"),
            "message": data.get("message")
        })
    
    # Run fetch in background
    asyncio.create_task(fetch_and_enrich(client, req.days_threshold, progress_callback))
    
    return {
        "success": True,
        "session_id": session_id,
        "message": "Fetching started"
    }


async def fetch_and_enrich(client: TwikitClient, days_threshold: int, callback):
    """Background task to fetch and enrich following list"""
    try:
        # Fetch following
        await client.fetch_following(callback=callback)
        
        # Enrich activity
        await client.enrich_activity(days_threshold=days_threshold, callback=callback)
        
        # Broadcast completion
        await manager.broadcast({
            "type": "fetch_complete",
            "data": client.get_session()
        })
    except Exception as e:
        logger.error(f"Fetch error: {e}")
        await manager.broadcast({
            "type": "error",
            "message": str(e)
        })


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Get session state"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return sessions[session_id].get_session()


@app.post("/api/unfollow/{session_id}")
async def unfollow(session_id: str, req: UnfollowRequest):
    """Unfollow inactive accounts"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    client = sessions[session_id]
    
    # Get users to unfollow
    users_to_unfollow = client.session.inactive
    if req.user_ids:
        users_to_unfollow = [u for u in users_to_unfollow if u.id in req.user_ids]
    
    if not users_to_unfollow:
        raise HTTPException(status_code=400, detail="No users to unfollow")
    
    async def progress_callback(data: dict):
        await manager.broadcast({
            "type": "unfollow_progress",
            "phase": data.get("phase"),
            "progress": data.get("progress"),
            "total": data.get("total"),
            "message": data.get("message")
        })
    
    # Run unfollow in background
    asyncio.create_task(run_unfollow(client, users_to_unfollow, progress_callback))
    
    return {
        "success": True,
        "total": len(users_to_unfollow),
        "message": "Unfollow started"
    }


async def run_unfollow(client: TwikitClient, users, callback):
    """Background task to unfollow users"""
    try:
        result = await client.unfollow_all(users=users, callback=callback)
        
        await manager.broadcast({
            "type": "unfollow_complete",
            "result": result
        })
    except Exception as e:
        logger.error(f"Unfollow error: {e}")
        await manager.broadcast({
            "type": "error",
            "message": str(e)
        })


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket for real-time progress updates"""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Keep connection alive
            if data == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/api/health")
async def health():
    """Health check"""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Mass Unfollow Web Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind")
    parser.add_argument("--port", type=int, default=8777, help="Port to bind")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    
    args = parser.parse_args()
    
    logger.info(f"🚀 Mass Unfollow server starting on http://{args.host}:{args.port}")
    
    uvicorn.run(
        "server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info"
    )


if __name__ == "__main__":
    main()
