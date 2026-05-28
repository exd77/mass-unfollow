// X Unfollower Classic — Popup Logic

const API_BASE = 'https://x.com/i/api';
const BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=';

// State
let state = {
  authToken: '',
  ct0: '',
  userId: '',
  following: [],
  filteredFollowing: [],
  activeTab: 'inactive',
  selected: new Set(),
  daysThreshold: 90,
  autoDetected: false
};

// DOM Elements
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupEventListeners();
  await autoDetectSession();
}

// Auto-detect session from x.com cookies
async function autoDetectSession() {
  updateStatus('Checking session...', '');
  
  try {
    // Get auth_token from x.com cookies
    const cookies = await chrome.cookies.getAll({ domain: '.x.com' });
    const authToken = cookies.find(c => c.name === 'auth_token');
    const ct0Cookie = cookies.find(c => c.name === 'ct0');
    const twidCookie = cookies.find(c => c.name === 'twid');

    if (!authToken || !ct0Cookie) {
      updateStatus('Not logged in to x.com', 'error');
      $('#status-hint').textContent = 'Login to x.com first, then reopen this popup';
      return;
    }

    // Extract values
    state.authToken = authToken.value;
    state.ct0 = ct0Cookie.value;
    state.autoDetected = true;

    // Extract user_id from twid cookie
    if (twidCookie) {
      const match = twidCookie.value.match(/(\d{10,})/);
      if (match) state.userId = match[1];
    }

    // Validate session with a quick API call
    const isValid = await validateSession();
    
    if (isValid) {
      // Update UI - show masked values
      $('#auth-token').value = state.authToken.substring(0, 8) + '••••••••';
      $('#ct0').value = state.ct0.substring(0, 8) + '••••••••';
      
      // Save to storage for reference
      await chrome.storage.local.set({
        authToken: state.authToken,
        ct0: state.ct0,
        userId: state.userId
      });

      updateStatus('Auto-detected from x.com', 'ready');
      $('#status-hint').textContent = state.userId ? `User ID: ${state.userId}` : 'Session valid';
      $('#btn-fetch').disabled = false;
      $('#session-source').textContent = '🍪 Browser cookies';
      $('#session-source').style.display = 'block';
    } else {
      updateStatus('Session expired', 'error');
      $('#status-hint').textContent = 'Please login to x.com again';
    }
  } catch (e) {
    console.error('Auto-detect failed:', e);
    updateStatus('Auto-detect failed', 'error');
    $('#status-hint').textContent = 'Enter credentials manually';
  }
}

async function validateSession() {
  try {
    // Quick verification - get user info
    const params = new URLSearchParams({
      variables: JSON.stringify({
        userId: state.userId || '0',
        count: 1
      }),
      features: JSON.stringify({
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false
      })
    });

    const response = await fetch(`${API_BASE}/graphql/Y1M3RrTqM8TqJ3h9s0s7Sg/UserTweets?${params}`, {
      headers: {
        'authorization': BEARER,
        'x-csrf-token': state.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'cookie': `auth_token=${state.authToken}; ct0=${state.ct0}`
      }
    });

    return response.ok;
  } catch (e) {
    return false;
  }
}

// Fallback: Manual session save
async function saveSession() {
  const authTokenInput = $('#auth-token').value.trim();
  const ct0Input = $('#ct0').value.trim();
  
  if (!authTokenInput || !ct0Input) {
    updateStatus('Missing credentials', 'error');
    return;
  }

  // Check if it's masked (auto-detected) or new input
  if (authTokenInput.includes('••••') || ct0Input.includes('••••')) {
    // Already using auto-detected values
    return;
  }

  state.authToken = authTokenInput;
  state.ct0 = ct0Input;
  
  // Extract user ID if not auto-detected
  if (!state.userId) {
    state.userId = await extractUserIdFromCookies();
  }

  await chrome.storage.local.set({
    authToken: state.authToken,
    ct0: state.ct0,
    userId: state.userId
  });

  updateStatus('Session saved', 'ready');
  $('#status-hint').textContent = state.userId ? `User ID: ${state.userId}` : '';
  $('#btn-fetch').disabled = false;
  $('#session-source').textContent = '💾 Manual input';
  $('#session-source').style.display = 'block';
}

async function extractUserIdFromCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: '.x.com' });
    const twid = cookies.find(c => c.name === 'twid');
    if (twid) {
      const match = twid.value.match(/(\d{10,})/);
      if (match) return match[1];
    }
  } catch (e) {
    console.error('Cookie extraction failed:', e);
  }
  return '';
}

// Refresh session (re-detect cookies)
async function refreshSession() {
  state.autoDetected = false;
  state.authToken = '';
  state.ct0 = '';
  state.userId = '';
  $('#session-source').style.display = 'none';
  await autoDetectSession();
}

// Event Listeners
function setupEventListeners() {
  $('#btn-save').addEventListener('click', saveSession);
  $('#btn-fetch').addEventListener('click', fetchFollowing);
  $('#btn-unfollow').addEventListener('click', unfollowSelected);
  $('#btn-refresh').addEventListener('click', refreshSession);
  
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  $('#days-threshold').addEventListener('change', (e) => {
    state.daysThreshold = parseInt(e.target.value);
    filterFollowing();
  });
}

// API Calls
async function fetchFollowing() {
  if (!state.authToken || !state.ct0) {
    updateStatus('No session', 'error');
    return;
  }

  showProgress(true);
  state.following = [];
  state.selected.clear();
  
  let cursor = null;
  let page = 0;
  const maxPages = 50;

  while (page < maxPages) {
    try {
      const result = await fetchFollowingPage(cursor);
      
      if (!result.users || result.users.length === 0) break;

      for (const user of result.users) {
        state.following.push({
          id: user.id,
          screenName: user.screen_name,
          name: user.name,
          avatar: user.profile_image_url_https,
          followers: user.followers_count,
          following: user.friends_count,
          lastTweet: null,
          daysInactive: null,
          status: 'unknown'
        });
      }

      updateProgress(`Fetched ${state.following.length} accounts...`);
      
      if (!result.cursor) break;
      cursor = result.cursor;
      page++;

      await sleep(200);
    } catch (e) {
      console.error('Fetch error:', e);
      updateStatus('Fetch failed: ' + e.message, 'error');
      break;
    }
  }

  await checkActivity();
  
  filterFollowing();
  showProgress(false);
  showResults();
  updateStatus(`Loaded ${state.following.length} accounts`, 'ready');
}

async function fetchFollowingPage(cursor) {
  const params = new URLSearchParams({
    variables: JSON.stringify({
      userId: state.userId,
      count: 200,
      includePromotedContent: false,
      ...(cursor ? { cursor } : {})
    }),
    features: JSON.stringify({
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      rweb_video_timestamps_enabled: true,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      responsive_web_media_download_video_enabled: false,
      responsive_web_enhance_cards_enabled: false
    })
  });

  const response = await fetch(`${API_BASE}/graphql/2vUj-_Ek-UmBVDNtd8OnQA/Following?${params}`, {
    headers: {
      'authorization': BEARER,
      'x-csrf-token': state.ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'cookie': `auth_token=${state.authToken}; ct0=${state.ct0}`
    }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  const timeline = data?.data?.user?.result?.timeline?.timeline?.instructions?.[0];
  
  if (!timeline) return { users: [], cursor: null };

  const entries = timeline.entries || [];
  const users = [];
  let nextCursor = null;

  for (const entry of entries) {
    const content = entry?.content?.itemContent?.user_results?.result;
    if (content?.legacy) {
      users.push(content.legacy);
    }
    if (entry?.content?.entryType === 'TimelineTimelineCursor' && 
        entry?.content?.cursorType === 'Bottom') {
      nextCursor = entry.content.value;
    }
  }

  return { users, cursor: nextCursor };
}

async function checkActivity() {
  updateProgress('Checking activity...');
  
  const batchSize = 5;
  for (let i = 0; i < state.following.length; i += batchSize) {
    const batch = state.following.slice(i, i + batchSize);
    await Promise.all(batch.map(checkUserActivity));
    updateProgress(`Checking activity: ${Math.min(i + batchSize, state.following.length)}/${state.following.length}`);
    await sleep(300);
  }
}

async function checkUserActivity(user) {
  try {
    const params = new URLSearchParams({
      variables: JSON.stringify({
        userId: user.id,
        count: 5,
        includePromotedContent: false
      }),
      features: JSON.stringify({
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        rweb_video_timestamps_enabled: true
      })
    });

    const response = await fetch(`${API_BASE}/graphql/Y1M3RrTqM8TqJ3h9s0s7Sg/UserTweets?${params}`, {
      headers: {
        'authorization': BEARER,
        'x-csrf-token': state.ct0,
        'x-twitter-auth-type': 'OAuth2Session',
        'cookie': `auth_token=${state.authToken}; ct0=${state.ct0}`
      }
    });

    if (!response.ok) {
      user.status = 'unknown';
      return;
    }

    const data = await response.json();
    const tweets = data?.data?.user?.result?.timeline_v2?.timeline?.instructions?.[0]?.entries || [];
    
    if (tweets.length === 0) {
      user.status = 'no_tweets';
      user.daysInactive = null;
      return;
    }

    let latestTweet = null;
    for (const entry of tweets) {
      const tweet = entry?.content?.itemContent?.tweet_results?.result;
      if (tweet?.legacy?.created_at) {
        latestTweet = new Date(tweet.legacy.created_at);
        break;
      }
    }

    if (latestTweet) {
      const days = Math.floor((Date.now() - latestTweet.getTime()) / (1000 * 60 * 60 * 24));
      user.lastTweet = latestTweet;
      user.daysInactive = days;
      user.status = days >= state.daysThreshold ? 'inactive' : 'active';
    } else {
      user.status = 'unknown';
    }
  } catch (e) {
    console.error('Activity check failed:', e);
    user.status = 'unknown';
  }
}

async function unfollowSelected() {
  const toUnfollow = state.selected.size > 0 
    ? state.filteredFollowing.filter(u => state.selected.has(u.id) && u.status === 'inactive')
    : state.filteredFollowing.filter(u => u.status === 'inactive');

  if (toUnfollow.length === 0) {
    updateStatus('No accounts to unfollow', 'error');
    return;
  }

  showProgress(true);
  updateProgress(`Unfollowing 0/${toUnfollow.length}...`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < toUnfollow.length; i++) {
    const user = toUnfollow[i];
    try {
      await unfollowUser(user.id);
      user.status = 'unfollowed';
      success++;
    } catch (e) {
      console.error(`Unfollow failed for @${user.screenName}:`, e);
      failed++;
    }
    updateProgress(`Unfollowing ${i + 1}/${toUnfollow.length}...`);
    await sleep(1000);
  }

  showProgress(false);
  filterFollowing();
  updateStatus(`Done: ${success} unfollowed, ${failed} failed`, failed > 0 ? 'error' : 'ready');
}

async function unfollowUser(userId) {
  const params = new URLSearchParams({
    include_profile_interstitial_type: '1',
    skip_status: 'true',
    user_id: userId
  });

  const response = await fetch(`${API_BASE}/1.1/friendships/destroy.json?${params}`, {
    method: 'POST',
    headers: {
      'authorization': BEARER,
      'x-csrf-token': state.ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'cookie': `auth_token=${state.authToken}; ct0=${state.ct0}`,
      'content-type': 'application/x-www-form-urlencoded'
    }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

// Filtering & Display
function filterFollowing() {
  const threshold = state.daysThreshold;
  
  state.filteredFollowing = state.following.filter(u => {
    if (state.activeTab === 'inactive') {
      return u.status === 'inactive' || (u.status === 'no_tweets' && threshold >= 90);
    } else if (state.activeTab === 'active') {
      return u.status === 'active';
    } else {
      return u.status === 'unknown';
    }
  });

  renderUserList();
  updateCounts();
}

function switchTab(tab) {
  state.activeTab = tab;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  filterFollowing();
}

function renderUserList() {
  const list = $('#user-list');
  list.innerHTML = '';

  if (state.filteredFollowing.length === 0) {
    list.innerHTML = '<div class="list-item" style="justify-content:center;color:var(--text-muted)">No accounts in this category</div>';
    return;
  }

  const sorted = [...state.filteredFollowing].sort((a, b) => {
    if (a.daysInactive === null) return 1;
    if (b.daysInactive === null) return -1;
    return b.daysInactive - a.daysInactive;
  });

  for (const user of sorted.slice(0, 100)) {
    const item = document.createElement('div');
    item.className = 'list-item' + (state.selected.has(user.id) ? ' selected' : '');
    item.innerHTML = `
      <input type="checkbox" ${state.selected.has(user.id) ? 'checked' : ''} data-id="${user.id}">
      <img class="avatar" src="${user.avatar}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><rect fill=%22%23ddd%22 width=%2224%22 height=%2224%22/><text x=%2212%22 y=%2216%22 text-anchor=%22middle%22 fill=%22%23888%22 font-size=%2212%22>?</text></svg>'">
      <div class="info">
        <div class="username">@${user.screenName}</div>
        <div class="activity">${user.daysInactive !== null ? user.daysInactive + ' days ago' : user.status}</div>
      </div>
      ${user.daysInactive !== null ? `<span class="days-badge">${user.daysInactive}d</span>` : ''}
    `;
    
    item.querySelector('input').addEventListener('change', (e) => {
      toggleSelection(user.id, e.target.checked);
    });

    list.appendChild(item);
  }
}

function toggleSelection(id, selected) {
  if (selected) {
    state.selected.add(id);
  } else {
    state.selected.delete(id);
  }
  updateCounts();
  
  const item = $(`.list-item input[data-id="${id}"]`)?.closest('.list-item');
  if (item) item.classList.toggle('selected', selected);
}

function updateCounts() {
  const inactive = state.following.filter(u => u.status === 'inactive').length;
  const active = state.following.filter(u => u.status === 'active').length;
  const unknown = state.following.filter(u => u.status === 'unknown' || u.status === 'no_tweets').length;

  $('#count-inactive').textContent = inactive;
  $('#count-active').textContent = active;
  $('#count-unknown').textContent = unknown;

  $('#total-count').textContent = state.following.length;
  $('#selected-count').textContent = state.selected.size;
  
  const toUnfollow = state.selected.size > 0 
    ? state.filteredFollowing.filter(u => state.selected.has(u.id) && u.status === 'inactive').length
    : inactive;
  $('#unfollow-count').textContent = toUnfollow;

  $('#btn-unfollow').disabled = toUnfollow === 0;
}

// UI Helpers
function updateStatus(text, type) {
  $('#status-text').textContent = text;
  $('#status-dot').className = 'status-dot' + (type === 'ready' ? ' ready' : type === 'error' ? ' error' : '');
  $('#footer-status').textContent = text;
}

function showProgress(show) {
  $('#progress-section').style.display = show ? 'block' : 'none';
}

function updateProgress(text) {
  const following = state.following.length;
  const total = following || 1;
  const percent = Math.min(100, (following / Math.max(total, 1)) * 100);
  $('#progress-fill').style.width = percent + '%';
  $('#progress-text').textContent = text;
}

function showResults() {
  $('#results-section').style.display = 'block';
  $('#summary-section').style.display = 'flex';
  filterFollowing();
}

// Utilities
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
