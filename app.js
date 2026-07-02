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
    btnTop20: document.getElementById('btnTop20'),
    top20Modal: document.getElementById('top20Modal'),
    top20Body: document.getElementById('top20Body'),
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

function extractService(message) {
    const match = message.match(/\[(.*?)\]/);
    return match ? match[1] : 'Unknown';
}

function extractCode(message) {
    const match = message.match(/code\s+(\d{4,6})/i);
    return match ? match[1] : 'N/A';
}

function extractCountry(number) {
    if (!number) return 'N/A';
    // Simple country code extraction from phone number
    if (number.startsWith('1')) return '🇺🇸 US';
    if (number.startsWith('44')) return '🇬🇧 UK';
    if (number.startsWith('91')) return '🇮🇳 IN';
    if (number.startsWith('86')) return '🇨🇳 CN';
    if (number.startsWith('81')) return '🇯🇵 JP';
    if (number.startsWith('33')) return '🇫🇷 FR';
    return 'International';
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
        el.tableBody.innerHTML = `<tr><td colspan="8" class="no-results">No messages found${q ? ` matching "${q}"` : ''}.</td></tr>`;
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
        const service = extractService(item.message);
        const code = extractCode(item.message);
        const country = extractCountry(item.num);
        return `<tr class="${isNew ? 'new-row' : ''}">
            <td class="cell-timestamp">${formatTimestamp(item.dt)}</td>
            <td class="cell-country">${country}</td>
            <td class="cell-number">${formatNumber(item.num)}</td>
            <td class="cell-service"><span class="service-badge">${escapeHtml(service)}</span></td>
            <td class="cell-code">${code}</td>
            <td><span class="cell-client"><span class="client-badge ${clientClass(item.cli)}">${escapeHtml(item.cli)}</span></span></td>
            <td class="cell-message">${highlightCodes(escapeHtml(item.message))}</td>
            <td class="cell-payout">$${parseFloat(item.payout).toFixed(3)}</td>
        </tr>`;
    }).join('');
}

// ===== Top 20 Clients Feature =====

function getTop20Clients() {
    const clientStats = {};
    
    // Count messages per client and collect all messages
    allMessages.forEach(msg => {
        if (!clientStats[msg.cli]) {
            clientStats[msg.cli] = { count: 0, payout: 0, numbers: [], messages: [] };
        }
        clientStats[msg.cli].count += 1;
        clientStats[msg.cli].payout += parseFloat(msg.payout || 0);
        if (msg.num && !clientStats[msg.cli].numbers.includes(msg.num)) {
            clientStats[msg.cli].numbers.push(msg.num);
        }
        clientStats[msg.cli].messages.push(msg);
    });
    
    // Convert to array and sort by count
    return Object.entries(clientStats)
        .map(([cli, stats]) => ({ 
            cli, 
            ...stats,
            numberRange: getNumberRange(stats.numbers)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
}

function getNumberRange(numbers) {
    if (!numbers.length) return 'N/A';
    const sorted = numbers.sort();
    return `${sorted[0]} - ${sorted[sorted.length - 1]}`;
}

function renderTop20Modal() {
    const top20 = getTop20Clients();
    
    if (top20.length === 0) {
        el.top20Body.innerHTML = '<p class="no-results">No client data available yet.</p>';
        return;
    }
    
    const html = `
        <div class="top20-list">
            ${top20.map((item, idx) => `
                <div class="top20-card">
                    <div class="top20-header">
                        <div style="display: flex; align-items: center; flex: 1;">
                            <div class="top20-rank rank-${idx + 1}">${idx + 1}</div>
                            <div class="top20-info">
                                <div class="top20-client">${escapeHtml(item.cli)}</div>
                                <div class="top20-stats">
                                    <div class="top20-stat"><strong>${item.count}</strong> messages</div>
                                    <div class="top20-stat"><strong>$${item.payout.toFixed(3)}</strong> earned</div>
                                    <div class="top20-stat"><strong>${item.numberRange}</strong></div>
                                </div>
                            </div>
                        </div>
                        <div class="top20-badge">${((item.count / allMessages.size) * 100).toFixed(1)}%</div>
                    </div>
                    <div class="top20-details-toggle" onclick="toggleClientDetails(this)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                        <span>View Messages</span>
                    </div>
                    <div class="top20-messages hidden">
                        <table class="client-messages-table">
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>Number</th>
                                    <th>Message</th>
                                    <th>Payout</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${item.messages.slice().reverse().map(msg => `
                                    <tr>
                                        <td class="msg-timestamp">${formatTimestamp(msg.dt)}</td>
                                        <td class="msg-number">${formatNumber(msg.num)}</td>
                                        <td class="msg-text">${highlightCodes(escapeHtml(msg.message))}</td>
                                        <td class="msg-payout">$${parseFloat(msg.payout).toFixed(3)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    
    el.top20Body.innerHTML = html;
}

function toggleClientDetails(element) {
    const messagesDiv = element.nextElementSibling;
    messagesDiv.classList.toggle('hidden');
    element.classList.toggle('expanded');
}

function showTop20Modal() {
    renderTop20Modal();
    el.top20Modal.classList.remove('hidden');
}

function closeTop20Modal() {
    el.top20Modal.classList.add('hidden');
}

// ===== Events =====

el.btnRetry.addEventListener('click', () => { hideError(); poll(); });

let debounce;
el.searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderTable(getSorted()), 150);
});

el.btnTop20.addEventListener('click', showTop20Modal);
el.modalClose.addEventListener('click', closeTop20Modal);

// Close modal when clicking outside
el.top20Modal.addEventListener('click', (e) => {
    if (e.target === el.top20Modal) closeTop20Modal();
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
