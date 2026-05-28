// ==UserScript==
// @name         Mass Unfollow for X
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Find and unfollow inactive X/Twitter accounts
// @author       exd77
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-end
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // ===== CONFIG =====
    const CONFIG = {
        UNFOLLOW_DELAY_MS: 2000,
        FETCH_PAGE_DELAY_MS: 600,
        RATE_LIMIT_BACKOFF_MS: 65000,
        ENRICH_CONCURRENCY: 5,
    };

    // ===== STATE =====
    let state = {
        bearerToken: null,
        csrfToken: null,
        userId: null,
        username: null,
        isLoggedIn: false,
        followingList: [],
        isFetching: false,
        isUnfollowing: false,
        fetchGeneration: 0,
        unfollowGeneration: 0,
        progress: { phase: '', page: 0, total: 0 },
    };

    // ===== STYLES =====
    const STYLES = `
        #mu-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 400px;
            max-height: 80vh;
            background: #fffff0;
            border: 2px solid #000;
            box-shadow: 4px 4px 0 rgba(0,0,0,0.3);
            z-index: 999999;
            font-family: 'Geneva', 'Lucida Grande', sans-serif;
            font-size: 12px;
            color: #000;
            display: none;
            overflow: hidden;
        }
        #mu-panel.open { display: flex; flex-direction: column; }
        
        #mu-header {
            background: linear-gradient(180deg, #fff 0%, #ddd 100%);
            padding: 4px 8px;
            border-bottom: 1px solid #000;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
        }
        #mu-header span { font-size: 11px; }
        
        #mu-close {
            width: 12px;
            height: 12px;
            background: #fff;
            border: 1px solid #000;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 9px;
        }
        #mu-close:hover { background: #ccc; }
        
        #mu-content {
            padding: 12px;
            overflow-y: auto;
            flex: 1;
        }
        
        #mu-toolbar {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
            flex-wrap: wrap;
            align-items: center;
        }
        
        .mu-btn {
            padding: 4px 12px;
            background: #ddd;
            border: 2px outset #eee;
            cursor: pointer;
            font-size: 11px;
            font-family: inherit;
        }
        .mu-btn:hover { background: #ccc; }
        .mu-btn:active { border-style: inset; }
        .mu-btn.primary {
            background: #3366cc;
            color: #fff;
            border-color: #3366cc;
        }
        .mu-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .mu-select {
            padding: 2px 4px;
            font-size: 11px;
            border: 1px inset #888;
        }
        
        #mu-status {
            padding: 6px 8px;
            background: #eee;
            border: 1px inset #888;
            margin-bottom: 12px;
            font-size: 10px;
        }
        
        #mu-progress {
            height: 16px;
            background: #fff;
            border: 1px inset #888;
            margin-bottom: 12px;
            display: none;
            position: relative;
        }
        #mu-progress.active { display: block; }
        #mu-progress-fill {
            height: 100%;
            background: repeating-linear-gradient(-45deg, #3366cc, #3366cc 4px, #888 4px, #888 8px);
            width: 0%;
            transition: width 0.3s;
        }
        #mu-progress-text {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: bold;
            text-shadow: 0 0 2px #fff;
        }
        
        #mu-tabs {
            display: flex;
            border-bottom: 1px solid #000;
            margin-bottom: 8px;
        }
        .mu-tab {
            padding: 4px 10px;
            cursor: pointer;
            border-right: 1px solid #888;
            font-size: 10px;
        }
        .mu-tab.active { background: #fff; font-weight: bold; }
        .mu-tab:hover:not(.active) { background: #ddd; }
        .mu-tab-count { color: #666; margin-left: 4px; }
        
        #mu-account-list {
            max-height: 300px;
            overflow-y: auto;
            border: 1px inset #888;
            background: #fff;
        }
        
        .mu-account {
            display: flex;
            align-items: center;
            padding: 4px 8px;
            border-bottom: 1px solid #eee;
            gap: 8px;
            cursor: pointer;
        }
        .mu-account:hover { background: #f0f0f0; }
        .mu-account.selected { background: #3366cc; color: #fff; }
        .mu-account.selected .mu-account-handle { color: #ccc; }
        
        .mu-checkbox {
            width: 12px;
            height: 12px;
            border: 1px solid #000;
            background: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
        }
        .mu-account.selected .mu-checkbox { background: #fff; color: #000; }
        
        .mu-avatar {
            width: 28px;
            height: 28px;
            border: 1px solid #000;
            object-fit: cover;
        }
        
        .mu-account-info { flex: 1; min-width: 0; }
        .mu-account-name { font-weight: bold; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mu-account-handle { font-size: 10px; color: #666; }
        
        .mu-badge {
            padding: 1px 5px;
            font-size: 9px;
            border: 1px solid #000;
        }
        .mu-badge-inactive { background: #cc8800; color: #fff; }
        .mu-badge-never { background: #cc0000; color: #fff; }
        .mu-badge-active { background: #008800; color: #fff; }
        
        #mu-footer {
            padding: 8px;
            background: #eee;
            border-top: 1px solid #000;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        #mu-toggle {
            position: fixed;
            top: 100px;
            right: 20px;
            width: 40px;
            height: 40px;
            background: #3366cc;
            color: #fff;
            border: 2px solid #000;
            border-radius: 4px;
            cursor: pointer;
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999998;
            box-shadow: 2px 2px 0 rgba(0,0,0,0.3);
        }
        #mu-toggle:hover { background: #4477dd; }
        
        .mu-loading {
            text-align: center;
            padding: 20px;
            color: #666;
        }
        
        .mu-empty {
            text-align: center;
            padding: 30px 10px;
            color: #888;
        }
    `;

    // ===== HELPERS =====
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function getCsrfToken() {
        const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
        return m ? m[1] : null;
    }

    function getAuthToken() {
        const m = document.cookie.match(/(?:^|;\s*)auth_token=([^;]+)/);
        return m ? m[1] : null;
    }

    function getUserId() {
        const m = document.cookie.match(/(?:^|;\s*)twid=u%3D(\d+)/);
        return m ? m[1] : null;
    }

    async function getBearerToken() {
        // Fetch from page scripts
        const scripts = document.querySelectorAll('script[src*="main"]');
        for (const script of scripts) {
            try {
                const res = await fetch(script.src, { credentials: 'omit' });
                const text = await res.text();
                const match = text.match(/AAAAAAAAAAAAAAAAAAAAANRILgAAAAA[A-Za-z0-9%+/=]{60,}/);
                if (match) return match[0];
            } catch (e) {}
        }
        // Fallback
        return 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I7wHoABWeg%3DZHRM8OMAz5e0fhMQqeyqlZMEaYAFIKyRmDQiLHJU4vasE4GMLY';
    }

    function buildHeaders() {
        return {
            'authorization': `Bearer ${state.bearerToken}`,
            'x-csrf-token': state.csrfToken,
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'en',
            'content-type': 'application/json',
        };
    }

    async function xFetch(url, options = {}) {
        const res = await fetch(url, {
            ...options,
            headers: { ...buildHeaders(), ...(options.headers || {}) },
            credentials: 'include',
        });

        if (res.status === 429) {
            const resetTs = res.headers.get('x-rate-limit-reset');
            const waitMs = resetTs ? Math.max(0, Number(resetTs) * 1000 - Date.now()) + 2000 : CONFIG.RATE_LIMIT_BACKOFF_MS;
            throw { type: 'RATE_LIMIT', waitMs };
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        }

        return res.json();
    }

    // ===== API FUNCTIONS =====
    async function fetchFollowingPage(userId, cursor) {
        const params = new URLSearchParams({
            user_id: userId,
            count: '200',
            skip_status: '0',
            include_user_entities: '0',
        });
        if (cursor) params.set('cursor', cursor);

        const data = await xFetch(`https://x.com/i/api/1.1/friends/list.json?${params}`);

        const users = (data?.users || []).map(u => ({
            id: u.id_str,
            screenName: u.screen_name,
            name: u.name,
            profileImageUrl: (u.profile_image_url_https || '').replace('_normal', '_bigger'),
            followersCount: u.followers_count,
            statusesCount: u.statuses_count,
            lastTweetAt: u.status?.created_at ? new Date(u.status.created_at).toISOString() : null,
            isRetweet: !!u.status?.retweeted_status,
            protected: u.protected || false,
        }));

        return {
            users,
            nextCursor: data?.next_cursor_str !== '0' ? data?.next_cursor_str : null,
        };
    }

    async function fetchAllFollowing(userId, gen) {
        const all = [];
        let cursor = null;
        let page = 0;

        while (true) {
            if (state.fetchGeneration > gen) throw { type: 'CANCELLED' };

            const result = await fetchFollowingPage(userId, cursor);
            all.push(...result.users);
            page++;
            state.progress = { phase: 'fetch_page', page, total: all.length };
            updateProgress();

            if (!result.nextCursor || result.users.length === 0) break;
            cursor = result.nextCursor;
            await sleep(CONFIG.FETCH_PAGE_DELAY_MS);
        }

        return all;
    }

    async function fetchLastTweetDate(userId, includeRts = false) {
        const params = new URLSearchParams({
            user_id: userId,
            count: '1',
            include_rts: includeRts ? '1' : '0',
            exclude_replies: '0',
            tweet_mode: 'extended',
        });

        try {
            const data = await xFetch(`https://x.com/i/api/1.1/statuses/user_timeline.json?${params}`);
            if (Array.isArray(data) && data.length > 0 && data[0].created_at) {
                return new Date(data[0].created_at).toISOString();
            }
        } catch (e) {
            if (e.type !== 'RATE_LIMIT') console.warn('fetchLastTweetDate failed:', e);
            throw e;
        }
        return null;
    }

    async function enrichWithActivity(users, gen) {
        let completed = 0;
        const queue = [...users];
        const workers = [];

        for (let i = 0; i < CONFIG.ENRICH_CONCURRENCY; i++) {
            workers.push((async () => {
                while (queue.length > 0 && state.fetchGeneration === gen) {
                    const user = queue.shift();
                    if (!user || user.protected || user.statusesCount === 0) {
                        completed++;
                        state.progress = { phase: 'enrich', index: completed, total: users.length };
                        updateProgress();
                        continue;
                    }

                    try {
                        const date = await fetchLastTweetDate(user.id);
                        user.lastTweetAt = date;
                        if (!date) {
                            const rtDate = await fetchLastTweetDate(user.id, true);
                            if (rtDate) user.lastTweetAt = rtDate;
                        }
                    } catch (e) {
                        if (e.type === 'RATE_LIMIT') {
                            state.progress = { phase: 'rate_limit', waitMs: e.waitMs };
                            updateProgress();
                            await sleep(e.waitMs);
                            queue.unshift(user);
                        }
                    }

                    completed++;
                    state.progress = { phase: 'enrich', index: completed, total: users.length };
                    updateProgress();
                    await sleep(100);
                }
            })());
        }

        await Promise.all(workers);
        return users;
    }

    async function unfollowUser(userId) {
        await xFetch('https://x.com/i/api/1.1/friendships/destroy.json', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: `user_id=${userId}`,
        });
    }

    async function unfollowQueue(userIds, gen) {
        let done = 0;
        const failed = [];

        for (const userId of userIds) {
            if (state.unfollowGeneration > gen) return;

            try {
                await unfollowUser(userId);
                done++;
            } catch (e) {
                if (e.type === 'RATE_LIMIT') {
                    await sleep(e.waitMs);
                    continue;
                }
                failed.push(userId);
            }

            state.progress = { phase: 'unfollow', done, total: userIds.length };
            updateProgress();
            await sleep(CONFIG.UNFOLLOW_DELAY_MS);
        }

        return { done, failed };
    }

    // ===== UI FUNCTIONS =====
    let currentView = 'all';

    function formatDate(isoStr) {
        if (!isoStr) return '—';
        const days = Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000);
        if (days < 1) return 'Today';
        if (days < 2) return 'Yesterday';
        if (days < 30) return `${days}d ago`;
        if (days < 365) return `${Math.floor(days / 30)}mo ago`;
        return `${Math.floor(days / 365)}y ago`;
    }

    function isInactive(user, threshold = 90) {
        if (!user.lastTweetAt || user.statusesCount === 0) return false;
        const diff = Math.floor((Date.now() - new Date(user.lastTweetAt).getTime()) / 86400000);
        return diff > threshold;
    }

    function getStatusBadge(user) {
        if (user.statusesCount === 0) return '<span class="mu-badge mu-badge-never">No Tweets</span>';
        if (!user.lastTweetAt) return '<span class="mu-badge" style="background:#888;color:#fff">Unknown</span>';
        if (isInactive(user)) return '<span class="mu-badge mu-badge-inactive">Inactive</span>';
        return '<span class="mu-badge mu-badge-active">Active</span>';
    }

    function getFilteredUsers() {
        const threshold = parseInt(document.getElementById('mu-threshold')?.value || '90');
        switch (currentView) {
            case 'no-tweets': return state.followingList.filter(u => u.statusesCount === 0);
            case 'unknown': return state.followingList.filter(u => u.statusesCount > 0 && !u.lastTweetAt);
            case 'inactive': return state.followingList.filter(u => isInactive(u, threshold));
            case 'active': return state.followingList.filter(u => !isInactive(u, threshold) && u.lastTweetAt);
            default: return state.followingList;
        }
    }

    function updateProgress() {
        const el = document.getElementById('mu-progress-fill');
        const text = document.getElementById('mu-progress-text');
        const progress = document.getElementById('mu-progress');

        if (!el || !text || !progress) return;

        progress.classList.add('active');

        if (state.progress.phase === 'fetch_page') {
            const pct = Math.min(5 + state.progress.page * 3, 70);
            el.style.width = `${pct}%`;
            text.textContent = `Page ${state.progress.page} — ${state.progress.total} accounts`;
        } else if (state.progress.phase === 'enrich') {
            const pct = 70 + Math.round((state.progress.index / state.progress.total) * 30);
            el.style.width = `${pct}%`;
            text.textContent = `Checking: ${state.progress.index}/${state.progress.total}`;
        } else if (state.progress.phase === 'rate_limit') {
            text.textContent = `Rate limited — waiting ${Math.ceil(state.progress.waitMs / 1000)}s`;
        } else if (state.progress.phase === 'unfollow') {
            el.style.width = `${(state.progress.done / state.progress.total) * 100}%`;
            text.textContent = `Unfollowing: ${state.progress.done}/${state.progress.total}`;
        } else if (state.progress.phase === 'done') {
            el.style.width = '100%';
            text.textContent = 'Done!';
            setTimeout(() => progress.classList.remove('active'), 2000);
        }
    }

    function renderList() {
        const container = document.getElementById('mu-account-list');
        if (!container) return;

        const users = getFilteredUsers();
        const threshold = parseInt(document.getElementById('mu-threshold')?.value || '90');

        if (users.length === 0) {
            container.innerHTML = '<div class="mu-empty">No accounts loaded.<br>Click "Load Following" to start.</div>';
            return;
        }

        container.innerHTML = users.map(u => `
            <div class="mu-account" data-id="${u.id}" onclick="window.muToggleSelect('${u.id}')">
                <div class="mu-checkbox">${u.selected ? '✓' : ''}</div>
                <img class="mu-avatar" src="${u.profileImageUrl}" onerror="this.style.display='none'">
                <div class="mu-account-info">
                    <div class="mu-account-name">${u.name.replace(/</g, '&lt;')}</div>
                    <div class="mu-account-handle">@${u.screenName}</div>
                </div>
                ${getStatusBadge(u)}
                <span style="font-size:10px;color:#666">${formatDate(u.lastTweetAt)}</span>
            </div>
        `).join('');

        updateCounts();
    }

    function updateCounts() {
        const threshold = parseInt(document.getElementById('mu-threshold')?.value || '90');
        const noTweets = state.followingList.filter(u => u.statusesCount === 0).length;
        const unknown = state.followingList.filter(u => u.statusesCount > 0 && !u.lastTweetAt).length;
        const inactive = state.followingList.filter(u => isInactive(u, threshold)).length;
        const active = state.followingList.filter(u => !isInactive(u, threshold) && u.lastTweetAt).length;
        const selected = state.followingList.filter(u => u.selected).length;

        const tabs = document.querySelectorAll('.mu-tab');
        tabs.forEach(tab => {
            const view = tab.dataset.view;
            const count = view === 'no-tweets' ? noTweets :
                         view === 'unknown' ? unknown :
                         view === 'inactive' ? inactive :
                         view === 'active' ? active :
                         state.followingList.length;
            tab.querySelector('.mu-tab-count').textContent = count;
        });

        const footer = document.getElementById('mu-footer');
        if (footer) {
            footer.innerHTML = `
                <span>${state.followingList.length} following · ${selected} selected</span>
                <button class="mu-btn primary" onclick="window.muUnfollow()" ${selected === 0 || state.isUnfollowing ? 'disabled' : ''}>
                    ${state.isUnfollowing ? 'Unfollowing…' : `Unfollow (${selected})`}
                </button>
            `;
        }
    }

    window.muToggleSelect = function(id) {
        const user = state.followingList.find(u => u.id === id);
        if (user) {
            user.selected = !user.selected;
            renderList();
        }
    };

    window.muSelectAll = function() {
        const users = getFilteredUsers();
        const allSelected = users.every(u => u.selected);
        users.forEach(u => u.selected = !allSelected);
        renderList();
    };

    window.muUnfollow = async function() {
        const selected = state.followingList.filter(u => u.selected).map(u => u.id);
        if (selected.length === 0) return;

        if (!confirm(`Unfollow ${selected.length} accounts?`)) return;

        state.isUnfollowing = true;
        state.unfollowGeneration++;
        const gen = state.unfollowGeneration;

        updateStatus('Unfollowing…');
        const result = await unfollowQueue(selected, gen);

        if (result) {
            state.followingList = state.followingList.filter(u => !result.failed.includes(u.id));
            updateStatus(`Done! Unfollowed ${result.done} accounts${result.failed.length ? `, ${result.failed.length} failed` : ''}.`);
        }

        state.isUnfollowing = false;
        renderList();
    };

    function updateStatus(text) {
        const el = document.getElementById('mu-status');
        if (el) el.textContent = text;
    }

    function createPanel() {
        // Add styles
        GM_addStyle(STYLES);

        // Create toggle button
        const toggle = document.createElement('div');
        toggle.id = 'mu-toggle';
        toggle.innerHTML = '👤';
        toggle.onclick = () => {
            const panel = document.getElementById('mu-panel');
            panel.classList.toggle('open');
        };
        document.body.appendChild(toggle);

        // Create panel
        const panel = document.createElement('div');
        panel.id = 'mu-panel';
        panel.innerHTML = `
            <div id="mu-header">
                <span>Mass Unfollow — X/Twitter</span>
                <div id="mu-close" onclick="document.getElementById('mu-panel').classList.remove('open')">✕</div>
            </div>
            <div id="mu-content">
                <div id="mu-status">Click "Load Following" to start</div>
                <div id="mu-progress">
                    <div id="mu-progress-fill"></div>
                    <div id="mu-progress-text"></div>
                </div>
                <div id="mu-toolbar">
                    <button class="mu-btn primary" onclick="window.muLoadFollowing()">Load Following</button>
                    <button class="mu-btn" onclick="window.muStop()" id="mu-stop-btn" style="display:none">Stop</button>
                    <span style="font-size:10px">Inactive ></span>
                    <select class="mu-select" id="mu-threshold" onchange="renderList()">
                        <option value="30">30 days</option>
                        <option value="90" selected>90 days</option>
                        <option value="180">180 days</option>
                        <option value="365">1 year</option>
                    </select>
                </div>
                <div id="mu-tabs">
                    <div class="mu-tab active" data-view="all" onclick="window.muSwitchTab('all')">All <span class="mu-tab-count">0</span></div>
                    <div class="mu-tab" data-view="no-tweets" onclick="window.muSwitchTab('no-tweets')">No Tweets <span class="mu-tab-count">0</span></div>
                    <div class="mu-tab" data-view="unknown" onclick="window.muSwitchTab('unknown')">Unknown <span class="mu-tab-count">0</span></div>
                    <div class="mu-tab" data-view="inactive" onclick="window.muSwitchTab('inactive')">Inactive <span class="mu-tab-count">0</span></div>
                    <div class="mu-tab" data-view="active" onclick="window.muSwitchTab('active')">Active <span class="mu-tab-count">0</span></div>
                </div>
                <div id="mu-account-list">
                    <div class="mu-empty">No accounts loaded.<br>Click "Load Following" to start.</div>
                </div>
                <div style="padding:4px 0">
                    <button class="mu-btn" onclick="window.muSelectAll()">Select All</button>
                </div>
            </div>
            <div id="mu-footer">
                <span>0 following · 0 selected</span>
                <button class="mu-btn primary" disabled>Unfollow (0)</button>
            </div>
        `;
        document.body.appendChild(panel);

        // Make draggable
        const header = panel.querySelector('#mu-header');
        let isDragging = false, offsetX, offsetY;
        header.onmousedown = (e) => {
            isDragging = true;
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;
        };
        document.onmousemove = (e) => {
            if (isDragging) {
                panel.style.left = (e.clientX - offsetX) + 'px';
                panel.style.top = (e.clientY - offsetY) + 'px';
                panel.style.right = 'auto';
            }
        };
        document.onmouseup = () => isDragging = false;
    }

    window.muSwitchTab = function(view) {
        currentView = view;
        document.querySelectorAll('.mu-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
        renderList();
    };

    window.muLoadFollowing = async function() {
        state.csrfToken = getCsrfToken();
        state.bearerToken = await getBearerToken();
        state.userId = getUserId();

        if (!state.csrfToken || !state.userId) {
            updateStatus('Not logged in. Please log in to x.com first.');
            return;
        }

        state.isFetching = true;
        state.fetchGeneration++;
        const gen = state.fetchGeneration;

        document.getElementById('mu-stop-btn').style.display = 'inline-block';
        updateStatus('Fetching following list…');

        try {
            const users = await fetchAllFollowing(state.userId, gen);
            updateStatus(`Enriching ${users.length} accounts…`);
            const enriched = await enrichWithActivity(users, gen);
            state.followingList = enriched;
            state.progress = { phase: 'done' };
            updateProgress();
            updateStatus(`Done! ${enriched.length} accounts loaded.`);
            renderList();
        } catch (e) {
            if (e.type === 'CANCELLED') {
                updateStatus('Cancelled.');
            } else {
                updateStatus(`Error: ${e.message}`);
            }
        }

        state.isFetching = false;
        document.getElementById('mu-stop-btn').style.display = 'none';
    };

    window.muStop = function() {
        state.fetchGeneration++;
        state.isFetching = false;
        updateStatus('Stopped.');
        document.getElementById('mu-stop-btn').style.display = 'none';
    };

    // Initialize
    createPanel();
    console.log('Mass Unfollow loaded! Click the button on the right to open.');

})();
