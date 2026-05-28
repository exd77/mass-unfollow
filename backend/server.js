import express from 'express'
import cors from 'cors'
import fetch from 'node-fetch'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, '.env') })

const app = express()
const PORT = process.env.PORT || 3000
const HOST = '0.0.0.0'

// Middleware
app.use(cors())
app.use(express.json())

// Serve static frontend (production build)
const distPath = join(__dirname, '..', 'frontend', 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  console.log(`Serving frontend from: ${distPath}`)
}

// X API constants
let FALLBACK_BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I7wHoABWeg%3DZHRM8OMAz5e0fhMQqeyqlZMEaYAFIKyRmDQiLHJU4vasE4GMLY'
const UNFOLLOW_DELAY_MS = 2000
const FETCH_PAGE_DELAY_MS = 600
const RATE_LIMIT_BACKOFF_MS = 65000
const ENRICH_CONCURRENCY = 5

// Fetch fresh bearer token from X's JS bundles
async function fetchBearerToken() {
  console.log('Fetching fresh bearer token from x.com…')
  
  // Strategy 1: Try known bearer token that works with cookies
  // This is the public web client token that X uses
  const publicToken = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I7wHoABWeg%3DZHRM8OMAz5e0fhMQqeyqlZMEaYAFIKyRmDQiLHJU4vasE4GMLY'
  
  // Test if the public token works with current cookies
  if (process.env.X_AUTH_TOKEN && process.env.X_CT0) {
    try {
      const testRes = await fetch('https://x.com/i/api/1.1/account/verify_credentials.json?include_email=true', {
        headers: {
          'authorization': `Bearer ${publicToken}`,
          'x-csrf-token': process.env.X_CT0,
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-active-user': 'yes',
          'x-twitter-client-language': 'en',
          'cookie': `ct0=${process.env.X_CT0}; auth_token=${process.env.X_AUTH_TOKEN}`
        }
      })
      
      if (testRes.ok) {
        console.log('Public bearer token works!')
        return publicToken
      } else {
        console.log(`Public token test: ${testRes.status}`)
      }
    } catch (e) {
      console.warn('Token test failed:', e.message)
    }
  }
  
  // Strategy 2: Try to fetch from X's page
  try {
    const res = await fetch('https://x.com/i/flow/login', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      redirect: 'follow'
    })
    const html = await res.text()
    
    // Look for bearer token pattern
    const pattern = /AAAAAAAAAAAAAAAAAAAAANRILgAAAAA[A-Za-z0-9%+/=]{60,}/g
    const matches = html.match(pattern)
    if (matches && matches.length > 0) {
      console.log('Found bearer token in page')
      return matches[0]
    }
  } catch (e) {
    console.warn('Failed to fetch bearer token from page:', e.message)
  }
  
  // Fallback to public token
  console.log('Using public bearer token')
  return publicToken
}

// State
let state = {
  bearerToken: FALLBACK_BEARER_TOKEN,
  csrfToken: null,
  userId: null,
  username: null,
  isLoggedIn: false,
  followingList: [],
  fetchedAt: null,
  progress: { phase: '', page: 0, total: 0, waitMs: 0 },
  unfollowProgress: { phase: '', done: 0, total: 0, failed: [], errors: {} },
  fetchGeneration: 0,
  unfollowGeneration: 0,
  isFetching: false,
  isUnfollowing: false,
}

// Auth helpers
function getCsrfToken() {
  return state.csrfToken
}

function buildHeaders() {
  const csrf = getCsrfToken()
  if (!csrf) {
    throw new Error('Not authenticated — CSRF token missing')
  }
  return {
    'authorization': `Bearer ${state.bearerToken}`,
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'cookie': `ct0=${csrf}; auth_token=${process.env.X_AUTH_TOKEN || ''}`
  }
}

// Generic API fetch
async function xFetch(url, options = {}) {
  const shortUrl = url.split('?')[0]
  console.log(`→ ${options.method || 'GET'} ${shortUrl}`)

  let res
  try {
    res = await fetch(url, {
      ...options,
      headers: { ...buildHeaders(), ...(options.headers || {}) }
    })
  } catch (netErr) {
    console.error(`Network error: ${shortUrl}`, netErr.message)
    throw netErr
  }

  console.log(`← ${res.status} ${shortUrl}`)

  if (res.status === 429) {
    const resetTs = res.headers.get('x-rate-limit-reset')
    const waitMs = resetTs
      ? Math.max(0, Number(resetTs) * 1000 - Date.now()) + 2000
      : RATE_LIMIT_BACKOFF_MS
    console.warn(`Rate limited: ${shortUrl}`, { waitMs })
    throw { type: 'RATE_LIMIT', waitMs }
  }

  if (res.status === 401) {
    // Get response body for debugging
    const body = await res.text().catch(() => '')
    console.error('401 Unauthorized details:', {
      url: shortUrl,
      body: body.slice(0, 500),
      hasAuthToken: !!process.env.X_AUTH_TOKEN,
      hasCt0: !!process.env.X_CT0,
      hasBearerToken: !!state.bearerToken
    })
    state.bearerToken = null
    throw new Error(`401 — authentication failed. Response: ${body.slice(0, 200)}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }

  const text = await res.text().catch(() => '')
  if (!text.trim()) return null

  try {
    return JSON.parse(text)
  } catch (_) {
    throw new Error(`Malformed response from ${shortUrl}`)
  }
}

// Fetch following page
async function fetchFollowingPage(userId, cursor) {
  const params = new URLSearchParams({
    user_id: userId,
    count: '200',
    skip_status: '0',
    include_user_entities: '0'
  })
  if (cursor && cursor !== '0') params.set('cursor', cursor)

  const data = await xFetch(`https://x.com/i/api/1.1/friends/list.json?${params}`)

  const users = (data?.users || []).map(u => {
    let lastTweetAt = null
    let lastRetweetAt = null
    let activityChecked
    const s = u.status
    if (s && s.created_at) {
      try {
        const dateIso = new Date(s.created_at).toISOString()
        if (!s.retweeted_status) {
          lastTweetAt = dateIso
          activityChecked = true
        } else {
          lastRetweetAt = dateIso
        }
      } catch (_) {}
    }

    return {
      id: u.id_str,
      screenName: u.screen_name,
      name: u.name,
      profileImageUrl: (u.profile_image_url_https || '').replace('_normal', '_bigger'),
      followersCount: u.followers_count,
      friendsCount: u.friends_count,
      statusesCount: u.statuses_count,
      lastTweetAt,
      lastRetweetAt,
      activityChecked,
      protected: u.protected || false
    }
  })

  const nextCursor = (data?.next_cursor_str && data.next_cursor_str !== '0')
    ? data.next_cursor_str
    : null

  return { users, nextCursor }
}

// Fetch all following
async function fetchAllFollowing(userId, gen) {
  const all = []
  let cursor = null
  let page = 0

  while (true) {
    if (state.fetchGeneration > gen) throw { type: 'CANCELLED' }

    let result
    try {
      result = await fetchFollowingPage(userId, cursor)
    } catch (err) {
      if (err.type === 'RATE_LIMIT') {
        state.progress = { phase: 'rate_limit', waitMs: err.waitMs }
        await sleep(err.waitMs)
        continue
      }
      throw err
    }

    all.push(...result.users)
    page++
    state.progress = { phase: 'fetch_page', page, total: all.length }

    if (!result.nextCursor || result.users.length === 0) break
    cursor = result.nextCursor
    await sleep(FETCH_PAGE_DELAY_MS)
  }

  return all
}

// Fetch last tweet date
async function fetchLastTweetDate(userId, includeRts = false) {
  const params = new URLSearchParams({
    user_id: userId,
    count: '1',
    include_rts: includeRts ? '1' : '0',
    exclude_replies: '0',
    tweet_mode: 'extended'
  })

  try {
    const data = await xFetch(`https://x.com/i/api/1.1/statuses/user_timeline.json?${params}`)
    if (Array.isArray(data) && data.length > 0 && data[0].created_at) {
      return new Date(data[0].created_at).toISOString()
    }
    return null
  } catch (err) {
    if (err.type !== 'RATE_LIMIT') {
      console.warn('fetchLastTweetDate failed', { userId, message: err.message })
    }
    throw err
  }
}

// Enrich with activity
async function enrichWithActivity(users, gen) {
  let completedCount = 0
  let globalRateLimitRemaining = 900
  let globalRateLimitReset = 0

  const pool = createPool(ENRICH_CONCURRENCY)

  await Promise.all(users.map((user, i) => pool(async () => {
    if (state.fetchGeneration > gen) return

    if (user.activityChecked !== undefined) {
      if (user.lastTweetAt || user.statusesCount === 0 || user.protected) {
        completedCount++
        state.progress = { phase: 'enrich', index: completedCount, total: users.length, user }
        return
      }
    }

    if (user.protected) {
      user.lastTweetAt = null
      user.activityChecked = false
    } else if (user.statusesCount === 0) {
      user.lastTweetAt = null
      user.activityChecked = true
    } else {
      let retries = 0
      let emptyTries = 0
      while (retries < 3 && emptyTries < 3) {
        if (state.fetchGeneration > gen) return

        if (globalRateLimitRemaining < 50) {
          const waitMs = globalRateLimitReset
            ? Math.max(0, globalRateLimitReset - Date.now()) + 2000
            : RATE_LIMIT_BACKOFF_MS
          state.progress = { phase: 'rate_limit', waitMs }
          await sleep(waitMs)
          globalRateLimitRemaining = 900
        }

        try {
          const date = await fetchLastTweetDate(user.id)
          globalRateLimitRemaining--

          if (date) {
            user.lastTweetAt = date
            user.activityChecked = true
            break
          }
          emptyTries++
          if (emptyTries >= 3) {
            try {
              const rtDate = await fetchLastTweetDate(user.id, true)
              user.lastTweetAt = rtDate || user.lastRetweetAt || null
            } catch (_) {
              user.lastTweetAt = user.lastRetweetAt || null
            }
            user.activityChecked = true
            break
          }
          await sleep(2000)
        } catch (err) {
          if (err.type === 'RATE_LIMIT') {
            state.progress = { phase: 'rate_limit', waitMs: err.waitMs }
            await sleep(err.waitMs)
            retries++
          } else {
            user.lastTweetAt = user.lastRetweetAt || null
            user.activityChecked = true
            break
          }
        }
      }
    }

    completedCount++
    state.progress = { phase: 'enrich', index: completedCount, total: users.length, user }
  })))

  return users
}

// Unfollow user
async function unfollowUser(userId) {
  const result = await xFetch('https://x.com/i/api/1.1/friendships/destroy.json', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `user_id=${userId}`
  })
  if (result?.errors?.length) {
    const errMsg = result.errors.map(e => e.message || JSON.stringify(e)).join(', ')
    throw new Error(`Unfollow API error: ${errMsg}`)
  }
}

// Unfollow queue
async function unfollowQueue(userIds, gen) {
  let done = 0
  const failed = []
  const errors = {}

  for (const userId of userIds) {
    if (state.unfollowGeneration > gen) {
      state.unfollowProgress = { phase: 'cancelled', done, total: userIds.length, failed, errors }
      return
    }

    let retries = 0
    while (retries < 3) {
      try {
        await unfollowUser(userId)
        done++
        state.unfollowProgress = { phase: 'progress', done, total: userIds.length, userId }
        await sleep(UNFOLLOW_DELAY_MS)
        break
      } catch (err) {
        if (err.type === 'RATE_LIMIT') {
          state.unfollowProgress = { phase: 'rate_limit', waitMs: err.waitMs, done, total: userIds.length }
          await sleep(err.waitMs)
          retries++
          if (retries >= 3) {
            failed.push(userId)
            errors[userId] = 'Rate limited after 3 retries'
            state.unfollowProgress = { phase: 'error', userId, error: errors[userId], done, total: userIds.length }
            await sleep(UNFOLLOW_DELAY_MS)
          }
        } else {
          const errMsg = err.message || String(err)
          failed.push(userId)
          errors[userId] = errMsg
          state.unfollowProgress = { phase: 'error', userId, error: errMsg, done, total: userIds.length }
          await sleep(UNFOLLOW_DELAY_MS)
          break
        }
      }
    }
  }

  state.unfollowProgress = { phase: 'done', done, total: userIds.length, failed, errors }
}

// Concurrency pool
function createPool(concurrency) {
  const queue = []
  let running = 0
  function drain() {
    while (running < concurrency && queue.length) {
      running++
      const task = queue.shift()
      task().finally(() => { running--; drain() })
    }
  }
  return (fn) => new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject))
    drain()
  })
}

// Sleep helper
const sleep = ms => new Promise(r => setTimeout(r, ms))

// API Routes

// Health check
app.get('/api/ping', (req, res) => {
  res.json({
    success: true,
    loggedIn: state.isLoggedIn,
    username: state.username,
    userId: state.userId,
    tokenReady: !!state.bearerToken && state.bearerToken !== FALLBACK_BEARER_TOKEN
  })
})

// Login with cookies
app.post('/api/login', async (req, res) => {
  const { authToken, ct0 } = req.body

  if (!authToken || !ct0) {
    return res.json({ success: false, error: 'Missing auth_token or ct0' })
  }

  // Update cookies
  process.env.X_AUTH_TOKEN = authToken
  process.env.X_CT0 = ct0
  state.csrfToken = ct0
  
  // Fetch fresh bearer token
  state.bearerToken = await fetchBearerToken()
  
  try {
    // Verify credentials - try multiple endpoints
    let data = null
    
    // Try v2 endpoint first
    try {
      data = await xFetch('https://x.com/i/api/1.1/account/verify_credentials.json?include_email=true')
    } catch (e) {
      // Try alternative endpoint
      try {
        data = await xFetch('https://x.com/i/api/1.1/account/verify_credentials.json?skip_status=true')
      } catch (e2) {
        // Try without params
        data = await xFetch('https://x.com/i/api/1.1/account/verify_credentials.json')
      }
    }
    
    if (data?.id_str || data?.data?.id_str) {
      state.userId = data.id_str || data?.data?.id_str
      state.username = data.screen_name || data?.data?.username
      state.isLoggedIn = true
      
      console.log(`✓ Logged in as @${state.username} (${state.userId})`)
      
      res.json({ 
        success: true, 
        userId: state.userId, 
        username: state.username,
        tokenReady: true
      })
    } else {
      res.json({ success: false, error: 'Invalid credentials' })
    }
  } catch (err) {
    console.error('Login error:', err.message)
    
    // If 401, cookies are likely expired or invalid
    if (err.message.includes('401')) {
      res.json({ 
        success: false, 
        error: 'Your session cookies are expired or invalid. Get fresh cookies from x.com (F12 → Application → Cookies → Copy auth_token & ct0).'
      })
    } else {
      res.json({ success: false, error: err.message })
    }
  }
})

// Fetch following
app.post('/api/fetch', async (req, res) => {
  if (!state.isLoggedIn) {
    return res.json({ success: false, error: 'Not logged in' })
  }

  if (state.isFetching) {
    return res.json({ success: false, error: 'Already fetching' })
  }

  state.isFetching = true
  state.fetchGeneration++
  const gen = state.fetchGeneration

  res.json({ success: true })

  try {
    const users = await fetchAllFollowing(state.userId, gen)
    
    const existingMap = new Map(state.followingList.map(u => [u.id, u]))
    const merged = users.map(u => {
      const prev = existingMap.get(u.id)
      if (prev) {
        const hasFreshData = u.activityChecked !== undefined
        return {
          ...u,
          lastTweetAt: hasFreshData ? u.lastTweetAt : prev.lastTweetAt,
          activityChecked: hasFreshData ? u.activityChecked : prev.activityChecked
        }
      }
      return u
    })

    state.followingList = merged
    state.fetchedAt = Date.now()

    const enriched = await enrichWithActivity(merged, gen)
    state.followingList = enriched
    
    state.progress = { phase: 'done', page: 0, total: enriched.length }
  } catch (err) {
    if (err.type === 'CANCELLED') {
      state.progress = { phase: 'cancelled' }
    } else {
      console.error('Fetch error:', err.message)
      state.progress = { phase: 'error', error: err.message }
    }
  } finally {
    state.isFetching = false
  }
})

// Get progress
app.get('/api/progress', (req, res) => {
  res.json(state.progress)
})

// Get unfollow progress
app.get('/api/unfollow-progress', (req, res) => {
  res.json(state.unfollowProgress)
})

// Cancel fetch
app.post('/api/cancel', (req, res) => {
  state.fetchGeneration++
  state.isFetching = false
  state.progress = { phase: 'cancelled' }
  res.json({ success: true })
})

// Unfollow
app.post('/api/unfollow', async (req, res) => {
  const { userIds } = req.body

  if (!state.isLoggedIn) {
    return res.json({ success: false, error: 'Not logged in' })
  }

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return res.json({ success: false, error: 'No user IDs provided' })
  }

  if (state.isUnfollowing) {
    return res.json({ success: false, error: 'Already unfollowing' })
  }

  state.isUnfollowing = true
  state.unfollowGeneration++
  const gen = state.unfollowGeneration

  res.json({ success: true })

  try {
    await unfollowQueue(userIds, gen)
    
    const unfollowedIds = new Set(userIds.filter(id => !state.unfollowProgress.failed.includes(id)))
    state.followingList = state.followingList.filter(u => !unfollowedIds.has(u.id))
  } catch (err) {
    console.error('Unfollow error:', err.message)
  } finally {
    state.isUnfollowing = false
  }
})

// Cancel unfollow
app.post('/api/cancel-unfollow', (req, res) => {
  state.unfollowGeneration++
  state.isUnfollowing = false
  state.unfollowProgress = { phase: 'cancelled', done: 0, total: 0 }
  res.json({ success: true })
})

// Get cached data
app.get('/api/cache', (req, res) => {
  res.json({
    success: true,
    followingList: state.followingList,
    fetchedAt: state.fetchedAt
  })
})

// Clear cache
app.delete('/api/cache', (req, res) => {
  state.followingList = []
  state.fetchedAt = null
  state.progress = { phase: '', page: 0, total: 0 }
  state.unfollowProgress = { phase: '', done: 0, total: 0 }
  res.json({ success: true })
})

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (existsSync(join(distPath, 'index.html'))) {
    res.sendFile(join(distPath, 'index.html'))
  } else {
    res.status(404).send('Frontend not built. Run: cd frontend && npm run build')
  }
})

// Auto-login from env
async function autoLogin() {
  const authToken = process.env.X_AUTH_TOKEN
  const ct0 = process.env.X_CT0

  if (authToken && ct0) {
    console.log('Auto-login from environment variables…')
    state.csrfToken = ct0
    state.bearerToken = FALLBACK_BEARER_TOKEN

    try {
      const data = await xFetch('https://x.com/i/api/1.1/account/verify_credentials.json')
      if (data?.id_str) {
        state.userId = data.id_str
        state.username = data.screen_name
        state.isLoggedIn = true
        console.log(`✓ Logged in as @${state.username} (${state.userId})`)
      }
    } catch (err) {
      console.warn('Auto-login failed:', err.message)
    }
  }
}

// Start server
app.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║  Mass Unfollow — Production Server                    ║
╠═══════════════════════════════════════════════════════╣
║  URL: http://0.0.0.0:${PORT}                            ║
║  Frontend: ${existsSync(distPath) ? '✓ Serving' : '✗ Not built'}                               ║
║  API: /api/*                                          ║
╚═══════════════════════════════════════════════════════╝
  `)
  autoLogin()
})
