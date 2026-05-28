// Mass Unfollow - Frontend App

const API = '';  // Same origin
let ws = null;
let sessionId = null;
let followingList = [];
let inactiveList = [];
let currentTab = 'all';
let daysThreshold = 90;

// DOM Elements
const elements = {
    loginSection: document.getElementById('login-section'),
    progressSection: document.getElementById('progress-section'),
    resultsSection: document.getElementById('results-section'),
    unfollowSection: document.getElementById('unfollow-section'),
    doneSection: document.getElementById('done-section'),
    
    loginForm: document.getElementById('login-form'),
    authToken: document.getElementById('auth_token'),
    ct0: document.getElementById('ct0'),
    userId: document.getElementById('user_id'),
    daysThreshold: document.getElementById('days_threshold'),
    
    progressTitle: document.getElementById('progress-title'),
    progressFill: document.getElementById('progress-fill'),
    progressText: document.getElementById('progress-text'),
    progressDetail: document.getElementById('progress-detail'),
    
    statFollowing: document.getElementById('stat-following'),
    statInactive: document.getElementById('stat-inactive'),
    statActive: document.getElementById('stat-active'),
    
    filterThreshold: document.getElementById('filter-threshold'),
    userList: document.getElementById('user-list'),
    selectedCount: document.getElementById('selected-count'),
    btnUnfollow: document.getElementById('btn-unfollow'),
    btnSelectAll: document.getElementById('btn-select-all'),
    btnDeselectAll: document.getElementById('btn-deselect-all'),
    
    unfollowProgressFill: document.getElementById('unfollow-progress-fill'),
    unfollowProgressText: document.getElementById('unfollow-progress-text'),
    unfollowProgressDetail: document.getElementById('unfollow-progress-detail'),
    
    resultSuccess: document.getElementById('result-success'),
    resultFailed: document.getElementById('result-failed'),
    btnStartOver: document.getElementById('btn-start-over'),
};

// WebSocket connection
function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        // Keep alive
        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('ping');
            }
        }, 30000);
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
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
            alert('Error: ' + data.message);
            break;
        case 'pong':
            break;
    }
}

// Show/hide sections
function showSection(sectionId) {
    ['login', 'progress', 'results', 'unfollow', 'done'].forEach(id => {
        const section = document.getElementById(`${id}-section`);
        if (section) {
            section.style.display = id === sectionId ? 'block' : 'none';
        }
    });
}

// Update progress display
function updateProgress(data) {
    const { progress, total, message, phase } = data;
    const percent = total > 0 ? Math.round((progress / total) * 100) : 0;
    
    elements.progressTitle.textContent = phase === 'fetching' ? 'Fetching Following' : 'Checking Activity';
    elements.progressFill.style.width = `${percent}%`;
    elements.progressText.textContent = `${percent}%`;
    elements.progressDetail.textContent = message;
}

// Update unfollow progress
function updateUnfollowProgress(data) {
    const { progress, total, message } = data;
    const percent = total > 0 ? Math.round((progress / total) * 100) : 0;
    
    elements.unfollowProgressFill.style.width = `${percent}%`;
    elements.unfollowProgressText.textContent = `${percent}%`;
    elements.unfollowProgressDetail.textContent = message;
}

// Login and fetch
async function handleLogin(e) {
    e.preventDefault();
    
    const loginData = {
        auth_token: elements.authToken.value.trim(),
        ct0: elements.ct0.value.trim(),
        user_id: elements.userId.value.trim(),
        days_threshold: parseInt(elements.daysThreshold.value)
    };
    
    daysThreshold = loginData.days_threshold;
    
    // Save to localStorage for convenience
    localStorage.setItem('mass_unfollow_auth', JSON.stringify(loginData));
    
    showSection('progress');
    
    try {
        const response = await fetch(`${API}/api/fetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            sessionId = data.session_id;
        } else {
            alert('Error: ' + data.detail);
            showSection('login');
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
        showSection('login');
    }
}

// Handle fetch complete
function onFetchComplete(data) {
    followingList = data.following || [];
    inactiveList = data.inactive || [];
    
    const activeCount = followingList.length - inactiveList.length;
    
    elements.statFollowing.textContent = followingList.length;
    elements.statInactive.textContent = inactiveList.length;
    elements.statActive.textContent = activeCount;
    
    renderUserList();
    showSection('results');
}

// Render user list
function renderUserList() {
    let users;
    switch (currentTab) {
        case 'inactive':
            users = inactiveList;
            break;
        case 'active':
            users = followingList.filter(u => !u.is_inactive);
            break;
        default:
            users = followingList;
    }
    
    // Apply threshold filter for inactive/active tabs
    const filterDays = parseInt(elements.filterThreshold.value);
    
    elements.userList.innerHTML = users.map(user => {
        const days = user.days_inactive;
        let daysClass = '';
        let daysText = '—';
        
        if (days !== null && days !== undefined) {
            daysText = `${days}d`;
            if (days > 180) daysClass = 'very-inactive';
            else if (days > 90) daysClass = 'inactive';
        } else if (user.statuses_count === 0) {
            daysText = 'No tweets';
            daysClass = 'very-inactive';
        }
        
        return `
            <div class="user-item ${user.selected ? 'selected' : ''}" data-id="${user.id}">
                <div class="user-checkbox">${user.selected ? '✓' : ''}</div>
                <img class="user-avatar" src="${user.profile_image_url}" 
                     onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'"
                     alt="${user.screen_name}">
                <div class="user-info">
                    <div class="user-name">${escapeHtml(user.name)}</div>
                    <div class="user-handle">@${user.screen_name}</div>
                </div>
                <div class="user-meta">
                    <div class="user-days ${daysClass}">${daysText}</div>
                    <div class="user-tweets">${formatNumber(user.statuses_count)} tweets</div>
                </div>
            </div>
        `;
    }).join('');
    
    // Add click handlers
    document.querySelectorAll('.user-item').forEach(item => {
        item.addEventListener('click', () => toggleUser(item.dataset.id));
    });
    
    updateSelectedCount();
}

// Toggle user selection
function toggleUser(userId) {
    const user = followingList.find(u => u.id === userId);
    if (user) {
        user.selected = !user.selected;
        renderUserList();
    }
}

// Update selected count
function updateSelectedCount() {
    const count = followingList.filter(u => u.selected).length;
    elements.selectedCount.textContent = count;
    elements.btnUnfollow.disabled = count === 0;
}

// Select/deselect all
function selectAll() {
    const users = currentTab === 'inactive' ? inactiveList : followingList;
    users.forEach(u => u.selected = true);
    renderUserList();
}

function deselectAll() {
    followingList.forEach(u => u.selected = false);
    renderUserList();
}

// Unfollow selected
async function handleUnfollow() {
    const selected = followingList.filter(u => u.selected);
    
    if (selected.length === 0) return;
    
    if (!confirm(`Unfollow ${selected.length} accounts? This cannot be undone!`)) return;
    
    showSection('unfollow');
    
    try {
        const response = await fetch(`${API}/api/unfollow/${sessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_ids: selected.map(u => u.id),
                days_threshold: daysThreshold
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            alert('Error: ' + data.detail);
            showSection('results');
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
        showSection('results');
    }
}

// Handle unfollow complete
function onUnfollowComplete(result) {
    elements.resultSuccess.textContent = result.success;
    elements.resultFailed.textContent = result.failed;
    showSection('done');
}

// Tab switching
function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentTab = tab.dataset.tab;
            renderUserList();
        });
    });
}

// Utilities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// Load saved credentials
function loadSavedCredentials() {
    const saved = localStorage.getItem('mass_unfollow_auth');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            elements.authToken.value = data.auth_token || '';
            elements.ct0.value = data.ct0 || '';
            elements.userId.value = data.user_id || '';
            elements.daysThreshold.value = data.days_threshold || '90';
        } catch (e) {}
    }
}

// Start over
function startOver() {
    sessionId = null;
    followingList = [];
    inactiveList = [];
    currentTab = 'all';
    showSection('login');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    loadSavedCredentials();
    setupTabs();
    
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.btnUnfollow.addEventListener('click', handleUnfollow);
    elements.btnSelectAll.addEventListener('click', selectAll);
    elements.btnDeselectAll.addEventListener('click', deselectAll);
    elements.btnStartOver.addEventListener('click', startOver);
    elements.filterThreshold.addEventListener('change', renderUserList);
});
