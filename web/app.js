// Mass Unfollow — Mac Classic Frontend

const API = '';
let ws = null;
let sessionId = null;
let followingList = [];
let currentTab = 'inactive';
let sortField = 'last_activity';

// Cache DOM elements
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// Clock update
function updateClock() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    $('clock').textContent = `${hour}:${m} ${ampm}`;
}
setInterval(updateClock, 10000);
updateClock();

// WebSocket
function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);
    
    ws.onopen = () => {
        console.log('WS connected');
        setInterval(() => ws.readyState === 1 && ws.send('ping'), 30000);
    };
    
    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        handleMessage(data);
    };
    
    ws.onclose = () => setTimeout(connectWebSocket, 3000);
}

function handleMessage(data) {
    switch (data.type) {
        case 'progress':
            updateProgress(data);
            break;
        case 'fetch_complete':
            onFetchComplete(data.data);
            break;
        case 'unfollow_progress':
            updateUnfollowProgress(data);
            break;
        case 'unfollow_complete':
            onUnfollowComplete(data.result);
            break;
        case 'error':
            setStatus(`Error: ${data.message}`);
            break;
    }
}

function setStatus(text) {
    $('status-text').textContent = text;
}

function updateProgress(data) {
    const { progress, total, message, phase } = data;
    const percent = total > 0 ? Math.round((progress / total) * 100) : 0;
    
    $('fetch-progress').style.width = `${percent}%`;
    $('fetch-count').textContent = `${progress.toLocaleString()} users`;
    setStatus(message);
}

function updateUnfollowProgress(data) {
    const { progress, total, message } = data;
    const percent = total > 0 ? Math.round((progress / total) * 100) : 0;
    
    $('unfollow-progress').style.width = `${percent}%`;
    $('unfollow-count').textContent = `${progress} / ${total}`;
    setStatus(message);
}

// Ready button - save credentials
$('btn-ready').onclick = () => {
    const auth_token = $('auth_token').value.trim();
    const ct0 = $('ct0').value.trim();
    const user_id = $('user_id').value.trim();
    
    if (auth_token && ct0 && user_id) {
        localStorage.setItem('mass_unfollow_creds', JSON.stringify({ auth_token, ct0, user_id }));
        $('btn-ready').innerHTML = '<span class="status-dot" style="background:#00ff00"></span> Saved';
        setStatus('Credentials saved to localStorage');
    } else {
        setStatus('Missing credentials!');
    }
};

// Load credentials from localStorage
function loadCredentials() {
    const saved = localStorage.getItem('mass_unfollow_creds');
    if (saved) {
        try {
            const { auth_token, ct0, user_id } = JSON.parse(saved);
            $('auth_token').value = auth_token || '';
            $('ct0').value = ct0 || '';
            $('user_id').value = user_id || '';
        } catch (e) {}
    }
}

// Load Following
$('btn-load').onclick = async () => {
    const auth_token = $('auth_token').value.trim();
    const ct0 = $('ct0').value.trim();
    const user_id = $('user_id').value.trim();
    const days_threshold = parseInt($('days-threshold').value);
    
    if (!auth_token || !ct0 || !user_id) {
        setStatus('Missing credentials! Fill all fields and click Ready.');
        return;
    }
    
    $('btn-load').disabled = true;
    $('btn-stop').disabled = false;
    setStatus('Connecting...');
    
    try {
        const res = await fetch(`${API}/api/fetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auth_token, ct0, user_id, days_threshold })
        });
        
        const data = await res.json();
        
        if (res.ok) {
            sessionId = data.session_id;
            setStatus('Fetching following list...');
        } else {
            setStatus(`Error: ${data.detail}`);
            $('btn-load').disabled = false;
            $('btn-stop').disabled = true;
        }
    } catch (e) {
        setStatus(`Connection error: ${e.message}`);
        $('btn-load').disabled = false;
        $('btn-stop').disabled = true;
    }
};

// Stop
$('btn-stop').onclick = () => {
    // Just UI feedback - actual stop would need server support
    $('btn-load').disabled = false;
    $('btn-stop').disabled = true;
    setStatus('Stopped');
};

// Clear Cache
$('btn-clear').onclick = () => {
    localStorage.removeItem('mass_unfollow_creds');
    followingList = [];
    $('auth_token').value = '';
    $('ct0').value = '';
    $('user_id').value = '';
    $('btn-ready').innerHTML = '<span class="status-dot"></span> Ready';
    renderUserList();
    updateStats();
    setStatus('Cache cleared');
};

// Tab switching
$$('.tab').forEach(tab => {
    tab.onclick = () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.tab;
        renderUserList();
    };
});

// Sort by activity
$('sort-activity').onclick = () => {
    sortField = sortField === 'last_activity' ? 'last_activity_asc' : 'last_activity';
    renderUserList();
};

// Select all checkbox
$('select-all').onchange = (e) => {
    const users = getFilteredUsers();
    users.forEach(u => u.selected = e.target.checked);
    renderUserList();
    updateStats();
};

// Handle fetch complete
function onFetchComplete(data) {
    followingList = data.following || [];
    
    $('btn-load').disabled = false;
    $('btn-stop').disabled = true;
    
    updateStats();
    renderUserList();
    setStatus(`Loaded ${followingList.length} accounts`);
}

// Get filtered users by current tab
function getFilteredUsers() {
    const threshold = parseInt($('days-threshold').value);
    
    switch (currentTab) {
        case 'no-tweets':
            return followingList.filter(u => u.statuses_count === 0);
        case 'unknown':
            return followingList.filter(u => u.statuses_count > 0 && u.days_inactive === null);
        case 'inactive':
            return followingList.filter(u => u.is_inactive || u.days_inactive >= threshold);
        case 'active':
            return followingList.filter(u => !u.is_inactive && u.days_inactive !== null && u.days_inactive < threshold);
        default:
            return followingList;
    }
}

// Update stats
function updateStats() {
    const threshold = parseInt($('days-threshold').value);
    
    const noTweets = followingList.filter(u => u.statuses_count === 0).length;
    const unknown = followingList.filter(u => u.statuses_count > 0 && u.days_inactive === null).length;
    const inactive = followingList.filter(u => u.is_inactive || u.days_inactive >= threshold).length;
    const active = followingList.filter(u => !u.is_inactive && u.days_inactive !== null && u.days_inactive < threshold).length;
    const selected = followingList.filter(u => u.selected).length;
    
    $('stat-total').textContent = followingList.length.toLocaleString();
    $('stat-no-tweets').textContent = noTweets.toLocaleString();
    $('stat-unknown').textContent = unknown.toLocaleString();
    $('stat-inactive').textContent = inactive.toLocaleString();
    $('stat-active').textContent = active.toLocaleString();
    $('stat-selected').textContent = selected.toLocaleString();
    $('stat-will-unfollow').textContent = selected.toLocaleString();
    
    // Tab counts
    $('count-no-tweets').textContent = `[${noTweets}]`;
    $('count-unknown').textContent = `[${unknown}]`;
    $('count-inactive').textContent = `[${inactive}]`;
    $('count-active').textContent = `[${active}]`;
    
    // Unfollow button
    $('btn-unfollow').disabled = selected === 0;
}

// Render user list
function renderUserList() {
    let users = getFilteredUsers();
    
    // Sort
    if (sortField === 'last_activity') {
        users.sort((a, b) => (b.days_inactive || 9999) - (a.days_inactive || 9999));
    } else if (sortField === 'last_activity_asc') {
        users.sort((a, b) => (a.days_inactive || 9999) - (b.days_inactive || 9999));
    }
    
    const tbody = $('user-list');
    
    if (users.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No accounts in this category</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.slice(0, 200).map(user => {
        const days = user.days_inactive;
        let activityText = '—';
        let statusBadge = '';
        
        if (user.statuses_count === 0) {
            activityText = 'No tweets';
            statusBadge = '<span class="badge badge-no-tweets">No Tweets</span>';
        } else if (days === null) {
            activityText = '—';
            statusBadge = '<span class="badge badge-unknown">Unknown</span>';
        } else if (days > 365) {
            activityText = `${Math.floor(days / 365)}y ago`;
            statusBadge = '<span class="badge badge-inactive">Inactive</span>';
        } else if (days > 30) {
            activityText = `${days}d ago`;
            statusBadge = '<span class="badge badge-inactive">Inactive</span>';
        } else {
            activityText = days === 0 ? 'Today' : `${days}d ago`;
            statusBadge = '<span class="badge badge-active">Active</span>';
        }
        
        const defaultAvatar = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect fill="%23ccc" width="32" height="32"/><text x="16" y="20" text-anchor="middle" fill="%23666" font-size="12">?</text></svg>';
        
        return `
            <tr class="${user.selected ? 'selected' : ''}" data-id="${user.id}">
                <td class="col-check">
                    <input type="checkbox" ${user.selected ? 'checked' : ''}>
                </td>
                <td class="col-user">
                    <div class="user-cell">
                        <img class="user-avatar" src="${user.profile_image_url || defaultAvatar}" 
                             onerror="this.src='${defaultAvatar}'">
                        <div class="user-info">
                            <div class="user-name">${escapeHtml(user.name)}</div>
                            <div class="user-handle">@${user.screen_name}</div>
                        </div>
                    </div>
                </td>
                <td class="col-activity">${activityText}</td>
                <td class="col-followers">${formatNum(user.followers_count)}</td>
                <td class="col-status">${statusBadge}</td>
            </tr>
        `;
    }).join('');
    
    // Add click handlers
    tbody.querySelectorAll('tr[data-id]').forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        
        row.onclick = (e) => {
            if (e.target.type !== 'checkbox') {
                checkbox.checked = !checkbox.checked;
            }
            toggleUser(row.dataset.id, checkbox.checked);
        };
        
        checkbox.onchange = (e) => {
            e.stopPropagation();
            toggleUser(row.dataset.id, checkbox.checked);
        };
    });
}

function toggleUser(id, selected) {
    const user = followingList.find(u => u.id === id);
    if (user) {
        user.selected = selected;
        updateStats();
    }
}

// Unfollow
$('btn-unfollow').onclick = async () => {
    const selected = followingList.filter(u => u.selected);
    
    if (selected.length === 0) return;
    
    if (!confirm(`Unfollow ${selected.length} accounts? This cannot be undone!`)) return;
    
    $('btn-unfollow').disabled = true;
    setStatus('Starting unfollow...');
    
    try {
        const res = await fetch(`${API}/api/unfollow/${sessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_ids: selected.map(u => u.id),
                days_threshold: parseInt($('days-threshold').value)
            })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            setStatus(`Error: ${data.detail}`);
            $('btn-unfollow').disabled = false;
        }
    } catch (e) {
        setStatus(`Error: ${e.message}`);
        $('btn-unfollow').disabled = false;
    }
};

function onUnfollowComplete(result) {
    setStatus(`Done! ${result.success} unfollowed, ${result.failed} failed`);
    $('unfollow-progress').style.width = '100%';
    $('unfollow-count').textContent = `${result.success} / ${result.total}`;
    
    // Remove unfollowed users from list
    const unfollowedIds = result.users
        .filter(u => u.unfollow_status === 'success')
        .map(u => u.id);
    
    followingList = followingList.filter(u => !unfollowedIds.includes(u.id));
    
    updateStats();
    renderUserList();
    
    $('btn-unfollow').disabled = false;
}

// Utilities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function formatNum(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num?.toString() || '0';
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    loadCredentials();
    setStatus('Ready — Enter credentials and click Load Following');
});
