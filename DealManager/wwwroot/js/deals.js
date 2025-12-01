// deals.js

let deals = [];
let dealsLoaded = false;   

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
    emptyClosed: document.getElementById('emptyClosed')
};

const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/login.html';
}
// ---------- работа с API ----------

function authHeaders() {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}

async function loadDeals() {
    try {
        const res = await fetch('/api/deals', {
            headers: {
                ...authHeaders()
            }
        });

        if (res.status === 401 || res.status === 403) {
            // токен сервер не принял – просто пишем в консоль,
            // но не пугаем пользователя
            const text = await res.text().catch(() => '');
            console.warn('Unauthorized /api/deals:', res.status, text);

            // Можно просто показать "Нет данных"
            elements.openList.innerHTML = '';
            elements.emptyOpen.textContent = 'Нет доступа к данным сделок.';
            elements.emptyOpen.style.display = 'block';
            return;
        }

        if (!res.ok) {
            console.error('Failed to load deals', res.status);
            return;
        }

        deals = await res.json();
        dealsLoaded = true;
        renderAll();
    } catch (e) {
        console.error('Load deals error', e);
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

// ---------- модалка ----------

function openModal(mode = 'new', id = null) {
    elements.modal.style.display = 'flex';

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

// ---------- обработчики формы ----------

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

// ---------- рендер ----------

function renderAll() {
    // OPEN deals (центр)
    const filter = (elements.filterInput.value || '').toLowerCase();

    const open = deals.filter(
        d =>
            !d.closed &&
            ((d.stock || '').toLowerCase().includes(filter) ||
                (d.notes || '').toLowerCase().includes(filter))
    );

    elements.openList.innerHTML = '';

    if (!dealsLoaded) {
        // ещё не загрузили с сервера
        elements.emptyOpen.textContent = 'Загружаем сделки...';
        elements.emptyOpen.style.display = 'block';
    } else if (open.length === 0) {
        // загрузили, но нет открытых сделок
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

    // CLOSED deals (правый столбец)
    const closed = deals.filter(d => d.closed);
    elements.closedList.innerHTML = '';

    if (closed.length === 0 && dealsLoaded) {
        elements.emptyClosed.style.display = 'block';
    } else {
        elements.emptyClosed.style.display = closed.length === 0 ? 'none' : 'none';

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

// простое экранирование текста
function escapeHtml(str) {
    return String(str || '').replace(/[&<>"]/g, s => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
    }[s]));
}

elements.filterInput.addEventListener('input', renderAll);

// ---------- import / export ----------

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

                // грузим каждую сделку на сервер
                for (const d of imported) {
                    delete d.id; // пусть сервер создаёт свои id
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

// ---------- старт ----------

loadDeals();

// горячая клавиша: Ctrl/Cmd+N
document.addEventListener('keydown', e => {
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        openModal('new');
    }
});
