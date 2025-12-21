// ai-chat.js
// Depends on deals-inline.js for apiFetch/auth redirect.

(function () {
    const modal = document.getElementById('aiChatModal');
    const closeBtn = document.getElementById('aiChatCloseBtn');
    const clearBtn = document.getElementById('aiChatClearBtn');
    const titleEl = document.getElementById('aiChatTitle');
    const badgeEl = document.getElementById('aiChatTickerBadge');
    const statusEl = document.getElementById('aiChatStatus');
    const messagesEl = document.getElementById('aiChatMessages');
    const inputEl = document.getElementById('aiChatInput');
    const sendBtn = document.getElementById('aiChatSendBtn');
    const slPctEl = document.getElementById('aiChatStopLossPercent');

    if (!modal || !messagesEl || !inputEl || !sendBtn) {
        console.warn('AI chat modal elements not found');
        return;
    }

    const storageKeySl = 'aiChatStopLossPercent';
    const savedSl = localStorage.getItem(storageKeySl);
    if (slPctEl && savedSl != null) slPctEl.value = savedSl;

    let current = { ticker: null, stockId: null };
    let isSending = false;

    function setStatus(text) {
        if (!statusEl) return;
        statusEl.textContent = text || '';
    }

    function showModal() {
        modal.style.display = 'flex';
        setTimeout(() => inputEl?.focus(), 0);
    }

    function hideModal() {
        modal.style.display = 'none';
        current = { ticker: null, stockId: null };
        messagesEl.innerHTML = '';
        setStatus('');
    }

    function scrollToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function fmtNum(n, digits = 2) {
        const x = Number(n);
        if (!isFinite(x)) return '';
        return x.toFixed(digits);
    }

    function tryParseAssistantJson(content) {
        if (!content) return null;
        let s = String(content).trim();

        // Strip markdown fences if present
        if (s.startsWith('```')) {
            s = s.replace(/^```[a-zA-Z0-9_-]*\s*/m, '').replace(/```$/m, '').trim();
        }

        // Try full parse first
        try { return JSON.parse(s); } catch { /* ignore */ }

        // Try to extract first JSON object
        const first = s.indexOf('{');
        const last = s.lastIndexOf('}');
        if (first >= 0 && last > first) {
            const sub = s.slice(first, last + 1);
            try { return JSON.parse(sub); } catch { /* ignore */ }
        }

        return null;
    }

    function renderList(title, items) {
        if (!items || !Array.isArray(items) || items.length === 0) return '';
        const li = items.map(x => `<li>${escapeHtml(String(x))}</li>`).join('');
        return `<div class="ai-sec"><div class="ai-sec-title">${escapeHtml(title)}</div><ul class="ai-ul">${li}</ul></div>`;
    }

    function renderLevels(title, arr) {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return '';
        const parts = arr
            .map(x => fmtNum(x, 2))
            .filter(Boolean)
            .map(x => `<span class="ai-level-chip">${escapeHtml(x)}</span>`)
            .join(' ');
        if (!parts) return '';
        return `<div class="ai-sec"><div class="ai-sec-title">${escapeHtml(title)}</div><div class="ai-levels">${parts}</div></div>`;
    }

    function renderKeyValue(label, value) {
        if (value == null || value === '') return '';
        return `<div class="ai-kv"><span class="ai-k">${escapeHtml(label)}:</span> <span class="ai-v">${escapeHtml(String(value))}</span></div>`;
    }

    function renderBubble(role, content) {
        const wrapper = document.createElement('div');
        wrapper.className = `ai-msg ${role === 'user' ? 'user' : 'assistant'}`;

        const bubble = document.createElement('div');
        bubble.className = 'ai-bubble';

        // Assistant often returns JSON; show a friendly summary + raw JSON collapsible
        if (role !== 'user') {
            const parsed = tryParseAssistantJson(content);

            if (parsed && typeof parsed === 'object') {
                const header =
                    `<div class="ai-head">` +
                    (parsed.summary ? `<div class="ai-summary">${escapeHtml(parsed.summary)}</div>` : '') +
                    (parsed.action ? `<div class="ai-action">Action: <strong>${escapeHtml(parsed.action)}</strong></div>` : '') +
                    `</div>`;

                const why = renderList('Why', parsed.why);
                const riskNotes = renderList('Risk notes', parsed.riskNotes);
                const questions = renderList('Questions', parsed.questions);

                const buyLevels = renderLevels('Buy levels', parsed.buyLevels);
                const sellLevels = renderLevels('Sell levels', parsed.sellLevels);

                const stop =
                    parsed.stop && (parsed.stop.recommended != null || parsed.stop.why)
                        ? `<div class="ai-sec"><div class="ai-sec-title">Stop</div>` +
                          renderKeyValue('Recommended', parsed.stop.recommended != null ? fmtNum(parsed.stop.recommended, 2) : null) +
                          renderKeyValue('Why', parsed.stop.why) +
                          `</div>`
                        : '';

                const add =
                    parsed.add && (parsed.add.maxShares != null || parsed.add.stage1Shares != null || parsed.add.stage2Shares != null || parsed.add.note)
                        ? `<div class="ai-sec"><div class="ai-sec-title">Add / size</div>` +
                          renderKeyValue('Max shares', parsed.add.maxShares != null ? parsed.add.maxShares : null) +
                          renderKeyValue('Stage1 shares', parsed.add.stage1Shares != null ? parsed.add.stage1Shares : null) +
                          renderKeyValue('Stage2 shares', parsed.add.stage2Shares != null ? parsed.add.stage2Shares : null) +
                          renderKeyValue('Note', parsed.add.note) +
                          `</div>`
                        : '';

                const raw = `<details><summary>Raw JSON</summary><pre class="ai-raw">${escapeHtml(content)}</pre></details>`;

                bubble.innerHTML = `${header}${why}${buyLevels}${sellLevels}${stop}${add}${riskNotes}${questions}${raw}`;
            } else {
                bubble.textContent = content;
            }
        } else {
            bubble.textContent = content;
        }

        wrapper.appendChild(bubble);
        messagesEl.appendChild(wrapper);
        scrollToBottom();
    }

    async function loadHistory() {
        if (!current.ticker) return;
        setStatus('Loading history...');
        try {
            const qs = new URLSearchParams();
            qs.set('ticker', current.ticker);
            if (current.stockId) qs.set('stockId', current.stockId);
            qs.set('limit', '120');

            const res = await apiFetch(`/api/ai/stock-chat/history?${qs.toString()}`, { method: 'GET' });
            const data = await res.json();

            messagesEl.innerHTML = '';
            const messages = data?.messages || [];
            for (const m of messages) {
                renderBubble(m.role, m.content);
            }
            if (messages.length === 0) {
                setStatus('No history yet. Ask something about the ticker.');
            } else {
                setStatus('');
            }
        } catch (e) {
            console.error(e);
            setStatus('Failed to load history');
        }
    }

    async function clearHistory() {
        if (!current.ticker) return;
        if (!confirm('Clear chat history?')) return;

        try {
            const qs = new URLSearchParams();
            qs.set('ticker', current.ticker);
            if (current.stockId) qs.set('stockId', current.stockId);

            await apiFetch(`/api/ai/stock-chat/clear?${qs.toString()}`, { method: 'POST' });
            messagesEl.innerHTML = '';
            setStatus('History cleared.');
        } catch (e) {
            console.error(e);
            setStatus('Failed to clear history');
        }
    }

    async function sendMessage() {
        if (isSending) return;
        const text = (inputEl.value || '').trim();
        if (!text) return;
        if (!current.ticker) return;

        isSending = true;
        sendBtn.disabled = true;
        setStatus('Sending...');

        const slPct = slPctEl ? (slPctEl.value || '').trim() : '';
        if (slPctEl) localStorage.setItem(storageKeySl, slPct);

        renderBubble('user', text);
        inputEl.value = '';

        try {
            const payload = {
                ticker: current.ticker,
                stockId: current.stockId,
                message: text,
                stopLossPercent: slPct ? Number(slPct) : null
            };

            const res = await apiFetch('/api/ai/stock-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errText = await res.text();
                const trimmed = (errText || '').trim();
                // Show only first lines to avoid dumping huge stack traces into UI
                const short =
                    trimmed
                        ? trimmed.split('\n').slice(0, 6).join('\n').slice(0, 800)
                        : `HTTP ${res.status}`;
                throw new Error(short);
            }

            const data = await res.json();
            const assistant = data?.responseJson || '';
            renderBubble('assistant', assistant);
            setStatus('');
        } catch (e) {
            console.error(e);
            const msg = (e && e.message) ? String(e.message) : 'Failed to get AI response. Try again.';
            renderBubble('assistant', `Request failed:\n${msg}`);
            setStatus('Failed (see details in chat)');
        } finally {
            isSending = false;
            sendBtn.disabled = false;
            inputEl.focus();
        }
    }

    function openFor(ticker, stockId) {
        current.ticker = (ticker || '').trim().toUpperCase();
        current.stockId = stockId || null;

        if (titleEl) titleEl.textContent = 'AI chat';
        if (badgeEl) badgeEl.textContent = current.ticker ? current.ticker : '';

        showModal();
        loadHistory();
    }

    // Close handlers
    if (closeBtn) closeBtn.addEventListener('click', hideModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) hideModal();
    });
    if (clearBtn) clearBtn.addEventListener('click', clearHistory);

    // Send handlers
    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Open button (event delegation from stock list)
    document.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('.ai-chat-btn');
        if (!btn) return;
        const ticker = btn.getAttribute('data-ticker') || '';
        const stockId = btn.getAttribute('data-stock-id') || '';

        // Prefill SL% from the source button if present (e.g. "6" or "6.5")
        const slRaw = (btn.getAttribute('data-sl-pct') || '').trim();
        if (slPctEl && slRaw) {
            const m = slRaw.match(/-?\d+(\.\d+)?/);
            if (m) slPctEl.value = m[0];
        }

        openFor(ticker, stockId || null);
    });
})();


