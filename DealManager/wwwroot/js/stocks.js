// stocks.js

const addStockBtn = document.getElementById('addStockBtn');
const stockModal = document.getElementById('stockModal');
const closeStockModalBtn = document.getElementById('closeStockModal');
const stockForm = document.getElementById('stockForm');
const stockList = document.getElementById('stockList');
const emptyStockEl = document.getElementById('emptyStock');

let stocks = [];
let stocksLoaded = false;

// локальный вариант authHeaders (такой же, как в deals.js)
function authHeaders() {
    const t = localStorage.getItem('token');
    return t ? { Authorization: 'Bearer ' + t } : {};
}

// ====== API ======

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

addStockBtn.addEventListener('click', () => {
    stockModal.style.display = 'flex';
});

closeStockModalBtn.addEventListener('click', () => {
    stockModal.style.display = 'none';
    stockForm.reset();
});

stockForm.addEventListener('submit', async e => {
    e.preventDefault();

    const fd = new FormData(stockForm);
    const ticker = (fd.get('ticker') || '').toString().trim();
    const desc = (fd.get('desc') || '').toString().trim();
    const sp500_member = fd.get('sp500_member') === 'on';
    const averageWeekVol = fd.get('averageWeekVol') === 'on';
    const betaVolatility = fd.get('betaVolatility');

    if (!ticker) return;

    const submitButton = stockForm.querySelector('button[type="submit"]');
    if (!submitButton) return;

    try {
        setButtonLoading(submitButton, true);
        
        await saveStockToServer({
            ticker,
            desc,
            sp500Member: sp500_member,
            averageWeekVol,
            betaVolatility
        });

        setButtonLoading(submitButton, false);
        stockModal.style.display = 'none';
        stockForm.reset();

        // перезагружаем список + селект сделок
        await loadStocks();
    } catch (e) {
        console.error(e);
        alert('Не удалось сохранить акцию');
        setButtonLoading(submitButton, false);
    }
});

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
        const el = document.createElement('div');
        el.className = 'deal-item';
        el.innerHTML = `
            <div class="meta">
                <strong>${s.ticker}</strong>
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

// ====== Старт ======
loadStocks();
