// ===== Lamix Stats Dashboard - Live Feed =====

// Use Netlify proxy when hosted (avoids HTTPS -> HTTP mixed content block)
const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';
const LIVE_API = isLocal
    ? 'http://51.77.216.195/crapi/lamix/viewstats?token=X46ZeF6ViotShZl5WYRse1t3lYiKZ3CAdo6ZdINSh0o='
    : '/api/viewstats?token=X46ZeF6ViotShZl5WYRse1t3lYiKZ3CAdo6ZdINSh0o=';
const STORED_API = '/api/stored';  // Netlify function serving persisted messages
const POLL_INTERVAL = 3000;
const MAX_STORED = 500;
const STORAGE_KEY = 'lamix_messages';

// DOM Elements
const el = {
    liveBadge: document.getElementById('liveBadge'),
    liveCount: document.getElementById('liveCount'),
    searchInput: document.getElementById('searchInput'),
    totalMessages: document.getElementById('totalMessages'),
    uniqueClients: document.getElementById('uniqueClients'),
    totalPayout: document.getElementById('totalPayout'),
    uniqueNumbers: document.getElementById('uniqueNumbers'),
    statsGrid: document.getElementById('statsGrid'),
    tableSection: document.getElementById('tableSection'),
    tableBody: document.getElementById('tableBody'),
    tableCount: document.getElementById('tableCount'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    errorState: document.getElementById('errorState'),
    errorMessage: document.getElementById('errorMessage'),
    btnRetry: document.getElementById('btnRetry'),
    lastUpdated: document.getElementById('lastUpdated'),
    btnTop5: document.getElementById('btnTop5'),
    top5Modal: document.getElementById('top5Modal'),
    top5Body: document.getElementById('top5Body'),
    modalClose: document.getElementById('modalClose'),
};

// ===== State =====
const allMessages = new Map();
let previousKeys = new Set();
let isFirstLoad = true;
let fetchCount = 0;
let pollTimer = null;
let isFetching = false;

// ===== LocalStorage (backup for local/offline) =====

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return 0;
        const items = JSON.parse(raw);
        if (!Array.isArray(items)) return 0;
        items.forEach(item => allMessages.set(msgKey(item), item));
        return items.length;
    } catch (e) { return 0; }
}

function saveToLocalStorage() {
    try {
        const sorted = getSorted();
        const trimmed = sorted.slice(0, MAX_STORED);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {}
}

// ===== Server Storage (Netlify Blobs via function) =====

async function loadFromServer() {
    try {
        const res = await fetch(STORED_API);
        if (!res.ok) return 0;
        const json = await res.json();
        if (json.status !== 'success' || !Array.isArray(json.data)) return 0;
        json.data.forEach(item => allMessages.set(msgKey(item), item));
        console.log(`Loaded ${json.data.length} messages from server storage`);
        return json.data.length;
    } catch (e) {
        console.warn('Could not load from server storage:', e);
        return 0;
    }
}

// ===== Helpers =====

function msgKey(item) {
    return `${item.dt}|${item.num}|${item.message}`;
}

function getSorted() {
    return [...allMessages.values()].sort((a, b) =>
        new Date(b.dt.replace(' ', 'T') + 'Z') - new Date(a.dt.replace(' ', 'T') + 'Z')
    );
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function formatTimestamp(dt) {
    const date = new Date(dt.replace(' ', 'T') + 'Z');
    const now = new Date();
    const mins = Math.floor((now - date) / 60000);
    const time = date.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
    const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago · ${time}`;
    return `${day} · ${time}`;
}

function formatNumber(num) {
    if (!num) return '—';
    return num.length > 6 ? num.replace(/(\d{3})(?=\d)/g, '$1 ') : num;
}

function clientClass(cli) {
    const n = (cli || '').toLowerCase().replace(/\s+/g, '');
    return {
        verify: 'client-verify', microsoft: 'client-microsoft',
        landprime: 'client-landprime', bumble: 'client-bumble',
    }[n] || 'client-default';
}

function highlightCodes(msg) {
    return msg.replace(/(\b\d{4,6}\b)/g, '<span class="highlight">$1</span>');
}

function animateValue(element, value, prefix = '', suffix = '') {
    element.classList.add('updating');
    setTimeout(() => {
        element.textContent = `${prefix}${value}${suffix}`;
        element.classList.remove('updating');
    }, 120);
}

// ===== Core: Live Poll =====

async function poll() {
    if (isFetching) return;
    isFetching = true;

    try {
        const isFirstFetch = allMessages.size === 0;
        if (isFirstFetch) showLoading(true);

        const res = await fetch(LIVE_API);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        if (json.status !== 'success') throw new Error('API error');

        fetchCount++;
        const items = json.data || [];

        // Merge new data
        let newCount = 0;
        items.forEach(item => {
            const key = msgKey(item);
            if (!allMessages.has(key)) {
                allMessages.set(key, item);
                newCount++;
            }
        });

        // Trim if over limit
        if (allMessages.size > MAX_STORED) {
            const sorted = getSorted();
            allMessages.clear();
            sorted.slice(0, MAX_STORED).forEach(item => allMessages.set(msgKey(item), item));
        }

        // Save to localStorage as backup
        if (newCount > 0) saveToLocalStorage();

        const sorted = getSorted();
        updateStats(sorted);
        renderTable(sorted);
        setLiveStatus(true);
        hideError();
        showLoading(false);
        isFirstLoad = false;

    } catch (err) {
        console.error('Poll error:', err);
        setLiveStatus(false);
        if (allMessages.size === 0) {
            showError(err.message);
            showLoading(false);
        }
    } finally {
        isFetching = false;
        el.lastUpdated.textContent = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
        });
        el.liveCount.textContent = `#${fetchCount}`;
    }
}

// ===== UI Updates =====

function showLoading(show) {
    el.loadingOverlay.classList.toggle('hidden', !show);
    el.statsGrid.classList.toggle('hidden', show);
    el.tableSection.classList.toggle('hidden', show);
}

function setLiveStatus(connected) {
    el.liveBadge.classList.toggle('connected', connected);
    el.liveBadge.classList.toggle('error', !connected);
    el.liveBadge.querySelector('.live-text').textContent = connected ? 'LIVE' : 'OFFLINE';
}

function showError(msg) {
    el.errorState.classList.remove('hidden');
    el.errorMessage.textContent = msg || 'Unable to reach the API.';
    el.statsGrid.classList.add('hidden');
    el.tableSection.classList.add('hidden');
}

function hideError() {
    el.errorState.classList.add('hidden');
}

function updateStats(data) {
    const clients = new Set(data.map(d => d.cli));
    const numbers = new Set(data.map(d => d.num));
    const payout = data.reduce((s, d) => s + parseFloat(d.payout || 0), 0);
    animateValue(el.totalMessages, data.length);
    animateValue(el.uniqueClients, clients.size);
    animateValue(el.totalPayout, payout.toFixed(3), '$');
    animateValue(el.uniqueNumbers, numbers.size);
}

function renderTable(data) {
    const q = el.searchInput.value.toLowerCase().trim();
    const filtered = q
        ? data.filter(m =>
            m.num.toLowerCase().includes(q) ||
            m.cli.toLowerCase().includes(q) ||
            m.message.toLowerCase().includes(q) ||
            m.dt.toLowerCase().includes(q))
        : data;

    el.tableCount.textContent = `${filtered.length} of ${data.length} messages (max ${MAX_STORED} stored)`;

    if (!filtered.length) {
        el.tableBody.innerHTML = `<tr><td colspan="5" class="no-results">No messages found${q ? ` matching "${q}"` : ''}.</td></tr>`;
        previousKeys = new Set();
        return;
    }

    const currentKeys = new Set(filtered.map(msgKey));
    const newKeys = new Set();
    if (!isFirstLoad) {
        currentKeys.forEach(k => { if (!previousKeys.has(k)) newKeys.add(k); });
    }
    previousKeys = new Set(data.map(msgKey));

    el.tableBody.innerHTML = filtered.map(item => {
        const isNew = newKeys.has(msgKey(item));
        return `<tr class="${isNew ? 'new-row' : ''}">
            <td class="cell-timestamp">${formatTimestamp(item.dt)}</td>
            <td class="cell-number">${formatNumber(item.num)}</td>
            <td><span class="cell-client"><span class="client-badge ${clientClass(item.cli)}">${escapeHtml(item.cli)}</span></span></td>
            <td class="cell-message">${highlightCodes(escapeHtml(item.message))}</td>
            <td class="cell-payout">$${parseFloat(item.payout).toFixed(3)}</td>
        </tr>`;
    }).join('');
}

// ===== Top 5 Clients Feature =====

function getTop5Clients() {
    const clientStats = {};
    
    // Count messages per client
    allMessages.forEach(msg => {
        if (!clientStats[msg.cli]) {
            clientStats[msg.cli] = { count: 0, payout: 0 };
        }
        clientStats[msg.cli].count += 1;
        clientStats[msg.cli].payout += parseFloat(msg.payout || 0);
    });
    
    // Convert to array and sort by count
    return Object.entries(clientStats)
        .map(([cli, stats]) => ({ cli, ...stats }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
}

function renderTop5Modal() {
    const top5 = getTop5Clients();
    
    if (top5.length === 0) {
        el.top5Body.innerHTML = '<p class="no-results">No client data available yet.</p>';
        return;
    }
    
    const html = `
        <div class="top5-list">
            ${top5.map((item, idx) => `
                <div class="top5-item">
                    <div style="display: flex; align-items: center;">
                        <div class="top5-rank rank-${idx + 1}">${idx + 1}</div>
                        <div class="top5-info">
                            <div class="top5-client">${escapeHtml(item.cli)}</div>
                            <div class="top5-stats">
                                <div class="top5-stat"><strong>${item.count}</strong> messages</div>
                                <div class="top5-stat"><strong>$${item.payout.toFixed(3)}</strong> earned</div>
                            </div>
                        </div>
                    </div>
                    <div class="top5-badge">${((item.count / allMessages.size) * 100).toFixed(1)}%</div>
                </div>
            `).join('')}
        </div>
    `;
    
    el.top5Body.innerHTML = html;
}

function showTop5Modal() {
    renderTop5Modal();
    el.top5Modal.classList.remove('hidden');
}

function closeTop5Modal() {
    el.top5Modal.classList.add('hidden');
}

// ===== Events =====

el.btnRetry.addEventListener('click', () => { hideError(); poll(); });

let debounce;
el.searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderTable(getSorted()), 150);
});

el.btnTop5.addEventListener('click', showTop5Modal);
el.modalClose.addEventListener('click', closeTop5Modal);

// Close modal when clicking outside
el.top5Modal.addEventListener('click', (e) => {
    if (e.target === el.top5Modal) closeTop5Modal();
});

// ===== Initialize =====

async function startLive() {
    // Step 1: Load from localStorage immediately (instant render)
    const localCount = loadFromLocalStorage();
    if (localCount > 0) {
        const sorted = getSorted();
        previousKeys = new Set(sorted.map(msgKey));
        updateStats(sorted);
        renderTable(sorted);
        showLoading(false);
        isFirstLoad = false;
        console.log(`Rendered ${localCount} messages from localStorage`);
    }

    // Step 2: Load from server storage (Netlify Blobs - has data collected in background)
    if (!isLocal) {
        const serverCount = await loadFromServer();
        if (serverCount > 0) {
            const sorted = getSorted();
            previousKeys = new Set(sorted.map(msgKey));
            updateStats(sorted);
            renderTable(sorted);
            showLoading(false);
            isFirstLoad = false;
            saveToLocalStorage(); // sync server data to localStorage
        }
    }

    // Step 3: Start live polling
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL);
}

startLive();
