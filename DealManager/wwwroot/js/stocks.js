
const addStockBtn = document.getElementById('addStockBtn');
const stockModal = document.getElementById('stockModal');
const closeStockModalBtn = document.getElementById('closeStockModal');
const stockForm = document.getElementById('stockForm');
const stockList = document.getElementById('stockList');

let stocks = [];

function authHeaders() {
    const t = localStorage.getItem('token');
    return t ? { Authorization: 'Bearer ' + t } : {};
}

async function loadStocks() {
    try {
        const res = await fetch('/api/stocks', {
            headers: authHeaders()
        });
        if (!res.ok) throw new Error('Failed to load stocks');

        stocks = await res.json();
        renderStocks();
    } catch (e) {
        console.error(e);
        document.getElementById('emptyStock').textContent = 'Не удалось загрузить акции';
        document.getElementById('emptyStock').style.display = 'block';
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
    if (!res.ok) throw new Error('Failed to save stock');
}

async function deleteStockOnServer(id) {
    const res = await fetch(`/api/stocks/${id}`, {
        method: 'DELETE',
        headers: authHeaders()
    });
    if (!res.ok) throw new Error('Failed to delete stock');
}

// модалка
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
    const ticker = fd.get('ticker').trim();
    const desc = fd.get('desc').trim();
    const sp500_member = fd.get('sp500_member') === 'on';
    const averageWeekVol = fd.get('averageWeekVol') === 'on';

    if (!ticker) return;

    try {
        await saveStockToServer({
            ticker,
            desc,
            sp500Member: sp500_member,
            averageWeekVol
        });
        stockModal.style.display = 'none';
        stockForm.reset();
        await loadStocks();
    } catch (e) {
        console.error(e);
        alert('Не удалось сохранить акцию');
    }
});

// отрисовка
function renderStocks() {
    stockList.innerHTML = '';
    if (!stocks.length) {
        document.getElementById('emptyStock').style.display = 'block';
        return;
    }
    document.getElementById('emptyStock').style.display = 'none';

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

        // заполнение ticker в форме сделки при клике по названию
        el.querySelector('.meta').addEventListener('click', () => {
            const dealInput = document.querySelector('#dealForm input[name="stock"]');
            if (dealInput) dealInput.value = s.ticker;
        });

        // удаление
        el.querySelector('.delete-icon').addEventListener('click', async () => {
            if (!confirm('Удалить акцию?')) return;
            try {
                await deleteStockOnServer(s.id);
                await loadStocks();
            } catch (e) {
                console.error(e);
                alert('Не удалось удалить акцию');
            }
        });

        stockList.appendChild(el);
    });
}

// стартовая загрузка
loadStocks();

