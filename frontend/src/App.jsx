import { useState, useEffect, useRef } from 'react'
import './index.css'

// API base URL — adjust for production
const API_BASE = '/api'

// Helper functions
const sleep = ms => new Promise(r => setTimeout(r, ms))

const formatDate = isoStr => {
  if (!isoStr) return '—'
  const days = Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000)
  if (days < 1) return 'Today'
  if (days < 2) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

const escHtml = str => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export default function App() {
  // State
  const [status, setStatus] = useState({ state: 'checking', text: 'Initializing…' })
  const [loggedIn, setLoggedIn] = useState(false)
  const [allUsers, setAllUsers] = useState([])
  const [isEnriched, setIsEnriched] = useState(false)
  const [currentView, setCurrentView] = useState('none')
  const [currentSort, setCurrentSort] = useState('inactive-first')
  const [isFetching, setIsFetching] = useState(false)
  const [isEnriching, setIsEnriching] = useState(false)
  const [isUnfollowing, setIsUnfollowing] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [progress, setProgress] = useState({ phase: '', percent: 0, text: '' })
  const [unfollowProgress, setUnfollowProgress] = useState({ done: 0, total: 0 })
  const [toast, setToast] = useState({ visible: false, text: '' })
  const [threshold, setThreshold] = useState(90)
  const [showGuide, setShowGuide] = useState(true)
  
  const progressInterval = useRef(null)
  const toastTimer = useRef(null)

  // Show toast
  const showToast = (text, duration = 3000) => {
    setToast({ visible: true, text })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast({ visible: false, text: '' }), duration)
  }

  // Check login status
  const checkLogin = async () => {
    setStatus({ state: 'checking', text: 'Checking…' })
    try {
      const res = await fetch(`${API_BASE}/ping`)
      const data = await res.json()
      if (data.success && data.loggedIn) {
        setLoggedIn(true)
        setStatus({ 
          state: 'ok', 
          text: `Logged in as @${data.username || 'user'} · Token ${data.tokenReady ? 'ready' : 'fallback'}` 
        })
        setShowGuide(false)
        // Load cached data
        await loadCachedData()
      } else {
        setLoggedIn(false)
        setStatus({ state: 'error', text: data.error || 'Not logged in — open x.com first' })
      }
    } catch (err) {
      setStatus({ state: 'error', text: 'Cannot connect to server' })
    }
  }

  // Load cached following list
  const loadCachedData = async () => {
    try {
      const res = await fetch(`${API_BASE}/cache`)
      const data = await res.json()
      if (data.success && data.followingList?.length) {
        setAllUsers(data.followingList)
        const enriched = data.followingList.some(u => u.activityChecked || u.lastTweetAt)
        setIsEnriched(enriched)
        const inactive = data.followingList.filter(u => isInactive(u)).length
        showToast(`${data.followingList.length} accounts (${inactive} inactive) — cached ${Math.round((Date.now() - data.fetchedAt) / 60000)}m ago`)
      }
    } catch (err) {
      console.error('Failed to load cache:', err)
    }
  }

  // Fetch following list
  const startFetch = async () => {
    setIsFetching(true)
    setProgress({ phase: 'fetch', percent: 0, text: 'Fetching following list…' })

    try {
      // Start fetch
      const res = await fetch(`${API_BASE}/fetch`, { method: 'POST' })
      const data = await res.json()

      if (!data.success) {
        showToast(data.error || 'Fetch failed', 5000)
        setIsFetching(false)
        return
      }

      // Poll for progress
      progressInterval.current = setInterval(async () => {
        try {
          const progRes = await fetch(`${API_BASE}/progress`)
          const progData = await progRes.json()
          
          if (progData.phase === 'fetch_page') {
            setProgress({ 
              phase: 'fetch', 
              percent: Math.min(5 + progData.page * 3, 68), 
              text: `Page ${progData.page} — ${progData.total} accounts…` 
            })
          } else if (progData.phase === 'rate_limit') {
            setProgress({ 
              phase: 'rate_limit', 
              percent: 0, 
              text: `Rate limited — waiting ${Math.ceil(progData.waitMs / 1000)}s…` 
            })
          } else if (progData.phase === 'enrich') {
            const pct = Math.round((progData.index / progData.total) * 100)
            setProgress({ 
              phase: 'enrich', 
              percent: pct, 
              text: `Checking activity: ${progData.index}/${progData.total}` 
            })
          } else if (progData.phase === 'done') {
            clearInterval(progressInterval.current)
            setProgress({ phase: 'done', percent: 100, text: 'Complete!' })
            
            // Load results
            const cacheRes = await fetch(`${API_BASE}/cache`)
            const cacheData = await cacheRes.json()
            if (cacheData.success) {
              setAllUsers(cacheData.followingList || [])
              setIsEnriched(true)
              const inactive = (cacheData.followingList || []).filter(u => isInactive(u)).length
              showToast(`Done — ${inactive} inactive accounts found`)
            }
            
            setIsFetching(false)
          }
        } catch (err) {
          console.error('Progress poll error:', err)
        }
      }, 500)

    } catch (err) {
      showToast('Fetch failed: ' + err.message, 5000)
      setIsFetching(false)
    }
  }

  // Cancel fetch
  const cancelFetch = async () => {
    try {
      await fetch(`${API_BASE}/cancel`, { method: 'POST' })
      if (progressInterval.current) clearInterval(progressInterval.current)
      setIsFetching(false)
      setProgress({ phase: '', percent: 0, text: '' })
      showToast('Fetch cancelled')
    } catch (err) {
      console.error('Cancel error:', err)
    }
  }

  // Unfollow selected
  const startUnfollow = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return

    setIsUnfollowing(true)
    setUnfollowProgress({ done: 0, total: ids.length })

    try {
      const res = await fetch(`${API_BASE}/unfollow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: ids })
      })
      const data = await res.json()

      if (!data.success) {
        showToast(data.error || 'Unfollow failed', 5000)
        setIsUnfollowing(false)
        return
      }

      // Poll for progress
      const unfollowInterval = setInterval(async () => {
        try {
          const progRes = await fetch(`${API_BASE}/unfollow-progress`)
          const progData = await progRes.json()
          
          setUnfollowProgress({ done: progData.done, total: progData.total })
          
          if (progData.phase === 'done') {
            clearInterval(unfollowInterval)
            setIsUnfollowing(false)
            setSelectedIds(new Set())
            
            // Remove unfollowed from list
            const cacheRes = await fetch(`${API_BASE}/cache`)
            const cacheData = await cacheRes.json()
            if (cacheData.success) {
              setAllUsers(cacheData.followingList || [])
            }
            
            showToast(`Unfollowed ${progData.done} accounts`)
          } else if (progData.phase === 'cancelled') {
            clearInterval(unfollowInterval)
            setIsUnfollowing(false)
            showToast('Unfollow cancelled')
          }
        } catch (err) {
          console.error('Unfollow progress error:', err)
        }
      }, 300)

    } catch (err) {
      showToast('Unfollow failed: ' + err.message, 5000)
      setIsUnfollowing(false)
    }
  }

  // Cancel unfollow
  const cancelUnfollow = async () => {
    try {
      await fetch(`${API_BASE}/cancel-unfollow`, { method: 'POST' })
      setIsUnfollowing(false)
      showToast('Unfollow cancelled')
    } catch (err) {
      console.error('Cancel unfollow error:', err)
    }
  }

  // Clear cache
  const clearCache = async () => {
    try {
      await fetch(`${API_BASE}/cache`, { method: 'DELETE' })
      setAllUsers([])
      setSelectedIds(new Set())
      setIsEnriched(false)
      showToast('Cache cleared')
    } catch (err) {
      console.error('Clear cache error:', err)
    }
  }

  // Classification helpers
  const isNoTweets = user => user.statusesCount === 0
  const isUnknown = user => !isNoTweets(user) && !user.lastTweetAt && !!user.activityChecked
  const isInactive = user => {
    if (user.statusesCount === 0) return false
    if (user.lastTweetAt) {
      const diffMs = Date.now() - new Date(user.lastTweetAt).getTime()
      return Math.floor(diffMs / 86400000) > threshold
    }
    return false
  }

  // Get filtered & sorted users
  const getViewUsers = () => {
    let filtered
    switch (currentView) {
      case 'none': filtered = allUsers.filter(isNoTweets); break
      case 'unknown': filtered = allUsers.filter(isUnknown); break
      case 'inactive': filtered = allUsers.filter(u => !isNoTweets(u) && !isUnknown(u) && isInactive(u)); break
      case 'active': filtered = allUsers.filter(u => !isNoTweets(u) && !isUnknown(u) && !isInactive(u)); break
      default: filtered = allUsers
    }

    // Sort
    return [...filtered].sort((a, b) => {
      switch (currentSort) {
        case 'inactive-first': {
          const ai = isInactive(a), bi = isInactive(b)
          if (ai && !bi) return -1
          if (!ai && bi) return 1
          if (ai && bi) {
            const ad = a.lastTweetAt ? new Date(a.lastTweetAt).getTime() : 0
            const bd = b.lastTweetAt ? new Date(b.lastTweetAt).getTime() : 0
            return ad - bd
          }
          return 0
        }
        case 'oldest-first': {
          const ad = a.lastTweetAt ? new Date(a.lastTweetAt).getTime() : 0
          const bd = b.lastTweetAt ? new Date(b.lastTweetAt).getTime() : 0
          return ad - bd
        }
        case 'newest-first': {
          const ad = a.lastTweetAt ? new Date(a.lastTweetAt).getTime() : 0
          const bd = b.lastTweetAt ? new Date(b.lastTweetAt).getTime() : 0
          return bd - ad
        }
        case 'followers': return (b.followersCount || 0) - (a.followersCount || 0)
        default: return 0
      }
    })
  }

  // Toggle selection
  const toggleSelect = userId => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  // Select all visible
  const toggleAllVisible = () => {
    const visibleIds = getViewUsers().map(u => u.id)
    const allSelected = visibleIds.every(id => selectedIds.has(id))
    
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(visibleIds))
    }
  }

  // Count stats
  const stats = {
    total: allUsers.length,
    none: allUsers.filter(isNoTweets).length,
    unknown: allUsers.filter(isUnknown).length,
    inactive: allUsers.filter(u => !isNoTweets(u) && !isUnknown(u) && isInactive(u)).length,
    active: allUsers.filter(u => !isNoTweets(u) && !isUnknown(u) && !isInactive(u)).length
  }

  // Initialize
  useEffect(() => {
    checkLogin()
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  // Render
  return (
    <div className="app-container">
      {/* Menu bar */}
      <div className="menu-bar">
        <div className="menu-bar-left">
          <span className="menu-item" style={{ fontWeight: 'bold' }}>◉</span>
          <span className="menu-item">File</span>
          <span className="menu-item">Edit</span>
          <span className="menu-item">View</span>
          <span className="menu-item">Help</span>
        </div>
        <div className="menu-bar-right">
          <span className="menu-item">{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      {/* Desktop */}
      <div className="desktop">
        <div className="mac-window">
          {/* Title bar */}
          <div className="title-bar">
            <div className="title-bar-buttons">
              <div className="title-bar-btn">×</div>
              <div className="title-bar-btn">−</div>
              <div className="title-bar-btn">□</div>
            </div>
            <div className="title-bar-text">Mass Unfollow — X/Twitter</div>
          </div>

          {/* Toolbar */}
          <div className="toolbar">
            <button 
              className="toolbar-btn primary" 
              onClick={startFetch}
              disabled={isFetching || !loggedIn}
            >
              {isFetching ? 'Fetching…' : 'Load Following'}
            </button>
            
            {isFetching && (
              <button className="toolbar-btn" onClick={cancelFetch}>
                Stop
              </button>
            )}

            <div className="toolbar-separator" />

            <div className="threshold-selector">
              <span className="toolbar-label">Inactive &gt;</span>
              <select 
                className="threshold-select"
                value={threshold}
                onChange={e => setThreshold(Number(e.target.value))}
              >
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>1 year</option>
              </select>
            </div>

            <div className="toolbar-separator" />

            <select 
              className="threshold-select"
              value={currentSort}
              onChange={e => setCurrentSort(e.target.value)}
            >
              <option value="inactive-first">Inactive First</option>
              <option value="oldest-first">Oldest First</option>
              <option value="newest-first">Newest First</option>
              <option value="followers">Most Followers</option>
            </select>

            <div className="toolbar-separator" />

            <button 
              className="toolbar-btn"
              onClick={clearCache}
              disabled={allUsers.length === 0}
            >
              Clear Cache
            </button>
          </div>

          {/* Progress bar */}
          {(isFetching || isEnriching) && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
              <div className="progress-label">{progress.text}</div>
            </div>
          )}

          {/* Unfollow progress */}
          {isUnfollowing && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${(unfollowProgress.done / unfollowProgress.total) * 100}%` }} />
              <div className="progress-label">
                Unfollowing: {unfollowProgress.done}/{unfollowProgress.total}
              </div>
            </div>
          )}

          {/* Tabs */}
          {allUsers.length > 0 && (
            <div className="tabs">
              <div 
                className={`tab ${currentView === 'none' ? 'active' : ''}`}
                onClick={() => setCurrentView('none')}
              >
                No Tweets <span className="tab-count">{stats.none}</span>
              </div>
              <div 
                className={`tab ${currentView === 'unknown' ? 'active' : ''}`}
                onClick={() => setCurrentView('unknown')}
              >
                Unknown <span className="tab-count">{stats.unknown}</span>
              </div>
              <div 
                className={`tab ${currentView === 'inactive' ? 'active' : ''}`}
                onClick={() => setCurrentView('inactive')}
              >
                Inactive <span className="tab-count">{stats.inactive}</span>
              </div>
              <div 
                className={`tab ${currentView === 'active' ? 'active' : ''}`}
                onClick={() => setCurrentView('active')}
              >
                Active <span className="tab-count">{stats.active}</span>
              </div>
            </div>
          )}

          {/* Stats bar */}
          {allUsers.length > 0 && (
            <div className="stats-bar">
              <span>{stats.total} following</span>
              <span>{selectedIds.size} selected</span>
              <span>{stats.inactive} inactive</span>
            </div>
          )}

          {/* Content area */}
          <div className="content-area">
            {/* Not logged in */}
            {!loggedIn && status.state !== 'checking' && (
              <div className="login-section">
                <div className="login-title">Not Connected</div>
                <div className="login-description">
                  Open x.com in your browser and log in first.<br />
                  Then refresh this page.
                </div>
                <button className="toolbar-btn primary" onClick={checkLogin}>
                  Retry Connection
                </button>
              </div>
            )}

            {/* Guide */}
            {loggedIn && showGuide && allUsers.length === 0 && (
              <div className="guide-section">
                <div className="guide-title">Quick Start</div>
                <ol className="guide-steps">
                  <li>Click <strong>Load Following</strong> to fetch your following list</li>
                  <li>Wait for activity check to complete (may take a few minutes)</li>
                  <li>Review accounts in each tab (No Tweets, Unknown, Inactive, Active)</li>
                  <li>Select accounts to unfollow using checkboxes</li>
                  <li>Click <strong>Unfollow Selected</strong> to remove them</li>
                </ol>
              </div>
            )}

            {/* Loading */}
            {loggedIn && isFetching && allUsers.length === 0 && (
              <div className="loading">
                <div className="loading-spinner" />
                <span>Fetching following list…</span>
              </div>
            )}

            {/* Account list */}
            {allUsers.length > 0 && (
              <>
                <div style={{ padding: '4px 8px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="toolbar-btn" onClick={toggleAllVisible}>
                    {getViewUsers().every(u => selectedIds.has(u.id)) ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <ul className="account-list">
                  {getViewUsers().map(user => (
                    <li 
                      key={user.id} 
                      className={`account-item ${selectedIds.has(user.id) ? 'selected' : ''} ${isInactive(user) ? 'inactive' : ''}`}
                      onClick={() => toggleSelect(user.id)}
                    >
                      <div className={`account-checkbox ${selectedIds.has(user.id) ? 'checked' : ''}`}>
                        {selectedIds.has(user.id) ? '✓' : ''}
                      </div>
                      <img 
                        className="account-avatar" 
                        src={user.profileImageUrl || '/default-avatar.png'} 
                        alt=""
                        onError={e => e.target.style.display = 'none'}
                      />
                      <div className="account-info">
                        <div className="account-name">{escHtml(user.name)}</div>
                        <div className="account-handle">@{escHtml(user.screenName)}</div>
                      </div>
                      <div className="account-meta">
                        {isEnriched && (
                          <>
                            {isNoTweets(user) && <span className="badge badge-never">No Tweets</span>}
                            {isUnknown(user) && <span className="badge badge-checking">Unknown</span>}
                            {!isNoTweets(user) && !isUnknown(user) && isInactive(user) && (
                              <span className="badge badge-inactive">Inactive</span>
                            )}
                            {!isNoTweets(user) && !isUnknown(user) && !isInactive(user) && (
                              <span className="badge badge-active">Active</span>
                            )}
                          </>
                        )}
                        <span className="account-last-tweet">
                          {isEnriched ? formatDate(user.lastTweetAt) : ''}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* Empty state */}
            {allUsers.length === 0 && !isFetching && loggedIn && !showGuide && (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <div className="empty-state-text">
                  No accounts loaded.<br />
                  Click <strong>Load Following</strong> to start.
                </div>
              </div>
            )}
          </div>

          {/* Unfollow footer */}
          {selectedIds.size > 0 && (
            <div style={{ 
              padding: '8px', 
              background: 'var(--mac-light-gray)', 
              borderTop: '1px solid var(--mac-black)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontFamily: 'var(--font-system)', fontSize: '11px' }}>
                {selectedIds.size} account{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                {isUnfollowing && (
                  <button className="toolbar-btn" onClick={cancelUnfollow}>
                    Cancel
                  </button>
                )}
                <button 
                  className="toolbar-btn primary"
                  onClick={startUnfollow}
                  disabled={isUnfollowing}
                >
                  {isUnfollowing ? 'Unfollowing…' : `Unfollow ${selectedIds.size}`}
                </button>
              </div>
            </div>
          )}

          {/* Status bar */}
          <div className="status-bar">
            <div className={`status-indicator ${status.state}`} />
            <span>{status.text}</span>
          </div>
        </div>
      </div>

      {/* Toast */}
      <div className={`toast ${toast.visible ? 'visible' : ''}`}>
        {toast.text}
      </div>
    </div>
  )
}
