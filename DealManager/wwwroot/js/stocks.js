// stocks.js

const addStockBtn = document.getElementById('addStockBtn');
const stockModal = document.getElementById('stockModal');
const closeStockModalBtn = document.getElementById('closeStockModal');
const stockForm = document.getElementById('stockForm');
const stockList = document.getElementById('stockList');
const emptyStockEl = document.getElementById('emptyStock');
const stockFilterInput = document.getElementById('stockFilterInput');

let stocks = [];
let stocksLoaded = false;
let expandedStockId = null; // Track which stock is currently expanded
// warningsCache is declared in deals-inline.js - use that shared cache

let draggedStockId = null; // For drag & drop reordering
let stockFilter = '';

// локальный вариант authHeaders (такой же, как в deals.js)
function authHeaders() {
    const t = localStorage.getItem('token');
    return t ? { Authorization: 'Bearer ' + t } : {};
}

// Provide apiFetch on Stocks page too (deals-inline.js defines it, but Stocks page may not load it).
// Keeps behavior consistent: auto-handle 401/403 by redirecting to login.
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
        localStorage.removeItem('email');
        localStorage.removeItem('userName');
        window.location.href = '/login.html';
        throw new Error('Unauthorized, redirect to login');
    }

    return response;
}

// ====== API ======

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
        // Use window.warningsCache to share with deals-inline.js
        window.warningsCache = warnings || [];
        return window.warningsCache;
    } catch (err) {
        console.error(err);
        window.warningsCache = [];
        return [];
    }
}

// Function to get warning by ticker from cache
// Uses window.warningsCache to share with deals-inline.js
function getWarningByTicker(ticker) {
    const cache = window.warningsCache || [];
    if (!ticker || !cache || cache.length === 0) return null;
    return cache.find(w => w.ticker === ticker?.toUpperCase()) || null;
}

// Function to get warning by stockId from cache (preferred for unique stock instances)
function getWarningByStockId(stockId) {
    const cache = window.warningsCache || [];
    if (!stockId || !cache || cache.length === 0) return null;
    return cache.find(w => w.stockId === stockId) || null;
}

async function loadStocks() {
    stocksLoaded = false;
    renderStocks(); // Show loading state
    
    try {
        const res = await apiFetch('/api/stocks', {
            headers: authHeaders()
        });
        if (!res.ok) throw new Error('Failed to load stocks');

        stocks = await res.json();
        stocksLoaded = true;
        
        // Load warnings when loading stocks
        await loadWarnings();
        
        renderStocks();
    } catch (e) {
        console.error(e);
        stocksLoaded = true;
        if (emptyStockEl) {
            emptyStockEl.textContent = 'Не удалось загрузить акции';
            emptyStockEl.style.display = 'block';
        }
    }
}

async function saveStockToServer(stockDto) {
    const res = await apiFetch('/api/stocks', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify(stockDto)
    });

    if (res.status === 401 || res.status === 403) {
        alert('Сессия истекла, войдите заново');
        localStorage.removeItem('token');
        localStorage.removeItem('email');
        localStorage.removeItem('userName');
        window.location.href = '/login.html';
        return;
    }

    if (!res.ok) {
        throw new Error('Failed to save stock');
    }
}


async function deleteStockOnServer(id) {
    const res = await apiFetch(`/api/stocks/${id}`, {
        method: 'DELETE',
        headers: authHeaders()
    });
    if (!res.ok) throw new Error('Failed to delete stock');
}

async function updateStockOnServer(id, stockDto) {
    const res = await fetch(`/api/stocks/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: JSON.stringify(stockDto)
    });

    if (res.status === 401 || res.status === 403) {
        alert('Сессия истекла, войдите заново');
        localStorage.removeItem('token');
        localStorage.removeItem('email');
        localStorage.removeItem('userName');
        window.location.href = '/login.html';
        return;
    }

    if (!res.ok) throw new Error('Failed to update stock');
}

// ====== Модалка акций ======

// Локальный helper только для кнопки сохранения акции,
// чтобы не конфликтовать с глобальным setButtonLoading из deals-inline.js
function setStockButtonLoading(button, isLoading) {
    if (isLoading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent.trim();
        }
        button.disabled = true;
        button.innerHTML = '<span class="loading-spinner"></span> Loading...';
    } else {
        button.disabled = false;
        const originalText = button.dataset.originalText || 'Save stock';
        button.textContent = originalText;
        delete button.dataset.originalText;
    }
}

// Function to open stock modal
function openStockModal(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    console.log('Add stock button triggered');
    const modal = document.getElementById('stockModal');
    if (modal) {
        modal.style.display = 'flex';
    }
    
    // When opening modal, update metrics header based on current ticker (if any)
    if (stockForm && typeof updateStockMetricsHeader === 'function') {
        const tickerInput = stockForm.querySelector('input[name="ticker"]');
        if (tickerInput) {
            updateStockMetricsHeader(tickerInput.value);
        }
    }
}

// Setup event listeners - use multiple approaches for maximum compatibility
function setupAddStockButton() {
    const btn = document.getElementById('addStockBtn');
    const modal = document.getElementById('stockModal');
    
    if (!btn || !modal) {
        console.error('addStockBtn or stockModal not found in DOM', {
            addStockBtn: !!btn,
            stockModal: !!modal
        });
        return;
    }
    
    console.log('Setting up addStockBtn event listener');
    
    // Add click handler for desktop (capture phase to catch early)
    btn.addEventListener('click', openStockModal, true);
    
    // Add touchstart handler for mobile devices (capture phase)
    btn.addEventListener('touchstart', (e) => {
        console.log('Add stock button touchstart');
        openStockModal(e);
    }, { passive: false, capture: true });
    
    // Add touchend as backup
    btn.addEventListener('touchend', (e) => {
        console.log('Add stock button touchend');
        openStockModal(e);
    }, { passive: false, capture: true });
    
    // Also add onclick as direct fallback
    btn.onclick = openStockModal;
    
    // Ensure button is clickable with inline styles
    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';
    btn.style.zIndex = '1000';
    btn.style.position = 'relative';
    btn.style.touchAction = 'manipulation';
    btn.removeAttribute('disabled');
    
    console.log('addStockBtn event listeners set up', btn);
}

// Also use event delegation through aside panel as backup
const asidePanel = document.querySelector('aside.panel');
if (asidePanel) {
    asidePanel.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'addStockBtn') {
            console.log('Add stock button clicked via delegation');
            openStockModal(e);
        }
    }, true);
    
    asidePanel.addEventListener('touchstart', (e) => {
        if (e.target && e.target.id === 'addStockBtn') {
            console.log('Add stock button touched via delegation');
            openStockModal(e);
        }
    }, { passive: false, capture: true });
}

// Setup when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAddStockButton);
} else {
    // DOM already loaded, setup immediately
    setTimeout(setupAddStockButton, 0);
}

if (closeStockModalBtn) {
    closeStockModalBtn.addEventListener('click', () => {
        if (stockModal) {
            stockModal.style.display = 'none';
        }
        if (stockForm) {
            stockForm.reset();
            delete stockForm.dataset.stockId; // Clear stored ID
            const modalTitle = document.getElementById('stockModalTitle');
            if (modalTitle) modalTitle.textContent = 'Add stock';
            
            // Clear ATR styling when form is reset
            const atrInput = stockForm.querySelector('input[name="atr"]');
            if (atrInput) {
                atrInput.classList.remove('atr-high-risk-readonly');
            }
            
            // Clear sync_sp500 field when form is reset
            const syncSp500Select = stockForm.querySelector('select[name="sync_sp500"]');
            if (syncSp500Select) {
                syncSp500Select.value = '';
            }
        }
        
        // Clear movement metrics header when closing modal
        const headerContainer = document.getElementById('stockMetricsHeader');
        if (headerContainer) {
            headerContainer.innerHTML = '';
        }
        
        // Only call setTickerError if it exists (it's defined later)
        if (typeof setTickerError === 'function') {
            setTickerError(''); // Clear error when closing
        }
    });
} else {
    console.error('closeStockModalBtn not found in DOM');
}

if (stockForm) {
    // Highlight "S&P 500 member" label in yellow when checkbox is NOT checked
    const sp500Checkbox = stockForm.querySelector('input[name="sp500_member"]');
    const sp500LabelSpan = stockForm.querySelector('label.inline-checkbox span');

    const updateSp500MemberStyling = () => {
        if (!sp500Checkbox || !sp500LabelSpan) return;
        if (sp500Checkbox.checked) {
            sp500LabelSpan.classList.remove('sp500-not-member');
        } else {
            sp500LabelSpan.classList.add('sp500-not-member');
        }
    };

    if (sp500Checkbox && sp500LabelSpan) {
        // Initial state when form is opened
        updateSp500MemberStyling();
        // Update on checkbox change
        sp500Checkbox.addEventListener('change', updateSp500MemberStyling);
    }

stockForm.addEventListener('submit', async e => {
    e.preventDefault();

    const fd = new FormData(stockForm);
    const ticker = (fd.get('ticker') || '').toString().trim();
    const desc = (fd.get('desc') || '').toString().trim();
    const sp500_member = fd.get('sp500_member') === 'on';
        const betaVolatility = fd.get('betaVolatility') || null;
        const regularVolume = fd.get('regular_volume');
        const syncSp500 = fd.get('sync_sp500');
        const atr = (fd.get('atr') || '').toString().trim() || null;
        
        console.log('Saving stock with betaVolatility:', betaVolatility, 'ATR:', atr);

    if (!ticker) return;

        const submitButton = stockForm.querySelector('button[type="submit"]');
        if (!submitButton) return;

        const stockId = stockForm.dataset.stockId; // Get stored stock ID if editing

        try {
            setStockButtonLoading(submitButton, true);
            
            if (stockId) {
                // Update existing stock
                await updateStockOnServer(stockId, {
                    ticker,
                    desc,
                    sp500Member: sp500_member,
                    betaVolatility: betaVolatility ? betaVolatility.toString() : null,
                    regularVolume: regularVolume ? regularVolume.toString() : null,
                    syncSp500: syncSp500 || null,
                    atr: atr
                });
            } else {
                // Create new stock
        await saveStockToServer({
            ticker,
            desc,
            sp500Member: sp500_member,
                    betaVolatility: betaVolatility ? betaVolatility.toString() : null,
                    regularVolume: regularVolume ? regularVolume.toString() : null,
                    syncSp500: syncSp500 || null,
                    atr: atr
                });
            }

            setStockButtonLoading(submitButton, false);
        stockModal.style.display = 'none';
        stockForm.reset();
            delete stockForm.dataset.stockId; // Clear stored ID
            
            // Clear ATR styling when form is reset
            const atrInput = stockForm.querySelector('input[name="atr"]');
            if (atrInput) {
                atrInput.classList.remove('atr-high-risk-readonly');
            }
            
            // Clear sync_sp500 field when form is reset
            const syncSp500Select = stockForm.querySelector('select[name="sync_sp500"]');
            if (syncSp500Select) {
                syncSp500Select.value = '';
            }
            
            // Reset modal title
            const modalTitle = document.getElementById('stockModalTitle');
            if (modalTitle) modalTitle.textContent = 'Add stock';

            // Reload stocks
        await loadStocks();
            await loadWarnings();
            window.dispatchEvent(new CustomEvent('stocksUpdated'));
            
            // Explicitly fetch weekly prices to ensure they are saved to MongoDB
            // This ensures data is persisted even if user didn't trigger beta calculation
            if (ticker && ticker.trim()) {
                try {
                    console.log(`Fetching weekly prices for ${ticker} to ensure MongoDB persistence`);
                    const priceRes = await fetch(`/api/prices/${encodeURIComponent(ticker.trim().toUpperCase())}`, {
                        headers: authHeaders()
                    });
                    if (priceRes.ok) {
                        console.log(`Successfully fetched weekly prices for ${ticker} - data should be in MongoDB`);
                    } else {
                        console.warn(`Failed to fetch weekly prices for ${ticker}:`, priceRes.status);
                    }
                } catch (err) {
                    console.error(`Error fetching weekly prices for ${ticker}:`, err);
                    // Don't show error to user - this is a background operation
                }
            }
    } catch (e) {
        console.error(e);
        alert('Не удалось сохранить акцию');
            setButtonLoading(submitButton, false);
    }
});
} else {
    console.error('stockForm not found in DOM');
}

// ====== Movement metrics in Add stock popup header ======

function updateStockMetricsHeader(ticker) {
    const headerContainer = document.getElementById('stockMetricsHeader');
    if (!headerContainer) return;

    headerContainer.innerHTML = '';

    ticker = (ticker || '').trim().toUpperCase();
    if (!ticker) return;

    if (typeof loadMovementMetrics !== 'function') {
        console.warn('Movement metrics function loadMovementMetrics is not available');
        return;
    }

    loadMovementMetrics(ticker)
        .then(metrics => {
            if (!metrics) return;

            // Direction (same logic as formatMovementMetrics)
            const direction = (metrics.direction === 1 || metrics.Direction === 1) ? '↑' :
                              (metrics.direction === -1 || metrics.Direction === -1) ? '↓' : '→';

            let arrowColor;
            if (direction === '↑') arrowColor = '#22c55e';
            else if (direction === '↓') arrowColor = '#ef4444';
            else arrowColor = '#f59e0b';

            // Mv (signed)
            const signed = (metrics.signedPct || metrics.SignedPct || 0);
            const signedDisplay = signed > 0 ? `+${signed.toFixed(2)}` : signed.toFixed(2);

            // Sp / St / E
            const speed = Math.round(metrics.speedPct || metrics.SpeedPct || 0);
            const strength = Math.round(metrics.strengthPct || metrics.StrengthPct || 0);
            const ease = Math.round(metrics.easeOfMovePct || metrics.EaseOfMovePct || 0);

            // Ret
            const returnPctValue = metrics.returnPct || metrics.ReturnPct || 0;
            const returnPct = (returnPctValue > 0 ? '+' : '') + returnPctValue.toFixed(2);

            // Color negative values red (same as formatMovementMetrics)
            const formatValue = (value) => {
                const valueStr = String(value);
                if (valueStr.startsWith('-') || parseFloat(valueStr) < 0) {
                    return `<span style="color: #ef4444;">${valueStr}</span>`;
                }
                return valueStr;
            };

            // Metric + tooltip (same style as in deals)
            const formatMetric = (label, value, tooltip) => {
                return `<span class="movement-metric-tooltip" data-tooltip="${tooltip}" style="cursor: help; position: relative; display: inline-block;">${label}</span>:<span class="movement-metric-tooltip" data-tooltip="${tooltip}" style="cursor: help; position: relative; display: inline-block;">${formatValue(value)}</span>%`;
            };

            const html = `
                <span class="movement-metrics-display" style="font-size: 11px; color: #64748b; margin-left: 8px; font-weight: normal;">
                    <span style="color: ${arrowColor}; font-weight: 900; font-size: 18px; text-shadow: 0.5px 0.5px 0.5px rgba(0,0,0,0.2);">${direction}</span>
                    | ${formatMetric('Mv', signedDisplay, 'This is a composite index of Speed, Strength and EaseOfMove.')}
                    | ${formatMetric('Sp', speed, 'Speed: Normalized speed percentage relative to historical maximum in this direction.')}
                    | ${formatMetric('St', strength, 'Strength: Normalized strength (|ΔP| * Volume) percentage relative to historical maximum.')}
                    | ${formatMetric('E', ease, 'Ease: Normalized ease of movement (move / volume) percentage relative to historical maximum.')}
                    | ${formatMetric('Ret', returnPct, 'Percentage change in price of the last bar')}
                </span>
            `;

            headerContainer.innerHTML = html;
        })
        .catch(err => {
            console.error('Error loading movement metrics for stock header in modal', ticker, err);
        });
}

function setupStockMetricsHeader() {
    if (!stockForm) return;

    const tickerInput = stockForm.querySelector('input[name="ticker"]');
    if (!tickerInput) return;

    let timeoutId = null;
    const triggerUpdate = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            updateStockMetricsHeader(tickerInput.value);
        }, 400);
    };

    tickerInput.addEventListener('input', triggerUpdate);
    tickerInput.addEventListener('change', triggerUpdate);
    tickerInput.addEventListener('blur', triggerUpdate);
}

if (stockForm) {
    setupStockMetricsHeader();
}

// ====== Рендер списка акций ======

function renderStocks() {
    stockList.innerHTML = '';

    if (!stocksLoaded) {
        if (emptyStockEl) {
            emptyStockEl.innerHTML = '<div class="loading-container"><span class="loading-spinner"></span><span>Загружаем акции...</span></div>';
            emptyStockEl.style.display = 'block';
        }
        // Update count to 0 while loading
        updateStockCount(0);
        return;
    }

    if (!stocks.length) {
        if (emptyStockEl) {
            emptyStockEl.textContent = 'Нет акций';
            emptyStockEl.style.display = 'block';
        }
        // Update count to 0
        updateStockCount(0);
        return;
    }
    if (emptyStockEl) emptyStockEl.style.display = 'none';

    const filter = (stockFilter || '').toLowerCase();
    let visible = stocks;

    if (filter) {
        visible = stocks.filter(s => {
            const ticker = (s.ticker || '').toLowerCase();
            const desc = (s.desc || '').toLowerCase();
            return ticker.includes(filter) || desc.includes(filter);
        });
    }

    if (!visible.length) {
        if (emptyStockEl) {
            emptyStockEl.textContent = 'Нет акций';
            emptyStockEl.style.display = 'block';
        }
        updateStockCount(0);
        return;
    }

    visible.forEach(s => {
        const stockRow = createStockRow(s);
        stockList.appendChild(stockRow);
    });
    
    // Update count with warning logic (for visible items)
    updateStockCount(visible.length);
}

// Function to update stock count and add warning icons
function updateStockCount(count) {
    const stockCountEl = document.getElementById('stockCount');
    if (!stockCountEl) return;
    
    stockCountEl.textContent = count;
    
    // Find the container div that holds the count
    const countContainer = stockCountEl.parentElement;
    if (!countContainer) return;
    
    // Remove existing warning icon if any
    const existingWarning = countContainer.querySelector('.count-warning-icon');
    if (existingWarning) {
        existingWarning.remove();
    }
    
    // Add warning icon if count exceeds thresholds
    // Yellow for > 15, Red for > 20 (different from deals which use > 10 and > 15)
    if (count > 20) {
        // Red warning for count > 20
        const warningIcon = document.createElement('span');
        warningIcon.className = 'count-warning-icon count-warning-red';
        warningIcon.setAttribute('data-tooltip', `High number of stocks: ${count}. Consider removing some stocks.`);
        warningIcon.textContent = '!';
        countContainer.appendChild(warningIcon);
    } else if (count > 15) {
        // Yellow warning for count > 15
        const warningIcon = document.createElement('span');
        warningIcon.className = 'count-warning-icon count-warning-yellow';
        warningIcon.setAttribute('data-tooltip', `Many stocks: ${count}. Monitor your portfolio carefully.`);
        warningIcon.textContent = '!';
        countContainer.appendChild(warningIcon);
    }
}

// Add new function to create expandable stock row
function createStockRow(stock) {
    const stockId = stock.id || 'new';
    const isExpanded = expandedStockId === stockId;
    
    const row = document.createElement('div');
    row.className = `deal-row ${isExpanded ? 'expanded' : ''}`;
    row.dataset.stockId = stockId;
    row.draggable = true;

    // Collapsed summary view
    const summary = document.createElement('div');
    summary.className = 'deal-summary';
    
    // Check if stock has warnings - prefer StockId, fallback to ticker
    const warning = (stock.id && getWarningByStockId(stock.id)) || getWarningByTicker(stock.ticker);
    const hasVolumeWarning = warning && warning.regular_share_volume;
    const hasSp500Warning = warning && warning.sp500_member;
    const hasAtrWarning = warning && warning.atr_high_risk;
    const hasSyncSp500Warning = warning && warning.sync_sp500_no;
    const hasBetaVolatilityWarning = warning && warning.beta_volatility_high;
    
    // Also check stock's fields as fallback
    const regularVolume = stock.regular_volume || stock.RegularVolume;
    const hasVolumeWarningFallback = hasVolumeWarning || (regularVolume === '1' || regularVolume === 1);
    const hasSp500WarningFallback = hasSp500Warning || (!stock.sp500Member && !stock.Sp500Member);
    const hasAtrWarningFallback = hasAtrWarning || isAtrHighRiskFromString(stock.atr || stock.Atr);
    const hasSyncSp500WarningFallback = hasSyncSp500Warning || (stock.sync_sp500 === 'no' || stock.SyncSp500 === 'no');
    const hasBetaVolatilityWarningFallback = hasBetaVolatilityWarning || 
        (stock.betaVolatility === '3' || stock.BetaVolatility === '3' || stock.betaVolatility === 3);
    
    // Add warning icons if needed
    const volumeWarningIcon = hasVolumeWarningFallback 
        ? `<span class="volume-warning-icon" data-tooltip="Regular share volume: Small (around 50M per week)">!</span>`
        : '';
        
    const sp500WarningIcon = hasSp500WarningFallback
        ? `<span class="volume-warning-icon" data-tooltip="S&amp;P 500 member: Not a member">!</span>`
        : '';

    const atrWarningIcon = hasAtrWarningFallback
        ? `<span class="volume-warning-icon" data-tooltip="ATR (Average True Range): High risk (more than 10%)">!</span>`
        : '';

    const syncSp500WarningIcon = hasSyncSp500WarningFallback
        ? `<span class="volume-warning-icon" data-tooltip="Is share movement synchronized with S&amp;P500?: No">!</span>`
        : '';

    const betaVolatilityWarningIcon = hasBetaVolatilityWarningFallback
        ? `<span class="volume-warning-icon" data-tooltip="Share beta volatility: High (more volatile)">!</span>`
        : '';
    
    summary.innerHTML = `
        <div class="meta">
            <div class="deal-title-row">
                <div class="stock-name">
                    <strong>${stock.ticker}${volumeWarningIcon}${sp500WarningIcon}${atrWarningIcon}${syncSp500WarningIcon}${betaVolatilityWarningIcon}</strong>
                </div>
                <div class="movement-metrics-container"></div>
            </div>
            <div class="small">${stock.desc || ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
            <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
            <span class="delete-icon">×</span>
        </div>
    `;

    // Add movement metrics (↑ | Mv:% | Ret:%) to stock header, reusing deals logic
    const metricsContainer = summary.querySelector('.movement-metrics-container');
    if (metricsContainer && stock.ticker && typeof loadMovementMetrics === 'function' && typeof formatMovementMetrics === 'function') {
        metricsContainer.innerHTML = '';
        loadMovementMetrics(stock.ticker).then(metrics => {
            if (!metrics) return;
            const formatted = formatMovementMetrics(metrics);
            metricsContainer.innerHTML = formatted;
        }).catch(err => {
            console.error('Error loading movement metrics for stock header', stock.ticker, err);
        });
    }

    // Expanded details view
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'deal-form-container';
    detailsContainer.style.display = isExpanded ? 'block' : 'none';
    detailsContainer.innerHTML = createStockDetailsHTML(stock);

    row.appendChild(summary);
    row.appendChild(detailsContainer);

    // Setup event handlers
    setupStockRowHandlers(row, stock);

    // Drag & drop handlers for reordering stocks
    row.addEventListener('dragstart', (e) => {
        draggedStockId = stockId;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
        draggedStockId = null;
        row.classList.remove('dragging');
    });

    row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedStockId || draggedStockId === stockId) return;
        e.dataTransfer.dropEffect = 'move';
    });

    row.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!draggedStockId || draggedStockId === stockId) return;

        const fromIndex = stocks.findIndex(s => s.id === draggedStockId);
        const toIndex = stocks.findIndex(s => s.id === stockId);
        if (fromIndex === -1 || toIndex === -1) return;

        const [moved] = stocks.splice(fromIndex, 1);
        stocks.splice(toIndex, 0, moved);

        // Re-render list in new order
        renderStocks();

        // Persist order to server
        try {
            const orderedIds = stocks.map(s => s.id);
            await fetch('/api/stocks/reorder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders()
                },
                body: JSON.stringify(orderedIds)
            });
        } catch (err) {
            console.error('Failed to save stock order', err);
        }
    });

    return row;
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

// Helper function to check if ATR is high risk (> 10%) from stock object
function isAtrHighRisk(stock) {
    const atr = stock.atr || stock.Atr || '';
    if (!atr) return false;

    // First check warning from cache - prefer StockId, fallback to ticker
    const warning = (stock.id && getWarningByStockId(stock.id)) || getWarningByTicker(stock.ticker);
    if (warning && warning.atr_high_risk) {
        return true;
    }

    // Fallback: parse ATR string
    return isAtrHighRiskFromString(atr);
}

// Add new function to create stock details HTML (read-only view)
function createStockDetailsHTML(stock) {
    const getBetaVolatilityText = (val) => {
        if (val === true || val === '1' || val === 1) return 'Slow';
        if (val === '2' || val === 2) return 'Same (around market)';
        if (val === '3' || val === 3) return 'High (more volatile)';
        return '-';
    };

    const getRegularVolumeText = (val) => {
        if (val === '1' || val === 1) return 'Small (< around 50M per week)';
        if (val === '2' || val === 2) return 'Average (< around 100M per week)';
        if (val === '3' || val === 3) return 'Big (around 200M per week)';
        return '-';
    };

    const getRegularVolumeClass = (val) => {
        if (val === '1' || val === 1) return 'volume-50m-readonly';
        if (val === '2' || val === 2) return 'volume-100m-readonly';
        if (val === '3' || val === 3) return 'volume-200m-readonly';
        return '';
    };

    const getSyncSp500Text = (val) => {
        if (val === 'yes') return 'Yes';
        if (val === 'no') return 'No';
        return '-';
    };

    const regularVolume = stock.regular_volume || stock.RegularVolume;
    const volumeClass = getRegularVolumeClass(regularVolume);
    const atrValue = stock.atr || stock.Atr || '-';
    const isAtrHighRiskValue = isAtrHighRisk(stock);
    const atrClass = isAtrHighRiskValue ? 'atr-high-risk-readonly' : '';
    const syncSp500Value = stock.sync_sp500 || stock.SyncSp500 || '';
    const syncSp500Class = (syncSp500Value === 'no') ? 'sync-sp500-no-readonly' : '';
    const betaVolatilityValue = stock.betaVolatility || stock.BetaVolatility || '';
    const betaVolatilityClass = (betaVolatilityValue === '3' || betaVolatilityValue === 3) 
        ? 'beta-volatility-high-readonly' : '';

    return `
        <div class="deal-form-inline stock-details-form">
            <div class="form-grid stock-details-grid">
                <label>
                    Ticker
                    <input type="text" value="${escapeHtml(stock.ticker || '')}" readonly style="background: #f6f8fb; cursor: default;" />
                </label>

                <label>
                    Share beta volatility
                    <input type="text" value="${getBetaVolatilityText(betaVolatilityValue)}" readonly class="${betaVolatilityClass}" style="background: #f6f8fb; cursor: default;" />
                </label>

                <label>
                    Regular share volume
                    <input type="text" value="${getRegularVolumeText(regularVolume)}" readonly class="${volumeClass}" style="background: #f6f8fb; cursor: default;" />
                </label>

                <label>
                    ATR (Average True Range)
                    <input type="text" value="${escapeHtml(atrValue)}" readonly class="${atrClass}" style="background: #f6f8fb; cursor: default;" />
                </label>

                <label>
                    Synchronized with S&P500
                    <input type="text" value="${getSyncSp500Text(syncSp500Value)}" readonly class="${syncSp500Class}" style="background: #f6f8fb; cursor: default;" />
                </label>

                <label class="inline-checkbox">
                    <input type="checkbox" ${stock.sp500Member || stock.Sp500Member ? 'checked' : ''} disabled style="cursor: default;" />
                    <span class="${!stock.sp500Member && !stock.Sp500Member ? 'sp500-not-member' : ''}">S&P 500 member</span>
                </label>

                <label>
                    Description
                    <textarea readonly style="background: #f6f8fb; cursor: default; min-height: 90px;">${escapeHtml(stock.desc || '')}</textarea>
                </label>

                <div class="form-actions" style="margin-top: 12px;">
                    <button type="button" class="edit-stock-btn">Edit stock</button>
                </div>
            </div>
        </div>
    `;
}

// Add new function to setup stock row handlers
function setupStockRowHandlers(row, stock) {
    const stockId = stock.id || 'new';
    const summary = row.querySelector('.deal-summary');
    const detailsContainer = row.querySelector('.deal-form-container');
    const expandIcon = summary.querySelector('.expand-icon');
    const deleteIcon = summary.querySelector('.delete-icon');
    const editBtn = detailsContainer.querySelector('.edit-stock-btn');

    // Toggle expand/collapse on summary click (but not on delete icon)
    summary.addEventListener('click', (e) => {
        // Don't toggle if clicking on delete icon
        if (e.target.closest('.delete-icon')) return;
        
        const isExpanded = row.classList.contains('expanded');
        if (isExpanded) {
            row.classList.remove('expanded');
            detailsContainer.style.display = 'none';
            expandedStockId = null;
            if (expandIcon) expandIcon.textContent = '▶';
        } else {
            // Collapse any other expanded row
            if (expandedStockId && expandedStockId !== stockId) {
                const otherRow = document.querySelector(`[data-stock-id="${expandedStockId}"]`);
                if (otherRow) {
                    otherRow.classList.remove('expanded');
                    otherRow.querySelector('.deal-form-container').style.display = 'none';
                    const otherIcon = otherRow.querySelector('.expand-icon');
                    if (otherIcon) otherIcon.textContent = '▶';
                }
            }
            row.classList.add('expanded');
            detailsContainer.style.display = 'block';
            expandedStockId = stockId;
            if (expandIcon) expandIcon.textContent = '▼';
        }
    });

    // Delete stock handler
    deleteIcon.addEventListener('click', async (e) => {
        e.stopPropagation();
            if (!confirm('Удалить акцию?')) return;

            try {
            await deleteStockOnServer(stock.id);
            await loadStocks();
            } catch (e) {
                console.error(e);
                alert('Не удалось удалить акцию');
            }
        });

    // Edit stock handler
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            // Open modal with stock data pre-filled
            if (stockModal && stockForm) {
                stockModal.style.display = 'flex';
                
                // Populate form with stock data
                stockForm.querySelector('input[name="ticker"]').value = stock.ticker || '';
                stockForm.querySelector('textarea[name="desc"]').value = stock.desc || '';
                stockForm.querySelector('input[name="sp500_member"]').checked = stock.sp500Member || stock.Sp500Member || false;
                const betaVolatilitySelect = stockForm.querySelector('select[name="betaVolatility"]');
                const betaVolatilityValue = stock.betaVolatility || stock.BetaVolatility || '';
                if (betaVolatilitySelect) {
                    betaVolatilitySelect.value = betaVolatilityValue;
                    // Update betaVolatility styling based on value
                    updateBetaVolatilityStyling(betaVolatilitySelect, betaVolatilityValue);
                }
                stockForm.querySelector('select[name="regular_volume"]').value = stock.regular_volume || stock.RegularVolume || '';
                const syncSp500Select = stockForm.querySelector('select[name="sync_sp500"]');
                const syncSp500Value = stock.sync_sp500 || stock.SyncSp500 || '';
                if (syncSp500Select) {
                    syncSp500Select.value = syncSp500Value;
                    // Update sync_sp500 styling based on value
                    updateSyncSp500Styling(syncSp500Select, syncSp500Value);
                }
                const atrInput = stockForm.querySelector('input[name="atr"]');
                const atrValue = stock.atr || stock.Atr || '';
                if (atrInput) {
                    atrInput.value = atrValue;
                    // Update ATR styling based on value
                    updateAtrStyling(atrInput, atrValue);
                }
                
                // Update modal title
                const modalTitle = document.getElementById('stockModalTitle');
                if (modalTitle) modalTitle.textContent = 'Edit stock';
                
                // Store stock ID for update
                stockForm.dataset.stockId = stock.id;
                
                // Update regular volume border
                if (typeof updateRegularVolumeBorder === 'function') {
                    updateRegularVolumeBorder();
                }
            }
        });
    }
}

// Add escapeHtml helper function if not already present
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ====== Auto-calculate regular_volume ======

// Function to set/clear error message for ticker
function setTickerError(message) {
    const tickerLabel = stockForm.querySelector('label:has(input[name="ticker"])');
    if (!tickerLabel) {
        // Fallback: find label by checking if it contains the ticker input
        const labels = stockForm.querySelectorAll('label');
        for (const label of labels) {
            if (label.querySelector('input[name="ticker"]')) {
                const tickerLabel = label;
                let errorEl = tickerLabel.querySelector('.ticker-error');
                if (!errorEl && message) {
                    errorEl = document.createElement('div');
                    errorEl.className = 'ticker-error error-text';
                    errorEl.style.marginTop = '4px';
                    tickerLabel.appendChild(errorEl);
                }
                if (errorEl) {
                    errorEl.textContent = message || '';
                    errorEl.style.display = message ? 'block' : 'none';
                }
                return;
            }
        }
        return;
    }
    
    let errorEl = tickerLabel.querySelector('.ticker-error');
    if (!errorEl && message) {
        errorEl = document.createElement('div');
        errorEl.className = 'ticker-error error-text';
        errorEl.style.marginTop = '4px';
        tickerLabel.appendChild(errorEl);
    }
    if (errorEl) {
        errorEl.textContent = message || '';
        errorEl.style.display = message ? 'block' : 'none';
    }
}

// Function to update regular volume border color based on selected value
function updateRegularVolumeBorder() {
    const regularVolumeSelect = stockForm.querySelector('select[name="regular_volume"]');
    if (!regularVolumeSelect) return;
    
    // Remove all volume classes
    regularVolumeSelect.classList.remove('volume-50m', 'volume-100m', 'volume-200m');
    
    const value = regularVolumeSelect.value;
    if (value === '1') {
        regularVolumeSelect.classList.add('volume-50m'); // Red
    } else if (value === '2') {
        regularVolumeSelect.classList.add('volume-100m'); // Yellow
    } else if (value === '3') {
        regularVolumeSelect.classList.add('volume-200m'); // Green
    }
}

// Function to update ATR input styling based on value
function updateAtrStyling(atrInput, atrValue) {
    if (!atrInput) return;
    
    // Remove high risk styling first
    atrInput.classList.remove('atr-high-risk-readonly');
    
    if (!atrValue || !atrValue.trim()) {
        return;
    }
    
    // Check if ATR percentage > 10% and apply red styling
    const match = atrValue.match(/\(([\d.]+)%\)/);
    if (match && match[1]) {
        const percent = parseFloat(match[1]);
        if (!isNaN(percent) && percent > 10.0) {
            atrInput.classList.add('atr-high-risk-readonly');
        }
    }
}

// Function to update sync_sp500 select styling based on value
function updateSyncSp500Styling(syncSp500Select, syncSp500Value) {
    if (!syncSp500Select) return;
    
    // Remove high risk styling first
    syncSp500Select.classList.remove('sync-sp500-no-readonly');
    
    if (syncSp500Value === 'no') {
        syncSp500Select.classList.add('sync-sp500-no-readonly');
    }
}

// Function to update betaVolatility select styling based on value
function updateBetaVolatilityStyling(betaVolatilitySelect, betaVolatilityValue) {
    if (!betaVolatilitySelect) return;
    
    // Remove high risk styling first
    betaVolatilitySelect.classList.remove('beta-volatility-high-readonly');
    
    if (betaVolatilityValue === '3' || betaVolatilityValue === 3) {
        betaVolatilitySelect.classList.add('beta-volatility-high-readonly');
    }
}

// Function to calculate and set ATR value
async function calculateAndSetAtr(ticker) {
    if (!ticker || !ticker.trim()) {
        const atrInput = stockForm.querySelector('input[name="atr"]');
        if (atrInput) {
            atrInput.value = '';
            // Remove high risk styling when clearing
            atrInput.classList.remove('atr-high-risk-readonly');
        }
        return;
    }

    const atrInput = stockForm.querySelector('input[name="atr"]');
    if (!atrInput) return;

    try {
        const res = await fetch(`/api/prices/${encodeURIComponent(ticker.trim().toUpperCase())}/atr?period=14`, {
            headers: authHeaders()
        });

        if (res.ok) {
            const data = await res.json();
            // Format ATR: show value and percentage
            const atrValue = data.atr || '';
            const atrPercent = data.atrPercent || '';
            
            if (atrValue && atrPercent) {
                const atrString = `${atrValue} (${atrPercent}%)`;
                atrInput.value = atrString;
                
                // Update styling based on value
                updateAtrStyling(atrInput, atrString);
            } else if (atrValue) {
                atrInput.value = atrValue;
                updateAtrStyling(atrInput, atrValue);
            } else {
                atrInput.value = '';
                updateAtrStyling(atrInput, '');
            }
            console.log(`Auto-calculated ATR for ${ticker}: ${atrInput.value}`);
        } else {
            // Clear ATR if calculation fails
            atrInput.value = '';
            updateAtrStyling(atrInput, '');
            console.warn('Failed to get ATR data', res.status);
        }
    } catch (err) {
        console.error('Error calculating ATR', err);
        atrInput.value = '';
        updateAtrStyling(atrInput, '');
    }
}

// Function to calculate Beta and auto-set both betaVolatility and sync_sp500 fields (optimized - single API call)
async function calculateAndSetBetaFields(ticker) {
    if (!ticker || !ticker.trim()) {
        const betaVolatilitySelect = stockForm.querySelector('select[name="betaVolatility"]');
        const syncSp500Select = stockForm.querySelector('select[name="sync_sp500"]');
        if (betaVolatilitySelect) {
            betaVolatilitySelect.value = '';
            updateBetaVolatilityStyling(betaVolatilitySelect, '');
        }
        if (syncSp500Select) {
            syncSp500Select.value = '';
            updateSyncSp500Styling(syncSp500Select, '');
        }
        return;
    }

    const betaVolatilitySelect = stockForm.querySelector('select[name="betaVolatility"]');
    const syncSp500Select = stockForm.querySelector('select[name="sync_sp500"]');
    if (!betaVolatilitySelect || !syncSp500Select) return;

    try {
        const res = await fetch(`/api/prices/${encodeURIComponent(ticker.trim().toUpperCase())}/beta`, {
            headers: authHeaders()
        });

        if (res.ok) {
            const data = await res.json();
            const beta = data.beta;
            const correlation = data.correlation;
            const volatilityCategory = data.volatilityCategory;
            
            // Set betaVolatility field based on volatility category
            if (volatilityCategory !== null && volatilityCategory !== undefined && 
                !isNaN(volatilityCategory) && volatilityCategory > 0 && volatilityCategory <= 3) {
                betaVolatilitySelect.value = volatilityCategory.toString();
                // Apply styling after setting value
                updateBetaVolatilityStyling(betaVolatilitySelect, betaVolatilitySelect.value);
                console.log(`Auto-set betaVolatility for ${ticker}: ${betaVolatilitySelect.value} (beta: ${beta.toFixed(4)})`);
            } else {
                betaVolatilitySelect.value = '';
                updateBetaVolatilityStyling(betaVolatilitySelect, '');
                console.warn(`Invalid volatility category for ${ticker}:`, volatilityCategory);
            }
            
            // Set sync_sp500 field based on correlation
            // Correlation threshold: >= 0.7 means strong synchronization with S&P500
            if (correlation !== null && correlation !== undefined && !isNaN(correlation)) {
                if (correlation >= 0.7) {
                    syncSp500Select.value = 'yes';
                } else {
                    syncSp500Select.value = 'no';
                }
                // Apply styling after setting value
                updateSyncSp500Styling(syncSp500Select, syncSp500Select.value);
                console.log(`Auto-set sync_sp500 for ${ticker}: ${syncSp500Select.value} (correlation: ${correlation.toFixed(4)})`);
            } else {
                syncSp500Select.value = '';
                updateSyncSp500Styling(syncSp500Select, '');
                console.warn(`Invalid correlation value for ${ticker}:`, correlation);
            }
        } else if (res.status === 503) {
            // SPY data not available
            console.warn('SPY benchmark data not available for Beta calculation');
            betaVolatilitySelect.value = '';
            updateBetaVolatilityStyling(betaVolatilitySelect, '');
            syncSp500Select.value = '';
            updateSyncSp500Styling(syncSp500Select, '');
        } else if (res.status === 404) {
            // No weekly data found for ticker
            console.warn(`No weekly data found for ${ticker}`);
            betaVolatilitySelect.value = '';
            updateBetaVolatilityStyling(betaVolatilitySelect, '');
            syncSp500Select.value = '';
            updateSyncSp500Styling(syncSp500Select, '');
        } else {
            // Other API errors - try to get error message from response
            let errorMessage = `Failed to get Beta data (${res.status})`;
            try {
                const errorText = await res.text();
                if (errorText) {
                    // Try to parse as JSON first
                    try {
                        const errorData = JSON.parse(errorText);
                        errorMessage = errorData.message || errorData.error || errorData.title || errorText;
                    } catch {
                        // If not JSON, use the text directly
                        errorMessage = errorText;
                    }
                }
            } catch (e) {
                // If reading response fails, use default message
                console.warn('Could not read error response:', e);
            }
            console.warn('Failed to get Beta data:', errorMessage);
            betaVolatilitySelect.value = '';
            updateBetaVolatilityStyling(betaVolatilitySelect, '');
            syncSp500Select.value = '';
            updateSyncSp500Styling(syncSp500Select, '');
        }
    } catch (err) {
        console.error('Error calculating Beta/Correlation', err);
        betaVolatilitySelect.value = '';
        updateBetaVolatilityStyling(betaVolatilitySelect, '');
        syncSp500Select.value = '';
        updateSyncSp500Styling(syncSp500Select, '');
    }
}

// Function to calculate average weekly volume and auto-select regular_volume
async function calculateAndSetRegularVolume(ticker) {
    if (!ticker || !ticker.trim()) {
        setTickerError('');
        return;
    }

    const regularVolumeSelect = stockForm.querySelector('select[name="regular_volume"]');
    if (!regularVolumeSelect) return;

    // Clear previous error
    setTickerError('');

    try {
        const res = await fetch(`/api/prices/${encodeURIComponent(ticker.trim().toUpperCase())}/average-volume`, {
            headers: authHeaders()
        });

        if (res.ok) {
            const data = await res.json();
            const volumeCategory = data.volumeCategory; // 1, 2, or 3
            
            // Auto-select the appropriate option
            regularVolumeSelect.value = volumeCategory.toString();
            
            // Update border color
            updateRegularVolumeBorder();
            
            console.log(`Auto-selected regular_volume=${volumeCategory} for ${ticker} (${data.averageVolumeInDollarsFormatted} per week)`);
            setTickerError(''); // Clear any previous errors
        } else if (res.status === 404) {
            // Ticker not found
            setTickerError('Ticker not found. Please check the ticker symbol and try again.');
            regularVolumeSelect.value = ''; // Clear the selection
            updateRegularVolumeBorder(); // Update border (will remove all classes)
        } else {
            // Other API errors
            setTickerError('Failed to get volume data. Please try again later.');
            console.warn('Failed to get average weekly volume', res.status);
            regularVolumeSelect.value = ''; // Clear the selection
            updateRegularVolumeBorder(); // Update border (will remove all classes)
        }
    } catch (err) {
        console.error('Error calculating average weekly volume', err);
        setTickerError('Error connecting to server. Please check your connection and try again.');
        regularVolumeSelect.value = ''; // Clear the selection
        updateRegularVolumeBorder(); // Update border (will remove all classes)
    }
}

// Add event listener to ticker input field - calculate volume when ticker loses focus
const tickerInput = stockForm.querySelector('input[name="ticker"]');
if (tickerInput) {
    let previousTicker = '';
    
    tickerInput.addEventListener('blur', async (e) => {
        const ticker = e.target.value.trim();
        // Always recalculate if ticker has a value and it's different from previous
        if (ticker && ticker !== previousTicker) {
            // Calculate regular volume, ATR, and Beta fields in parallel
            await Promise.all([
                calculateAndSetRegularVolume(ticker),
                calculateAndSetAtr(ticker),
                calculateAndSetBetaFields(ticker)
            ]);
            previousTicker = ticker; // Update previous value
        } else if (!ticker) {
            // Clear error if ticker is empty
            setTickerError('');
            const regularVolumeSelect = stockForm.querySelector('select[name="regular_volume"]');
            if (regularVolumeSelect) {
                regularVolumeSelect.value = '';
                updateRegularVolumeBorder(); // Update border
            }
            const atrInput = stockForm.querySelector('input[name="atr"]');
            if (atrInput) {
                atrInput.value = '';
                // Remove high risk styling when clearing
                atrInput.classList.remove('atr-high-risk-readonly');
            }
            // Clear betaVolatility and sync_sp500 fields
            const betaVolatilitySelect = stockForm.querySelector('select[name="betaVolatility"]');
            if (betaVolatilitySelect) {
                betaVolatilitySelect.value = '';
            }
            const syncSp500Select = stockForm.querySelector('select[name="sync_sp500"]');
            if (syncSp500Select) {
                syncSp500Select.value = '';
                updateSyncSp500Styling(syncSp500Select, '');
            }
            previousTicker = ''; // Reset previous ticker
        }
    });
    
    // Clear error when user starts typing
    tickerInput.addEventListener('input', () => {
        setTickerError('');
    });
}

// Setup event listener for regular_volume select to update border color on change
const regularVolumeSelect = stockForm.querySelector('select[name="regular_volume"]');
if (regularVolumeSelect) {
    regularVolumeSelect.addEventListener('change', updateRegularVolumeBorder);
    
    // Update initial state if value is already set
    updateRegularVolumeBorder();
}

// Setup event listener for sync_sp500 select to update styling on change
const syncSp500Select = stockForm.querySelector('select[name="sync_sp500"]');
if (syncSp500Select) {
    syncSp500Select.addEventListener('change', () => {
        updateSyncSp500Styling(syncSp500Select, syncSp500Select.value);
    });
    
    // Update initial state if value is already set
    updateSyncSp500Styling(syncSp500Select, syncSp500Select.value);
}

// Setup event listener for betaVolatility select to update styling on change
const betaVolatilitySelect = stockForm.querySelector('select[name="betaVolatility"]');
if (betaVolatilitySelect) {
    betaVolatilitySelect.addEventListener('change', () => {
        updateBetaVolatilityStyling(betaVolatilitySelect, betaVolatilitySelect.value);
    });
    
    // Update initial state if value is already set
    updateBetaVolatilityStyling(betaVolatilitySelect, betaVolatilitySelect.value);
}

// ====== Старт ======
loadStocks();

if (stockFilterInput) {
    stockFilterInput.addEventListener('input', () => {
        stockFilter = stockFilterInput.value || '';
        renderStocks();
    });
}
