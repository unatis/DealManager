// stocks.js

const addStockBtn = document.getElementById('addStockBtn');
const stockModal = document.getElementById('stockModal');
const closeStockModalBtn = document.getElementById('closeStockModal');
const stockForm = document.getElementById('stockForm');
const stockList = document.getElementById('stockList');
const emptyStockEl = document.getElementById('emptyStock');

let stocks = [];
let stocksLoaded = false;
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
    const betaVolatility = fd.get('betaVolatility');
    const regularVolume = fd.get('regular_volume');

    if (!ticker) return;

    const submitButton = stockForm.querySelector('button[type="submit"]');
    if (!submitButton) return;

    try {
        setButtonLoading(submitButton, true);
        
        await saveStockToServer({
            ticker,
            desc,
            sp500Member: sp500_member,
            betaVolatility,
            regularVolume: regularVolume ? regularVolume.toString() : null
        });

        setButtonLoading(submitButton, false);
        stockModal.style.display = 'none';
        stockForm.reset();

        // перезагружаем список + селект сделок
        await loadStocks();
        
        // Reload warnings after saving stock
        await loadWarnings();
        
        // Trigger a custom event to reload stocks cache in deals-inline.js
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
        // Check if stock has warning
        const warning = getWarningByTicker(s.ticker);
        const hasWarning = warning && warning.regular_share_volume;
        
        // Also check stock's regular_volume as fallback
        const regularVolume = s.regular_volume || s.RegularVolume;
        const hasVolumeWarning = hasWarning || (regularVolume === '1' || regularVolume === 1);
        
        // Add warning icon if needed
        const warningIcon = hasVolumeWarning 
            ? `<span class="volume-warning-icon" data-tooltip="Regular share volume: <span style='color: #dc2626; font-weight: 600;'>Small (around 50M per week)</span>">!</span>`
            : '';
        
        const el = document.createElement('div');
        el.className = 'deal-item';
        el.innerHTML = `
            <div class="meta">
                <strong>${s.ticker}${warningIcon}</strong>
                <div class="small">${s.desc || ''}</div>
            </div>
            <div style="display:flex;align-items:center">
                <span class="delete-icon">×</span>
            </div>
        `;

        // клик по акции в левой панели – подставляем тикер в селект сделки (если модалка открыта)
        el.querySelector('.meta').addEventListener('click', () => {
            const select = document.getElementById('dealStockSelect');
            if (select && !select.disabled) {
                select.value = s.ticker;
            }
        });

        // удаление акции
        el.querySelector('.delete-icon').addEventListener('click', async evt => {
            evt.stopPropagation();
            if (!confirm('Удалить акцию?')) return;

            try {
                await deleteStockOnServer(s.id);
                await loadStocks(); // снова обновим и список, и селект
            } catch (e) {
                console.error(e);
                alert('Не удалось удалить акцию');
            }
        });

        stockList.appendChild(el);
    });
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
            await calculateAndSetRegularVolume(ticker);
            previousTicker = ticker; // Update previous value
        } else if (!ticker) {
            // Clear error if ticker is empty
            setTickerError('');
            const regularVolumeSelect = stockForm.querySelector('select[name="regular_volume"]');
            if (regularVolumeSelect) {
                regularVolumeSelect.value = '';
                updateRegularVolumeBorder(); // Update border
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
