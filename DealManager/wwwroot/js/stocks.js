// stocks.js

const addStockBtn = document.getElementById('addStockBtn');
const stockModal = document.getElementById('stockModal');
const closeStockModalBtn = document.getElementById('closeStockModal');
const stockForm = document.getElementById('stockForm');
const stockList = document.getElementById('stockList');
const emptyStockEl = document.getElementById('emptyStock');

let stocks = [];
let stocksLoaded = false;
let expandedStockId = null; // Track which stock is currently expanded
// warningsCache is declared in deals-inline.js - use that shared cache

// локальный вариант authHeaders (такой же, как в deals.js)
function authHeaders() {
    const t = localStorage.getItem('token');
    return t ? { Authorization: 'Bearer ' + t } : {};
}

// ====== API ======

// Function to load warnings from server
async function loadWarnings() {
    try {
        const res = await fetch('/api/stocks/warnings', {
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
        const res = await fetch('/api/stocks', {
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
    const res = await fetch('/api/stocks', {
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
    const res = await fetch(`/api/stocks/${id}`, {
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

function setButtonLoading(button, isLoading) {
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

// Check if button exists before adding event listener
if (addStockBtn && stockModal) {
    console.log('Setting up addStockBtn event listener');
    addStockBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Add stock button clicked');
        stockModal.style.display = 'flex';
    });
    
    // Also try mousedown as fallback
    addStockBtn.addEventListener('mousedown', (e) => {
        console.log('Add stock button mousedown');
    });
} else {
    console.error('addStockBtn or stockModal not found in DOM', {
        addStockBtn: !!addStockBtn,
        stockModal: !!stockModal,
        addStockBtnElement: addStockBtn,
        stockModalElement: stockModal
    });
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
        // Only call setTickerError if it exists (it's defined later)
        if (typeof setTickerError === 'function') {
            setTickerError(''); // Clear error when closing
        }
    });
} else {
    console.error('closeStockModalBtn not found in DOM');
}

if (stockForm) {
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
            setButtonLoading(submitButton, true);
            
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

            setButtonLoading(submitButton, false);
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
        } catch (e) {
            console.error(e);
            alert('Не удалось сохранить акцию');
            setButtonLoading(submitButton, false);
        }
    });
} else {
    console.error('stockForm not found in DOM');
}

// ====== Рендер списка акций ======

function renderStocks() {
    stockList.innerHTML = '';

    if (!stocksLoaded) {
        if (emptyStockEl) {
            emptyStockEl.innerHTML = '<div class="loading-container"><span class="loading-spinner"></span><span>Загружаем акции...</span></div>';
            emptyStockEl.style.display = 'block';
        }
        return;
    }

    if (!stocks.length) {
        if (emptyStockEl) {
            emptyStockEl.textContent = 'Нет акций';
            emptyStockEl.style.display = 'block';
        }
        return;
    }
    if (emptyStockEl) emptyStockEl.style.display = 'none';

    stocks.forEach(s => {
        const stockRow = createStockRow(s);
        stockList.appendChild(stockRow);
    });
}

// Add new function to create expandable stock row
function createStockRow(stock) {
    const stockId = stock.id || 'new';
    const isExpanded = expandedStockId === stockId;
    
    const row = document.createElement('div');
    row.className = `deal-row ${isExpanded ? 'expanded' : ''}`;
    row.dataset.stockId = stockId;

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
            <strong>${stock.ticker}${volumeWarningIcon}${sp500WarningIcon}${atrWarningIcon}${syncSp500WarningIcon}${betaVolatilityWarningIcon}</strong>
            <div class="small">${stock.desc || ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
            <span class="expand-icon">${isExpanded ? '▼' : '▶'}</span>
            <span class="delete-icon">×</span>
        </div>
    `;

    // Expanded details view
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'deal-form-container';
    detailsContainer.style.display = isExpanded ? 'block' : 'none';
    detailsContainer.innerHTML = createStockDetailsHTML(stock);

    row.appendChild(summary);
    row.appendChild(detailsContainer);

    // Setup event handlers
    setupStockRowHandlers(row, stock);

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
            // Other API errors
            console.warn('Failed to get Beta data', res.status);
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
            // Calculate regular volume, ATR, and Beta fields (volatility + sync_sp500) in parallel
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
// Ensure button is clickable on page load
if (addStockBtn) {
    // Remove any disabled attribute
    addStockBtn.removeAttribute('disabled');
    // Ensure it's visible and clickable
    addStockBtn.style.pointerEvents = 'auto';
    addStockBtn.style.cursor = 'pointer';
    addStockBtn.style.zIndex = '10';
    addStockBtn.style.position = 'relative';
    console.log('addStockBtn initialized:', addStockBtn);
}

loadStocks();
