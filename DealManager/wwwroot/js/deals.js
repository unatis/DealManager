// deals.js

let deals = [];
let dealsLoaded = false;

// ---------- элементы DOM ----------
const elements = {
    newDealBtn: document.getElementById('newDealBtn'),
    modal: document.getElementById('modal'),
    closeModal: document.getElementById('closeModal'),
    dealForm: document.getElementById('dealForm'),
    openList: document.getElementById('openList'),
    closedList: document.getElementById('closedList'),
    filterInput: document.getElementById('filterInput'),
    modalTitle: document.getElementById('modalTitle'),
    deleteBtn: document.getElementById('deleteBtn'),
    closeDealBtn: document.getElementById('closeDealBtn'),
    importBtn: document.getElementById('importBtn'),
    exportBtn: document.getElementById('exportBtn'),
    openCount: document.getElementById('openCount'),
    emptyOpen: document.getElementById('emptyOpen'),
    emptyClosed: document.getElementById('emptyClosed'),
    userNameDisplay: document.getElementById('userNameDisplay'),
    logoutBtn: document.getElementById('logoutBtn'),
    priceError: document.getElementById('priceError')
};

function setPriceError(message) {
    if (!elements.priceError) return;
    if (message) {
        elements.priceError.textContent = message;
        elements.priceError.style.display = 'inline';
    } else {
        elements.priceError.textContent = '';
        elements.priceError.style.display = 'none';
    }
}

// ---------- редирект если нет токена ----------
const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/login.html';
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
                    const res = await fetch('/api/users/portfolio', {
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
    const select = document.getElementById('dealStockSelect');
    if (!select) return;

    // пока грузим
    select.innerHTML = '<option value="" disabled selected>Loading stocks…</option>';

    try {
        const res = await fetch('/api/stocks', {
            headers: authHeaders()
        });

        if (!res.ok) {
            throw new Error('Failed to load stocks for deals');
        }

        const stocks = await res.json();

        // если акций нет – просто показываем сообщение,
        // но НЕ делаем select disabled, чтоб не ломать клик
        if (!stocks || stocks.length === 0) {
            select.innerHTML =
                '<option value="" disabled selected>First add stocks in the left panel</option>';
            return;
        }

        // есть акции – строим список
        select.innerHTML =
            '<option value="" disabled selected>Choose stock from list</option>';

        stocks.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.ticker;
            opt.textContent = s.ticker;
            select.appendChild(opt);
        });

        // Setup event listener for stock selection AFTER options are added
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            setupStockSelectListener();
        }, 50);
    } catch (err) {
        console.error(err);
        select.innerHTML =
            '<option value="" disabled selected>Failed to load stocks</option>';
    }
}


// ========== ЗАГРУЗКА СДЕЛОК ==========

async function loadDeals() {
    try {
        const res = await fetch('/api/deals', {
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
        renderAll();
    } catch (e) {
        console.error('Load deals error', e);
        dealsLoaded = true;
    }
}

async function saveDealToServer(deal, isEdit) {
    const hasId = !!deal.id;
    const url = isEdit && hasId ? `/api/deals/${deal.id}` : '/api/deals';
    const method = isEdit && hasId ? 'PUT' : 'POST';

    const res = await fetch(url, {
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
}

async function deleteDealOnServer(id) {
    const res = await fetch(`/api/deals/${id}`, {
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
        // localStorage.clear(); // если хочешь вообще все снести

        window.location.href = '/login.html';
    });
}

// ========== МОДАЛКА ==========

async function openModal(mode = 'new', id = null) {
    elements.modal.style.display = 'flex';
    setPriceError('');

    // Wait for stocks to load first
    await loadStocksForDeals();

    elements.modalTitle.textContent =
        mode === 'new'
            ? 'New deal'
            : mode === 'view'
                ? 'Deal details'
                : 'Edit deal';

    elements.deleteBtn.style.display = mode === 'new' ? 'none' : 'inline-block';
    elements.closeDealBtn.style.display =
        mode === 'view' || mode === 'edit' ? 'inline-block' : 'none';

    if (id) {
        const d = deals.find(x => x.id === id);
        if (d) {
            elements.dealForm.dataset.editId = id;

            // Get the current ticker first
            const currentTicker = d.stock || d.Stock || '';

            // Populate all form fields
            Array.from(elements.dealForm.elements).forEach(el => {
                if (el.name && d[el.name] !== undefined) {
                    if (el.type === 'checkbox') {
                        el.checked = d[el.name];
                    } else {
                        el.value = d[el.name];
                    }
                }
            });

            // Set the stock select value AFTER stocks are loaded
            const stockSelect = document.getElementById('dealStockSelect');
            if (stockSelect && currentTicker) {
                stockSelect.value = currentTicker;
            }

            if (mode === 'view') {
                Array.from(elements.dealForm.elements).forEach(i => (i.disabled = true));
                elements.closeDealBtn.disabled = false;
            } else {
                Array.from(elements.dealForm.elements).forEach(i => (i.disabled = false));
            }
        }
    } else {
        elements.dealForm.reset();
        delete elements.dealForm.dataset.editId;
        Array.from(elements.dealForm.elements).forEach(i => (i.disabled = false));
        
        // Set default date to today when creating a new deal
        if (mode === 'new') {
            const dateInput = elements.dealForm.querySelector('input[name="date"]');
            if (dateInput) {
                const today = new Date().toISOString().split('T')[0];
                dateInput.value = today;
            }
        }
    }
}

function closeModal() {
    elements.modal.style.display = 'none';
    elements.dealForm.reset();
    delete elements.dealForm.dataset.editId;
}

// ========== ОБРАБОТЧИКИ ФОРМЫ ==========

elements.newDealBtn.addEventListener('click', () => openModal('new'));
elements.closeModal.addEventListener('click', closeModal);

elements.dealForm.addEventListener('submit', async e => {
    e.preventDefault();

    const form = new FormData(elements.dealForm);
    const obj = {
        id: elements.dealForm.dataset.editId || null,
        closed: false,
        closedAt: null
    };

    for (const [k, v] of form.entries()) {
        obj[k] = v;
    }

    if (!obj.date) {
        obj.date = new Date().toISOString().slice(0, 10);
    }

    const isEdit = !!elements.dealForm.dataset.editId;

    try {
        await saveDealToServer(obj, isEdit);
        await loadDeals();
        closeModal();
    } catch (e2) {
        console.error(e2);
        alert('Не удалось сохранить сделку');
    }
});

elements.deleteBtn.addEventListener('click', async () => {
    const id = elements.dealForm.dataset.editId;
    if (!id) return;
    if (!confirm('Удалить сделку?')) return;

    try {
        await deleteDealOnServer(id);
        await loadDeals();
        closeModal();
    } catch (e) {
        console.error(e);
        alert('Не удалось удалить сделку');
    }
});

elements.closeDealBtn.addEventListener('click', async () => {
    const id = elements.dealForm.dataset.editId;
    if (!id) return;

    const deal = deals.find(x => x.id === id);
    if (!deal) return;

    deal.closed = true;
    deal.closedAt = new Date().toISOString();

    try {
        await saveDealToServer(deal, true);
        await loadDeals();
        closeModal();
    } catch (e) {
        console.error(e);
        alert('Не удалось закрыть сделку');
    }
});

// ========== РЕНДЕР ==========

function renderAll() {
    const filter = (elements.filterInput.value || '').toLowerCase();

    const open = deals.filter(
        d =>
            !d.closed &&
            ((d.stock || '').toLowerCase().includes(filter) ||
                (d.notes || '').toLowerCase().includes(filter))
    );

    elements.openList.innerHTML = '';

    if (!dealsLoaded) {
        elements.emptyOpen.textContent = 'Загружаем сделки...';
        elements.emptyOpen.style.display = 'block';
    } else if (open.length === 0) {
        elements.emptyOpen.textContent =
            'Нет открытых сделок — нажмите «New Deal», чтобы добавить.';
        elements.emptyOpen.style.display = 'block';
    } else {
        elements.emptyOpen.style.display = 'none';

        open.forEach(d => {
            const el = document.createElement('div');
            el.className = 'deal-item';
            el.dataset.id = d.id;

            el.innerHTML = `
                <div class="meta">
                    <strong>${escapeHtml(d.stock || '-')}</strong>
                    <span class="small" style="margin-top:4px">
                        ${formatDate(d.date)}
                    </span>
                    <div class="small" style="margin-top:6px">
                        ${escapeHtml((d.notes || '').slice(0, 140))}
                    </div>
                </div>
                <div class="chips" style="min-width:140px;justify-content:flex-end">
                    <div class="badge">TP:${escapeHtml(d.take_profit || '-')}</div>
                    <div class="badge">SL:${escapeHtml(d.stop_loss || '-')}</div>
                </div>
            `;

            // сюда добавляем кнопку графика
            const actionsDiv = el.querySelector('.chips');
            if (actionsDiv) {
                addChartButton(actionsDiv, d.stock || '');
            }

            el.addEventListener('click', event => {
                const dealEl = event.currentTarget;
                openModal('view', dealEl.dataset.id);
            });

            elements.openList.appendChild(el);
        });
    }

    elements.openCount.textContent = open.length;

    // CLOSED deals
    const closed = deals.filter(d => d.closed);
    elements.closedList.innerHTML = '';

    if (!dealsLoaded) {
        elements.emptyClosed.style.display = 'none';
    } else if (closed.length === 0) {
        elements.emptyClosed.style.display = 'block';
    } else {
        elements.emptyClosed.style.display = 'none';

        closed.forEach(d => {
            const el = document.createElement('div');
            el.className = 'deal-item';
            el.dataset.id = d.id;

            el.innerHTML = `
                <div class="meta">
                    <strong>${escapeHtml(d.stock || '-')}</strong>
                    <span class="small" style="margin-top:4px">
                        closed ${formatDate(d.closedAt ? d.closedAt.slice(0, 10) : '')}
                    </span>
                    <div class="small" style="margin-top:6px">
                        ${escapeHtml((d.notes || '').slice(0, 120))}
                    </div>
                </div>
                <div class="chips">
                    <div class="badge">TP:${escapeHtml(d.take_profit || '-')}</div>
                </div>
            `;

            // и здесь тоже кнопка графика
            const actionsDiv = el.querySelector('.chips');
            if (actionsDiv) {
                addChartButton(actionsDiv, d.stock || '');
            }

            el.addEventListener('click', event => {
                const dealEl = event.currentTarget;
                openModal('view', dealEl.dataset.id);
            });

            elements.closedList.appendChild(el);
        });
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

// Format date from YYYY-MM-DD to DD/MM/YYYY
function formatDate(dateStr) {
    if (!dateStr) return '';
    // Handle both YYYY-MM-DD and ISO date strings
    const datePart = dateStr.slice(0, 10);
    const parts = datePart.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
}

elements.filterInput.addEventListener('input', renderAll);

// ========== IMPORT / EXPORT ==========

//elements.exportBtn.addEventListener('click', () => {
//    const blob = new Blob([JSON.stringify(deals, null, 2)], {
//        type: 'application/json'
//    });

//    const url = URL.createObjectURL(blob);
//    const a = document.createElement('a');

//    a.href = url;
//    a.download = 'deals.json';
//    a.click();

//    URL.revokeObjectURL(url);
//});

//elements.importBtn.addEventListener('click', () => {
//    const inp = document.createElement('input');
//    inp.type = 'file';
//    inp.accept = '.json';

//    inp.onchange = async e => {
//        const f = e.target.files[0];
//        if (!f) return;

//        const r = new FileReader();

//        r.onload = async ev => {
//            try {
//                const imported = JSON.parse(ev.target.result);
//                if (!Array.isArray(imported)) {
//                    alert('Invalid file');
//                    return;
//                }

//                for (const d of imported) {
//                    delete d.id;
//                    await saveDealToServer(d, false);
//                }

//                await loadDeals();
//                alert('Imported ' + imported.length + ' deals');
//            } catch (err) {
//                console.error(err);
//                alert('Ошибка импорта');
//            }
//        };

//        r.readAsText(f);
//    };

//    inp.click();
//});

function addChartButton(containerEl, stockTicker) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Chart';
    btn.className = 'secondary';
    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!stockTicker) return;

        try {
            const res = await fetch(`/api/prices/${encodeURIComponent(stockTicker)}`, {
                headers: {
                    ...authHeaders()
                }
            });

            if (!res.ok) {
                console.error('Failed to load prices', res.status);
                alert('Не удалось загрузить данные по акции');
                return;
            }

            const data = await res.json();
            console.log('PriceSeries', data);
            // TODO: здесь можно открыть модалку и нарисовать график Chart.js
        } catch (err) {
            console.error(err);
            alert('Ошибка загрузки цены акции');
        }
    });

    containerEl.appendChild(btn);
}

// Function to fetch previous week's low and high prices and populate o_price and h_price fields
async function loadPreviousWeekLowPrice(ticker) {
    if (!ticker) {
        console.log('No ticker provided');
        return;
    }

    const oPriceInput = elements.dealForm.querySelector('input[name="o_price"]');
    const hPriceInput = elements.dealForm.querySelector('input[name="h_price"]');

    console.log('Loading previous week low/high prices for:', ticker);

    try {
        const res = await fetch(`/api/prices/${encodeURIComponent(ticker)}`, {
            headers: {
                ...authHeaders()
            }
        });

        if (!res.ok) {
            console.error('Failed to load prices', res.status);
            // quota / error – очищаем поля, чтобы не оставались старые значения
            if (oPriceInput) oPriceInput.value = '';
            if (hPriceInput) hPriceInput.value = '';
            setPriceError('Price history is temporarily unavailable (API quota reached).');
            return;
        }

        const data = await res.json();
        console.log('Price data received:', data);
        
        // Data is an array of price points, sorted by date ascending (oldest first)
        // Each item has: Date, Low, High, Open, Close, Volume
        if (data && Array.isArray(data) && data.length >= 2) {
            // Get the second-to-last item (previous week)
            const previousWeek = data[data.length - 2];
            console.log('Previous week data:', previousWeek);
            
            // Extract the low price (try both PascalCase and camelCase)
            const lowPrice = previousWeek.Low !== undefined ? previousWeek.Low : 
                           (previousWeek.low !== undefined ? previousWeek.low : null);
            
            // Extract the high price (try both PascalCase and camelCase)
            const highPrice = previousWeek.High !== undefined ? previousWeek.High : 
                            (previousWeek.high !== undefined ? previousWeek.high : null);
            
            console.log('Previous week low price:', lowPrice);
            console.log('Previous week high price:', highPrice);
            
            // Set o_price field (low price)
            if (lowPrice !== undefined && lowPrice !== null) {
                if (oPriceInput) {
                    oPriceInput.value = lowPrice.toString();
                    console.log('Set o_price field to:', lowPrice);
                } else {
                    console.error('o_price input field not found');
                }
            } else {
                console.warn('Low price not found in previous week data. Available keys:', Object.keys(previousWeek));
            }
            
            // Set h_price field (high price)
            if (highPrice !== undefined && highPrice !== null) {
                if (hPriceInput) {
                    hPriceInput.value = highPrice.toString();
                    console.log('Set h_price field to:', highPrice);
                } else {
                    console.error('h_price input field not found');
                }
            } else {
                console.warn('High price not found in previous week data. Available keys:', Object.keys(previousWeek));
            }

            // Успешно получили данные по истории цен – убираем сообщение об ошибке
            setPriceError('');
        } else {
            console.warn('Not enough data points. Array length:', data?.length);
        }
    } catch (err) {
        console.error('Error loading previous week low/high prices', err);
        // На любой ошибке очищаем поля
        if (oPriceInput) oPriceInput.value = '';
        if (hPriceInput) hPriceInput.value = '';
        setPriceError('Price history is temporarily unavailable (API error).');
    }
}

// Function to fetch current stock price and populate share_price field
async function loadCurrentPrice(ticker) {
    if (!ticker) {
        console.log('No ticker provided for current price');
        return;
    }

    const sharePriceInput = elements.dealForm.querySelector('input[name="share_price"]');

    console.log('Loading current price for:', ticker);

    try {
        const res = await fetch(`/api/prices/${encodeURIComponent(ticker)}/quote`, {
            headers: {
                ...authHeaders()
            }
        });

        if (!res.ok) {
            console.error('Failed to load current price', res.status);
            // quota / error – очищаем поле, чтобы не оставалось старое значение
            if (sharePriceInput) sharePriceInput.value = '';
            setPriceError('Current price is temporarily unavailable (API quota reached).');
            return;
        }

        const data = await res.json();
        console.log('Current price data received:', data);
        
        if (data && data.price !== undefined && data.price !== null) {
            if (sharePriceInput) {
                sharePriceInput.value = data.price.toString();
                console.log('Set share_price field to:', data.price);
            } else {
                console.error('share_price input field not found');
            }
            // Успешно получили текущую цену – убираем сообщение об ошибке
            setPriceError('');
        } else {
            console.warn('Price not found in response:', data);
        }
    } catch (err) {
        console.error('Error loading current price', err);
        // На любой ошибке очищаем поле
        if (sharePriceInput) sharePriceInput.value = '';
        setPriceError('Current price is temporarily unavailable (API error).');
    }
}

// Setup event listener for stock select dropdown
function setupStockSelectListener() {
    const stockSelect = document.getElementById('dealStockSelect');
    if (!stockSelect) {
        console.warn('dealStockSelect not found');
        return;
    }

    // Remove any existing change listeners by cloning (this removes all event listeners)
    const newSelect = stockSelect.cloneNode(true);
    stockSelect.parentNode.replaceChild(newSelect, stockSelect);

    // Add change event listener to the new select element
    newSelect.addEventListener('change', async (e) => {
        const ticker = e.target.value;
        console.log('Stock selected:', ticker);
        
        // Only load price if we're creating a new deal (not editing/viewing)
        const isNewDeal = !elements.dealForm.dataset.editId;
        console.log('Is new deal:', isNewDeal, 'editId:', elements.dealForm.dataset.editId);
        
        if (ticker && ticker.trim() !== '' && isNewDeal) {
            console.log('Calling loadPreviousWeekLowPrice and loadCurrentPrice...');
            // Load both previous week data and current price
            await Promise.all([
                loadPreviousWeekLowPrice(ticker),
                loadCurrentPrice(ticker)
            ]);
        }
    });
    
    console.log('Stock select listener attached');
}

// ======== СТАРТ =========
loadStocksForDeals();
loadDeals();

document.addEventListener('keydown', e => {
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        openModal('new');
    }
});