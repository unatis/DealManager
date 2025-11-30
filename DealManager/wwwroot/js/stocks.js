
const addStockBtn = document.getElementById('addStockBtn');
const stockModal = document.getElementById('stockModal');
const closeStockModalBtn = document.getElementById('closeStockModal');
const stockForm = document.getElementById('stockForm');
const stockList = document.getElementById('stockList');

let stocks = JSON.parse(localStorage.getItem('stocks_v1') || '[]');

    // открыть модал
    addStockBtn.addEventListener('click', () => stockModal.style.display = 'flex');

    // закрыть модал
    closeStockModalBtn.addEventListener('click', () => {
    stockModal.style.display = 'none';
stockForm.reset();
    });

    // сохранить акцию
    stockForm.addEventListener('submit', e => {
    e.preventDefault();
const ticker = stockForm.elements['ticker'].value.trim();
const desc = stockForm.elements['desc'].value.trim();
if (!ticker) return;

stocks.push({id: Date.now(), ticker, desc });
localStorage.setItem('stocks_v1', JSON.stringify(stocks));
stockModal.style.display = 'none';
stockForm.reset();
renderStocks();
    });

// отрисовка списка акций
function renderStocks() {
    stockList.innerHTML = '';
if (stocks.length === 0) {
    document.getElementById('emptyStock').style.display = 'block';
        } else {
    document.getElementById('emptyStock').style.display = 'none';
            stocks.forEach(s => {
                const el = document.createElement('div');
el.className = 'deal-item';
el.innerHTML = `<div class="meta"><strong>${s.ticker}</strong><div class="small">${s.desc || ''}</div></div><div style="display:flex;align-items:center"><span class="delete-icon">×</span></div>`;

                // клик по элементу — заполняем поле сделки
                el.querySelector('.meta').addEventListener('click', () => {
                    const dealInput = document.querySelector('#dealForm input[name="stock"]');
if (dealInput) dealInput.value = s.ticker;
                });

                // удалить акцию
                el.querySelector('.delete-icon').addEventListener('click', () => {
                    if (confirm('Удалить акцию?')) {
    stocks = stocks.filter(x => x.id !== s.id);
localStorage.setItem('stocks_v1', JSON.stringify(stocks));
renderStocks();
                    }
                });

stockList.appendChild(el);
            });
        }
    }

// сразу отображаем существующие акции
renderStocks();
