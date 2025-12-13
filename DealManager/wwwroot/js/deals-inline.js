// deals.js - Inline expandable version

let deals = [];
let dealsLoaded = false;
let expandedDealId = null; // Track which deal is currently expanded
let newDealRow = null; // Track if there's a new deal row being created
let stocksCache = []; // Cache stocks data for checking regular_volume
// warningsCache is now a window property to share with stocks.js
window.warningsCache = window.warningsCache || [];

// ---------- элементы DOM ----------
const elements = {
    newDealBtn: document.getElementById('newDealBtn'),
    openList: document.getElementById('openList'),
    closedList: document.getElementById('closedList'),
    filterInput: document.getElementById('filterInput'),
    openCount: document.getElementById('openCount'),
    closedCount: document.getElementById('closedCount'),
    emptyOpen: document.getElementById('emptyOpen'),
    emptyClosed: document.getElementById('emptyClosed'),
    userNameDisplay: document.getElementById('userNameDisplay'),
    logoutBtn: document.getElementById('logoutBtn')
};

function setPriceError(containerEl, message) {
    if (!containerEl) return;
    let errorEl = containerEl.querySelector('.price-error');
    if (!errorEl && message) {
        errorEl = document.createElement('div');
        errorEl.className = 'price-error error-text';
        containerEl.insertBefore(errorEl, containerEl.firstChild);
    }
    if (errorEl) {
        errorEl.textContent = message || '';
        errorEl.style.display = message ? 'block' : 'none';
    }
}

// Calculate total sum: share_price * amount_tobuy_stage_1
function calculateTotalSum(sharePrice, amountToBuy) {
    const price = parseFloat(String(sharePrice || '').replace(',', '.')) || 0;
    const amount = parseFloat(String(amountToBuy || '').replace(',', '.')) || 0;
    const total = price * amount;
    return total > 0 ? total.toFixed(2) : null;
}

// Function to format total sum for display
function formatTotalSum(totalSum) {
    if (!totalSum) return null;
    const num = parseFloat(String(totalSum).replace(',', '.'));
    if (isNaN(num) || num <= 0) return null;
    return `$${num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// Function to escape HTML special characters
function escapeHtml(str) {
    return String(str || '').replace(/[&<>"]/g, s => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
    }[s]));
}

// Function to set button loading state with spinner (similar to login button)
function setButtonLoading(button, isLoading) {
    if (!button) return;

    if (isLoading) {
        // Если у кнопки заранее задан data-original-text (в HTML) — не трогаем.
        // Если нет — запоминаем текущий текст один раз.
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent.trim();
        }
        button.disabled = true;
        button.innerHTML = '<span class="loading-spinner"></span> Loading...';
    } else {
        button.disabled = false;
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
        }
        // data-original-text НЕ очищаем, чтобы текст кнопки не «переучивался»
        // при повторных включениях/выключениях спиннера.
    }
}

// Simple reusable modal for deal limit / risk warnings
function showDealLimitModal(message) {
    const modal = document.getElementById('dealLimitModal');
    const body = document.getElementById('dealLimitModalBody');
    const closeBtn = document.getElementById('dealLimitCloseBtn');

    if (!modal || !body || !closeBtn) {
        // Разметка не найдена – логируем, но не показываем alert, чтобы не путать UX
        console.error('dealLimitModal elements not found in DOM');
        console.error('Deal limit message:', message);
        return;
    }

    body.textContent = message;
    // Используем flex, чтобы сработало центрирование по .modal в deals.css
    modal.style.display = 'flex';

    function hide() {
        modal.style.display = 'none';
        closeBtn.removeEventListener('click', hide);
        modal.removeEventListener('click', backdropHandler);
    }

    function backdropHandler(e) {
        if (e.target === modal) {
            hide();
        }
    }

    closeBtn.addEventListener('click', hide);
    modal.addEventListener('click', backdropHandler);
}

// Reusable confirm-style modal for weekly activations warning
function showWeeklyConfirmModal(message) {
    return new Promise(resolve => {
        const modal     = document.getElementById('weeklyConfirmModal');
        const body      = document.getElementById('weeklyConfirmModalBody');
        const okBtn     = document.getElementById('weeklyConfirmOkBtn');
        const cancelBtn = document.getElementById('weeklyConfirmCancelBtn');

        if (!modal || !body || !okBtn || !cancelBtn) {
            console.error('weeklyConfirmModal elements not found in DOM');
            console.error('Weekly confirm message:', message);
            // Если модалка не найдена — на всякий случай ведём себя как «Cancel»
            resolve(false);
            return;
        }

        body.textContent = message;
        // Используем flex, чтобы сработало центрирование по .modal в deals.css
        modal.style.display = 'flex';

        function cleanup() {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
        }

        function onOk() {
            cleanup();
            resolve(true);
        }

        function onCancel() {
            cleanup();
            resolve(false);
        }

        function onBackdrop(e) {
            if (e.target === modal) {
                cleanup();
                resolve(false);
            }
        }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
    });
}

// ===== TRADINGVIEW CHART HELPERS =====

function buildSymbolFromTicker(ticker) {
    if (!ticker) return null;
    const cleaned = String(ticker).trim().toUpperCase();
    if (!cleaned) return null;
    // TradingView widget in this setup expects plain ticker, e.g. "NVDA"
    return cleaned;
}

// Render (or re-render) TradingView widget in a given container
function renderTradingViewChart(containerId, symbol, interval) {
    if (typeof window.TradingView === 'undefined') {
        console.warn('TradingView library is not loaded yet');
        return;
    }

    const container = document.getElementById(containerId);
    if (!container) {
        console.warn('Chart container not found:', containerId);
        return;
    }

    // Clear container to avoid multiple iframes
    container.innerHTML = '';

    // eslint-disable-next-line no-undef
    new TradingView.widget({
        container_id: containerId,
        symbol,
        interval: interval || 'W',
        theme: 'dark',
        style: '1',
        locale: 'en',
        autosize: true,
        hide_top_toolbar: false,
        hide_legend: false
    });
}

// Format total sum for display
function formatTotalSum(totalSum) {
    if (!totalSum) return '';
    const num = parseFloat(String(totalSum).replace(',', '.')) || 0;
    return num > 0 ? `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
}

// Helper function to check if ATR is high risk (> 10%) from ATR string
function isAtrHighRiskFromString(atrString) {
    if (!atrString) return false;
    const match = atrString.match(/\(([\d.]+)%\)/);
    if (match && match[1]) {
        const percent = parseFloat(match[1]);
        return !isNaN(percent) && percent > 10.0;
    }
    return false;
}

// ---------- JWT helpers ----------
function isJwtExpired(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return true;

        const payloadJson = atob(parts[1]);
        const payload = JSON.parse(payloadJson);

        if (!payload.exp) return true;

        const expMs = payload.exp * 1000; // exp в секундах
        const nowMs = Date.now();

        // небольшой запас 30 секунд, чтобы не упираться в границу
        return nowMs > expMs - 30000;
    } catch (e) {
        console.error('Failed to parse JWT', e);
        return true;
    }
}

// ---------- редирект если нет токена ИЛИ он истёк ----------
const token = localStorage.getItem('token');
if (!token || isJwtExpired(token)) {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
}

// ---------- заголовки авторизации ----------
function authHeaders() {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}

// ---------- универсальный fetch с авто-обработкой 401/403 ----------
async function apiFetch(url, options = {}) {
    const token = localStorage.getItem('token');

    const headers = {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 || response.status === 403) {
        console.warn('API returned', response.status, '– clearing token and redirecting to login');
        localStorage.removeItem('token');
        window.location.href = '/login.html';
        throw new Error('Unauthorized, redirect to login');
    }

    return response;
}

// ========== PORTFOLIO inline edit ==========
// Helper function to setup inline editing for portfolio fields
function setupPortfolioField(spanElement, localStorageKey, apiEndpoint, fieldName) {
    console.log('setupPortfolioField called:', { fieldName, element: spanElement, id: spanElement?.id });
    if (!spanElement) {
        console.error('setupPortfolioField: spanElement is null/undefined');
        return;
    }

    // Initialize from localStorage
    (function initField() {
        const stored = localStorage.getItem(localStorageKey);
        if (stored != null) {
            const num = Number(stored);
            spanElement.textContent = isNaN(num) ? stored : num.toFixed(2);
        }
    })();

    spanElement.addEventListener('click', () => {
        console.log('CLICK EVENT: Clicked on portfolio field:', fieldName, 'element:', spanElement);
        console.log('CLICK EVENT: Current data-editing value:', spanElement.dataset.editing);
        
        // If already editing, try to clean up and reset
        if (spanElement.dataset.editing === '1') {
            console.log('CLICK EVENT: Already editing, cleaning up...');
            // Remove any existing input
            const existingInput = spanElement.querySelector('input.portfolio-input');
            if (existingInput && existingInput.parentNode === spanElement) {
                console.log('CLICK EVENT: Found existing input, removing it');
                try {
                    spanElement.removeChild(existingInput);
                } catch (err) {
                    console.warn('CLICK EVENT: Input already removed, continuing');
                }
            }
            // Reset editing state
            spanElement.dataset.editing = '';
            console.log('CLICK EVENT: Reset data-editing, continuing with new edit');
            // Continue to create new input below
        }

        const currentText = spanElement.textContent.trim();
        const current = Number(currentText.replace(',', '.')) || 0;
        console.log('CLICK EVENT: Current value:', { currentText, current });

        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.min = '0';
        input.value = current.toString();
        input.className = 'portfolio-input';

        spanElement.textContent = '';
        spanElement.appendChild(input);
        spanElement.dataset.editing = '1';
        console.log('CLICK EVENT: Input created and appended, fieldName:', fieldName);

        input.focus();
        input.select();

        const finish = async (save) => {
            console.log('finish called:', { save, fieldName, editing: spanElement.dataset.editing });
            if (spanElement.dataset.editing !== '1') {
                console.log('finish: Not editing, returning');
                return;
            }
            
            // Remove input from DOM first
            if (input && input.parentNode === spanElement) {
                try {
                    spanElement.removeChild(input);
                    console.log('finish: Input removed from DOM');
                } catch (err) {
                    console.warn('finish: Input already removed from DOM:', err);
                }
            } else if (input) {
                console.log('finish: Input exists but is not a child of spanElement');
            }
            
            // Clear editing state
            spanElement.dataset.editing = '';

            let newVal = current;
            if (save) {
                const parsed = Number(input.value.replace(',', '.'));
                newVal = isNaN(parsed) ? current : parsed;
                console.log('finish: Parsed value:', { inputValue: input.value, parsed, newVal, current });
            }

            // Set new value
            spanElement.textContent = newVal.toFixed(2);
            console.log('finish: Updated spanElement.textContent to:', newVal.toFixed(2));

            if (save) {
                localStorage.setItem(localStorageKey, String(newVal));
                console.log('finish: Saved to localStorage, fieldName:', fieldName, 'isPortfolio:', fieldName === 'portfolio');

                // If Cash was updated, recalculate Total Sum immediately (before saving to DB)
                if (fieldName === 'portfolio') {
                    console.log('finish: Cash field detected, calling calculateAndUpdateTotalSum...');
                    // Wait for next tick to ensure DOM is updated, then calculate
                    await new Promise(resolve => setTimeout(resolve, 0));
                    console.log('finish: About to call calculateAndUpdateTotalSum');
                    await calculateAndUpdateTotalSum();
                    console.log('finish: calculateAndUpdateTotalSum completed');
                    // Refresh Risk value after Total Sum is updated
                    await calculateAndDisplayPortfolioRisk();
                } else {
                    console.log('finish: Not portfolio field, skipping Total Sum calculation');
                }

                try {
                    // Use PascalCase for API request (matching C# record property names)
                    const pascalFieldName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
                    const requestBody = {};
                    requestBody[pascalFieldName] = newVal;
                    const res = await apiFetch(apiEndpoint, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            ...authHeaders()
                        },
                        body: JSON.stringify(requestBody)
                    });
                    if (!res.ok) {
                        console.error(`Failed to save ${fieldName}`, res.status);
                    } else {
                        console.log(`${fieldName} saved to DB:`, newVal);
                        // Total Sum already recalculated and saved above
                    }
                } catch (e) {
                    console.error(`Error saving ${fieldName}`, e);
                }
            }
        };

        input.addEventListener('blur', async (e) => {
            console.log('BLUR EVENT: Input blur triggered for field:', fieldName, 'element:', input);
            console.log('BLUR EVENT: Current data-editing:', spanElement.dataset.editing);
            console.log('BLUR EVENT: Input value:', input.value);
            
            // Ensure we finish editing even if something went wrong
            try {
                // Check if we're still in editing mode
                if (spanElement.dataset.editing === '1') {
                    console.log('BLUR EVENT: Calling finish(true)...');
                    await finish(true);
                    console.log('BLUR EVENT: finish(true) completed');
                } else {
                    console.log('BLUR EVENT: Not in editing mode, but cleaning up anyway');
                    // Clean up anyway
                    if (input && input.parentNode === spanElement) {
                        const currentValue = input.value || spanElement.textContent;
                        spanElement.removeChild(input);
                        spanElement.textContent = currentValue;
                        spanElement.dataset.editing = '';
                    }
                }
                
                // Additional call to ensure Total Sum is recalculated after blur if it's Cash field
                if (fieldName === 'portfolio') {
                    console.log('BLUR EVENT: Portfolio field, scheduling additional recalculation...');
                    setTimeout(async () => {
                        console.log('BLUR EVENT: Executing delayed calculateAndUpdateTotalSum');
                        await calculateAndUpdateTotalSum();
                        console.log('BLUR EVENT: Delayed calculateAndUpdateTotalSum completed');
                        // Refresh Risk value after Total Sum is updated
                        await calculateAndDisplayPortfolioRisk();
                        await calculateAndDisplayInSharesRisk();
                    }, 200);
                } else {
                    console.log('BLUR EVENT: Not portfolio field, fieldName is:', fieldName);
                }
            } catch (err) {
                console.error('BLUR EVENT: Error in blur handler:', err);
                // Force cleanup on error
                try {
                    if (input && input.parentNode === spanElement) {
                        spanElement.removeChild(input);
                        spanElement.dataset.editing = '';
                    }
                } catch (cleanupErr) {
                    console.error('BLUR EVENT: Error during cleanup:', cleanupErr);
                }
            }
        });
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                console.log('ENTER EVENT: Enter key pressed for field:', fieldName);
                e.preventDefault();
                try {
                    await finish(true);
                    console.log('ENTER EVENT: finish(true) completed');
                    // Additional call to ensure Total Sum is recalculated after Enter if it's Cash field
                    if (fieldName === 'portfolio') {
                        console.log('ENTER EVENT: Portfolio field, scheduling additional recalculation...');
                        setTimeout(async () => {
                            console.log('ENTER EVENT: Executing delayed calculateAndUpdateTotalSum');
                            await calculateAndUpdateTotalSum();
                            console.log('ENTER EVENT: Delayed calculateAndUpdateTotalSum completed');
                            // Refresh Risk value after Total Sum is updated
                            await calculateAndDisplayPortfolioRisk();
                            await calculateAndDisplayInSharesRisk();
                        }, 200);
                    } else {
                        console.log('ENTER EVENT: Not portfolio field, fieldName is:', fieldName);
                    }
                } catch (err) {
                    console.error('ENTER EVENT: Error in Enter handler:', err);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finish(false);
            }
        });
    });
}

// Initialize portfolio fields when DOM is ready
function initPortfolioFields() {
    console.log('initPortfolioFields: Starting initialization...');
    const portfolioSpan = document.getElementById('portfolioValue');
    const totalSumSpan = document.getElementById('totalSumValue');
    const inSharesSpan = document.getElementById('inSharesValue');
    const inPlannedSpan = document.getElementById('inPlannedValue');

    console.log('initPortfolioFields: Found elements:', {
        portfolioSpan: !!portfolioSpan,
        totalSumSpan: !!totalSumSpan,
        inSharesSpan: !!inSharesSpan,
        inPlannedSpan: !!inPlannedSpan
    });

    if (portfolioSpan) {
        console.log('initPortfolioFields: Setting up portfolio field (Cash)');
        setupPortfolioField(portfolioSpan, 'portfolio', '/api/users/portfolio', 'portfolio');
    } else {
        console.error('initPortfolioFields: portfolioSpan not found!');
    }
    // Total Sum is readonly - calculated automatically, no editing
    // if (totalSumSpan) {
    //     setupPortfolioField(totalSumSpan, 'totalSum', '/api/users/totalsum', 'totalSum');
    // }
    // In Shares is readonly - calculated automatically, no editing
    // if (inSharesSpan) {
    //     setupPortfolioField(inSharesSpan, 'inShares', '/api/users/inshares', 'inShares');
    // }

    // Load values from API on page load
    async function loadPortfolioValues() {
        try {
            // Load portfolio
            const portfolioRes = await apiFetch('/api/users/portfolio', {
                headers: authHeaders()
            });
            if (portfolioRes.ok) {
                const portfolioData = await portfolioRes.json();
                const portfolio = portfolioData.portfolio ?? portfolioData.Portfolio;
                if (portfolio !== undefined && portfolioSpan) {
                    const val = Number(portfolio) || 0;
                    portfolioSpan.textContent = val.toFixed(2);
                    localStorage.setItem('portfolio', String(val));
                }
            }

            // Total Sum is calculated automatically (Cash + In Shares), not loaded from DB

            // Load inShares
            const inSharesRes = await apiFetch('/api/users/inshares', {
                headers: authHeaders()
            });
            if (inSharesRes.ok) {
                const inSharesData = await inSharesRes.json();
                const inShares = inSharesData.inShares ?? inSharesData.InShares;
                if (inShares !== undefined && inSharesSpan) {
                    const val = Number(inShares) || 0;
                    inSharesSpan.textContent = val.toFixed(2);
                    localStorage.setItem('inShares', String(val));
                }
            }
            
            // After loading all values, calculate Total Sum (Cash + In Shares + In Planned)
            await calculateAndUpdateTotalSum();
        } catch (e) {
            console.error('Error loading portfolio values', e);
        }
    }

    // Load values when page loads
    loadPortfolioValues();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPortfolioFields);
} else {
    initPortfolioFields();
}

// ---------- пользователь в шапке ----------
(function initUserInfo() {
    if (!elements.userNameDisplay) return;

    const storedUserName = localStorage.getItem('userName');
    const storedEmail = localStorage.getItem('email');

    const display = storedUserName || storedEmail || 'Unknown';
    elements.userNameDisplay.textContent = display;
})();

// ---------- заголовки авторизации ----------
function authHeaders() {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}

// ========== PORTFOLIO inline edit ==========
const portfolioSpan = document.getElementById('portfolioValue');

// начальное значение из localStorage
(function initPortfolio() {
    const stored = localStorage.getItem('portfolio');
    if (stored != null && portfolioSpan) {
        const num = Number(stored);
        portfolioSpan.textContent = isNaN(num) ? stored : num.toFixed(2);
    }
})();

if (portfolioSpan) {
    portfolioSpan.addEventListener('click', () => {
        if (portfolioSpan.dataset.editing === '1') return;

        const currentText = portfolioSpan.textContent.trim();
        const current = Number(currentText.replace(',', '.')) || 0;

        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.min = '0';
        input.value = current.toString();
        input.className = 'portfolio-input';

        portfolioSpan.textContent = '';
        portfolioSpan.appendChild(input);
        portfolioSpan.dataset.editing = '1';

        input.focus();
        input.select();

        const finish = async (save) => {
            if (portfolioSpan.dataset.editing !== '1') return;
            portfolioSpan.dataset.editing = '';

            let newVal = current;
            if (save) {
                const parsed = Number(input.value.replace(',', '.'));
                newVal = isNaN(parsed) ? current : parsed;
            }

            portfolioSpan.textContent = newVal.toFixed(2);

            if (save) {
                localStorage.setItem('portfolio', String(newVal));

                try {
                    const res = await apiFetch('/api/users/portfolio', {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            ...authHeaders()
                        },
                        body: JSON.stringify({ portfolio: newVal })
                    });
                    if (!res.ok) {
                        console.error('Failed to save portfolio', res.status);
                    }
                } catch (e) {
                    console.error('Error saving portfolio', e);
                }
            }
        };

        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finish(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finish(false);
            }
        });
    });
}

// ========== STOCKS для сделок (select) ==========

async function loadStocksForDeals() {
    try {
        const res = await apiFetch('/api/stocks', {
            headers: authHeaders()
        });

        if (!res.ok) {
            throw new Error('Failed to load stocks for deals');
        }

        const stocks = await res.json();
        stocksCache = stocks || []; // Update cache
        return stocksCache;
    } catch (err) {
        console.error(err);
        stocksCache = [];
        return [];
    }
}

// Function to get stock by ticker from cache
function getStockByTicker(ticker) {
    if (!ticker || !stocksCache || stocksCache.length === 0) return null;
    return stocksCache.find(s => s.ticker === ticker) || null;
}

// Function to load warnings from server
async function loadWarnings() {
    try {
        const res = await apiFetch('/api/stocks/warnings', {
            headers: authHeaders()
        });

        if (!res.ok) {
            throw new Error('Failed to load warnings');
        }

        const warnings = await res.json();
        window.warningsCache = warnings || [];
        return window.warningsCache;
    } catch (err) {
        console.error(err);
        window.warningsCache = [];
        return [];
    }
}

// Function to get warning by ticker from cache
function getWarningByTicker(ticker) {
    const cache = window.warningsCache || [];
    if (!ticker || !cache || cache.length === 0) return null;
    return cache.find(w => w.ticker === ticker?.toUpperCase()) || null;
}

// ========== ЗАГРУЗКА СДЕЛОК ==========

async function loadDeals() {
    try {
        const res = await apiFetch('/api/deals', {
            headers: {
                ...authHeaders()
            }
        });

        if (res.status === 401 || res.status === 403) {
            const text = await res.text().catch(() => '');
            console.warn('Unauthorized /api/deals:', res.status, text);

            elements.openList.innerHTML = '';
            elements.emptyOpen.textContent = 'Нет доступа к данным сделок.';
            elements.emptyOpen.style.display = 'block';
            dealsLoaded = true;
            return;
        }

        if (!res.ok) {
            console.error('Failed to load deals', res.status);
            dealsLoaded = true;
            return;
        }

        deals = await res.json();
        dealsLoaded = true;
        
        // Load stocks and warnings to cache for volume indicator
        await loadStocksForDeals();
        await loadWarnings();
        
        renderAll();
        
        // Calculate and display portfolio risk after loading deals
        await calculateAndDisplayPortfolioRisk();
        
        // Calculate total sum of all deals and update In Shares
        await calculateAndUpdateInShares();
    } catch (e) {
        console.error('Load deals error', e);
        dealsLoaded = true;
    }
}

// Calculate total sum of all deals and update In Shares field
async function calculateAndUpdateInShares() {
    try {
        // Calculate total sum of only OPEN, ACTIVE (non-planned) deals
        let totalInShares = 0;
        
        deals.forEach(deal => {
            // Skip closed deals
            if (deal.closed) {
                return;
            }

            // Skip planned (future) deals - they are accounted separately in "In Planned"
            if (deal.planned_future) {
                return;
            }
            
            // Try to get total_sum from deal, or calculate it
            let dealTotal = 0;
            
            if (deal.total_sum) {
                // Use existing total_sum if available
                dealTotal = parseFloat(String(deal.total_sum).replace(',', '.')) || 0;
            } else {
                // Calculate: share_price * amount_tobuy_stage_1
                const sharePrice = parseFloat(String(deal.share_price || '').replace(',', '.')) || 0;
                const amount = parseFloat(String(deal.amount_tobuy_stage_1 || '').replace(',', '.')) || 0;
                dealTotal = sharePrice * amount;
            }
            
            totalInShares += dealTotal;
        });
        
        // Update In Shares field
        const inSharesSpan = document.getElementById('inSharesValue');
        if (inSharesSpan) {
            const roundedTotal = Number(totalInShares.toFixed(2));
            inSharesSpan.textContent = roundedTotal.toFixed(2);
            localStorage.setItem('inShares', String(roundedTotal));
            
            // Save to database
            try {
                const res = await apiFetch('/api/users/inshares', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authHeaders()
                    },
                    body: JSON.stringify({ InShares: roundedTotal })
                });
                if (!res.ok) {
                    console.error('Failed to save In Shares', res.status);
                } else {
                    console.log('In Shares updated to:', roundedTotal);
                }
            } catch (e) {
                console.error('Error saving In Shares', e);
            }
        }

        // After updating In Shares, also recalculate In Planned (planned future deals)
        await calculateAndUpdateInPlanned();
        
        // After updating In Shares, calculate Total Sum (Cash + In Shares + In Planned)
        await calculateAndUpdateTotalSum();
        
        // After updating In Shares, also update Risk (In Shares)
        await calculateAndDisplayInSharesRisk();
    } catch (e) {
        console.error('Error calculating In Shares', e);
    }
}

// Calculate total sum of all planned (future) open deals and update In Planned field
async function calculateAndUpdateInPlanned() {
    try {
        let totalPlanned = 0;

        deals.forEach(deal => {
            // Consider only planned and not closed deals
            if (!deal || !deal.planned_future || deal.closed) {
                return;
            }

            let dealTotal = 0;

            if (deal.total_sum) {
                // Use existing total_sum if available
                dealTotal = parseFloat(String(deal.total_sum).replace(',', '.')) || 0;
            } else {
                // Fallback: calculate from share_price * amount_tobuy_stage_1
                const sharePrice = parseFloat(String(deal.share_price || '').replace(',', '.')) || 0;
                const amount = parseFloat(String(deal.amount_tobuy_stage_1 || '').replace(',', '.')) || 0;
                dealTotal = sharePrice * amount;
            }

            totalPlanned += dealTotal;
        });

        const inPlannedSpan = document.getElementById('inPlannedValue');
        if (inPlannedSpan) {
            const roundedTotal = Number(totalPlanned.toFixed(2));
            inPlannedSpan.textContent = roundedTotal.toFixed(2);
            localStorage.setItem('inPlanned', String(roundedTotal));
        }
    } catch (e) {
        console.error('Error calculating In Planned', e);
    }
}

// Calculate and update Total Sum field (Cash + In Shares)
async function calculateAndUpdateTotalSum() {
    try {
        console.log('calculateAndUpdateTotalSum: Starting calculation...');
        const portfolioSpan = document.getElementById('portfolioValue');
        const inSharesSpan = document.getElementById('inSharesValue');
        const totalSumSpan = document.getElementById('totalSumValue');
        
        if (!portfolioSpan || !inSharesSpan || !totalSumSpan) {
            console.error('calculateAndUpdateTotalSum: Missing required elements', {
                portfolioSpan: !!portfolioSpan,
                inSharesSpan: !!inSharesSpan,
                totalSumSpan: !!totalSumSpan
            });
            return;
        }
        
        // Get Cash value - read directly from textContent
        const cashStr = portfolioSpan.textContent.trim().replace(',', '.');
        const cash = parseFloat(cashStr) || 0;
        console.log('calculateAndUpdateTotalSum: Cash value from DOM:', cashStr, 'parsed:', cash);
        
        // Get In Shares value
        const inSharesStr = inSharesSpan.textContent.trim().replace(',', '.');
        const inShares = parseFloat(inSharesStr) || 0;
        console.log('calculateAndUpdateTotalSum: In Shares value from DOM:', inSharesStr, 'parsed:', inShares);
        
        // Calculate Total Sum = Cash + In Shares
        const totalSum = cash + inShares;
        const roundedTotal = Number(totalSum.toFixed(2));
        
        console.log('calculateAndUpdateTotalSum: Calculated values', {
            cash,
            inShares,
            totalSum: roundedTotal,
            oldTotalSum: totalSumSpan.textContent
        });
        
        // Update Total Sum field
        const oldValue = totalSumSpan.textContent;
        totalSumSpan.textContent = roundedTotal.toFixed(2);
        localStorage.setItem('totalSum', String(roundedTotal));
        console.log('calculateAndUpdateTotalSum: Updated UI from', oldValue, 'to', roundedTotal.toFixed(2));
        
        // Save to database
        try {
            const res = await apiFetch('/api/users/totalsum', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders()
                },
                body: JSON.stringify({ TotalSum: roundedTotal })
            });
            if (!res.ok) {
                console.error('Failed to save Total Sum', res.status);
            } else {
                console.log('Total Sum updated to:', roundedTotal);
            }
        } catch (e) {
            console.error('Error saving Total Sum', e);
        }
    } catch (e) {
        console.error('Error calculating Total Sum', e);
    }
}

async function saveDealToServer(deal, isEdit) {
    const hasId = !!deal.id;
    const url = isEdit && hasId ? `/api/deals/${deal.id}` : '/api/deals';
    const method = isEdit && hasId ? 'PUT' : 'POST';

    const res = await apiFetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify(deal)
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('Save failed', res.status, text);
        throw new Error(`Failed to save deal (${res.status})`);
    }
    
    // After saving deal, recalculate In Shares, Cash, and Total Sum
    // This happens on the server side (Cash is deducted), so we need to refresh from server
    await refreshPortfolioFromServer();
    await calculateAndUpdateInShares();
    await calculateAndUpdateTotalSum();
}

// Refresh Cash (Portfolio) value from server
async function refreshPortfolioFromServer() {
    try {
        const res = await apiFetch('/api/users/portfolio', {
            headers: authHeaders()
        });
        if (res.ok) {
            const portfolioData = await res.json();
            const portfolio = portfolioData.portfolio ?? portfolioData.Portfolio;
            if (portfolio !== undefined) {
                const portfolioSpan = document.getElementById('portfolioValue');
                if (portfolioSpan) {
                    const val = Number(portfolio) || 0;
                    portfolioSpan.textContent = val.toFixed(2);
                    localStorage.setItem('portfolio', String(val));
                }
            }
        }
    } catch (e) {
        console.error('Error refreshing portfolio from server', e);
    }
}

// Handle deal form submission
async function handleDealSubmit(form, deal, isNew) {
    const formData = new FormData(form);
    const dealData = {};
    
    // Collect all form fields
    for (const [key, value] of formData.entries()) {
        dealData[key] = value;
    }
    
    // If editing, preserve the deal ID
    if (deal && deal.id) {
        dealData.id = deal.id;
    }
    
    try {
        await saveDealToServer(dealData, !!deal?.id);
        
        // Reload deals to show the updated list
        await loadDeals();
        
        // Calculate and display portfolio risk after saving deal
        await calculateAndDisplayPortfolioRisk();
        
        // If this was a new deal, close the form
        if (isNew) {
            newDealRow = null;
            expandedDealId = null;
            renderAll();
        }
    } catch (e) {
        console.error('Error saving deal', e);
        alert('Не удалось сохранить сделку');
    }
}

async function deleteDealOnServer(id) {
    const res = await apiFetch(`/api/deals/${id}`, {
        method: 'DELETE',
        headers: {
            ...authHeaders()
        }
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('Delete failed', res.status, text);
        throw new Error('Failed to delete deal');
    }
}

// ========== ЛОГАУТ ==========

if (elements.logoutBtn) {
    elements.logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('email');
        localStorage.removeItem('userName');
        window.location.href = '/login.html';
    });
}

// ========== HAMBURGER MENU ==========

const menuToggle = document.getElementById('menuToggle');
const mobileMenu = document.getElementById('mobileMenu');
const mobileMenuOverlay = document.createElement('div');
mobileMenuOverlay.className = 'mobile-menu-overlay';
document.body.appendChild(mobileMenuOverlay);

// Mobile menu buttons (clone functionality from desktop buttons)
const newDealBtnMobile = document.getElementById('newDealBtnMobile');
const logoutBtnMobile = document.getElementById('logoutBtnMobile');

if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
        const isOpen = mobileMenu.classList.contains('open');
        
        if (isOpen) {
            closeMobileMenu();
        } else {
            openMobileMenu();
        }
    });
    
    // Close menu when clicking overlay
    mobileMenuOverlay.addEventListener('click', closeMobileMenu);
    
    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
            closeMobileMenu();
        }
    });
}

function openMobileMenu() {
    if (mobileMenu) {
        mobileMenu.classList.add('open');
        mobileMenuOverlay.classList.add('active');
        if (menuToggle) menuToggle.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
}

function closeMobileMenu() {
    if (mobileMenu) {
        mobileMenu.classList.remove('open');
        mobileMenuOverlay.classList.remove('active');
        if (menuToggle) menuToggle.classList.remove('active');
        document.body.style.overflow = ''; // Restore scrolling
    }
}

// Wire up mobile menu buttons to same functionality as desktop buttons
if (newDealBtnMobile && elements.newDealBtn) {
    newDealBtnMobile.addEventListener('click', () => {
        // Trigger the same action as desktop New Deal button
        elements.newDealBtn.click();
        closeMobileMenu();
    });
}

if (logoutBtnMobile && elements.logoutBtn) {
    logoutBtnMobile.addEventListener('click', () => {
        // Trigger the same action as desktop Logout button
        elements.logoutBtn.click();
        closeMobileMenu();
    });
}

// ========== INLINE FORM GENERATION ==========

function createDealFormHTML(deal = null, isNew = false) {
    const dealId = deal?.id || 'new';
    const isEdit = !isNew && deal !== null;
    const dateValue = deal?.date ? (deal.date.includes('T') ? deal.date.split('T')[0] : deal.date) : new Date().toISOString().split('T')[0];
    
    return `
        <form class="deal-form-inline" data-deal-id="${dealId}">
            <div class="form-grid">
                <label>Deal date<input type="date" name="date" value="${dateValue}" required></label>

                <label>
                    Share name
                    <select name="stock" class="deal-stock-select" required>
                        <option value="" disabled selected>Loading stocks…</option>
                    </select>
                </label>
                <label>Share price<input type="text" name="share_price" value="${escapeHtml(String(deal?.share_price || ''))}" placeholder=""></label>
               
                <label>Shares amount to buy at stage 1<input type="text" name="amount_tobuy_stage_1" value="${escapeHtml(deal?.amount_tobuy_stage_1 || '')}" placeholder=""></label>
                <label>Shares amount to buy at stage 2<input type="text" name="amount_tobuy_stage_2" value="${escapeHtml(deal?.amount_tobuy_stage_2 || '')}" placeholder=""></label>
                <label>Take profit<input type="text" name="take_profit" value="${escapeHtml(deal?.take_profit || '')}" placeholder=""></label>
                <label>Take profit %?<input type="text" name="take_profit_prcnt" value="${escapeHtml(deal?.take_profit_prcnt || '')}" placeholder=""></label>
                <label>Stop loss<input type="text" name="stop_loss" value="${escapeHtml(deal?.stop_loss || '')}" placeholder=""></label>
                <label>Stop loss %?<input type="text" name="stop_loss_prcnt" value="${escapeHtml(deal?.stop_loss_prcnt || '')}" placeholder=""></label>

                <label>
                    You're afraid it will be too late?
                    <select name="fear_too_late">
                        <option value="" ${!deal?.fear_too_late ? 'selected' : ''} disabled></option>
                        <option value="no" ${deal?.fear_too_late === 'no' ? 'selected' : ''}>No</option>
                        <option value="yes" ${deal?.fear_too_late === 'yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>
                <label>
                    You want earn big money quickly?
                    <select name="get_even">
                        <option value="" ${!deal?.get_even ? 'selected' : ''} disabled></option>
                        <option value="no" ${deal?.get_even === 'no' ? 'selected' : ''}>No</option>
                        <option value="yes" ${deal?.get_even === 'yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>
                <label>
                    Is this deal idea you got from other people?
                    <select name="from_others">
                        <option value="" ${!deal?.from_others ? 'selected' : ''} disabled></option>
                        <option value="no" ${deal?.from_others === 'no' ? 'selected' : ''}>No</option>
                        <option value="yes" ${deal?.from_others === 'yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>

                <label>
                    Is S&P500 in an upper trend right now on monthly timeframe?
                    <select name="sp500_up">
                        <option value="" ${!deal?.sp500_up ? 'selected' : ''} disabled></option>
                        <option value="no" ${deal?.sp500_up === 'no' ? 'selected' : ''}>No</option>
                        <option value="yes" ${deal?.sp500_up === 'yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>

                <label>
                    The share is in end of reversal pattern?
                    <select name="reversal">
                        <option value="" ${!deal?.reversal ? 'selected' : ''} disabled></option>
                        <option value="no" ${deal?.reversal === 'no' ? 'selected' : ''}>No</option>
                        <option value="yes" ${deal?.reversal === 'yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>
                <label>
                    The share is in a flat pattern?
                    <select name="flatpattern">
                        <option value="" ${!deal?.flatpattern ? 'selected' : ''} disabled></option>
                        <option value="no" ${deal?.flatpattern === 'no' ? 'selected' : ''}>No</option>
                        <option value="yes" ${deal?.flatpattern === 'yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>
                <label>
                    What is the current price range position according all share history
                    <select name="price_range_pos">
                        <option value="" ${!deal?.price_range_pos ? 'selected' : ''} disabled></option>
                        <option value="1" ${deal?.price_range_pos === '1' ? 'selected' : ''}>Bottom</option>
                        <option value="2" ${deal?.price_range_pos === '2' ? 'selected' : ''}>Middle</option>
                        <option value="3" ${deal?.price_range_pos === '3' ? 'selected' : ''}>Highest</option>
                    </select>
                </label>

                <label>Support price on week timeline<input type="text" name="support_price" value="${escapeHtml(deal?.support_price || '')}" placeholder=""></label>
                <label>Resistance price on week timeline<input type="text" name="resist_price" value="${escapeHtml(deal?.resist_price || '')}" placeholder=""></label>

                <label>O price previous week<input type="text" name="o_price" value="${escapeHtml(deal?.o_price || '')}" placeholder=""></label>
                <label>H price previous week<input type="text" name="h_price" value="${escapeHtml(deal?.h_price || '')}" placeholder=""></label>

                <label>
                    What is the timeframe you make decision
                    <select name="timeframe">
                        <option value="" ${!deal?.timeframe ? 'selected' : ''} disabled></option>
                        <option ${deal?.timeframe === 'Daily' ? 'selected' : ''}>Daily</option>
                        <option ${deal?.timeframe === 'Weekly' ? 'selected' : ''}>Weekly</option>
                        <option ${deal?.timeframe === 'Monthly' ? 'selected' : ''}>Monthly</option>
                    </select>
                </label>
                <label>
                    Is share monthly timeframe trand down or up?
                    <select name="monthly_dir">
                        <option value="" ${!deal?.monthly_dir ? 'selected' : ''} disabled></option>
                        <option ${deal?.monthly_dir === 'Down' ? 'selected' : ''}>Down</option>
                        <option ${deal?.monthly_dir === 'Up' ? 'selected' : ''}>Up</option>
                        <option ${deal?.monthly_dir === 'Flat' ? 'selected' : ''}>Flat</option>
                    </select>
                </label>
                <label>
                    Is share weekly timeframe trand down or up?
                    <select name="weekly_dir">
                        <option value="" ${!deal?.weekly_dir ? 'selected' : ''} disabled></option>
                        <option ${deal?.weekly_dir === 'Down' ? 'selected' : ''}>Down</option>
                        <option ${deal?.weekly_dir === 'Up' ? 'selected' : ''}>Up</option>
                        <option ${deal?.weekly_dir === 'Flat' ? 'selected' : ''}>Flat</option>
                    </select>
                </label>

                <label>
                    Do you buy on the corrections pattern?
                    <select name="correction_trand">
                        <option value="" ${!deal?.correction_trand ? 'selected' : ''} disabled></option>
                        <option ${deal?.correction_trand === 'No' ? 'selected' : ''}>No</option>
                        <option ${deal?.correction_trand === 'Yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>
                <label>
                    Is you deal is counter trend?
                    <select name="counter_trend">
                        <option value="" ${!deal?.counter_trend ? 'selected' : ''} disabled></option>
                        <option ${deal?.counter_trend === 'No' ? 'selected' : ''}>No</option>
                        <option ${deal?.counter_trend === 'Yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>

                <label>
                    What is current week candle color?
                    <select name="buy_green_sell_red">
                        <option value="" ${!deal?.buy_green_sell_red ? 'selected' : ''} disabled></option>
                        <option ${deal?.buy_green_sell_red === 'Red' ? 'selected' : ''}>Red</option>
                        <option ${deal?.buy_green_sell_red === 'Green' ? 'selected' : ''}>Green</option>
                    </select>
                </label>
                <label>
                    Is the share in flat position before up trend?
                    <select name="flat_before_up">
                        <option value="" ${!deal?.flat_before_up ? 'selected' : ''} disabled></option>
                        <option ${deal?.flat_before_up === 'No' ? 'selected' : ''}>No</option>
                        <option ${deal?.flat_before_up === 'Yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>
                <label>
                    Is the share in flat position before down trend?
                    <select name="flat_before_down">
                        <option value="" ${!deal?.flat_before_down ? 'selected' : ''} disabled></option>
                        <option ${deal?.flat_before_down === 'No' ? 'selected' : ''}>No</option>
                        <option ${deal?.flat_before_down === 'Yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>
  
                <label>
                    Is current week candle O higher than previous  week O?
                    <select name="green_candle_higher">
                        <option value="" ${!deal?.green_candle_higher ? 'selected' : ''} disabled></option>
                        <option ${deal?.green_candle_higher === 'No' ? 'selected' : ''}>No</option>
                        <option ${deal?.green_candle_higher === 'Yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>
                <label class="full">Deal details description<textarea name="notes">${escapeHtml(deal?.notes || '')}</textarea></label>

                ${!deal?.closed ? `
                <div class="deal-chart-section full">
                    <div id="tv_chart_${dealId}" class="deal-chart-container"></div>
                </div>
                ` : ''}

                <div class="full form-actions">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 50px; flex-wrap: wrap;">
                            ${isNew ? `
                            <button type="submit" data-original-text="Plan a deal">Plan a deal</button>
                            ` : deal?.planned_future ? `
                            <button type="button" class="activate-deal-btn">Create deal</button>
                            ${!deal?.closed ? `<button type="submit" class="secondary">Save changes</button>` : ''}
                            ` : `
                            ${!deal?.closed ? `<button type="submit">Save changes</button>` : ''}
                            `}
                        </div>
                        ${
                            isNew
                                ? `<button type="button" class="cancel-deal-btn secondary">Cancel</button>`
                                : (isEdit && !deal?.closed
                                    ? `<button type="button" class="secondary close-deal-btn">Close deal</button>`
                                    : '')
                        }
                    </div>
                </div>
            </div>
        </form>
    `;
}

// ========== РЕНДЕР ==========

function renderAll() {
    const filter = (elements.filterInput.value || '').toLowerCase();

    let open = deals.filter(
        d =>
            !d.closed &&
            ((d.stock || '').toLowerCase().includes(filter) ||
                (d.notes || '').toLowerCase().includes(filter))
    );

    // Sort open deals by id (descending) - MongoDB ObjectIds contain timestamp, most recent first
    open = open.sort((a, b) => {
        // Compare by id (MongoDB ObjectId contains timestamp, lexicographic comparison works)
        const idA = a.id || '';
        const idB = b.id || '';
        if (idA && idB) {
            return idB.localeCompare(idA); // Descending order (newest first)
        }
        // If one has no id, put it at the end
        if (idA && !idB) return -1;
        if (!idA && idB) return 1;
        return 0;
    });

    elements.openList.innerHTML = '';

    if (!dealsLoaded) {
        elements.emptyOpen.innerHTML = '<div class="loading-container"><span class="loading-spinner"></span><span>Загружаем сделки...</span></div>';
        elements.emptyOpen.style.display = 'block';
    } else if (open.length === 0 && !newDealRow) {
        elements.emptyOpen.textContent =
            'Нет открытых сделок — нажмите «New Deal», чтобы добавить.';
        elements.emptyOpen.style.display = 'block';
    } else {
        elements.emptyOpen.style.display = 'none';

        // Render new deal row if it exists (always at the top)
        if (newDealRow) {
            const newRow = createDealRow(null, true);
            elements.openList.appendChild(newRow);
        }

        // Render existing deals (already sorted, most recent first)
        open.forEach(d => {
            const row = createDealRow(d, false);
            elements.openList.appendChild(row);
        });
    }

    const count = open.length + (newDealRow ? 1 : 0);
    elements.openCount.textContent = count;
    
    // Add warning icon based on count
    // Find the container div that holds the count
    const countContainer = elements.openCount.parentElement;
    if (countContainer) {
        // Remove existing warning icon if any
        const existingWarning = countContainer.querySelector('.count-warning-icon');
        if (existingWarning) {
            existingWarning.remove();
        }
        
        // Add warning icon if count exceeds thresholds
        if (count > 15) {
            // Red warning for count > 15
            const warningIcon = document.createElement('span');
            warningIcon.className = 'count-warning-icon count-warning-red';
            warningIcon.setAttribute('data-tooltip', `High number of open deals: ${count}. Consider closing some deals.`);
            warningIcon.textContent = '!';
            countContainer.appendChild(warningIcon);
        } else if (count > 10) {
            // Yellow warning for count > 10
            const warningIcon = document.createElement('span');
            warningIcon.className = 'count-warning-icon count-warning-yellow';
            warningIcon.setAttribute('data-tooltip', `Many open deals: ${count}. Monitor your portfolio carefully.`);
            warningIcon.textContent = '!';
            countContainer.appendChild(warningIcon);
        }
    }

    // CLOSED deals
    let closed = deals.filter(d => d.closed);

    // Sort closed deals by id (descending) - most recent first
    closed = closed.sort((a, b) => {
        const idA = a.id || '';
        const idB = b.id || '';
        if (idA && idB) {
            return idB.localeCompare(idA); // Descending order (newest first)
        }
        if (idA && !idB) return -1;
        if (!idA && idB) return 1;
        return 0;
    });

    elements.closedList.innerHTML = '';

    if (!dealsLoaded) {
        elements.emptyClosed.innerHTML = '<div class="loading-container"><span class="loading-spinner"></span><span>Загружаем сделки...</span></div>';
        elements.emptyClosed.style.display = 'block';
    } else if (closed.length === 0) {
        elements.emptyClosed.style.display = 'block';
    } else {
        elements.emptyClosed.style.display = 'none';

        closed.forEach(d => {
            const row = createDealRow(d, false);
            elements.closedList.appendChild(row);
        });
    }
    
    // Update closed deals count (no warning logic, just count)
    if (elements.closedCount) {
        elements.closedCount.textContent = closed.length;
    }
}

function createDealRow(deal, isNew) {
    const dealId = deal?.id || 'new';
    const isExpanded = expandedDealId === dealId || isNew;
    
    const row = document.createElement('div');
    row.className = `deal-row ${isExpanded ? 'expanded' : ''}`;
    row.dataset.dealId = dealId;

    // Collapsed summary view
    const summary = document.createElement('div');
    summary.className = 'deal-summary';
    
    // Calculate and format total sum for display
    const totalSum = calculateTotalSum(deal?.share_price, deal?.amount_tobuy_stage_1);
    const totalSumFormatted = formatTotalSum(totalSum || deal?.total_sum);
    const totalSumDisplay = totalSumFormatted ? totalSumFormatted : '';
    
    // Add planned future indicator next to date (only for open planned deals)
    const plannedFutureLabel =
        deal?.planned_future && !deal?.closed
            ? ' <span style="color: #f59e0b; font-size: 12px; font-weight: 500; margin-left: 8px;">[Planned]</span>'
            : '';
    
    // Check if stock has warnings and add indicators
    let volumeIndicator = '';
    let sp500Indicator = '';
    let atrIndicator = '';
    let syncSp500Indicator = '';
    let betaVolatilityIndicator = '';
    if (deal?.stock) {
        // First check warnings cache (preferred method)
        const warning = getWarningByTicker(deal.stock);
        if (warning) {
            if (warning.regular_share_volume) {
                volumeIndicator = `<span class="volume-warning-icon" data-tooltip="Regular share volume: Small (around 50M per week)">!</span>`;
            }
            if (warning.sp500_member) {
                sp500Indicator = `<span class="volume-warning-icon" data-tooltip="S&amp;P 500 member: Not a member">!</span>`;
            }
            if (warning.atr_high_risk) {
                atrIndicator = `<span class="volume-warning-icon" data-tooltip="ATR (Average True Range): High risk (more than 10%)">!</span>`;
            }
            if (warning.sync_sp500_no) {
                syncSp500Indicator = `<span class="volume-warning-icon" data-tooltip="Is share movement synchronized with S&amp;P500?: No">!</span>`;
            }
            if (warning.beta_volatility_high) {
                betaVolatilityIndicator = `<span class="volume-warning-icon" data-tooltip="Share beta volatility: High (more volatile)">!</span>`;
            }
        }
        
        // Fallback: check stock's fields (for backward compatibility)
        const stock = getStockByTicker(deal.stock);
        if (stock) {
            const regularVolume = stock.regular_volume || stock.RegularVolume;
            if (regularVolume === '1' || regularVolume === 1) {
                volumeIndicator = `<span class="volume-warning-icon" data-tooltip="Regular share volume: Small (around 50M per week)">!</span>`;
            }
            // Check S&P 500 member status
            if (!stock.sp500Member && !stock.Sp500Member) {
                sp500Indicator = `<span class="volume-warning-icon" data-tooltip="S&amp;P 500 member: Not a member">!</span>`;
            }
            // Check ATR high risk
            if (isAtrHighRiskFromString(stock.atr || stock.Atr)) {
                atrIndicator = `<span class="volume-warning-icon" data-tooltip="ATR (Average True Range): High risk (more than 10%)">!</span>`;
            }
            // Check sync SP500
            if (stock.sync_sp500 === 'no' || stock.SyncSp500 === 'no') {
                syncSp500Indicator = `<span class="volume-warning-icon" data-tooltip="Is share movement synchronized with S&amp;P500?: No">!</span>`;
            }
            // Check beta volatility high
            if (stock.betaVolatility === '3' || stock.BetaVolatility === '3' || stock.betaVolatility === 3) {
                betaVolatilityIndicator = `<span class="volume-warning-icon" data-tooltip="Share beta volatility: High (more volatile)">!</span>`;
            }
        }
    }
    
    summary.innerHTML = `
        <div class="meta">
            ${deal?.stock 
                ? `<div class="deal-title-row">
                    <div class="stock-name">
                        <strong>${escapeHtml(deal.stock)}${volumeIndicator}${sp500Indicator}${atrIndicator}${syncSp500Indicator}${betaVolatilityIndicator}</strong>
                    </div>
                    ${totalSumDisplay ? `<div class="total-sum-display">${totalSumDisplay}</div>` : ''}
                    <div class="movement-metrics-container"></div>
                </div>`
                : `<div class="new-deal-title"><strong>New Deal</strong></div>`
            }
            ${deal ? `<span class="small" style="margin-top:4px">${formatDate(deal.date)}${plannedFutureLabel}</span>` : ''}
            ${deal ? `<div class="small" style="margin-top:6px">${escapeHtml((deal.notes || '').slice(0, 140))}</div>` : ''}
        </div>
        ${deal ? `
        <div class="chips" style="min-width:140px;justify-content:flex-end">
            <div class="badge movement-metric-tooltip" data-tooltip="Share Price">SP:${escapeHtml(deal.share_price || '-')}</div>
            <div class="badge movement-metric-tooltip" data-tooltip="Stop Loss">SL:${escapeHtml(deal.stop_loss || '-')}</div>
            ${deal.stop_loss_prcnt ? (() => {
                // Extract numeric value from percentage string (supports optional minus sign)
                const slPercentMatch = String(deal.stop_loss_prcnt).match(/-?\d+(\.\d+)?/);
                const slPercentValue = slPercentMatch ? parseFloat(slPercentMatch[0]) : 0;
                
                // Determine color class based on SL percentage
                let colorClass = '';
                if (slPercentValue <= 0) {
                    // Zero or negative SL% → green badge
                    colorClass = 'sl-percent-green';
                } else if (slPercentValue > 10) {
                    colorClass = 'sl-percent-red'; // Red for SL% > 10%
                } else if (slPercentValue > 5) {
                    colorClass = 'sl-percent-yellow'; // Yellow for SL% > 5% (but <= 10%)
                }
                
                return `<div class="badge movement-metric-tooltip ${colorClass}" data-tooltip="Stop Loss Percentage">SL:${escapeHtml(deal.stop_loss_prcnt)}%</div>`;
            })() : ''}
            <div class="badge movement-metric-tooltip" data-tooltip="Take Profit">TP:${escapeHtml(deal.take_profit || '-')}</div>
            ${deal.take_profit_prcnt ? `<div class="badge movement-metric-tooltip" data-tooltip="Take Profit Percentage">TP:${escapeHtml(deal.take_profit_prcnt)}%</div>` : ''}
            ${deal.reward_to_risk ? (() => {
                // Extract numeric value from "1:4.3" format
                const ratioMatch = deal.reward_to_risk.match(/1:([\d.]+)/);
                const ratioValue = ratioMatch ? parseFloat(ratioMatch[1]) : 0;
                
                // Determine color class based on ratio
                let colorClass = '';
                if (ratioValue <= 1.0) {
                    colorClass = 'reward-risk-red'; // Red for 1:1 or worse
                } else if (ratioValue <= 2.0) {
                    colorClass = 'reward-risk-yellow'; // Yellow for 1:2 or worse (but better than 1:1)
                }
                
                return `<div class="badge movement-metric-tooltip ${colorClass}" data-tooltip="Reward to Risk Ratio">R ${escapeHtml(deal.reward_to_risk)}</div>`;
            })() : ''}
        </div>
        ` : ''}
    `;
    
    // Add movement metrics near the price (load asynchronously)
    // Only for open deals (not closed, and not new deals - new deals will get metrics when stock is selected)
    if (deal?.stock && deal?.id && !deal?.closed && !isNew) {
        console.log('Adding movement metrics for deal stock:', deal.stock);
        
        // Store deal ID and stock ticker on the row for later retrieval
        const dealId = deal?.id || 'new';
        row.dataset.dealStock = deal.stock;
        
        loadMovementMetrics(deal.stock).then(metrics => {
            console.log('Movement metrics received for', deal.stock, ':', metrics);
            
            // Re-find the row and summary (in case DOM was re-rendered)
            const currentRow = document.querySelector(`[data-deal-id="${dealId}"]`);
            if (!currentRow) {
                console.warn('Deal row not found for', dealId);
                return;
            }
            
            const currentSummary = currentRow.querySelector('.deal-summary');
            if (!currentSummary) {
                console.warn('Summary element not found in row for', deal.stock);
                return;
            }
            
            const metricsContainer = currentSummary.querySelector('.movement-metrics-container');
            if (!metricsContainer) {
                console.warn('movement-metrics-container not found for', deal.stock);
                return;
            }
            
            // Avoid duplicates
            const existing = metricsContainer.querySelector('.movement-metrics-display');
            if (existing) {
                console.log('Movement metrics already displayed for', deal.stock);
                return;
            }
            
            if (metrics) {
                const formatted = formatMovementMetrics(metrics);
                console.log('Formatted movement metrics:', formatted);
                
                metricsContainer.innerHTML = formatted;
                console.log('Movement metrics inserted into metrics container successfully');
            } else {
                console.log('No movement metrics available for', deal.stock);
            }
        }).catch(err => {
            console.error('Error loading movement metrics for', deal.stock, ':', err);
        });
    }
    // Note: Movement metrics are only shown for open deals with selected stock
    // This is expected behavior for new deals (no stock selected yet) or closed deals

    // Expanded form view
    const formContainer = document.createElement('div');
    formContainer.className = 'deal-form-container';
    formContainer.style.display = isExpanded ? 'block' : 'none';
    formContainer.innerHTML = createDealFormHTML(deal, isNew);

    row.appendChild(summary);
    row.appendChild(formContainer);

    // Setup event handlers
    setupDealRowHandlers(row, deal, isNew);

    return row;
}

async function setupDealRowHandlers(row, deal, isNew) {
    const dealId = deal?.id || 'new';
    const summary = row.querySelector('.deal-summary');
    const formContainer = row.querySelector('.deal-form-container');
    const form = row.querySelector('.deal-form-inline');

    // If this is a new deal row that starts expanded, populate stocks immediately
    if (isNew && row.classList.contains('expanded') && form) {
        // Explicitly reset select to ensure it's empty
        const select = form.querySelector('.deal-stock-select');
        if (select) {
            select.value = '';
            select.selectedIndex = -1;
        }
        await populateStockSelect(form, null);
        setupStockSelectListener(form, dealId);
        setupTrendSelectListeners(form);
    }
    
    // Setup trend select listeners for all forms
    if (form) {
        setupTrendSelectListeners(form);
        setupSharePriceListener(form);
        setupStopLossListener(form);
        setupTakeProfitListener(form);
        setupTotalSumCalculator(row, form, deal);

        // For new deals (which start expanded) or rows initially expanded,
        // initialize chart immediately; existing collapsed deals will
        // initialize chart on expand to avoid rendering into hidden container.
        if (isNew || row.classList.contains('expanded')) {
            setupDealChart(row, form, deal, dealId);
        }
        
        // Cancel button for new deals
        if (isNew) {
            const cancelBtn = form.querySelector('.cancel-deal-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    // Close the deal row without saving
                    newDealRow = null;
                    expandedDealId = null;
                    renderAll();
                });
            }
        }
    }

    // Toggle expand/collapse on summary click
    summary.addEventListener('click', async (e) => {
        // Don't toggle if clicking on badges
        if (e.target.closest('.chips')) return;
        
        const isExpanded = row.classList.contains('expanded');
        if (isExpanded) {
            row.classList.remove('expanded');
            formContainer.style.display = 'none';
            expandedDealId = null;
            if (isNew) {
                newDealRow = null;
                renderAll();
            }
        } else {
            // Collapse any other expanded row
            if (expandedDealId && expandedDealId !== dealId) {
                const otherRow = document.querySelector(`[data-deal-id="${expandedDealId}"]`);
                if (otherRow) {
                    otherRow.classList.remove('expanded');
                    otherRow.querySelector('.deal-form-container').style.display = 'none';
                }
            }
            row.classList.add('expanded');
            formContainer.style.display = 'block';
            expandedDealId = dealId;
            
            // Load stocks for the select
            if (form) {
                const tickerToUse = isNew ? null : (deal?.stock || null);
                await populateStockSelect(form, tickerToUse);
                setupStockSelectListener(form, dealId);
                setupTrendSelectListeners(form);
                setupSharePriceListener(form);
                setupStopLossListener(form);
                setupDealChart(row, form, deal, dealId);
            }
        }
    });

    // Form submit
        if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleDealSubmit(form, deal, isNew);
        });

        // Activate deal button (for planned deals)
        const activateBtn = form.querySelector('.activate-deal-btn');
        if (activateBtn) {
            activateBtn.addEventListener('click', async () => {
                if (!deal || !deal.id) return;

                // Gather latest values from form (fallback to deal if inputs are empty)
                let sharePriceNum = 0;
                let amount1Num = 0;
                let amount2Num = 0;
                let slPctNum = 0;

                try {
                    if (form) {
                        const spInput  = form.querySelector('input[name="share_price"]');
                        const a1Input  = form.querySelector('input[name="amount_tobuy_stage_1"]');
                        const a2Input  = form.querySelector('input[name="amount_tobuy_stage_2"]');
                        const slInput  = form.querySelector('input[name="stop_loss_prcnt"]');

                        if (spInput) sharePriceNum = parseFloat(String(spInput.value || '').replace(',', '.')) || 0;
                        if (a1Input) amount1Num    = parseFloat(String(a1Input.value || '')) || 0;
                        if (a2Input) amount2Num    = parseFloat(String(a2Input.value || '')) || 0;
                        if (slInput) slPctNum      = parseFloat(String(slInput.value || '').replace(',', '.')) || 0;
                    }

                    // Fallback to deal values if form fields are empty
                    if (!sharePriceNum && deal.share_price) {
                        sharePriceNum = parseFloat(String(deal.share_price).replace(',', '.')) || 0;
                    }
                    if (!amount1Num && deal.amount_tobuy_stage_1) {
                        amount1Num = parseFloat(String(deal.amount_tobuy_stage_1)) || 0;
                    }
                    if (!amount2Num && deal.amount_tobuy_stage_2) {
                        amount2Num = parseFloat(String(deal.amount_tobuy_stage_2)) || 0;
                    }
                    if (!slPctNum && deal.stop_loss_prcnt) {
                        slPctNum = parseFloat(String(deal.stop_loss_prcnt).replace(',', '.')) || 0;
                    }

                    const totalPlanned = sharePriceNum * (amount1Num + amount2Num);

                    // 0) Строгая проверка: хватает ли вообще Cash под эту позицию
                    try {
                        const portfolioSpan = document.getElementById('portfolioValue');
                        if (portfolioSpan) {
                            const cashStr = portfolioSpan.textContent.trim().replace(',', '.');
                            const cash = parseFloat(cashStr) || 0;
                            if (totalPlanned > cash) {
                                showDealLimitModal(
                                    `Not enough Cash to activate this deal.\n` +
                                    `Required: ${totalPlanned.toFixed(2)}, available: ${cash.toFixed(2)}.`
                                );
                                return;
                            }
                        }
                    } catch (cashErr) {
                        console.error('Failed to validate cash before activation', cashErr);
                    }

                    // 1) Жёсткая проверка лимитов по размеру позиции и риску
                    if (slPctNum > 0 && totalPlanned > 0) {
                        const res = await apiFetch(`/api/deals/limits?stopLossPercent=${encodeURIComponent(slPctNum)}`, {
                            headers: authHeaders()
                        });
                        if (res.ok) {
                            const limits = await res.json();
                            const isSingle = !amount2Num || amount2Num === 0;

                            if (isSingle) {
                                if (totalPlanned > limits.singleStageMax) {
                                    showDealLimitModal(
                                        `Single-stage deal is too big.\n` +
                                        `Max allowed: ${limits.singleStageMax.toFixed(2)}.`
                                    );
                                    return;
                                }
                            } else {
                                const stage1Sum = sharePriceNum * amount1Num;
                                if (stage1Sum > limits.maxStage1 || totalPlanned > limits.maxPosition) {
                                    showDealLimitModal(
                                        `Two-stage deal exceeds limits.\n` +
                                        `Stage 1 max: ${limits.maxStage1.toFixed(2)}, total max: ${limits.maxPosition.toFixed(2)}.`
                                    );
                                    return;
                                }
                            }

                            if (!limits.allowed) {
                                showDealLimitModal(
                                    `Deal would push portfolio risk above limit.\n` +
                                    `Added risk: ${limits.addedRiskPercent.toFixed(2)}%.`
                                );
                                return;
                            }
                        }
                    }

                    // 2) Мягкое предупреждение, если уже было 2 и более активаций за неделю
                    try {
                        const weeklyRes = await apiFetch('/api/deals/weekly-activations', {
                            headers: authHeaders()
                        });
                        if (weeklyRes.ok) {
                            const data = await weeklyRes.json();
                            if (data && data.exceeds) {
                                const msg =
                                    `You already activated ${data.count} deals this week.\n` +
                                    `Recommended maximum is ${data.maxPerWeek} per week.\n\n` +
                                    `Do you still want to activate this deal?`;
                                const proceed = await showWeeklyConfirmModal(msg);
                                if (!proceed) {
                                    return; // пользователь отменил активацию
                                }
                            }
                        }
                    } catch (warnErr) {
                        console.error('Failed to check weekly activations', warnErr);
                        // В случае ошибки предупреждения не блокируем активацию
                    }
                } catch (err) {
                    console.error('Failed to validate deal limits before activation', err);
                    // Если лимиты не смогли посчитать — не блокируем, но логируем
                }

                setButtonLoading(activateBtn, true);
                
                // Change planned_future from true to false
                const updatedDeal = { ...deal, planned_future: false };
                
                try {
                    await saveDealToServer(updatedDeal, true);
                    
                    // If deal has total_sum, deduct from portfolio (since it's now active)
                    if (updatedDeal.total_sum) {
                        await refreshPortfolioFromServer();
                    }
                    
                    await loadDeals();
                    
                    // Calculate and display portfolio risk after activating deal
                    await calculateAndDisplayPortfolioRisk();
                    await calculateAndDisplayInSharesRisk();
                } catch (e) {
                    console.error(e);
                    alert('Не удалось активировать сделку');
                } finally {
                    setButtonLoading(activateBtn, false);
                }
            });
            // Setup risk/limits hints for this form
            setupRiskAndLimits(form);
        }

        // Close deal button
        const closeBtn = form.querySelector('.close-deal-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', async () => {
                const updatedDeal = { ...deal, closed: true, closedAt: new Date().toISOString() };
                try {
                    setButtonLoading(closeBtn, true);
                    await saveDealToServer(updatedDeal, true);
                    await loadDeals();
                } catch (e) {
                    console.error(e);
                    alert('Не удалось закрыть сделку');
                } finally {
                    setButtonLoading(closeBtn, false);
                }
            });
        }
    }
}

// Setup TradingView chart for a specific deal row (once per form)
function setupDealChart(row, form, deal, dealId) {
    if (!form) return;

    const chartContainerId = `tv_chart_${dealId}`;
    const chartContainer = form.querySelector(`#${chartContainerId}`) || row.querySelector(`#${chartContainerId}`);
    if (!chartContainer) {
        return;
    }

    const toolbar = form.querySelector('.deal-chart-toolbar');
    const stockSelect = form.querySelector('.deal-stock-select');

    function getCurrentSymbol() {
        let ticker = null;

        if (stockSelect && stockSelect.value) {
            ticker = stockSelect.value;
        } else if (deal && deal.stock) {
            ticker = deal.stock;
        }

        return buildSymbolFromTicker(ticker);
    }

    // Initial render for existing deals with a stock
    const initialSymbol = getCurrentSymbol();
    if (initialSymbol) {
        renderTradingViewChart(chartContainerId, initialSymbol, 'W');
    }

    // React to stock selection changes
    if (stockSelect) {
        stockSelect.addEventListener('change', () => {
            const symbol = getCurrentSymbol();
            if (!symbol) return;

            renderTradingViewChart(chartContainerId, symbol, 'W');

            if (toolbar) {
                toolbar.querySelectorAll('button[data-interval]').forEach(b => b.classList.remove('active'));
                const wBtn = toolbar.querySelector('button[data-interval="W"]');
                if (wBtn) wBtn.classList.add('active');
            }
        });
    }

}

// Setup total sum calculator that updates title when share_price or amount_tobuy_stage_1 changes
function setupTotalSumCalculator(row, form, deal) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const amountInput = form.querySelector('input[name="amount_tobuy_stage_1"]');
    const summary = row.querySelector('.deal-summary');
    
    if (!sharePriceInput || !amountInput || !summary) return;
    
    const updateTotalSum = () => {
        const sharePrice = sharePriceInput.value || '';
        const amount = amountInput.value || '';
        const totalSum = calculateTotalSum(sharePrice, amount);
        const totalSumFormatted = formatTotalSum(totalSum);
        const totalSumDisplay = totalSumFormatted ? totalSumFormatted : '';
        
        const stockNameDiv = summary.querySelector('.stock-name');
        const titleElement = stockNameDiv?.querySelector('strong');
        if (!titleElement) return;
        
        // Always use deal.stock if available, don't extract from textContent
        const tickerText = deal?.stock || 'New Deal';
        
        // Get warning icons from current DOM (movement metrics are now after price, not here)
        const warningIcons = Array.from(titleElement.querySelectorAll('.volume-warning-icon'));
        
        // Remove any movement metrics that might still be in stock name (cleanup)
        const movementMetricsInStockName = titleElement.querySelectorAll('.movement-metrics-display');
        movementMetricsInStockName.forEach(metric => metric.remove());
        
        // Build new HTML with only ticker and warning icons (NO movement metrics, NO total sum)
        let newHTML = escapeHtml(tickerText);
        
        // Add warning icons
        warningIcons.forEach(icon => {
            newHTML += icon.outerHTML;
        });
        
        // Update titleElement (without total sum, without movement metrics)
        if (titleElement.innerHTML !== newHTML) {
            titleElement.innerHTML = newHTML;
        }
        
        // Update total sum in separate div
        const metaDiv = summary.querySelector('.meta > div:first-child');
        if (metaDiv) {
            let totalSumDiv = metaDiv.querySelector('.total-sum-display');
            if (totalSumDisplay) {
                if (!totalSumDiv) {
                    totalSumDiv = document.createElement('div');
                    totalSumDiv.className = 'total-sum-display';
                    metaDiv.appendChild(totalSumDiv);
                }
                totalSumDiv.textContent = totalSumDisplay;
                totalSumDiv.style.display = '';
            } else if (totalSumDiv) {
                totalSumDiv.style.display = 'none';
            }
        }
    };
    
    // Listen to input changes
    sharePriceInput.addEventListener('input', updateTotalSum);
    amountInput.addEventListener('input', updateTotalSum);
}

// Show deal limits (max position, stages, added risk) under the form
async function updateDealLimitsUI(form) {
    const slPctInput = form.querySelector('input[name="stop_loss_prcnt"]');
    if (!slPctInput) return;

    const slPct = parseFloat((slPctInput.value || '').replace(',', '.'));
    if (!slPct || slPct <= 0) return;

    try {
        const res = await apiFetch(`/api/deals/limits?stopLossPercent=${encodeURIComponent(slPct)}`, {
            headers: authHeaders()
        });
        if (!res.ok) {
            console.warn('Failed to load deal limits', res.status);
            return;
        }
        const limits = await res.json();

        let info = form.querySelector('.deal-limits-info');
        if (!info) {
            info = document.createElement('div');
            info.className = 'deal-limits-info small';
            info.style.marginTop = '8px';
            info.style.color = 'var(--muted)';

            const actions = form.querySelector('.form-actions');
            if (actions && actions.parentNode) {
                actions.parentNode.insertBefore(info, actions);
            } else {
                form.appendChild(info);
            }
        }

        if (!limits.allowed) {
            info.innerHTML = `
                <span style="color:#dc2626;font-weight:600;">
                    Planned deal exceeds portfolio risk limits.
                    Max position: ${limits.maxPosition.toFixed(2)}
                    (adds ${limits.addedRiskPercent.toFixed(2)}% risk).
                </span>`;
        } else {
            info.innerHTML = `
                Max position: <strong>${limits.maxPosition.toFixed(2)}</strong>
                (adds ${limits.addedRiskPercent.toFixed(2)}% risk).<br>
                Stage 1 ≤ <strong>${limits.maxStage1.toFixed(2)}</strong>
                (single-stage max: ${limits.singleStageMax.toFixed(2)}).<br>
                Recommended split: ${limits.recommendedStage1.toFixed(2)}
                + ${limits.recommendedStage2.toFixed(2)}.
            `;
        }
    } catch (e) {
        console.error('Error updating deal limits UI', e);
    }
}

function setupRiskAndLimits(form) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const amount1Input    = form.querySelector('input[name="amount_tobuy_stage_1"]');
    const amount2Input    = form.querySelector('input[name="amount_tobuy_stage_2"]');
    const slPctInput      = form.querySelector('input[name="stop_loss_prcnt"]');

    if (!sharePriceInput || !amount1Input || !slPctInput) return;

    const trigger = () => {
        if (slPctInput.value) {
            updateDealLimitsUI(form);
        }
    };

    sharePriceInput.addEventListener('input', trigger);
    amount1Input.addEventListener('input', trigger);
    if (amount2Input) amount2Input.addEventListener('input', trigger);
    slPctInput.addEventListener('input', trigger);
}

// Setup event listener for share price input to calculate stop loss and take profit percentages
function setupSharePriceListener(form) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stopLossInput = form.querySelector('input[name="stop_loss"]');
    const takeProfitInput = form.querySelector('input[name="take_profit"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    const takeProfitPrcntInput = form.querySelector('input[name="take_profit_prcnt"]');
    
    if (!sharePriceInput) return;
    
    const calculatePercentages = () => {
        const sharePriceStr = String(sharePriceInput.value || '').trim().replace(',', '.');
        const sharePrice = parseFloat(sharePriceStr);
        
        console.log('setupSharePriceListener: calculatePercentages called', {
            sharePriceStr,
            sharePrice,
            sharePriceValid: !isNaN(sharePrice) && sharePrice > 0,
            takeProfitValue: takeProfitInput?.value
        });
        
        if (isNaN(sharePrice) || sharePrice <= 0) {
            // Only clear percentages if share price is explicitly invalid (not just empty)
            // Don't clear if share price is just empty (might be loading)
            if (sharePriceStr && (isNaN(sharePrice) || sharePrice <= 0)) {
                console.log('setupSharePriceListener: Share price invalid, clearing percentages');
                if (stopLossPrcntInput) stopLossPrcntInput.value = '';
                if (takeProfitPrcntInput) takeProfitPrcntInput.value = '';
            }
            return;
        }
        
        // Calculate stop loss percentage if stop loss is set
        if (stopLossInput && stopLossInput.value) {
            const stopLoss = parseFloat(String(stopLossInput.value || '').replace(',', '.'));
            if (!isNaN(stopLoss) && stopLoss > 0) {
                const stopLossPrcnt = ((stopLoss - sharePrice) / sharePrice) * 100;
                if (stopLossPrcntInput) {
                    stopLossPrcntInput.value = stopLossPrcnt.toFixed(2);
                }
            }
        }
        
        // Calculate take profit percentage if take profit is set
        if (takeProfitInput && takeProfitInput.value) {
            const takeProfitStr = String(takeProfitInput.value || '').trim().replace(',', '.');
            if (takeProfitStr) {
                const takeProfit = parseFloat(takeProfitStr);
                if (!isNaN(takeProfit) && takeProfit > 0) {
                    const takeProfitPrcnt = ((takeProfit - sharePrice) / sharePrice) * 100;
                    if (takeProfitPrcntInput) {
                        takeProfitPrcntInput.value = takeProfitPrcnt.toFixed(2);
                    }
                }
            }
        }
    };
    
    // Listen to share price changes
    sharePriceInput.addEventListener('input', calculatePercentages);
    sharePriceInput.addEventListener('blur', calculatePercentages);
    sharePriceInput.addEventListener('change', calculatePercentages);
    
    // Also listen to stop loss and take profit changes
    if (stopLossInput) {
        stopLossInput.addEventListener('input', calculatePercentages);
        stopLossInput.addEventListener('blur', calculatePercentages);
        stopLossInput.addEventListener('change', calculatePercentages);
    }
    
    if (takeProfitInput) {
        takeProfitInput.addEventListener('input', calculatePercentages);
        takeProfitInput.addEventListener('blur', calculatePercentages);
        takeProfitInput.addEventListener('change', calculatePercentages);
    }
    
    // Calculate immediately if values are already present
    // This will work for both new deals (after stock is selected) and existing deals
    if (sharePriceInput.value) {
        setTimeout(() => {
            calculatePercentages();
        }, 100);
    }
}

// Setup event listener for stop loss input to calculate stop loss percentage
function setupStopLossListener(form) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stopLossInput = form.querySelector('input[name="stop_loss"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    
    if (!stopLossInput || !sharePriceInput) return;
    
    const calculateStopLossPercent = () => {
        const sharePrice = parseFloat(String(sharePriceInput.value || '').replace(',', '.'));
        const stopLoss = parseFloat(String(stopLossInput.value || '').replace(',', '.'));
        
        if (isNaN(sharePrice) || sharePrice <= 0) {
            if (stopLossPrcntInput) stopLossPrcntInput.value = '';
            return;
        }
        
        if (isNaN(stopLoss) || stopLoss <= 0) {
            if (stopLossPrcntInput) stopLossPrcntInput.value = '';
            return;
        }
        
        const stopLossPrcnt = ((stopLoss - sharePrice) / sharePrice) * 100;
        if (stopLossPrcntInput) {
            stopLossPrcntInput.value = stopLossPrcnt.toFixed(2);
        }
    };
    
    stopLossInput.addEventListener('input', calculateStopLossPercent);
    stopLossInput.addEventListener('blur', calculateStopLossPercent);
}

// Function to recalculate take profit percentage (can be called from anywhere)
function recalculateTakeProfitPercent(form) {
    if (!form) {
        console.log('recalculateTakeProfitPercent: form is null');
        return;
    }
    
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const takeProfitInput = form.querySelector('input[name="take_profit"]');
    const takeProfitPrcntInput = form.querySelector('input[name="take_profit_prcnt"]');
    
    console.log('recalculateTakeProfitPercent called:', {
        hasSharePrice: !!sharePriceInput,
        hasTakeProfit: !!takeProfitInput,
        hasTakeProfitPrcnt: !!takeProfitPrcntInput,
        sharePriceValue: sharePriceInput?.value,
        takeProfitValue: takeProfitInput?.value
    });
    
    if (!sharePriceInput || !takeProfitInput || !takeProfitPrcntInput) {
        console.log('recalculateTakeProfitPercent: Missing inputs');
        return;
    }
    
    const sharePriceStr = String(sharePriceInput.value || '').trim().replace(',', '.');
    const takeProfitStr = String(takeProfitInput.value || '').trim().replace(',', '.');
    
    console.log('recalculateTakeProfitPercent: Parsed strings:', {
        sharePriceStr,
        takeProfitStr,
        sharePriceEmpty: !sharePriceStr,
        takeProfitEmpty: !takeProfitStr
    });
    
    // Only calculate if BOTH values are present
    if (!sharePriceStr || !takeProfitStr) {
        console.log('recalculateTakeProfitPercent: One or both values empty, skipping');
        return;
    }
    
    const sharePrice = parseFloat(sharePriceStr);
    const takeProfit = parseFloat(takeProfitStr);
    
    console.log('recalculateTakeProfitPercent: Parsed numbers:', {
        sharePrice,
        takeProfit,
        sharePriceValid: !isNaN(sharePrice) && sharePrice > 0,
        takeProfitValid: !isNaN(takeProfit) && takeProfit > 0
    });
    
    if (isNaN(sharePrice) || sharePrice <= 0 || isNaN(takeProfit) || takeProfit <= 0) {
        console.log('recalculateTakeProfitPercent: Invalid numbers, skipping');
        return;
    }
    
    const takeProfitPrcnt = ((takeProfit - sharePrice) / sharePrice) * 100;
    const formattedValue = takeProfitPrcnt.toFixed(2);
    takeProfitPrcntInput.value = formattedValue;
    console.log('✓ recalculateTakeProfitPercent: Set value to', formattedValue, '%');
}

// Setup event listener for take profit input to calculate take profit percentage
function setupTakeProfitListener(form) {
    const takeProfitInput = form.querySelector('input[name="take_profit"]');
    const takeProfitPrcntInput = form.querySelector('input[name="take_profit_prcnt"]');
    
    if (!takeProfitInput || !takeProfitPrcntInput) {
        return;
    }
    
    // Track if we're waiting for share price to load
    let waitingForSharePrice = false;
    let checkInterval = null;
    
    const calculateTakeProfitPercent = () => {
        // Always query the DOM fresh to get the current value
        // This ensures we get the latest value even if it was set asynchronously
        const sharePriceInput = form.querySelector('input[name="share_price"]');
        if (!sharePriceInput) {
            console.log('calculateTakeProfitPercent: sharePriceInput not found in form');
            return;
        }
        
        const sharePriceStr = String(sharePriceInput.value || '').trim().replace(',', '.');
        const takeProfitStr = String(takeProfitInput.value || '').trim().replace(',', '.');
        
        console.log('calculateTakeProfitPercent called:', {
            sharePriceStr,
            takeProfitStr,
            sharePriceEmpty: !sharePriceStr,
            takeProfitEmpty: !takeProfitStr,
            sharePriceInputExists: !!sharePriceInput,
            sharePriceInputValue: sharePriceInput.value
        });
        
        // Only calculate if BOTH values are present
        // Don't clear the field if only one is empty (user might be typing)
        if (!sharePriceStr || !takeProfitStr) {
            // If take profit is set but share price is empty, start checking periodically
            if (takeProfitStr && !sharePriceStr && !waitingForSharePrice) {
                console.log('calculateTakeProfitPercent: Take profit set but share price empty, starting periodic check');
                waitingForSharePrice = true;
                
                // Clear any existing interval
                if (checkInterval) {
                    clearInterval(checkInterval);
                }
                
                // Check every 200ms for up to 5 seconds (25 checks)
                let checkCount = 0;
                checkInterval = setInterval(() => {
                    checkCount++;
                    // Always query fresh from DOM
                    const currentSharePriceInput = form.querySelector('input[name="share_price"]');
                    const currentSharePrice = currentSharePriceInput ? String(currentSharePriceInput.value || '').trim() : '';
                    const currentTakeProfit = String(takeProfitInput.value || '').trim();
                    
                    if (currentSharePrice && currentTakeProfit) {
                        console.log('calculateTakeProfitPercent: Both values now available, calculating');
                        clearInterval(checkInterval);
                        checkInterval = null;
                        waitingForSharePrice = false;
                        calculateTakeProfitPercent();
                    } else if (checkCount >= 25) {
                        console.log('calculateTakeProfitPercent: Timeout waiting for share price');
                        clearInterval(checkInterval);
                        checkInterval = null;
                        waitingForSharePrice = false;
                    }
                }, 200);
            }
            console.log('calculateTakeProfitPercent: One or both values empty, skipping');
            return; // Don't clear, just return - let user finish typing
        }
        
        // Stop checking if both values are now available
        if (waitingForSharePrice && checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
            waitingForSharePrice = false;
        }
        
        const sharePrice = parseFloat(sharePriceStr);
        const takeProfit = parseFloat(takeProfitStr);
        
        console.log('calculateTakeProfitPercent: Parsed values:', {
            sharePrice,
            takeProfit,
            sharePriceValid: !isNaN(sharePrice) && sharePrice > 0,
            takeProfitValid: !isNaN(takeProfit) && takeProfit > 0
        });
        
        if (isNaN(sharePrice) || sharePrice <= 0) {
            console.log('calculateTakeProfitPercent: Share price invalid, clearing field');
            takeProfitPrcntInput.value = '';
            return;
        }
        
        if (isNaN(takeProfit) || takeProfit <= 0) {
            console.log('calculateTakeProfitPercent: Take profit invalid, clearing field');
            takeProfitPrcntInput.value = '';
            return;
        }
        
        const takeProfitPrcnt = ((takeProfit - sharePrice) / sharePrice) * 100;
        const formattedValue = takeProfitPrcnt.toFixed(2);
        takeProfitPrcntInput.value = formattedValue;
        console.log('✓ calculateTakeProfitPercent: Set value to', formattedValue, '%');
    };
    
    // Add event listeners - always try to calculate
    takeProfitInput.addEventListener('input', (e) => {
        // Always try to calculate - the function will check if both values are present
        calculateTakeProfitPercent();
    });
    takeProfitInput.addEventListener('blur', (e) => {
        // Always try to calculate on blur
        // This ensures calculation happens even if share price was loaded asynchronously
        calculateTakeProfitPercent();
    });
    
    // Also trigger calculation if share price changes (in case take profit is already set)
    // We need to query the form fresh each time to get the current sharePriceInput
    const sharePriceHandler = () => {
        // Always try to calculate - the function will check if both values are present
        console.log('sharePriceHandler: Share price changed, recalculating');
        calculateTakeProfitPercent();
    };
    
    // Find sharePriceInput fresh and attach listeners
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    if (sharePriceInput) {
        sharePriceInput.addEventListener('input', sharePriceHandler);
        sharePriceInput.addEventListener('blur', sharePriceHandler);
        sharePriceInput.addEventListener('change', sharePriceHandler);
    }
    
    // Calculate immediately if both values are already present and not empty
    // This will work for both new deals (after stock is selected) and existing deals
    if (sharePriceInput && sharePriceInput.value && takeProfitInput.value && 
        sharePriceInput.value.trim() && takeProfitInput.value.trim()) {
        setTimeout(() => {
            calculateTakeProfitPercent();
        }, 100);
    }
}

async function populateStockSelect(form, currentTicker) {
    const select = form.querySelector('.deal-stock-select');
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>Loading stocks…</option>';

    const stocks = await loadStocksForDeals();
    
    // Clear and set default option - make it selected if no currentTicker
    select.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.disabled = true;
    defaultOpt.textContent = 'Choose stock from list';
    select.appendChild(defaultOpt);
    
    stocks.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.ticker;
        opt.textContent = s.ticker;
        select.appendChild(opt);
    });

    // Set the value - if no currentTicker, explicitly set to empty string
    if (currentTicker) {
        select.value = currentTicker;
    } else {
        // For new deals, ensure default is selected
        select.selectedIndex = 0; // Select the first option (default)
        select.value = ''; // Explicitly set to empty
    }
}

function setupStockSelectListener(form, dealId) {
    const select = form.querySelector('.deal-stock-select');
    if (!select) return;

    // Store the current value before cloning
    const currentValue = select.value;

    // Remove any existing listeners by cloning
    const newSelect = select.cloneNode(true);
    select.parentNode.replaceChild(newSelect, select);

    // Restore the value (should be empty for new deals, or the ticker for existing deals)
    newSelect.value = currentValue;

    // Track the last loaded ticker to avoid duplicate calls
    let lastLoadedTicker = currentValue;
    let isLoading = false;

    // Function to load data for a ticker
    const loadDataForTicker = async (ticker) => {
        // Skip if already loading the same ticker
        if (isLoading && lastLoadedTicker === ticker) {
            console.log('Skipping duplicate load for ticker:', ticker);
            return;
        }
        
        if (ticker && ticker.trim() !== '') {
            // Mark as loading and update last loaded ticker
            isLoading = true;
            lastLoadedTicker = ticker;
            
            const formContainer = form.closest('.deal-form-container');
            console.log('Loading data for ticker:', ticker);
            
            try {
                // Use Promise.allSettled so one failure doesn't stop the others
                const results = await Promise.allSettled([
                    loadPreviousWeekLowPrice(ticker, form).catch(err => {
                        console.error('loadPreviousWeekLowPrice failed:', err);
                        return null;
                    }),
                    loadCurrentPrice(ticker, form).catch(err => {
                        console.error('loadCurrentPrice failed:', err);
                        return null;
                    }),
                    loadTrends(ticker, form).catch(err => {
                        console.error('loadTrends failed:', err);
                        return null;
                    }),
                    loadSupportResistance(ticker, form).catch(err => {
                        console.error('loadSupportResistance failed:', err);
                        return null;
                    }),
                    loadAverageWeeklyVolume(ticker).catch(err => {
                        console.error('loadAverageWeeklyVolume failed:', err);
                        return null;
                    }),
                    loadMovementMetricsAndDisplay(ticker, form).catch(err => {
                        console.error('loadMovementMetricsAndDisplay failed:', err);
                        return null;
                    })
                ]);
                
                console.log('All requests completed:', results);
            } finally {
                // Reset loading flag after all requests complete
                isLoading = false;
            }
        } else {
            // Clear price fields if stock is deselected
            const formContainer = form.closest('.deal-form-container');
            const oPriceInput = form.querySelector('input[name="o_price"]');
            const hPriceInput = form.querySelector('input[name="h_price"]');
            const sharePriceInput = form.querySelector('input[name="share_price"]');
            const supportPriceInput = form.querySelector('input[name="support_price"]');
            const monthlySelect = form.querySelector('select[name="monthly_dir"]');
            const weeklySelect = form.querySelector('select[name="weekly_dir"]');
            if (oPriceInput) oPriceInput.value = '';
            if (hPriceInput) hPriceInput.value = '';
            if (sharePriceInput) sharePriceInput.value = '';
            if (supportPriceInput) supportPriceInput.value = '';
            if (monthlySelect) {
                monthlySelect.value = '';
                updateSelectDownClass(monthlySelect);
            }
            if (weeklySelect) {
                weeklySelect.value = '';
                updateSelectDownClass(weeklySelect);
            }
            setPriceError(formContainer, '');
            
            // Clear movement metrics from title when stock is deselected
            const dealRow = formContainer?.closest('.deal-row');
            if (dealRow) {
                const summary = dealRow.querySelector('.deal-summary');
                const titleElement = summary?.querySelector('strong');
                if (titleElement) {
                    const metricsDisplay = titleElement.querySelector('.movement-metrics-display');
                    if (metricsDisplay) {
                        metricsDisplay.remove();
                    }
                    
                    // Reset title to "New Deal" if no stock selected
                    const stockSelect = form.querySelector('.deal-stock-select');
                    if (stockSelect && !stockSelect.value) {
                        const currentText = titleElement.textContent.split('!')[0].trim(); // Remove warning icons
                        if (currentText && currentText !== 'New Deal') {
                            titleElement.innerHTML = titleElement.innerHTML.replace(/^[^<]+/, 'New Deal');
                        }
                    }
                }
            }
        }
    };

    const chartContainerId = `tv_chart_${dealId}`;
    
    // Add change event listener
    newSelect.addEventListener('change', async (e) => {
        const ticker = e.target.value;
        // Only load if ticker changed from last loaded
        if (ticker !== lastLoadedTicker) {
            await loadDataForTicker(ticker);
        }
        
        // Always attempt to render chart for the selected ticker
        const symbol = buildSymbolFromTicker(ticker);
        if (symbol) {
            renderTradingViewChart(chartContainerId, symbol, 'W');
        }
    });
    
    // Also listen to input event (for when user types in a select with search/autocomplete)
    // But skip if change event already handled it
    newSelect.addEventListener('input', async (e) => {
        const ticker = e.target.value;
        // Only trigger if value actually changed and not already loading
        if (ticker !== lastLoadedTicker && !isLoading) {
            await loadDataForTicker(ticker);
        }
        
        const symbol = buildSymbolFromTicker(ticker);
        if (symbol) {
            renderTradingViewChart(chartContainerId, symbol, 'W');
        }
    });
    
    // Setup listeners for monthly_dir and weekly_dir selects to add red border when "Down" is selected
    setupTrendSelectListeners(form);
}

async function handleDealSubmit(form, deal, isNew) {
    const submitButton = form.querySelector('button[type="submit"]');
    if (!submitButton) return;
    
    try {
        setButtonLoading(submitButton, true);
        
        const formData = new FormData(form);
        const obj = {
            id: deal?.id || null,
            closed: deal?.closed || false,
            closedAt: deal?.closedAt || null
        };

        for (const [k, v] of formData.entries()) {
            obj[k] = v;
        }

        // planned_future: new deals are always created as planned; existing keep their flag
        if (isNew) {
            obj.planned_future = true;
        } else {
            obj.planned_future = !!(deal && deal.planned_future);
        }

        // Calculate and include total sum (both stages)
        const sharePriceStr = obj.share_price || '';
        const amount1Str    = obj.amount_tobuy_stage_1 || '';
        const amount2Str    = obj.amount_tobuy_stage_2 || '';

        const sharePriceNum = parseFloat(String(sharePriceStr).replace(',', '.')) || 0;
        const amount1Num    = parseFloat(String(amount1Str)) || 0;
        const amount2Num    = parseFloat(String(amount2Str)) || 0;

        const totalPlanned  = sharePriceNum * (amount1Num + amount2Num);
        const totalSum      = calculateTotalSum(sharePriceStr, amount1Str);
        if (totalSum) {
            obj.total_sum = totalSum;
        }

        if (!obj.date) {
            obj.date = new Date().toISOString().slice(0, 10);
        }

        // Validate against deal limits (risk / cash constraints)
        // 0) Hard check: do we have enough Cash for this planned position at all?
        try {
            const portfolioSpan = document.getElementById('portfolioValue');
            if (portfolioSpan) {
                const cashStr = portfolioSpan.textContent.trim().replace(',', '.');
                const cash = parseFloat(cashStr) || 0;
                if (totalPlanned > cash) {
                    showDealLimitModal(
                        `Not enough Cash for this deal.\n` +
                        `Required: ${totalPlanned.toFixed(2)}, available: ${cash.toFixed(2)}.`
                    );
                    setButtonLoading(submitButton, false);
                    return;
                }
            }
        } catch (cashErr) {
            console.error('Failed to validate cash before saving deal', cashErr);
        }

        const slPctNum = parseFloat(String(obj.stop_loss_prcnt || '').replace(',', '.')) || 0;
        if (slPctNum > 0 && totalPlanned > 0) {
            try {
                const res = await apiFetch(`/api/deals/limits?stopLossPercent=${encodeURIComponent(slPctNum)}`, {
                    headers: authHeaders()
                });
                if (res.ok) {
                    const limits = await res.json();
                    const isSingle = !amount2Num || amount2Num === 0;

                    if (isSingle) {
                        if (totalPlanned > limits.singleStageMax) {
                            showDealLimitModal(
                                `Single-stage deal is too big.\n` +
                                `Max allowed: ${limits.singleStageMax.toFixed(2)}.`
                            );
                            setButtonLoading(submitButton, false);
                            return;
                        }
                    } else {
                        const stage1Sum = sharePriceNum * amount1Num;
                        if (stage1Sum > limits.maxStage1 || totalPlanned > limits.maxPosition) {
                            showDealLimitModal(
                                `Two-stage deal exceeds limits.\n` +
                                `Stage 1 max: ${limits.maxStage1.toFixed(2)}, total max: ${limits.maxPosition.toFixed(2)}.`
                            );
                            setButtonLoading(submitButton, false);
                            return;
                        }
                    }

                    if (!limits.allowed) {
                        showDealLimitModal(
                            `Deal would push portfolio risk above limit.\n` +
                            `Added risk: ${limits.addedRiskPercent.toFixed(2)}%.`
                        );
                        setButtonLoading(submitButton, false);
                        return;
                    }
                }
            } catch (err) {
                console.error('Failed to validate deal limits', err);
            }
        }

        await saveDealToServer(obj, !isNew);

        // New planned deals should NOT affect cash / In Shares until activated.
        const isPlannedNew = isNew && obj.planned_future === true;

        // Portfolio deduction is now handled server-side in DealsController.
        // Refresh portfolio only when deal actually affects it.
        if (!isPlannedNew) {
            await refreshPortfolioFromServer();
        }
        
        if (isNew) {
            newDealRow = null;
        }
        expandedDealId = null;
        await loadDeals();
        
        // Recalculate risk metrics only when portfolio is affected.
        if (!isPlannedNew) {
            await calculateAndDisplayPortfolioRisk();
            await calculateAndDisplayInSharesRisk();
        }
    } catch (e) {
        console.error(e);
        alert('Не удалось сохранить сделку');
    } finally {
        setButtonLoading(submitButton, false);
    }
}

// Function to refresh portfolio value from server
// Portfolio deduction is now handled server-side for security
async function refreshPortfolioFromServer() {
    if (!portfolioSpan) return;
    
    try {
        const res = await apiFetch('/api/users/portfolio', {
            method: 'GET',
            headers: {
                ...authHeaders()
            }
        });
        
        if (res.ok) {
            const data = await res.json();
            const portfolioValue = data.portfolio || 0;
            
            // Update localStorage
            localStorage.setItem('portfolio', String(portfolioValue));
            
            // Update UI
            portfolioSpan.textContent = Number(portfolioValue).toFixed(2);
            
            console.log('Portfolio refreshed from server:', portfolioValue);
        } else {
            console.warn('Failed to refresh portfolio from server', res.status);
        }
    } catch (e) {
        console.error('Error refreshing portfolio from server', e);
    }
}

// Function to calculate and display portfolio risk percentage
async function calculateAndDisplayPortfolioRisk() {
    try {
        const res = await apiFetch('/api/deals/risk-percent', {
            method: 'GET',
            headers: {
                ...authHeaders()
            }
        });

        if (res.ok) {
            const riskPercent = await res.json();
            
            // Find or create risk display element
            let riskDisplay = document.getElementById('portfolioRiskDisplay');
            if (!riskDisplay) {
                // Create display element near portfolio value
                riskDisplay = document.createElement('span');
                riskDisplay.id = 'portfolioRiskDisplay';
                riskDisplay.className = 'portfolio-risk';
                riskDisplay.style.marginLeft = '12px';
                riskDisplay.style.color = 'var(--muted)';
                riskDisplay.style.fontSize = '14px';
                
                // Insert after portfolio span
                if (portfolioSpan && portfolioSpan.parentNode) {
                    portfolioSpan.parentNode.insertBefore(riskDisplay, portfolioSpan.nextSibling);
                }
            }
            
            // Update display
            riskDisplay.textContent = `Risk: ${riskPercent.toFixed(2)}%`;
            
            // Add warning class if risk is high (>10%)
            if (riskPercent > 10) {
                riskDisplay.style.color = '#dc2626'; // red
                riskDisplay.style.fontWeight = '600';
            } else if (riskPercent > 5) {
                riskDisplay.style.color = '#f59e0b'; // orange
                riskDisplay.style.fontWeight = '500';
            } else {
                riskDisplay.style.color = 'var(--muted)';
                riskDisplay.style.fontWeight = 'normal';
            }
            
            return riskPercent;
        } else {
            console.warn('Failed to get portfolio risk percent', res.status);
        }
    } catch (e) {
        console.error('Error calculating portfolio risk', e);
    }
    return null;
}

// Function to fetch previous week's low and high prices
async function loadPreviousWeekLowPrice(ticker, form) {
    if (!ticker || !form) return;

    const formContainer = form.closest('.deal-form-container');
    setPriceError(formContainer, '');

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}`, {
            headers: { ...authHeaders() }
        });

        if (!res.ok) {
            const oPriceInput = form.querySelector('input[name="o_price"]');
            const hPriceInput = form.querySelector('input[name="h_price"]');
            if (oPriceInput) oPriceInput.value = '';
            if (hPriceInput) hPriceInput.value = '';
            setPriceError(formContainer, 'Price history is temporarily unavailable (API quota reached).');
            return;
        }

        const data = await res.json();
        console.log('Weekly prices data received for', ticker, ':', data);
        
        if (data && Array.isArray(data) && data.length >= 2) {
            // Get the second-to-last week (previous week)
            const previousWeek = data[data.length - 2];
            console.log('Previous week data:', previousWeek);
            
            // Get Open price for o_price field
            const openPrice = previousWeek.Open !== undefined ? previousWeek.Open : 
                             (previousWeek.open !== undefined ? previousWeek.open : null);
            
            // Get High price for h_price field
            const highPrice = previousWeek.High !== undefined ? previousWeek.High : 
                             (previousWeek.high !== undefined ? previousWeek.high : null);
            
            console.log('Open price:', openPrice, 'High price:', highPrice);
            
            if (openPrice !== undefined && openPrice !== null) {
                const oPriceInput = form.querySelector('input[name="o_price"]');
                if (oPriceInput) {
                    oPriceInput.value = openPrice.toString();
                    console.log('Set o_price to:', openPrice);
                } else {
                    console.warn('o_price input not found');
                }
            }
            
            if (highPrice !== undefined && highPrice !== null) {
                const hPriceInput = form.querySelector('input[name="h_price"]');
                if (hPriceInput) {
                    hPriceInput.value = highPrice.toString();
                    console.log('Set h_price to:', highPrice);
                } else {
                    console.warn('h_price input not found');
                }
            }
            
            setPriceError(formContainer, '');
        } else if (data && Array.isArray(data) && data.length === 1) {
            // If only one week available, use it
            const week = data[0];
            console.log('Using only available week:', week);
            const openPrice = week.Open !== undefined ? week.Open : 
                             (week.open !== undefined ? week.open : null);
            const highPrice = week.High !== undefined ? week.High : 
                             (week.high !== undefined ? week.high : null);
            
            if (openPrice !== undefined && openPrice !== null) {
                const oPriceInput = form.querySelector('input[name="o_price"]');
                if (oPriceInput) {
                    oPriceInput.value = openPrice.toString();
                    console.log('Set o_price to:', openPrice);
                }
            }
            
            if (highPrice !== undefined && highPrice !== null) {
                const hPriceInput = form.querySelector('input[name="h_price"]');
                if (hPriceInput) {
                    hPriceInput.value = highPrice.toString();
                    console.log('Set h_price to:', highPrice);
                }
            }
            
            setPriceError(formContainer, '');
        } else {
            console.warn('Invalid or empty data received for', ticker, ':', data);
        }
    } catch (err) {
        console.error('Error loading previous week low/high prices', err);
        const formContainer = form.closest('.deal-form-container');
        setPriceError(formContainer, 'Price history is temporarily unavailable (API error).');
    }
}

async function loadCurrentPrice(ticker, form) {
    if (!ticker || !form) return;

    const formContainer = form.closest('.deal-form-container');
    setPriceError(formContainer, '');

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}/quote`, {
            headers: { ...authHeaders() }
        });

        if (!res.ok) {
            const sharePriceInput = form.querySelector('input[name="share_price"]');
            if (sharePriceInput) sharePriceInput.value = '';
            setPriceError(formContainer, 'Current price is temporarily unavailable (API quota reached).');
            return;
        }

        const data = await res.json();
        
        if (data && data.price !== undefined && data.price !== null) {
            const sharePriceInput = form.querySelector('input[name="share_price"]');
            
            if (sharePriceInput) {
                sharePriceInput.value = data.price.toString();
                
                // Trigger input event to ensure all listeners are notified
                // This will trigger setupSharePriceListener's calculatePercentages
                sharePriceInput.dispatchEvent(new Event('input', { bubbles: true }));
                sharePriceInput.dispatchEvent(new Event('change', { bubbles: true }));
                
                // Also trigger a small delay to ensure all event handlers have processed
                setTimeout(() => {
                    recalculateTakeProfitPercent(form);
                }, 50);
                
                // Calculate stop loss after autofilling share price
                await calculateStopLoss(form);
                
                // Recalculate take profit percentage if take profit is already set
                recalculateTakeProfitPercent(form);
            }
            setPriceError(formContainer, '');
        }
    } catch (err) {
        console.error('Error loading current price', err);
        const formContainer = form.closest('.deal-form-container');
        setPriceError(formContainer, 'Current price is temporarily unavailable (API error).');
    }
}

async function loadTrends(ticker, form) {
    if (!ticker || !form) return;

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}/trends`, {
            headers: { ...authHeaders() }
        });

        if (!res.ok) {
            console.warn('Failed to load trends for', ticker, 'Status:', res.status);
            const errorText = await res.text().catch(() => '');
            console.warn('Error response:', errorText);
            return;
        }

        const data = await res.json();
        console.log('Trends data received for', ticker, ':', data);
        
        // Set monthly_dir
        const monthlySelect = form.querySelector('select[name="monthly_dir"]');
        if (monthlySelect) {
            if (data.monthly) {
                monthlySelect.value = data.monthly;
                updateSelectDownClass(monthlySelect);
                console.log('Set monthly_dir to:', data.monthly);
            } else {
                console.warn('No monthly trend in response');
            }
        } else {
            console.warn('monthly_dir select not found in form');
        }
        
        // Set weekly_dir
        const weeklySelect = form.querySelector('select[name="weekly_dir"]');
        if (weeklySelect) {
            if (data.weekly) {
                weeklySelect.value = data.weekly;
                updateSelectDownClass(weeklySelect);
                console.log('Set weekly_dir to:', data.weekly);
            } else {
                console.warn('No weekly trend in response');
            }
        } else {
            console.warn('weekly_dir select not found in form');
        }
    } catch (err) {
        console.error('Error loading trends for', ticker, ':', err);
    }
}

const defaultMovementSettings = {
    timeframe: 'Weekly',
    lookback: 52
};

function loadMovementSettings() {
    try {
        const raw = localStorage.getItem('movementSettings');
        if (!raw) return { ...defaultMovementSettings };
        const parsed = JSON.parse(raw);
        return {
            timeframe: parsed.timeframe || 'Weekly',
            lookback: parsed.lookback || 52
        };
    } catch {
        return { ...defaultMovementSettings };
    }
}

function saveMovementSettings(settings) {
    try {
        localStorage.setItem('movementSettings', JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save movement settings', e);
    }
}

window.movementSettings = loadMovementSettings();

// Load movement metrics for a ticker
async function loadMovementMetrics(ticker) {
    if (!ticker) {
        console.log('loadMovementMetrics: No ticker provided');
        return null;
    }
    
    try {
        console.log('Loading movement metrics for ticker:', ticker);
        const s = window.movementSettings || defaultMovementSettings;
        const lookback = s.lookback || 52;
        const timeframe = encodeURIComponent(s.timeframe || 'Weekly');
        const url = `/api/prices/${encodeURIComponent(ticker)}/movement-score?lookback=${lookback}&timeframe=${timeframe}`;
        console.log('Request URL:', url);
        
        const res = await apiFetch(url, {
            headers: { ...authHeaders() }
        });
        
        console.log('Response status:', res.status, 'OK:', res.ok);
        
        if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            console.warn('Failed to load movement metrics for', ticker, 'Status:', res.status, 'Error:', errorText);
            
            // If 404, the endpoint might not exist yet (needs app restart)
            if (res.status === 404) {
                console.warn('Endpoint not found - application may need to be restarted');
            }
            
            return null;
        }
        
        const data = await res.json();
        console.log('Movement metrics loaded for', ticker, ':', JSON.stringify(data, null, 2));
        
        // Verify we have the expected fields
        if (data && (data.speedPct !== undefined || data.strengthPct !== undefined)) {
            console.log('Movement metrics data is valid');
            return data;
        } else {
            console.warn('Movement metrics data missing expected fields:', data);
            return null;
        }
    } catch (err) {
        console.error('Error loading movement metrics for', ticker, ':', err);
        return null;
    }
}

// Load movement metrics for a composite index built from multiple tickers
async function loadCompositeMovementMetrics(tickersArray) {
    if (!Array.isArray(tickersArray)) return null;

    const symbols = [...new Set(
        tickersArray
            .map(t => (t || '').trim().toUpperCase())
            .filter(Boolean)
    )];

    if (symbols.length < 2) {
        console.warn('loadCompositeMovementMetrics: need at least 2 tickers', symbols);
        return null;
    }

    const query = encodeURIComponent(symbols.join(','));
    const url = `/api/prices/composite/movement-score?lookback=52&tickers=${query}`;

    try {
        const res = await apiFetch(url, {
            headers: { ...authHeaders() }
        });

        if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            console.warn('Failed to load composite movement metrics', res.status, errorText);
            return null;
        }

        const data = await res.json();
        console.log('Composite movement metrics loaded for', symbols.join('+'), ':', JSON.stringify(data, null, 2));
        return data;
    } catch (err) {
        console.error('Error loading composite movement metrics:', err);
        return null;
    }
}

// Format movement metrics for display
function formatMovementMetrics(metrics) {
    if (!metrics) {
        console.log('formatMovementMetrics: No metrics provided');
        return '';
    }
    
    console.log('formatMovementMetrics: Processing metrics:', JSON.stringify(metrics, null, 2));
    
    // Handle both camelCase and potential variations
    const direction = (metrics.direction === 1 || metrics.Direction === 1) ? '↑' : 
                      (metrics.direction === -1 || metrics.Direction === -1) ? '↓' : '→';
    
    // Determine arrow color based on direction
    let arrowColor;
    if (direction === '↑') {
        arrowColor = '#22c55e'; // Green for up
    } else if (direction === '↓') {
        arrowColor = '#ef4444'; // Red for down
    } else {
        arrowColor = '#f59e0b'; // Yellow for flat
    }
    
    const signed = (metrics.signedPct || metrics.SignedPct || 0);
    const signedDisplay = signed > 0 ? `+${signed.toFixed(2)}` : signed.toFixed(2); // Mv
    
    const speed = Math.round(metrics.speedPct || metrics.SpeedPct || 0);          // Sp
    const strength = Math.round(metrics.strengthPct || metrics.StrengthPct || 0); // St
    const ease = Math.round(metrics.easeOfMovePct || metrics.EaseOfMovePct || 0); // E
    
    const returnPctValue = metrics.returnPct || metrics.ReturnPct || 0;
    const returnPct = returnPctValue
        ? (returnPctValue > 0 ? '+' : '') + returnPctValue.toFixed(2)
        : '0.00';
    
    // Helper function to color negative values red
    const formatValue = (value) => {
        const valueStr = String(value);
        if (valueStr.startsWith('-') || parseFloat(valueStr) < 0) {
            return `<span style="color: #ef4444;">${valueStr}</span>`;
        }
        return valueStr;
    };
    
    // Helper function to format metric with tooltip (same style as risk icons)
    // Tooltip is visible on both label and value
    const formatMetric = (label, value, tooltip) => {
        return `<span class="movement-metric-tooltip" data-tooltip="${tooltip}" style="cursor: help; position: relative; display: inline-block;">${label}</span>:<span class="movement-metric-tooltip" data-tooltip="${tooltip}" style="cursor: help; position: relative; display: inline-block;">${formatValue(value)}</span>%`;
    };
    
    // Base (existing) description for Mv
    const baseMvTooltip = 'This is a composite index of Speed, Strength and EaseOfMove.';
    // Append removed metrics (Sp/St/E) to the end of tooltip
    const mvTooltip =
        `${baseMvTooltip}\n\n` +
        `Sp (Speed): ${speed}% | St (Strength): ${strength}% | E (Ease): ${ease}%`;
    
    const retTooltip = 'Percentage change in price of the last bar';
    
    // Visibly show only arrow, Mv and Ret in the deal title
    const formatted = `<span class="movement-metrics-display" style="font-size: 11px; color: #64748b; margin-left: 8px; font-weight: normal;">
        <span style="color: ${arrowColor}; font-weight: 900; font-size: 18px; text-shadow: 0.5px 0.5px 0.5px rgba(0,0,0,0.2);">${direction}</span>
        | ${formatMetric('Mv', signedDisplay, mvTooltip)}
        | ${formatMetric('Ret', returnPct, retTooltip)}
    </span>`;
    
    console.log('formatMovementMetrics: Formatted result:', formatted);
    return formatted;
}

// Track loading state to prevent duplicate calls
const movementMetricsLoading = new Set();

// Load and display movement metrics in the deal row title
async function loadMovementMetricsAndDisplay(ticker, form) {
    if (!ticker || !form) return;
    
    // Create a unique key for this deal row to track loading state
    const formContainer = form.closest('.deal-form-container');
    const dealRow = formContainer?.closest('.deal-row');
    if (!dealRow) {
        console.warn('Deal row not found for movement metrics');
        return;
    }
    
    const loadingKey = `${dealRow.dataset.dealId || 'new'}-${ticker}`;
    
    // Check if already loading or already loaded
    if (movementMetricsLoading.has(loadingKey)) {
        console.log('Movement metrics already loading for', ticker);
        return;
    }
    
    try {
        movementMetricsLoading.add(loadingKey);
        
        const summary = dealRow.querySelector('.deal-summary');
        const stockNameDiv = summary?.querySelector('.stock-name');
        const titleElement = stockNameDiv?.querySelector('strong');
        const metricsContainer = summary?.querySelector('.movement-metrics-container');
        
        if (!titleElement) {
            console.warn('Title element not found in deal row');
            movementMetricsLoading.delete(loadingKey);
            return;
        }
        
        // Remove any movement metrics from stock name (cleanup - they should only be after price)
        const movementMetricsInStockName = titleElement.querySelectorAll('.movement-metrics-display');
        movementMetricsInStockName.forEach(metric => metric.remove());
        
        // Update title from "New Deal" to ticker if needed
        const currentTitleText = titleElement.textContent.trim().split('!')[0].trim(); // Get text without warning icons
        if (currentTitleText === 'New Deal') {
            // Get warning indicators if they exist (they might be added after)
            const warningIcons = titleElement.querySelectorAll('.volume-warning-icon');
            const warningHTML = Array.from(warningIcons).map(icon => icon.outerHTML).join('');
            
            // Clear current content and set ticker
            titleElement.innerHTML = '';
            const tickerText = document.createTextNode(ticker);
            titleElement.appendChild(tickerText);
            
            // Append warning icons after ticker text
            if (warningHTML) {
                titleElement.insertAdjacentHTML('beforeend', warningHTML);
            }
            
            console.log('Updated deal title to:', ticker);
        }
        
        // Load metrics
        const metrics = await loadMovementMetrics(ticker);
        
        // Remove any existing movement metrics from the container AND from stock name (double cleanup)
        const allMetricsInStockName = titleElement.querySelectorAll('.movement-metrics-display');
        allMetricsInStockName.forEach(metric => metric.remove());
        
        // Also remove from stock-name div itself (not just the strong tag)
        if (stockNameDiv) {
            const metricsInStockNameDiv = stockNameDiv.querySelectorAll('.movement-metrics-display');
            metricsInStockNameDiv.forEach(metric => metric.remove());
        }
        
        if (metricsContainer) {
            const existingMetrics = metricsContainer.querySelectorAll('.movement-metrics-display');
            existingMetrics.forEach(metric => metric.remove());
            
            if (metrics) {
                const formatted = formatMovementMetrics(metrics);
                
                // Final cleanup - ensure no metrics in stock name before adding to container
                titleElement.querySelectorAll('.movement-metrics-display').forEach(m => m.remove());
                if (stockNameDiv) {
                    stockNameDiv.querySelectorAll('.movement-metrics-display').forEach(m => m.remove());
                }
                
                // Append formatted HTML ONLY to the container (after price)
                metricsContainer.innerHTML = formatted;
                
                console.log('Movement metrics displayed after price for', ticker);
            } else {
                console.log('No movement metrics available for', ticker);
                metricsContainer.innerHTML = '';
            }
        } else {
            // Fallback: if container doesn't exist, create it and insert after price
            const metaDiv = summary?.querySelector('.meta > div:first-child');
            if (metaDiv && metrics) {
                const container = document.createElement('div');
                container.className = 'movement-metrics-container';
                const formatted = formatMovementMetrics(metrics);
                container.innerHTML = formatted;
                
                // Ensure we remove any metrics from stock name first
                const stockNameElement = metaDiv.querySelector('.stock-name strong');
                if (stockNameElement) {
                    const metricsInStockName = stockNameElement.querySelectorAll('.movement-metrics-display');
                    metricsInStockName.forEach(metric => metric.remove());
                }
                
                // Insert after price (total-sum-display) if it exists
                const priceDiv = metaDiv.querySelector('.total-sum-display');
                if (priceDiv) {
                    // Insert after price div (after the price, before anything else)
                    priceDiv.insertAdjacentElement('afterend', container);
                } else {
                    // If no price, append to end after stock-name (shouldn't happen normally)
                    const stockNameDiv = metaDiv.querySelector('.stock-name');
                    if (stockNameDiv) {
                        stockNameDiv.insertAdjacentElement('afterend', container);
                    } else {
                        metaDiv.appendChild(container);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error loading movement metrics for deal title:', err);
    } finally {
        // Remove from loading set after a short delay to allow rendering
        setTimeout(() => {
            movementMetricsLoading.delete(loadingKey);
        }, 100);
    }
}

async function loadAverageWeeklyVolume(ticker) {
    if (!ticker || !ticker.trim()) return null;

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker.trim().toUpperCase())}/average-volume`, {
            headers: authHeaders()
        });

        if (res.ok) {
            const data = await res.json();
            console.log(`Average weekly volume for ${ticker}: ${data.averageVolumeFormatted} (${data.averageVolumeInDollarsFormatted})`);
            return data;
        } else {
            console.warn('Failed to get average weekly volume', res.status);
        }
    } catch (err) {
        console.error('Error loading average weekly volume', err);
    }
    return null;
}

async function loadSupportResistance(ticker, form) {
    if (!ticker || !form) return;

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}/support-resistance`, {
            headers: { ...authHeaders() }
        });

        if (!res.ok) {
            console.warn('Failed to load support/resistance levels');
            return;
        }

        const data = await res.json();
        console.log('Support/resistance data received for', ticker, ':', data);
        
        // Set support_price to first two levels only
        const supportInput = form.querySelector('input[name="support_price"]');
        if (supportInput && data.firstTwo && data.firstTwo.length > 0) {
            // Use firstTwo - only the first two levels
            supportInput.value = data.firstTwo.map(l => parseFloat(l).toFixed(2)).join(', ');
            console.log(`First two support levels loaded for ${ticker}: ${supportInput.value}`);
        } else if (supportInput && data.supportPrice) {
            // Fallback to supportPrice if firstTwo is not available
            supportInput.value = data.supportPrice;
            console.log(`Support levels loaded for ${ticker}: ${data.supportPrice}`);
        } else if (supportInput && data.levels && data.levels.length >= 2) {
            // Fallback: use first two from levels array if firstTwo is not available
            const firstTwoLevels = data.levels.slice(0, 2);
            supportInput.value = firstTwoLevels.map(l => parseFloat(l).toFixed(2)).join(', ');
            console.log(`First two support levels loaded from levels array for ${ticker}: ${supportInput.value}`);
        } else if (supportInput && data.levels && data.levels.length > 0) {
            // If only one level available, use it
            supportInput.value = parseFloat(data.levels[0]).toFixed(2);
            console.log(`Single support level loaded for ${ticker}: ${supportInput.value}`);
        }
    } catch (err) {
        console.error('Error loading support/resistance levels', err);
    }
}

async function loadCurrentPrice(ticker, form) {
    if (!ticker || !form) {
        console.log('loadCurrentPrice: ticker or form is null', { ticker, form: !!form });
        return;
    }

    const formContainer = form.closest('.deal-form-container');
    setPriceError(formContainer, '');

    console.log('loadCurrentPrice: Starting to load price for ticker:', ticker);

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}/quote`, {
            headers: { ...authHeaders() }
        });

        console.log('loadCurrentPrice: API response status:', res.status);

        if (!res.ok) {
            const sharePriceInput = form.querySelector('input[name="share_price"]');
            if (sharePriceInput) sharePriceInput.value = '';
            setPriceError(formContainer, 'Current price is temporarily unavailable (API quota reached).');
            console.log('loadCurrentPrice: API request failed, clearing share price');
            return;
        }

        const data = await res.json();
        console.log('loadCurrentPrice: API response data:', data);
        
        if (data && data.price !== undefined && data.price !== null) {
            const sharePriceInput = form.querySelector('input[name="share_price"]');
            console.log('loadCurrentPrice: sharePriceInput found:', !!sharePriceInput);
            
            if (sharePriceInput) {
                const oldValue = sharePriceInput.value;
                sharePriceInput.value = data.price.toString();
                console.log('✓ Share price set to:', data.price.toString(), '(was:', oldValue, ')');
                
                // Check if take profit is already set
                const takeProfitInput = form.querySelector('input[name="take_profit"]');
                const takeProfitValue = takeProfitInput?.value?.trim();
                console.log('loadCurrentPrice: takeProfitValue after setting share price:', takeProfitValue);
                
                // Trigger input event to ensure all listeners are notified
                // This will trigger setupSharePriceListener's calculatePercentages
                console.log('loadCurrentPrice: Dispatching input and change events');
                sharePriceInput.dispatchEvent(new Event('input', { bubbles: true }));
                sharePriceInput.dispatchEvent(new Event('change', { bubbles: true }));
                
                // Calculate stop loss after autofilling share price
                await calculateStopLoss(form);
                
                // Recalculate take profit percentage if take profit is already set
                // Use multiple delays to catch cases where take profit is entered after share price loads
                console.log('loadCurrentPrice: Calling recalculateTakeProfitPercent after share price load');
                recalculateTakeProfitPercent(form);
                
                // Also trigger recalculations with delays to catch late input
                setTimeout(() => {
                    console.log('loadCurrentPrice: Recalculating after 100ms delay');
                    recalculateTakeProfitPercent(form);
                }, 100);
                
                setTimeout(() => {
                    console.log('loadCurrentPrice: Recalculating after 500ms delay');
                    recalculateTakeProfitPercent(form);
                }, 500);
                
                setTimeout(() => {
                    console.log('loadCurrentPrice: Recalculating after 1000ms delay');
                    recalculateTakeProfitPercent(form);
                }, 1000);
            } else {
                console.warn('loadCurrentPrice: sharePriceInput not found in form');
            }
            setPriceError(formContainer, '');
        } else {
            console.warn('loadCurrentPrice: Invalid data received', data);
        }
    } catch (err) {
        console.error('Error loading current price', err);
        const formContainer = form.closest('.deal-form-container');
        setPriceError(formContainer, 'Current price is temporarily unavailable (API error).');
    }
}

async function calculateStopLoss(form) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stopLossInput = form.querySelector('input[name="stop_loss"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    
    if (!sharePriceInput || !stopLossInput || !stopLossPrcntInput) return;
    
    // If stop loss is already set (from DB or manually), do NOT override it with auto-calculated value.
    // In this case we only recalculate percentage and exit.
    const currentStop = parseFloat(String(stopLossInput.value || '').replace(',', '.'));
    if (!isNaN(currentStop) && currentStop > 0) {
        calculateStopLossPercentage(form);
        return;
    }
    
    const sharePrice = parseFloat(sharePriceInput.value);
    if (!sharePrice || isNaN(sharePrice) || sharePrice <= 0) {
        return; // Invalid share price
    }
    
    // Get the ticker to fetch previous week Low price
    const stockSelect = form.querySelector('select[name="stock"]');
    if (!stockSelect || !stockSelect.value) {
        return; // No stock selected
    }
    
    const ticker = stockSelect.value;
    
    try {
        // Fetch weekly prices to get previous week Low
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}`, {
            headers: { ...authHeaders() }
        });
        
        if (!res.ok) {
            console.warn('Failed to fetch weekly prices for stop loss calculation');
            return;
        }
        
        const data = await res.json();
        if (data && Array.isArray(data) && data.length >= 2) {
            // Get the second-to-last week (previous week)
            const previousWeek = data[data.length - 2];
            
            // Get Low price from previous week
            const lowPrice = previousWeek.Low !== undefined ? previousWeek.Low : 
                           (previousWeek.low !== undefined ? previousWeek.low : null);
            
            if (lowPrice !== null && lowPrice !== undefined && !isNaN(lowPrice)) {
                // Set stop loss price to previous week Low
                stopLossInput.value = lowPrice.toString();
                
                // Calculate percentage: ((share_price - stop_loss) / share_price) * 100
                const percentage = ((sharePrice - lowPrice) / sharePrice) * 100;
                stopLossPrcntInput.value = percentage.toFixed(2);
                
                // Check and apply error styling if needed
                updateStopLossErrorClass(stopLossPrcntInput, percentage);
                
                console.log(`Stop loss calculated: Price=${lowPrice}, Percentage=${percentage.toFixed(2)}%`);
            }
        }
    } catch (err) {
        console.error('Error calculating stop loss:', err);
    }
}

// Calculate stop loss percentage from share price and stop loss value
function calculateStopLossPercentage(form) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stopLossInput = form.querySelector('input[name="stop_loss"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    
    if (!sharePriceInput || !stopLossInput || !stopLossPrcntInput) return;
    
    const sharePrice = parseFloat(String(sharePriceInput.value || '').replace(',', '.'));
    const stopLoss = parseFloat(String(stopLossInput.value || '').replace(',', '.'));
    
    // Both values must be valid numbers
    if (isNaN(sharePrice) || sharePrice <= 0 || isNaN(stopLoss) || stopLoss <= 0) {
        return; // Invalid values
    }
    
    // Calculate percentage: ((share_price - stop_loss) / share_price) * 100
    const percentage = ((sharePrice - stopLoss) / sharePrice) * 100;
    stopLossPrcntInput.value = percentage.toFixed(2);
    
    // Check and apply error styling if needed
    updateStopLossErrorClass(stopLossPrcntInput, percentage);
    
    console.log(`Stop loss percentage recalculated: ${percentage.toFixed(2)}% (Share: ${sharePrice}, Stop Loss: ${stopLoss})`);
}

function updateSelectDownClass(select) {
    if (!select) return;
    if (select.value === 'Down') {
        select.classList.add('has-down-selected');
    } else {
        select.classList.remove('has-down-selected');
    }
}

function setupTrendSelectListeners(form) {
    const monthlySelect = form.querySelector('select[name="monthly_dir"]');
    const weeklySelect = form.querySelector('select[name="weekly_dir"]');
    
    if (monthlySelect) {
        updateSelectDownClass(monthlySelect);
        monthlySelect.addEventListener('change', () => {
            updateSelectDownClass(monthlySelect);
        });
    }
    
    if (weeklySelect) {
        updateSelectDownClass(weeklySelect);
        weeklySelect.addEventListener('change', () => {
            updateSelectDownClass(weeklySelect);
        });
    }
}

function updateStopLossErrorClass(input, value) {
    if (!input) return;
    
    // Remove previous state classes
    input.classList.remove('has-stop-loss-error');
    input.classList.remove('has-stop-loss-good');
    
    if (value <= 0) {
        // Zero or negative stop loss % → good (green)
        input.classList.add('has-stop-loss-good');
    } else if (value > 10) {
        // Too high risk → error (red)
        input.classList.add('has-stop-loss-error');
    }
}

function setupSharePriceListener(form) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    const takeProfitInput = form.querySelector('input[name="take_profit"]');
    const takeProfitPrcntInput = form.querySelector('input[name="take_profit_prcnt"]');
    
    if (!sharePriceInput) return;
    
    // Remove existing listeners by cloning
    const newInput = sharePriceInput.cloneNode(true);
    sharePriceInput.parentNode.replaceChild(newInput, sharePriceInput);
    
    // Function to calculate percentages when share price changes
    const calculatePercentages = () => {
        // Calculate stop loss
        calculateStopLoss(form);
        
        // Calculate take profit percentage if take profit is set
        if (takeProfitInput && takeProfitInput.value && takeProfitPrcntInput) {
            recalculateTakeProfitPercent(form);
        }
    };
    
    // Add listeners for both 'input' (real-time) and 'change' (on blur)
    newInput.addEventListener('input', () => {
        // Debounce to avoid too many calculations while typing
        clearTimeout(newInput._stopLossTimeout);
        newInput._stopLossTimeout = setTimeout(() => {
            calculatePercentages();
        }, 500); // Wait 500ms after user stops typing
    });
    
    newInput.addEventListener('change', () => {
        calculatePercentages();
    });
    
    // Also trigger calculation if share price is already set and take profit is also set
    if (newInput.value && takeProfitInput && takeProfitInput.value) {
        setTimeout(() => {
            calculatePercentages();
        }, 100);
    }
    
    // Also trigger calculation after a delay to catch cases where share price is loaded via API
    // This ensures that if share price is set programmatically, the calculation still happens
    setTimeout(() => {
        if (newInput.value && takeProfitInput && takeProfitInput.value) {
            calculatePercentages();
        }
    }, 500);
    
    // Also check stop loss % field when user manually changes it
    if (stopLossPrcntInput) {
        // Check initial value
        const initialValue = parseFloat(stopLossPrcntInput.value);
        if (!isNaN(initialValue)) {
            updateStopLossErrorClass(stopLossPrcntInput, initialValue);
        }
        
        const newStopLossPrcnt = stopLossPrcntInput.cloneNode(true);
        stopLossPrcntInput.parentNode.replaceChild(newStopLossPrcnt, stopLossPrcntInput);
        
        newStopLossPrcnt.addEventListener('input', () => {
            const value = parseFloat(newStopLossPrcnt.value);
            if (!isNaN(value)) {
                updateStopLossErrorClass(newStopLossPrcnt, value);
            } else {
                newStopLossPrcnt.classList.remove('has-stop-loss-error');
            }
        });
        
        newStopLossPrcnt.addEventListener('change', () => {
            const value = parseFloat(newStopLossPrcnt.value);
            if (!isNaN(value)) {
                updateStopLossErrorClass(newStopLossPrcnt, value);
            } else {
                newStopLossPrcnt.classList.remove('has-stop-loss-error');
            }
        });
    }
}

function setupStopLossListener(form) {
    const stopLossInput = form.querySelector('input[name="stop_loss"]');
    
    if (!stopLossInput) return;
    
    // Remove existing listeners by cloning
    const newInput = stopLossInput.cloneNode(true);
    stopLossInput.parentNode.replaceChild(newInput, stopLossInput);
    
    // Add listeners for both 'input' (real-time) and 'change' (on blur)
    newInput.addEventListener('input', () => {
        // Debounce to avoid too many calculations while typing
        clearTimeout(newInput._stopLossTimeout);
        newInput._stopLossTimeout = setTimeout(() => {
            calculateStopLossPercentage(form);
        }, 500); // Wait 500ms after user stops typing
    });
    
    newInput.addEventListener('change', () => {
        calculateStopLossPercentage(form);
    });
}

// Setup total sum calculation and update row title
function setupTotalSumCalculator(row, form, deal) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const amountToBuyInput = form.querySelector('input[name="amount_tobuy_stage_1"]');
    const stockSelect = form.querySelector('.deal-stock-select');
    const summary = row.querySelector('.deal-summary');
    
    if (!sharePriceInput || !amountToBuyInput || !summary) return;
    
    // Remove existing listeners by cloning
    const newSharePriceInput = sharePriceInput.cloneNode(true);
    sharePriceInput.parentNode.replaceChild(newSharePriceInput, sharePriceInput);
    
    const newAmountToBuyInput = amountToBuyInput.cloneNode(true);
    amountToBuyInput.parentNode.replaceChild(newAmountToBuyInput, amountToBuyInput);
    
    // Function to update the row title (deal-summary) with total sum
    const updateRowTitle = () => {
        const sharePrice = newSharePriceInput.value || '';
        const amountToBuy = newAmountToBuyInput.value || '';
        const totalSum = calculateTotalSum(sharePrice, amountToBuy);
        const totalSumFormatted = formatTotalSum(totalSum);
        const totalSumDisplay = totalSumFormatted ? totalSumFormatted : '';
        
        // Get current stock name from select or from deal
        let currentStock = 'New Deal';
        if (stockSelect && stockSelect.value) {
            currentStock = stockSelect.value;
        } else if (deal?.stock) {
            currentStock = deal.stock;
        }
        
        // Find the stock name element (strong tag inside div)
        const stockNameDiv = summary.querySelector('.stock-name');
        const stockElement = stockNameDiv?.querySelector('strong');
        if (stockElement) {
            // Get warning icons from current DOM (movement metrics are now after price, not here)
            const warningIcons = Array.from(stockElement.querySelectorAll('.volume-warning-icon'));
            
            // Remove any movement metrics that might still be in stock name (cleanup)
            const movementMetricsInStockName = stockElement.querySelectorAll('.movement-metrics-display');
            movementMetricsInStockName.forEach(metric => metric.remove());
            
            // Build new HTML with only ticker and warning icons (NO movement metrics, NO total sum)
            let newHTML = escapeHtml(currentStock);
            
            // Add warning icons
            warningIcons.forEach(icon => {
                newHTML += icon.outerHTML;
            });
            
            // Update titleElement (without total sum, without movement metrics)
            if (stockElement.innerHTML !== newHTML) {
                stockElement.innerHTML = newHTML;
            }
        } else if (stockNameDiv) {
            // If stockNameDiv exists but strong doesn't, create it
            const strongEl = document.createElement('strong');
            strongEl.textContent = currentStock;
            stockNameDiv.innerHTML = '';
            stockNameDiv.appendChild(strongEl);
        }
        
        // Update total sum in separate div
        const metaDiv = summary.querySelector('.meta > div:first-child');
        if (metaDiv) {
            let totalSumDiv = metaDiv.querySelector('.total-sum-display');
            if (totalSumDisplay) {
                if (!totalSumDiv) {
                    totalSumDiv = document.createElement('div');
                    totalSumDiv.className = 'total-sum-display';
                    metaDiv.appendChild(totalSumDiv);
                }
                totalSumDiv.textContent = totalSumDisplay;
                totalSumDiv.style.display = '';
            } else if (totalSumDiv) {
                totalSumDiv.style.display = 'none';
            }
        }
        
        // Store totalSum in a data attribute for later use
        row.dataset.totalSum = totalSum || '';
    };
    
    // Function to calculate and display total sum in the row title (deal-summary)
    const calculateAndDisplayTotalSum = () => {
        // Update row title which shows the total sum in the deal-summary element
        updateRowTitle();
    };
    
    // Add event listeners for share_price
    newSharePriceInput.addEventListener('input', () => {
        clearTimeout(newSharePriceInput._totalSumTimeout);
        newSharePriceInput._totalSumTimeout = setTimeout(() => {
            updateRowTitle();
        }, 300);
    });
    
    // Calculate and display total sum when share_price loses focus (blur)
    newSharePriceInput.addEventListener('blur', () => {
        calculateAndDisplayTotalSum();
    });
    
    newSharePriceInput.addEventListener('change', () => {
        updateRowTitle();
    });
    
    // Add event listeners for amount_tobuy_stage_1
    newAmountToBuyInput.addEventListener('input', () => {
        clearTimeout(newAmountToBuyInput._totalSumTimeout);
        newAmountToBuyInput._totalSumTimeout = setTimeout(() => {
            updateRowTitle();
        }, 300);
    });
    
    // Calculate and display total sum when field loses focus (blur)
    newAmountToBuyInput.addEventListener('blur', () => {
        calculateAndDisplayTotalSum();
    });
    
    newAmountToBuyInput.addEventListener('change', () => {
        updateRowTitle();
    });
    
    // Update row title when stock name changes
    if (stockSelect) {
        const handleStockChange = () => {
            // Small delay to let the stock select update first
            setTimeout(() => {
                updateRowTitle();
            }, 100);
        };
        
        stockSelect.addEventListener('change', handleStockChange);
    }
    
    // Initial calculation
    updateRowTitle();
    
    // Setup risk calculation when total_sum or stop_loss_prcnt changes
    setupRiskCalculator(form);
}

// Calculate portfolio risk on client side (for new deals that aren't saved yet)
async function calculatePortfolioRiskClientSide(form) {
    try {
        // Get current Total Sum value (Cash + In Shares)
        const totalSumSpan = document.getElementById('totalSumValue');
        if (!totalSumSpan) return 0;
        
        const totalSumStr = totalSumSpan.textContent.trim().replace(',', '.');
        const totalSum = parseFloat(totalSumStr) || 0;
        
        if (totalSum <= 0) return 0;
        
        // Calculate total risk from all existing open deals
        let totalRisk = 0;
        
        // Get all open deals (excluding closed ones)
        const openDeals = deals.filter(d => !d.closed);
        
        for (const deal of openDeals) {
            // Parse total_sum
            let totalSum = 0;
            if (deal.total_sum) {
                totalSum = parseFloat(String(deal.total_sum).replace(',', '.')) || 0;
            } else if (deal.share_price && deal.amount_tobuy_stage_1) {
                // Calculate from share_price * amount_tobuy_stage_1
                const sharePrice = parseFloat(String(deal.share_price).replace(',', '.')) || 0;
                const amount = parseFloat(String(deal.amount_tobuy_stage_1).replace(',', '.')) || 0;
                totalSum = sharePrice * amount;
            }
            
            // Parse stop_loss_prcnt
            let stopLossPercent = 0;
            if (deal.stop_loss_prcnt) {
                stopLossPercent = parseFloat(String(deal.stop_loss_prcnt).replace(',', '.')) || 0;
            }
            
            // Calculate risk for this deal: total_sum * (stop_loss_percent / 100)
            if (stopLossPercent > 0 && totalSum > 0) {
                const dealRisk = totalSum * (stopLossPercent / 100);
                totalRisk += dealRisk;
            }
        }
        
        // Add risk from the current form (new deal being created)
        if (form) {
            const totalSumInput = form.querySelector('input[name="total_sum"]');
            const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
            const sharePriceInput = form.querySelector('input[name="share_price"]');
            const amountToBuyInput = form.querySelector('input[name="amount_tobuy_stage_1"]');
            
            let formTotalSum = 0;
            let formStopLossPercent = 0;
            
            // Get total_sum from form
            if (totalSumInput && totalSumInput.value) {
                formTotalSum = parseFloat(String(totalSumInput.value).replace(',', '.')) || 0;
            } else if (sharePriceInput && amountToBuyInput && sharePriceInput.value && amountToBuyInput.value) {
                // Calculate from share_price * amount_tobuy_stage_1
                const sharePrice = parseFloat(String(sharePriceInput.value).replace(',', '.')) || 0;
                const amount = parseFloat(String(amountToBuyInput.value).replace(',', '.')) || 0;
                formTotalSum = sharePrice * amount;
            }
            
            // Get stop_loss_prcnt from form
            if (stopLossPrcntInput && stopLossPrcntInput.value) {
                formStopLossPercent = parseFloat(String(stopLossPrcntInput.value).replace(',', '.')) || 0;
            }
            
            // Add risk from current form deal
            if (formStopLossPercent > 0 && formTotalSum > 0) {
                const formDealRisk = formTotalSum * (formStopLossPercent / 100);
                totalRisk += formDealRisk;
            }
        }
        
        // Calculate percentage: (total_risk / totalSum) * 100
        const riskPercent = (totalRisk / totalSum) * 100;
        return Math.round(riskPercent * 100) / 100; // Round to 2 decimal places
    } catch (e) {
        console.error('Error calculating portfolio risk client side', e);
        return 0;
    }
}

// Setup risk calculator for real-time updates when editing deal data
function setupRiskCalculator(form) {
    const dealId = form?.dataset?.dealId;
    const isNewDeal = dealId === 'new';
    
    const totalSumInput = form.querySelector('input[name="total_sum"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const amountToBuyInput = form.querySelector('input[name="amount_tobuy_stage_1"]');
    
    // Function to calculate and display risk
    const calculateAndDisplayRisk = async () => {
        if (isNewDeal) {
            // For new deals, calculate on client side
            const riskPercent = await calculatePortfolioRiskClientSide(form);
            const riskSpan = document.getElementById('portfolioRiskValue');
            if (riskSpan) {
                const riskValue = Number(riskPercent) || 0;
                riskSpan.textContent = riskValue.toFixed(2) + '%';
                
                // Apply color classes based on risk level
                riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
                if (riskValue > 10) {
                    riskSpan.classList.add('risk-high'); // Red color for high risk
                } else if (riskValue > 5) {
                    riskSpan.classList.add('risk-medium'); // Yellow/Orange color for medium risk
                } else {
                    riskSpan.classList.add('risk-low'); // Green color for low risk
                }
            }
        } else {
            // For existing deals, use server-side calculation
            await calculateAndDisplayPortfolioRisk();
            await calculateAndDisplayInSharesRisk();
        }
    };
    
    // Debounce function for risk calculation
    let riskCalculationTimeout = null;
    const calculateRisk = () => {
        clearTimeout(riskCalculationTimeout);
        riskCalculationTimeout = setTimeout(async () => {
            await calculateAndDisplayRisk();
        }, 1000); // Wait 1 second after user stops typing
    };
    
    // Add listeners to total_sum if it exists (calculated field)
    if (totalSumInput) {
        totalSumInput.addEventListener('input', calculateRisk);
        totalSumInput.addEventListener('change', calculateAndDisplayRisk);
    }
    
    // Add listeners to stop_loss_prcnt
    if (stopLossPrcntInput) {
        stopLossPrcntInput.addEventListener('input', calculateRisk);
        stopLossPrcntInput.addEventListener('change', calculateAndDisplayRisk);
    }
    
    // Also listen to share_price and amount_tobuy_stage_1 since they affect total_sum
    if (sharePriceInput) {
        sharePriceInput.addEventListener('change', async () => {
            // Wait a bit for total_sum to be recalculated
            setTimeout(async () => {
                await calculateAndDisplayRisk();
            }, 500);
        });
    }
    
    if (amountToBuyInput) {
        amountToBuyInput.addEventListener('change', async () => {
            // Wait a bit for total_sum to be recalculated
            setTimeout(async () => {
                await calculateAndDisplayRisk();
            }, 500);
        });
    }
    
    // Initial risk calculation if form already has values (for new deals)
    if (isNewDeal) {
        // Check if form has values that would affect risk calculation
        const hasValues = (stopLossPrcntInput && stopLossPrcntInput.value) ||
                          (totalSumInput && totalSumInput.value) ||
                          (sharePriceInput && sharePriceInput.value && amountToBuyInput && amountToBuyInput.value);
        
        if (hasValues) {
            // Wait a bit for form to be fully initialized
            setTimeout(async () => {
                await calculateAndDisplayRisk();
            }, 300);
        }
    }
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"]/g, s => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
    }[s]));
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const datePart = dateStr.slice(0, 10);
    const parts = datePart.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
}

elements.filterInput.addEventListener('input', renderAll);

// ========== NEW DEAL BUTTON ==========

elements.newDealBtn.addEventListener('click', async () => {
    if (newDealRow) {
        // If new deal row already exists, just expand it
        const existingRow = document.querySelector('[data-deal-id="new"]');
        if (existingRow) {
            existingRow.classList.add('expanded');
            existingRow.querySelector('.deal-form-container').style.display = 'block';
            existingRow.querySelector('.expand-icon').textContent = '▼';
            expandedDealId = 'new';
            // Ensure stock select is reset
            const form = existingRow.querySelector('.deal-form-inline');
            if (form) {
                const select = form.querySelector('.deal-stock-select');
                if (select) {
                    select.value = '';
                    select.selectedIndex = -1;
                }
                await populateStockSelect(form, null);
                setupStockSelectListener(form, 'new');
            }
        }
    } else {
        newDealRow = true;
        expandedDealId = 'new';
        renderAll();
        // Wait for DOM to update, then expand and populate stocks
        setTimeout(async () => {
            const newRow = document.querySelector('[data-deal-id="new"]');
            if (newRow) {
                const form = newRow.querySelector('.deal-form-inline');
                if (form) {
                    // Explicitly reset select to ensure it's empty
                    const select = form.querySelector('.deal-stock-select');
                    if (select) {
                        select.value = '';
                        select.selectedIndex = -1;
                    }
                    await populateStockSelect(form, null);
                    setupStockSelectListener(form, 'new');
                }
            }
        }, 50);
    }
});

// Listen for stocks updated event to reload cache
window.addEventListener('stocksUpdated', async () => {
    await loadStocksForDeals();
    await loadWarnings(); // Also reload warnings
    renderAll(); // Re-render deals to show updated indicators
});

// Calculate and display portfolio risk percentage
async function calculateAndDisplayPortfolioRisk() {
    try {
        const res = await apiFetch('/api/deals/risk-percent', {
            headers: authHeaders()
        });
        
        if (res.ok) {
            const riskPercent = await res.json();
            const riskSpan = document.getElementById('portfolioRiskValue');
            if (riskSpan) {
                const riskValue = Number(riskPercent) || 0;
                riskSpan.textContent = riskValue.toFixed(2) + '%';
                
                // Apply color classes based on risk level
                riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
                if (riskValue > 10) {
                    riskSpan.classList.add('risk-high'); // Red color for high risk
                } else if (riskValue > 5) {
                    riskSpan.classList.add('risk-medium'); // Yellow/Orange color for medium risk
                } else {
                    riskSpan.classList.add('risk-low'); // Green color for low risk
                }
            }
        } else {
            console.error('Failed to load portfolio risk', res.status);
            const riskSpan = document.getElementById('portfolioRiskValue');
            if (riskSpan) {
                riskSpan.textContent = '0.00%';
                // Reset classes on error
                riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
                riskSpan.classList.add('risk-low');
            }
        }
    } catch (e) {
        console.error('Error loading portfolio risk', e);
        const riskSpan = document.getElementById('portfolioRiskValue');
        if (riskSpan) {
            riskSpan.textContent = '0.00%';
            // Reset classes on error
            riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
            riskSpan.classList.add('risk-low');
        }
    }
}

// Calculate and display risk percentage relative to In Shares
async function calculateAndDisplayInSharesRisk() {
    try {
        // First check if In Shares value is available
        const inSharesSpan = document.getElementById('inSharesValue');
        const inSharesValue = inSharesSpan ? parseFloat(inSharesSpan.textContent.replace(/,/g, '')) || 0 : 0;
        
        console.log('calculateAndDisplayInSharesRisk - In Shares value from DOM:', inSharesValue);
        
        const res = await apiFetch('/api/deals/risk-percent-inshares', {
            headers: authHeaders()
        });
        
        if (res.ok) {
            const riskPercent = await res.json();
            console.log('In Shares Risk API response:', riskPercent, 'In Shares:', inSharesValue);
            const riskSpan = document.getElementById('inSharesRiskValue');
            if (riskSpan) {
                const riskValue = Number(riskPercent) || 0;
                console.log('In Shares Risk calculated value:', riskValue);

                // Calculate money at risk based on In Shares value
                let moneyAtRiskText = '';
                if (inSharesValue > 0 && riskValue !== 0) {
                    const moneyAtRisk = inSharesValue * (riskValue / 100);
                    moneyAtRiskText = ` [${moneyAtRisk.toFixed(2)}]`;
                }

                // Show: "8.64% [10000.00]"
                riskSpan.textContent = `${riskValue.toFixed(2)}%${moneyAtRiskText}`;
                
                // Apply color classes based on risk level
                riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
                if (riskValue > 10) {
                    riskSpan.classList.add('risk-high'); // Red color for high risk
                } else if (riskValue > 5) {
                    riskSpan.classList.add('risk-medium'); // Yellow/Orange color for medium risk
                } else {
                    riskSpan.classList.add('risk-low'); // Green color for low risk
                }
            } else {
                console.warn('inSharesRiskValue element not found in DOM');
            }
        } else {
            const errorText = await res.text().catch(() => '');
            console.error('Failed to load in shares risk', res.status, errorText);
            const riskSpan = document.getElementById('inSharesRiskValue');
            if (riskSpan) {
                riskSpan.textContent = '0.00%';
                // Reset classes on error
                riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
                riskSpan.classList.add('risk-low');
            }
        }
    } catch (e) {
        console.error('Error loading in shares risk', e);
        const riskSpan = document.getElementById('inSharesRiskValue');
        if (riskSpan) {
            riskSpan.textContent = '0.00%';
            // Reset classes on error
            riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
            riskSpan.classList.add('risk-low');
        }
    }
}

// ========== PINNED STOCKS (TOOLS PANEL) ==========

let pinnedStocks = [];
let draggedPinnedId = null;

async function loadPinnedStocks() {
    const container = document.getElementById('pinnedStocksContainer');
    if (!container) return;

    try {
        const res = await apiFetch('/api/pinnedstocks', {
            headers: authHeaders()
        });
        if (!res.ok) {
            console.warn('Failed to load pinned stocks', res.status);
            container.innerHTML = '';
            return;
        }

        pinnedStocks = await res.json(); // [{ id, ticker, order }]
        renderPinnedStocks();
    } catch (e) {
        console.error('Error loading pinned stocks', e);
    }
}

function renderPinnedStocks() {
    const container = document.getElementById('pinnedStocksContainer');
    if (!container) return;

    container.innerHTML = '';

    if (!pinnedStocks || pinnedStocks.length === 0) {
        return;
    }

    pinnedStocks.forEach(item => {
        const chip = document.createElement('div');
        chip.className = 'pinned-stock-chip';
        chip.dataset.pinnedId = item.id;
        chip.draggable = true;

        const label = document.createElement('strong');
        label.textContent = (item.ticker || '').toUpperCase();
        chip.appendChild(label);

        const metricsDiv = document.createElement('div');
        metricsDiv.className = 'movement-metrics-container';
        metricsDiv.style.marginLeft = '6px';
        chip.appendChild(metricsDiv);

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.className = 'secondary';
        removeBtn.style.padding = '0 4px';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deletePinnedStock(item.id);
        });
        chip.appendChild(removeBtn);

        setupPinnedDragHandlers(chip, item.id);

        container.appendChild(chip);

        attachPinnedMetrics(metricsDiv, item.ticker);
    });
}

async function attachPinnedMetrics(containerEl, ticker) {
    if (!containerEl || !ticker) return;

    if (typeof loadMovementMetrics !== 'function' || typeof formatMovementMetrics !== 'function') {
        console.warn('Movement metrics helpers are not available for pinned stocks');
        containerEl.textContent = '';
        return;
    }

    const raw = (ticker || '').trim().toUpperCase();

    try {
        let metrics = null;

        // If ticker contains '+', treat it as a composite index
        if (raw.includes('+') && typeof loadCompositeMovementMetrics === 'function') {
            const parts = raw
                .split('+')
                .map(t => t.trim())
                .filter(Boolean);

            metrics = await loadCompositeMovementMetrics(parts);
        } else {
            // Regular single ticker
            metrics = await loadMovementMetrics(raw);
        }

        if (!metrics) {
            containerEl.textContent = '';
            return;
        }

        const html = formatMovementMetrics(metrics);
        containerEl.innerHTML = html;
    } catch (e) {
        console.error('Error loading movement metrics for pinned item', ticker, e);
        containerEl.textContent = '';
    }
}

function setupPinnedDragHandlers(chip, pinnedId) {
    chip.addEventListener('dragstart', (e) => {
        draggedPinnedId = pinnedId;
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    chip.addEventListener('dragend', () => {
        draggedPinnedId = null;
        chip.classList.remove('dragging');
    });

    chip.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedPinnedId || draggedPinnedId === pinnedId) return;

        const container = document.getElementById('pinnedStocksContainer');
        if (!container) return;

        const chips = Array.from(container.querySelectorAll('.pinned-stock-chip'));
        const draggedEl = chips.find(c => c.dataset.pinnedId === draggedPinnedId);
        if (!draggedEl) return;

        const target = e.currentTarget;
        const rect = target.getBoundingClientRect();
        const before = (e.clientX - rect.left) < rect.width / 2;

        if (before) {
            container.insertBefore(draggedEl, target);
        } else {
            container.insertBefore(draggedEl, target.nextSibling);
        }
    });

    chip.addEventListener('drop', async (e) => {
        e.preventDefault();
        await savePinnedOrderToServer();
    });
}

async function savePinnedOrderToServer() {
    const container = document.getElementById('pinnedStocksContainer');
    if (!container) return;

    const orderedIds = Array.from(container.querySelectorAll('.pinned-stock-chip'))
        .map(el => el.dataset.pinnedId)
        .filter(Boolean);

    if (!orderedIds.length) return;

    try {
        const res = await apiFetch('/api/pinnedstocks/reorder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders()
            },
            body: JSON.stringify({ orderedIds })
        });

        if (!res.ok) {
            console.error('Failed to save pinned stocks order', res.status);
            return;
        }

        // Обновим локальный порядок
        pinnedStocks.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
    } catch (e) {
        console.error('Error saving pinned stocks order', e);
    }
}

async function addPinnedStock(ticker) {
    const t = (ticker || '').trim().toUpperCase();
    if (!t) return;

    try {
        const res = await apiFetch('/api/pinnedstocks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders()
            },
            body: JSON.stringify({ ticker: t })
        });

        if (!res.ok) {
            console.error('Failed to add pinned stock', res.status);
            return;
        }

        await loadPinnedStocks();
    } catch (e) {
        console.error('Error adding pinned stock', e);
    }
}

async function deletePinnedStock(id) {
    if (!id) return;
    try {
        const res = await apiFetch(`/api/pinnedstocks/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (!res.ok) {
            console.error('Failed to delete pinned stock', res.status);
            return;
        }
        await loadPinnedStocks();
    } catch (e) {
        console.error('Error deleting pinned stock', e);
    }
}

function setupPinnedStocksUI() {
    const input = document.getElementById('pinnedTickerInput');
    const openBtn = document.getElementById('openPinnedModalBtn');
    const confirmBtn = document.getElementById('confirmPinnedAddBtn');
    const closeBtn = document.getElementById('closePinnedModalBtn');
    const modal = document.getElementById('pinnedModal');

    if (!input || !openBtn || !confirmBtn || !closeBtn || !modal) return;

    const openModal = () => {
        modal.style.display = 'flex';
        input.value = '';
        setTimeout(() => input.focus(), 0);
    };

    const closeModal = () => {
        modal.style.display = 'none';
        input.value = '';
    };

    openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
    });

    closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal();
    });

    // Force uppercase input by default for pinned tickers (including composite like AAPL+TSLA)
    input.addEventListener('input', () => {
        if (!input.value) return;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.toUpperCase();
        // Try to preserve caret position
        if (start != null && end != null) {
            input.setSelectionRange(start, end);
        }
    });

    const submit = () => {
        addPinnedStock(input.value);
        closeModal();
    };

    confirmBtn.addEventListener('click', (e) => {
        e.preventDefault();
        submit();
    });

    const form = document.getElementById('pinnedForm');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            submit();
        });
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    });
}

function setupSettingsUI() {
    const btn = document.getElementById('settingsBtn');
    const modal = document.getElementById('settingsModal');
    const closeBtn = document.getElementById('closeSettingsModalBtn');
    const form = document.getElementById('settingsForm');
    const tfSelect = document.getElementById('movementTimeframeSelect');
    const lbSelect = document.getElementById('movementLookbackSelect');

    if (!btn || !modal || !closeBtn || !form || !tfSelect || !lbSelect) return;

    const openModal = () => {
        const s = window.movementSettings || defaultMovementSettings;
        tfSelect.value = s.timeframe || 'Weekly';
        lbSelect.value = String(s.lookback || 52);
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
    };

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
    });

    closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal();
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const settings = {
            timeframe: tfSelect.value || 'Weekly',
            lookback: parseInt(lbSelect.value || '52', 10)
        };
        window.movementSettings = settings;
        saveMovementSettings(settings);
        closeModal();
    });
}

// ======== СТАРТ =========
(async function init() {
    setupPinnedStocksUI();
    setupSettingsUI();
    await loadDeals();
    // Calculate and display portfolio risk on page load
    await calculateAndDisplayPortfolioRisk();
    await calculateAndDisplayInSharesRisk();
    await loadPinnedStocks();
})();

document.addEventListener('keydown', e => {
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        elements.newDealBtn.click();
    }
});

