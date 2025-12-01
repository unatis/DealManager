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
    logoutBtn: document.getElementById('logoutBtn')
};

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

function openModal(mode = 'new', id = null) {
    elements.modal.style.display = 'flex';

    loadStocksForDeals();

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

            Array.from(elements.dealForm.elements).forEach(el => {
                if (el.name && d[el.name] !== undefined) {
                    if (el.type === 'checkbox') {
                        el.checked = d[el.name];
                    } else {
                        el.value = d[el.name];
                    }
                }
            });

            // выставляем выбранный тикер в select
            const currentTicker = d.stock || d.Stock || '';
            

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
                        ${escapeHtml(d.date || '')}
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
                        closed ${escapeHtml(d.closedAt ? d.closedAt.slice(0, 10) : '')}
                    </span>
                    <div class="small" style="margin-top:6px">
                        ${escapeHtml((d.notes || '').slice(0, 120))}
                    </div>
                </div>
                <div class="chips">
                    <div class="badge">TP:${escapeHtml(d.take_profit || '-')}</div>
                </div>
            `;

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

elements.filterInput.addEventListener('input', renderAll);

// ========== IMPORT / EXPORT ==========

elements.exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(deals, null, 2)], {
        type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = 'deals.json';
    a.click();

    URL.revokeObjectURL(url);
});

elements.importBtn.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';

    inp.onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;

        const r = new FileReader();

        r.onload = async ev => {
            try {
                const imported = JSON.parse(ev.target.result);
                if (!Array.isArray(imported)) {
                    alert('Invalid file');
                    return;
                }

                for (const d of imported) {
                    delete d.id;
                    await saveDealToServer(d, false);
                }

                await loadDeals();
                alert('Imported ' + imported.length + ' deals');
            } catch (err) {
                console.error(err);
                alert('Ошибка импорта');
            }
        };

        r.readAsText(f);
    };

    inp.click();
});

// ======== СТАРТ =========
loadStocksForDeals();
loadDeals();

document.addEventListener('keydown', e => {
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        openModal('new');
    }
});