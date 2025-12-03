// deals.js - Inline expandable version

let deals = [];
let dealsLoaded = false;
let expandedDealId = null; // Track which deal is currently expanded
let newDealRow = null; // Track if there's a new deal row being created

// ---------- элементы DOM ----------
const elements = {
    newDealBtn: document.getElementById('newDealBtn'),
    openList: document.getElementById('openList'),
    closedList: document.getElementById('closedList'),
    filterInput: document.getElementById('filterInput'),
    openCount: document.getElementById('openCount'),
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

// Calculate total sum: share_price * amount_tobuy
function calculateTotalSum(sharePrice, amountToBuy) {
    const price = parseFloat(String(sharePrice || '').replace(',', '.')) || 0;
    const amount = parseFloat(String(amountToBuy || '').replace(',', '.')) || 0;
    const total = price * amount;
    return total > 0 ? total.toFixed(2) : null;
}

// Format total sum for display
function formatTotalSum(totalSum) {
    if (!totalSum) return '';
    const num = parseFloat(String(totalSum).replace(',', '.')) || 0;
    return num > 0 ? `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
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
    try {
        const res = await fetch('/api/stocks', {
            headers: authHeaders()
        });

        if (!res.ok) {
            throw new Error('Failed to load stocks for deals');
        }

        const stocks = await res.json();
        return stocks || [];
    } catch (err) {
        console.error(err);
        return [];
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
        window.location.href = '/login.html';
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
               
                <label>Shares amount to buy total<input type="text" name="amount_tobuy" value="${escapeHtml(deal?.amount_tobuy || '')}" placeholder=""></label>

                <label>Shares amount to buy at stage 1<input type="text" name="amount_tobuy_stage_1" value="${escapeHtml(deal?.amount_tobuy_stage_1 || '')}" placeholder=""></label>
                <label>Shares amount to buy at stage 2<input type="text" name="amount_tobuy_stage_2" value="${escapeHtml(deal?.amount_tobuy_stage_2 || '')}" placeholder=""></label>
                <label>Shares amount to buy at stage 3<input type="text" name="amount_tobuy_stage_3" value="${escapeHtml(deal?.amount_tobuy_stage_3 || '')}" placeholder=""></label>
                <label>What is your take profit price?<input type="text" name="take_profit" value="${escapeHtml(deal?.take_profit || '')}" placeholder=""></label>
                <label>What is your take profit in %?<input type="text" name="take_profit_prcnt" value="${escapeHtml(deal?.take_profit_prcnt || '')}" placeholder=""></label>
                <label>What is your stop loss price?<input type="text" name="stop_loss" value="${escapeHtml(deal?.stop_loss || '')}" placeholder=""></label>
                <label>What is your stop loss in %?<input type="text" name="stop_loss_prcnt" value="${escapeHtml(deal?.stop_loss_prcnt || '')}" placeholder=""></label>

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

                <div class="full form-actions">
                    <button type="submit">${isNew ? 'Create deal' : 'Save changes'}</button>
                    ${isEdit && !deal?.closed ? `<button type="button" class="secondary close-deal-btn">Close deal</button>` : ''}
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
        elements.emptyOpen.textContent = 'Загружаем сделки...';
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

    elements.openCount.textContent = open.length + (newDealRow ? 1 : 0);

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
        elements.emptyClosed.style.display = 'none';
    } else if (closed.length === 0) {
        elements.emptyClosed.style.display = 'block';
    } else {
        elements.emptyClosed.style.display = 'none';

        closed.forEach(d => {
            const row = createDealRow(d, false);
            elements.closedList.appendChild(row);
        });
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
    const totalSum = calculateTotalSum(deal?.share_price, deal?.amount_tobuy);
    const totalSumFormatted = formatTotalSum(totalSum || deal?.total_sum);
    const totalSumDisplay = totalSumFormatted ? ` - ${totalSumFormatted}` : '';
    
    summary.innerHTML = `
        <div class="meta">
            <strong>${escapeHtml(deal?.stock || 'New Deal')}${totalSumDisplay}</strong>
            ${deal ? `<span class="small" style="margin-top:4px">${formatDate(deal.date)}</span>` : ''}
            ${deal ? `<div class="small" style="margin-top:6px">${escapeHtml((deal.notes || '').slice(0, 140))}</div>` : ''}
        </div>
        ${deal ? `
        <div class="chips" style="min-width:140px;justify-content:flex-end">
            <div class="badge">TP:${escapeHtml(deal.take_profit || '-')}</div>
            <div class="badge">SL:${escapeHtml(deal.stop_loss || '-')}</div>
        </div>
        ` : ''}
    `;

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
        setupTotalSumCalculator(row, form, deal);
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
            }
        }
    });

    // Form submit
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleDealSubmit(form, deal, isNew);
        });

        // Close deal button
        const closeBtn = form.querySelector('.close-deal-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', async () => {
                const updatedDeal = { ...deal, closed: true, closedAt: new Date().toISOString() };
                try {
                    await saveDealToServer(updatedDeal, true);
                    await loadDeals();
                } catch (e) {
                    console.error(e);
                    alert('Не удалось закрыть сделку');
                }
            });
        }

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

    newSelect.addEventListener('change', async (e) => {
        const ticker = e.target.value;
        if (ticker && ticker.trim() !== '') {
            const formContainer = form.closest('.deal-form-container');
            console.log('Loading data for ticker:', ticker);
            
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
                })
            ]);
            
            console.log('All requests completed:', results);
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
        }
    });
    
    // Setup listeners for monthly_dir and weekly_dir selects to add red border when "Down" is selected
    setupTrendSelectListeners(form);
}

async function handleDealSubmit(form, deal, isNew) {
    const formData = new FormData(form);
    const obj = {
        id: deal?.id || null,
        closed: deal?.closed || false,
        closedAt: deal?.closedAt || null
    };

    for (const [k, v] of formData.entries()) {
        obj[k] = v;
    }

    // Calculate and include total sum
    const sharePrice = obj.share_price || '';
    const amountToBuy = obj.amount_tobuy || '';
    const totalSum = calculateTotalSum(sharePrice, amountToBuy);
    if (totalSum) {
        obj.total_sum = totalSum;
    }

    if (!obj.date) {
        obj.date = new Date().toISOString().slice(0, 10);
    }

    try {
        await saveDealToServer(obj, !isNew);
        
        // Deduct total sum from portfolio for new deals
        if (isNew && totalSum) {
            await deductPortfolio(totalSum);
        }
        
        if (isNew) {
            newDealRow = null;
        }
        expandedDealId = null;
        await loadDeals();
    } catch (e) {
        console.error(e);
        alert('Не удалось сохранить сделку');
    }
}

// Function to deduct deal total from portfolio
async function deductPortfolio(totalSum) {
    if (!totalSum) return;
    
    const totalSumValue = parseFloat(String(totalSum).replace(',', '.')) || 0;
    if (totalSumValue <= 0) {
        console.log('Skipping portfolio deduction: totalSum is zero or invalid');
        return;
    }
    
    // Get current portfolio value from localStorage (preferred) or UI
    let currentPortfolio = 0;
    const stored = localStorage.getItem('portfolio');
    if (stored != null && stored !== '') {
        const num = parseFloat(String(stored).replace(',', '.')) || 0;
        currentPortfolio = num;
    } else if (portfolioSpan) {
        // Fallback to UI element value (remove any formatting)
        const currentText = portfolioSpan.textContent.trim();
        const cleanedText = currentText.replace(/[$,]/g, '').replace(',', '.');
        currentPortfolio = parseFloat(cleanedText) || 0;
    }
    
    // Calculate new portfolio
    const newPortfolio = Math.max(0, currentPortfolio - totalSumValue); // Ensure non-negative
    
    // Update localStorage
    localStorage.setItem('portfolio', String(newPortfolio));
    
    // Update UI
    if (portfolioSpan) {
        portfolioSpan.textContent = newPortfolio.toFixed(2);
    }
    
    // Update database
    try {
        const res = await fetch('/api/users/portfolio', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders()
            },
            body: JSON.stringify({ portfolio: newPortfolio })
        });
        
        if (!res.ok) {
            console.error('Failed to update portfolio after deal creation', res.status);
            const errorText = await res.text().catch(() => '');
            console.error('Error response:', errorText);
        } else {
            console.log(`Portfolio updated: $${currentPortfolio.toFixed(2)} - $${totalSumValue.toFixed(2)} = $${newPortfolio.toFixed(2)}`);
        }
    } catch (e) {
        console.error('Error updating portfolio after deal creation', e);
    }
}

// Function to fetch previous week's low and high prices
async function loadPreviousWeekLowPrice(ticker, form) {
    if (!ticker || !form) return;

    const formContainer = form.closest('.deal-form-container');
    setPriceError(formContainer, '');

    try {
        const res = await fetch(`/api/prices/${encodeURIComponent(ticker)}`, {
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
        const res = await fetch(`/api/prices/${encodeURIComponent(ticker)}/quote`, {
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
                // Calculate stop loss after autofilling share price
                await calculateStopLoss(form);
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
        const res = await fetch(`/api/prices/${encodeURIComponent(ticker)}/trends`, {
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

async function loadSupportResistance(ticker, form) {
    if (!ticker || !form) return;

    try {
        const res = await fetch(`/api/prices/${encodeURIComponent(ticker)}/support-resistance`, {
            headers: { ...authHeaders() }
        });

        if (!res.ok) {
            console.warn('Failed to load support/resistance levels');
            return;
        }

        const data = await res.json();
        console.log('Support/resistance data received for', ticker, ':', data);
        
        // Set support_price to ALL found support levels (comma-separated)
        const supportInput = form.querySelector('input[name="support_price"]');
        if (supportInput && data.levels && data.levels.length > 0) {
            // Use all levels found
            supportInput.value = data.levels.map(l => parseFloat(l).toFixed(2)).join(', ');
            console.log(`All support levels loaded for ${ticker}: ${supportInput.value} (${data.levels.length} levels)`);
        } else if (supportInput && data.supportPrice) {
            // Fallback to supportPrice if levels array is not available
            supportInput.value = data.supportPrice;
            console.log(`Support levels loaded for ${ticker}: ${data.supportPrice}`);
        } else if (supportInput && data.firstTwo && data.firstTwo.length > 0) {
            // Fallback: use firstTwo if available
            supportInput.value = data.firstTwo.map(l => parseFloat(l).toFixed(2)).join(', ');
            console.log(`Support levels loaded for ${ticker}: ${supportInput.value}`);
        }
    } catch (err) {
        console.error('Error loading support/resistance levels', err);
    }
}

async function calculateStopLoss(form) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stopLossInput = form.querySelector('input[name="stop_loss"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    
    if (!sharePriceInput || !stopLossInput || !stopLossPrcntInput) return;
    
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
        const res = await fetch(`/api/prices/${encodeURIComponent(ticker)}`, {
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
    
    // Remove error class first
    input.classList.remove('has-stop-loss-error');
    
    // Check if value is negative or greater than 10
    if (value < 0 || value > 10) {
        input.classList.add('has-stop-loss-error');
    }
}

function setupSharePriceListener(form) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    
    if (!sharePriceInput) return;
    
    // Remove existing listeners by cloning
    const newInput = sharePriceInput.cloneNode(true);
    sharePriceInput.parentNode.replaceChild(newInput, sharePriceInput);
    
    // Add listeners for both 'input' (real-time) and 'change' (on blur)
    newInput.addEventListener('input', () => {
        // Debounce to avoid too many calculations while typing
        clearTimeout(newInput._stopLossTimeout);
        newInput._stopLossTimeout = setTimeout(() => {
            calculateStopLoss(form);
        }, 500); // Wait 500ms after user stops typing
    });
    
    newInput.addEventListener('change', () => {
        calculateStopLoss(form);
    });
    
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

// Setup total sum calculation and update row title
function setupTotalSumCalculator(row, form, deal) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const amountToBuyInput = form.querySelector('input[name="amount_tobuy"]');
    const stockSelect = form.querySelector('.deal-stock-select');
    const summary = row.querySelector('.deal-summary');
    
    if (!sharePriceInput || !amountToBuyInput || !summary) return;
    
    // Function to update the row title with total sum
    const updateRowTitle = () => {
        const sharePrice = sharePriceInput.value || '';
        const amountToBuy = amountToBuyInput.value || '';
        const totalSum = calculateTotalSum(sharePrice, amountToBuy);
        const totalSumFormatted = formatTotalSum(totalSum);
        const totalSumDisplay = totalSumFormatted ? ` - ${totalSumFormatted}` : '';
        
        // Get current stock name from select or from deal
        let currentStock = 'New Deal';
        if (stockSelect && stockSelect.value) {
            currentStock = stockSelect.value;
        } else if (deal?.stock) {
            currentStock = deal.stock;
        }
        
        // Find the stock name element and update it
        const stockElement = summary.querySelector('.meta strong');
        if (stockElement) {
            stockElement.textContent = `${currentStock}${totalSumDisplay}`;
        }
        
        // Store totalSum in a data attribute for later use
        row.dataset.totalSum = totalSum || '';
    };
    
    // Remove existing listeners by cloning
    const newSharePriceInput = sharePriceInput.cloneNode(true);
    sharePriceInput.parentNode.replaceChild(newSharePriceInput, sharePriceInput);
    
    const newAmountToBuyInput = amountToBuyInput.cloneNode(true);
    amountToBuyInput.parentNode.replaceChild(newAmountToBuyInput, amountToBuyInput);
    
    // Add event listeners for share_price
    newSharePriceInput.addEventListener('input', () => {
        clearTimeout(newSharePriceInput._totalSumTimeout);
        newSharePriceInput._totalSumTimeout = setTimeout(() => {
            updateRowTitle();
        }, 300);
    });
    
    newSharePriceInput.addEventListener('change', () => {
        updateRowTitle();
    });
    
    // Add event listeners for amount_tobuy
    newAmountToBuyInput.addEventListener('input', () => {
        clearTimeout(newAmountToBuyInput._totalSumTimeout);
        newAmountToBuyInput._totalSumTimeout = setTimeout(() => {
            updateRowTitle();
        }, 300);
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

// ======== СТАРТ =========
loadDeals();

document.addEventListener('keydown', e => {
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        elements.newDealBtn.click();
    }
});

