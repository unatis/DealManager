// deals.js - Inline expandable version

let deals = [];
let dealsLoaded = false;
let expandedDealId = null; // Track which deal is currently expanded
let newDealRow = null; // Track if there's a new deal row being created
let stocksCache = []; // Cache stocks data for checking regular_volume
// warningsCache is now a window property to share with stocks.js
window.warningsCache = window.warningsCache || [];

// ===== UI-only per-deal state (stored in deals[]) =====
// Used to prevent auto-refresh overwriting manual edits.
function getDealIdFromForm(form) {
    return form?.closest('.deal-row')?.dataset?.dealId || null;
}

function getDealById(dealId) {
    if (!dealId || dealId === 'new') return null;
    return (deals || []).find(d => d?.id === dealId) || null;
}

function ensureDealUi(deal) {
    deal._ui ??= {};
    deal._ui.dirty ??= {};
    return deal._ui;
}

function markDirty(form, field) {
    const id = getDealIdFromForm(form);
    const d = getDealById(id);
    if (!d) return;
    ensureDealUi(d).dirty[field] = true;
}

function isDirty(form, field) {
    const id = getDealIdFromForm(form);
    const d = getDealById(id);
    return !!d?._ui?.dirty?.[field];
}

function captureDirtyMap(oldDeals) {
    const m = new Map();
    for (const d of (oldDeals || [])) {
        if (!d?.id) continue;
        const dirty = d?._ui?.dirty;
        if (dirty) m.set(d.id, { ...dirty });
    }
    return m;
}

function applyDirtyMap(newDeals, dirtyMap) {
    for (const d of (newDeals || [])) {
        if (!d?.id) continue;
        const dirty = dirtyMap.get(d.id);
        if (!dirty) continue;
        d._ui ??= {};
        d._ui.dirty = { ...dirty };
    }
}

async function refreshPlannedAutoFieldsOnExpand(form, deal) {
    if (!form || !deal?.planned_future || deal?.closed || !deal?.stock) return;

    const monthlySelect = form.querySelector('select[name="monthly_dir"]');
    const weeklySelect = form.querySelector('select[name="weekly_dir"]');
    const sp500Select = form.querySelector('select[name="sp500_up"]');
    const candleSelect = form.querySelector('select[name="buy_green_sell_red"]');

    const needTrends =
        (!!monthlySelect && !monthlySelect.value && !isDirty(form, 'monthly_dir')) ||
        (!!weeklySelect && !weeklySelect.value && !isDirty(form, 'weekly_dir'));
    const needSp500 =
        !!sp500Select && !sp500Select.value && !isDirty(form, 'sp500_up');
    const needCandle =
        !!candleSelect && !candleSelect.value && !isDirty(form, 'buy_green_sell_red');

    const tasks = [];
    if (needTrends) tasks.push(loadTrends(deal.stock, form));
    if (needCandle) tasks.push(loadCandleColor(deal.stock, form));
    if (needSp500) tasks.push(loadSp500Trend(form));

    if (tasks.length === 0) return;
    await Promise.allSettled(tasks);
}

// ---------- элементы DOM ----------
const elements = {
    newDealBtn: document.getElementById('newDealBtn'),
    openList: document.getElementById('openList'),
    closedList: document.getElementById('closedList'),
    filterInput: document.getElementById('filterInput'),
    openCount: document.getElementById('openCount'),
    closedCount: document.getElementById('closedCount'),
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

function setDealFormLoading(formContainer, isLoading, text = 'Loading...') {
    if (!formContainer) return;

    let overlay = formContainer.querySelector('.deal-form-loading');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'deal-form-loading';
        overlay.innerHTML = `
            <div class="deal-form-loading-inner">
                <span class="loading-spinner"></span>
                <span class="deal-form-loading-text"></span>
            </div>
        `;
        formContainer.appendChild(overlay);
    }

    const textEl = overlay.querySelector('.deal-form-loading-text');
    if (textEl) textEl.textContent = text || 'Loading...';

    overlay.style.display = isLoading ? 'flex' : 'none';
}

function parseNumber(val) {
    return parseFloat(String(val || '').trim().replace(',', '.')) || 0;
}

function parseMoney(val) {
    // Accept values like "$50.20", "50,20", " 50.20 " etc.
    const cleaned = String(val || '').trim().replace(/[^0-9,.\-]/g, '');
    return parseNumber(cleaned);
}

function getStopLossBasePrice(form) {
    // Stop loss % should be based on Average entry (Avrg price) when available,
    // otherwise fall back to Share price (current quote).
    const avgEl = form?.querySelector?.('[data-role="avg-entry-input"]');
    const avg = parseMoney(avgEl?.value);
    if (Number.isFinite(avg) && avg > 0) return avg;

    const shareEl = form?.querySelector?.('input[name="share_price"]');
    const share = parseMoney(shareEl?.value);
    return (Number.isFinite(share) && share > 0) ? share : 0;
}

function updateStopLossPercentBadge(form, percentage) {
    if (!form) return;
    if (!Number.isFinite(percentage)) return;

    const row = form.closest?.('.deal-row');
    const chips = row?.querySelector?.('.deal-summary .chips');
    if (!chips) return;

    let badge = chips.querySelector?.('[data-tooltip="Stop Loss Percentage"]');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'badge movement-metric-tooltip';
        badge.setAttribute('data-tooltip', 'Stop Loss Percentage');
        chips.appendChild(badge);
    }

    badge.textContent = `SL:${percentage.toFixed(2)}%`;

    badge.classList.remove('sl-percent-green', 'sl-percent-yellow', 'sl-percent-red');
    if (percentage <= 0) badge.classList.add('sl-percent-green');
    else if (percentage > 10) badge.classList.add('sl-percent-red');
    else if (percentage > 5) badge.classList.add('sl-percent-yellow');
}

function computeAthFromWeeklyBars(weeklyBars) {
    if (!Array.isArray(weeklyBars) || weeklyBars.length === 0) return 0;
    let ath = 0;
    for (const b of weeklyBars) {
        const h = Number(b?.High ?? b?.high ?? 0);
        if (Number.isFinite(h) && h > ath) ath = h;
    }
    return ath;
}

async function warnIfNearAthForNewDeal(form, ticker, priceNow) {
    // Warning popup only: do not block on API errors.
    // Trigger when price is within 10% of ATH (or above it).
    if (!form) return true;
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return true;

    const p = Number(priceNow);
    if (!Number.isFinite(p) || p <= 0) return true;

    // Avoid repeated warnings on the same form submission attempts.
    if (form.dataset.athWarnAck === '1') return true;

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(t)}`, { headers: authHeaders() });
        if (!res.ok) return true;
        const weeklyBars = await res.json();

        const ath = computeAthFromWeeklyBars(weeklyBars);
        if (!(ath > 0)) return true;

        const deltaPct = ((p - ath) / ath) * 100; // + above ATH, - below
        const absDelta = Math.abs(deltaPct);

        // Show warning if within 10% of ATH or above it.
        if (absDelta > 10) return true;

        const relation =
            Math.abs(deltaPct) < 0.01 ? 'at' : (deltaPct > 0 ? 'above' : 'below');
        const deltaText =
            Math.abs(deltaPct) < 0.01 ? '0.00%' : `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%`;

        const lines = [];
        lines.push('Price is near the all-time high (ATH).');
        lines.push('');
        lines.push(`Ticker: ${t}`);
        lines.push(`Current price: ${p.toFixed(2)}`);
        lines.push(`ATH (weekly high): ${ath.toFixed(2)}`);
        lines.push(`Distance to ATH: ${deltaText} (${relation})`);
        lines.push('');
        lines.push('Continue creating this deal?');

        const proceed = await showDealLimitModal(lines.join('\\n'), {
            title: 'Warning: near ATH',
            mode: 'confirm',
            okText: 'Continue',
            cancelText: 'Cancel'
        });

        if (proceed) {
            form.dataset.athWarnAck = '1';
        }
        return proceed;
    } catch {
        return true;
    }
}

function calculateRewardToRisk(entry, stopLoss, takeProfit) {
    const e = parseNumber(entry);
    const sl = parseNumber(stopLoss);
    const tp = parseNumber(takeProfit);

    if (!e || !sl || !tp) return null;

    const risk = e - sl;
    const reward = tp - e;

    if (risk <= 0 || reward <= 0) return null;
    return reward / risk;
}

function updateNewDealRewardToRiskBadge(row, form) {
    const badgeHost = row?.querySelector('.new-deal-title .reward-to-risk-badge');
    if (!badgeHost) return;

    const spInput = form?.querySelector('input[name="share_price"]');
    const slInput = form?.querySelector('input[name="stop_loss"]');
    const tpInput = form?.querySelector('input[name="take_profit"]');

    let ratio = calculateRewardToRisk(spInput?.value, slInput?.value, tpInput?.value);

    // Fallback: if user filled percentages (SL% / TP%) but not absolute prices,
    // ratio can be computed as TP% / SL%.
    if (!ratio) {
        const slPctInput = form?.querySelector('input[name="stop_loss_prcnt"]');
        const tpPctInput = form?.querySelector('input[name="take_profit_prcnt"]');
        const slPct = parseNumber(slPctInput?.value);
        const tpPct = parseNumber(tpPctInput?.value);
        if (slPct > 0 && tpPct > 0) {
            ratio = tpPct / slPct;
        }
    }

    if (!ratio) {
        badgeHost.innerHTML = '';
        return;
    }

    const ratioText = `1:${ratio.toFixed(1)}`;
    let colorClass = '';
    if (ratio <= 1.0) colorClass = 'reward-risk-red';
    else if (ratio <= 2.0) colorClass = 'reward-risk-yellow';
    else colorClass = 'reward-risk-green';

    badgeHost.innerHTML =
        `<div class="badge movement-metric-tooltip ${colorClass}" data-tooltip="Reward to Risk Ratio">R ${escapeHtml(ratioText)}</div>`;
}

function setupNewDealRewardToRiskBadge(row, form) {
    if (!row || !form) return;
    if (form.dataset.rrBadgeBound === '1') return;
    form.dataset.rrBadgeBound = '1';

    const handler = (e) => {
        const t = e?.target;
        // Update for any of the price fields (and allow bubbling to survive input cloning).
        if (t?.name === 'share_price' || t?.name === 'stop_loss' || t?.name === 'take_profit') {
            updateNewDealRewardToRiskBadge(row, form);
        }
    };

    form.addEventListener('input', handler);
    form.addEventListener('change', handler);

    // Initial render + delayed render (covers programmatic value updates after async loads).
    updateNewDealRewardToRiskBadge(row, form);
    setTimeout(() => updateNewDealRewardToRiskBadge(row, form), 600);
}

// Calculate total sum: share_price * sharesCount (returns string with 2 decimals or null)
function calculateTotalSum(sharePrice, amountToBuy) {
    const price = parseNumber(sharePrice);
    const amount = parseNumber(amountToBuy);
    const total = price * amount;
    return total > 0 ? total.toFixed(2) : null;
}

function sumStages(stages) {
    if (!Array.isArray(stages)) return 0;
    return stages.reduce((acc, n) => acc + (Number(n) > 0 ? Number(n) : 0), 0);
}

function calculateTotalSumFromStages(sharePrice, stages) {
    const price = parseNumber(sharePrice);
    const shares = sumStages(stages);
    const total = price * shares;
    return total > 0 ? total.toFixed(2) : null;
}

function calculateAvgEntryFromForm(form) {
    // Weighted average: sum(shares_i * buy_price_i) / sum(shares_i)
    const shareInputs = Array.from(form?.querySelectorAll('input[name="amount_tobuy_stages[]"]') || []);
    const priceInputs = Array.from(form?.querySelectorAll('input[name="buy_price_stages[]"]') || []);
    const n = Math.max(shareInputs.length, priceInputs.length);

    const quoteFallback = parseNumber(form?.dataset?.lastQuotePrice || '');

    let totalShares = 0;
    let totalCost = 0;
    for (let i = 0; i < n; i++) {
        const sh = parseNumber(shareInputs[i]?.value || '');
        // If stage buy price is not set, fall back to the last quote price (market buy).
        const pxRaw = parseNumber(priceInputs[i]?.value || '');
        const px = (pxRaw > 0) ? pxRaw : (quoteFallback > 0 ? quoteFallback : 0);
        if (sh > 0 && px > 0) {
            totalShares += sh;
            totalCost += sh * px;
        }
    }
    if (totalShares <= 0) return null;
    const avg = totalCost / totalShares;
    return Number.isFinite(avg) && avg > 0 ? avg : null;
}

function calculateAvgEntryFromDeal(deal) {
    // Weighted average: sum(shares_i * buy_price_i) / sum(shares_i)
    // If a stage buy price is missing, fall back to deal.share_price (current quote / entry).
    const sharesArr = Array.isArray(deal?.amount_tobuy_stages) ? deal.amount_tobuy_stages : [];
    const pricesArr = Array.isArray(deal?.buy_price_stages) ? deal.buy_price_stages : [];
    const n = Math.max(sharesArr.length, pricesArr.length);

    const quoteFallback = parseNumber(deal?.share_price || '');

    let totalShares = 0;
    let totalCost = 0;
    for (let i = 0; i < n; i++) {
        const sh = parseNumber(sharesArr[i] || '');
        let px = parseNumber(pricesArr[i] || '');
        if (!(px > 0) && quoteFallback > 0) px = quoteFallback;

        if (sh > 0 && px > 0) {
            totalShares += sh;
            totalCost += sh * px;
        }
    }
    if (totalShares <= 0) return null;
    const avg = totalCost / totalShares;
    return Number.isFinite(avg) && avg > 0 ? avg : null;
}

function getStagesFromDeal(deal) {
    // New format
    if (deal && Array.isArray(deal.amount_tobuy_stages) && deal.amount_tobuy_stages.length) {
        return deal.amount_tobuy_stages
            .map(v => parseNumber(v))
            .filter(n => n > 0);
    }
    // Legacy fallback (should be auto-migrated on server, but keep for safety)
    const s1 = parseNumber(deal?.amount_tobuy_stage_1);
    const s2 = parseNumber(deal?.amount_tobuy_stage_2);
    return [s1, s2].filter(n => n > 0);
}

function getStagesFromForm(form) {
    const inputs = Array.from(form?.querySelectorAll('input[name="amount_tobuy_stages[]"]') || []);
    return inputs
        .map(i => parseNumber(i.value))
        .filter(n => n > 0);
}

function updateAvgEntryUI(form) {
    if (!form) return;
    const el = form.querySelector('[data-role="avg-entry-input"]');
    const avg = calculateAvgEntryFromForm(form);
    if (el) {
        el.value = avg ? `$${avg.toFixed(2)}` : '';
    }

    // Keep SL% in sync when avg entry changes.
    // (SL% is now computed from Average entry when present.)
    try {
        calculateStopLossPercentage(form);
    } catch {
        // ignore
    }
}

function reindexStageRows(stagesBlock) {
    if (!stagesBlock) return;
    const inputs = Array.from(stagesBlock.querySelectorAll('input[name="amount_tobuy_stages[]"]'));
    inputs.forEach((input, i) => {
        input.dataset.stageIndex = String(i);
        if (i === 0) return; // stage 1 has no remove button and is rendered in base HTML
        const row = input.closest('.stages-row');
        const titleShares = row?.querySelector('.stage-title-shares');
        if (titleShares) titleShares.textContent = `Shares amount to buy (stage ${i + 1})`;

        const priceInput = row?.querySelector('input[name="buy_price_stages[]"]');
        if (priceInput) priceInput.dataset.stageIndex = String(i);
        const titlePrice = row?.querySelector('.stage-title-price');
        if (titlePrice) titlePrice.textContent = `Buy price (stage ${i + 1})`;
    });
}

function renderStagesUI(form, deal) {
    if (!form) return;
    const stagesBlock = form.querySelector('.stages-block');
    if (!stagesBlock) return;

    const stages = getStagesFromDeal(deal);
    const stage1Input = stagesBlock.querySelector('input[name="amount_tobuy_stages[]"][data-stage-index="0"]');
    if (stage1Input && stages.length > 0 && !stage1Input.value) {
        stage1Input.value = String(stages[0]);
    }

    const extra = stagesBlock.querySelector('.stages-extra');
    if (!extra) return;
    extra.innerHTML = '';

    for (let i = 1; i < stages.length; i++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'stage-wrapper';
        wrapper.innerHTML = `
            <div class="stages-row">
                <label class="stage-label">
                    <span class="stage-title-shares">Shares amount to buy (stage ${i + 1})</span>
                    <input type="text" class="amount-stage-input" data-stage-index="${i}" name="amount_tobuy_stages[]"
                           value="${escapeHtml(String(stages[i] ?? ''))}" placeholder="">
                </label>
                <label class="stage-label">
                    <span class="stage-title-price">Buy price (stage ${i + 1})</span>
                    <input type="text" class="buy-price-stage-input" data-stage-index="${i}" name="buy_price_stages[]"
                           value="${escapeHtml(String((deal?.buy_price_stages && deal.buy_price_stages[i]) ? deal.buy_price_stages[i] : ''))}" placeholder="">
                </label>
                <button type="button" class="remove-stage-btn secondary">Remove stage</button>
            </div>
        `;
        extra.appendChild(wrapper);
    }

    const addBtn = stagesBlock.querySelector('.add-stage-btn');
    if (addBtn && !addBtn.dataset.bound) {
        addBtn.dataset.bound = '1';
        addBtn.addEventListener('click', () => {
            const idx = stagesBlock.querySelectorAll('input[name="amount_tobuy_stages[]"]').length;
            const wrapper = document.createElement('div');
            wrapper.className = 'stage-wrapper';
            wrapper.innerHTML = `
                <div class="stages-row">
                    <label class="stage-label">
                        <span class="stage-title-shares">Shares amount to buy (stage ${idx + 1})</span>
                        <input type="text" class="amount-stage-input" data-stage-index="${idx}" name="amount_tobuy_stages[]"
                               value="" placeholder="">
                    </label>
                    <label class="stage-label">
                        <span class="stage-title-price">Buy price (stage ${idx + 1})</span>
                        <input type="text" class="buy-price-stage-input" data-stage-index="${idx}" name="buy_price_stages[]"
                               value="" placeholder="">
                    </label>
                    <button type="button" class="remove-stage-btn secondary">Remove stage</button>
                </div>
            `;
            extra.appendChild(wrapper);
            reindexStageRows(stagesBlock);

            const input = wrapper.querySelector('input');
            if (input) input.focus();
        });
    }

    // Bind remove handler once per stages block (event delegation).
    if (!stagesBlock.dataset.removeBound) {
        stagesBlock.dataset.removeBound = '1';
        stagesBlock.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('.remove-stage-btn');
            if (!btn) return;

            const wrapper = btn.closest('.stage-wrapper') || btn.closest('.stages-row')?.parentElement;
            if (wrapper) wrapper.remove();

            reindexStageRows(stagesBlock);

            // Trigger recalculations (total sum / limits) since DOM removal itself doesn't fire input events.
            const stage1 = stagesBlock.querySelector('input[name="amount_tobuy_stages[]"][data-stage-index="0"]')
                || stagesBlock.querySelector('input[name="amount_tobuy_stages[]"]');
            if (stage1) stage1.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    // Ensure indices/titles are consistent after initial render
    reindexStageRows(stagesBlock);

    // Refresh Avg entry after stages render (covers first expand + async data fills)
    updateAvgEntryUI(form);
}

// Function to format total sum for display
function formatTotalSum(totalSum) {
    if (!totalSum) return null;
    const num = parseFloat(String(totalSum).replace(',', '.'));
    if (isNaN(num) || num <= 0) return null;
    return `$${num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// Function to escape HTML special characters
function escapeHtml(str) {
    return String(str || '').replace(/[&<>"]/g, s => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
    }[s]));
}

// ===== Weekly setup detector: "reversal + retest + breakout above previous week high" (weekly + quote) =====
// We interpret indices as:
// b   = current week (in-progress) -> use quote P instead of close
// r   = b-1 (last completed week)  -> previous week, defines breakout high
// tau = b-2 (week before previous) -> defines support level S = L_tau
//
// Conditions (ATR-based buffers):
// 1) Impulse after tau: H_r >= S + gamma
// 2) Retest: |L_r - S| <= eps  AND  C_r >= S - eps  (optional: L_r >= L_tau)
// 3) Breakout trigger (quote): P >= H_r + delta
const weeklySetupDefaults = Object.freeze({
    atrPeriod: 14,
    epsAtrFrac: 0.25,      // ε = 0.25 * ATR
    gammaAtrFrac: 0.50,    // γ = 0.50 * ATR
    deltaAtrFrac: 0.10,    // δ = 0.10 * ATR
    fallbackEpsPct: 0.005, // 0.5% of S
    fallbackDeltaPct: 0.002, // 0.2% of H_r
    requireNoLowerLowOnRetest: true
});

function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
}

function normalizeWeekBar(b) {
    return {
        O: toNum(b?.Open ?? b?.open),
        H: toNum(b?.High ?? b?.high),
        L: toNum(b?.Low ?? b?.low),
        C: toNum(b?.Close ?? b?.close)
    };
}

function calcWeeklyAtr(weeklyBars, period = 14) {
    if (!Array.isArray(weeklyBars) || weeklyBars.length < 3) return null;
    const trs = [];
    for (let i = 1; i < weeklyBars.length; i++) {
        const p = normalizeWeekBar(weeklyBars[i - 1]);
        const c = normalizeWeekBar(weeklyBars[i]);
        if (![p.C, c.H, c.L].every(Number.isFinite)) continue;
        const tr = Math.max(
            c.H - c.L,
            Math.abs(c.H - p.C),
            Math.abs(c.L - p.C)
        );
        if (Number.isFinite(tr) && tr > 0) trs.push(tr);
    }
    if (trs.length < 3) return null;
    const slice = trs.slice(-Math.max(3, period));
    const avg = slice.reduce((a, x) => a + x, 0) / slice.length;
    return Number.isFinite(avg) ? avg : null;
}

function detectWeeklyReversalRetestBreakout(weeklyBars, quotePrice, opts = {}) {
    const cfg = { ...weeklySetupDefaults, ...(opts || {}) };

    if (!Array.isArray(weeklyBars) || weeklyBars.length < 4) {
        return { hasSetup: false, triggered: false, reason: 'Not enough weekly bars' };
    }

    // Decide whether the last candle represents the current in-progress week.
    // In our backend `PricePoint.Date` is the candle date (usually week ending/trading day),
    // so most of the time AlphaVantage weekly series does NOT include current week; last bar is last completed week.
    const last = weeklyBars[weeklyBars.length - 1];
    const lastDateRaw = last?.Date ?? last?.date;
    const lastDate = lastDateRaw ? new Date(lastDateRaw) : null;

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    // Monday start (local): convert JS Sunday=0..Saturday=6 -> Monday=0..Sunday=6
    startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));

    const lastIsCurrentWeek = !!(lastDate && lastDate >= startOfWeek);

    // r = last completed week; tau = week before r
    const rIdx = lastIsCurrentWeek ? (weeklyBars.length - 2) : (weeklyBars.length - 1);
    const tauIdx = rIdx - 1;
    if (tauIdx < 0) {
        return { hasSetup: false, triggered: false, reason: 'Not enough bars for tau/r' };
    }

    const r = normalizeWeekBar(weeklyBars[rIdx]);     // last completed week
    const tau = normalizeWeekBar(weeklyBars[tauIdx]); // week before last completed

    if (![r.O, r.H, r.L, r.C, tau.O, tau.H, tau.L, tau.C].every(Number.isFinite)) {
        return { hasSetup: false, triggered: false, reason: 'Bad OHLC values' };
    }

    const S = tau.L;
    // ATR: exclude current week bar only if it exists in the array
    const atrBars = lastIsCurrentWeek ? weeklyBars.slice(0, weeklyBars.length - 1) : weeklyBars;
    const atr = calcWeeklyAtr(atrBars, cfg.atrPeriod);
    const eps = atr ? (atr * cfg.epsAtrFrac) : (Math.abs(S) * cfg.fallbackEpsPct);
    const gamma = atr ? (atr * cfg.gammaAtrFrac) : (Math.abs(S) * (cfg.fallbackEpsPct * 2));
    const delta = atr ? (atr * cfg.deltaAtrFrac) : (Math.abs(r.H) * cfg.fallbackDeltaPct);

    // 1) Impulse after tau: previous week high must be meaningfully above support S
    const impulseOk = r.H >= (S + gamma);

    // 2) Retest: low near S and close not below S (beyond eps)
    const retestOk =
        Math.abs(r.L - S) <= eps &&
        r.C >= (S - eps) &&
        (!cfg.requireNoLowerLowOnRetest || r.L >= tau.L);

    const hasSetup = impulseOk && retestOk;
    const entryHigh = r.H;
    const entryTrigger = entryHigh + delta;
    const P = toNum(quotePrice);
    const triggered = Number.isFinite(P) ? (P >= entryTrigger) : false;

    // Suggested stop: under support with same delta buffer (simple, consistent)
    const stop = S - delta;

    return {
        hasSetup,
        triggered,
        support: S,
        entryHigh,
        entryTrigger,
        stop,
        debug: { atr, eps, gamma, delta, P, impulseOk, retestOk, rIdx, tauIdx }
    };
}

// Function to set button loading state with spinner (similar to login button)
function setButtonLoading(button, isLoading) {
    if (!button) return;

    if (isLoading) {
        // Если у кнопки заранее задан data-original-text (в HTML) — не трогаем.
        // Если нет — запоминаем текущий текст один раз.
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent.trim();
        }
        button.disabled = true;
        button.innerHTML = '<span class="loading-spinner"></span> Loading...';
    } else {
        button.disabled = false;
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
        }
        // data-original-text НЕ очищаем, чтобы текст кнопки не «переучивался»
        // при повторных включениях/выключениях спиннера.
    }
}

// Unified advisor-style modal for warnings and confirms (reuses the same design as other advisor popups)
// Returns Promise<boolean>: true = confirmed (only in confirm mode), false = closed/cancel/backdrop
function showDealLimitModal(message, opts = {}) {
    const {
        title = 'Deal limit warning',
        mode = 'info', // 'info' | 'confirm'
        okText = 'Continue',
        cancelText = 'Cancel'
    } = opts || {};

    return new Promise(resolve => {
        const modal = document.getElementById('dealLimitModal');
        const body = document.getElementById('dealLimitModalBody');
        const closeBtn = document.getElementById('dealLimitCloseBtn');
        const titleEl = document.getElementById('dealLimitModalTitle');

        const actions = document.getElementById('dealLimitModalActions');
        const okBtn = document.getElementById('dealLimitOkBtn');
        const cancelBtn = document.getElementById('dealLimitCancelBtn');

        if (!modal || !body || !closeBtn || !titleEl) {
            console.error('dealLimitModal elements not found in DOM');
            console.error('Deal limit message:', message);
            resolve(false);
            return;
        }

        titleEl.textContent = title;
        body.textContent = message;

        const isConfirm = String(mode).toLowerCase() === 'confirm';
        if (actions && okBtn && cancelBtn) {
            actions.style.display = isConfirm ? 'flex' : 'none';
            okBtn.textContent = okText;
            cancelBtn.textContent = cancelText;
        }

        modal.style.display = 'flex';

        function cleanup() {
            modal.style.display = 'none';
            closeBtn.removeEventListener('click', onClose);
            modal.removeEventListener('click', onBackdrop);

            if (okBtn) okBtn.removeEventListener('click', onOk);
            if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
        }

        function onClose() { cleanup(); resolve(false); }
        function onOk() { cleanup(); resolve(true); }
        function onCancel() { cleanup(); resolve(false); }

        function onBackdrop(e) {
            if (e.target === modal) {
                cleanup();
                resolve(false);
            }
        }

        closeBtn.addEventListener('click', onClose);
        modal.addEventListener('click', onBackdrop);

        if (isConfirm && okBtn && cancelBtn) {
            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
        }
    });
}

// Close deal modal with required close price.
// Returns Promise<number|null>: number = close price, null = cancelled/closed.
function showCloseDealModal(opts = {}) {
    const { ticker = '', defaultPrice = '' } = opts || {};

    return new Promise(resolve => {
        const modal = document.getElementById('closeDealModal');
        const closeBtn = document.getElementById('closeDealModalCloseBtn');
        const cancelBtn = document.getElementById('closeDealCancelBtn');
        const okBtn = document.getElementById('closeDealOkBtn');
        const input = document.getElementById('closeDealPriceInput');
        const err = document.getElementById('closeDealPriceError');
        const hint = document.getElementById('closeDealTickerHint');

        if (!modal || !closeBtn || !cancelBtn || !okBtn || !input || !err || !hint) {
            console.error('closeDealModal elements not found in DOM');
            resolve(null);
            return;
        }

        hint.textContent = ticker ? `Ticker: ${ticker}` : '';
        input.value = defaultPrice != null && String(defaultPrice).trim() !== '' ? String(defaultPrice) : '';
        err.style.display = 'none';
        err.textContent = '';

        modal.style.display = 'flex';
        try { input.focus(); } catch { }

        function cleanup() {
            modal.style.display = 'none';
            closeBtn.removeEventListener('click', onCancel);
            cancelBtn.removeEventListener('click', onCancel);
            okBtn.removeEventListener('click', onOk);
            modal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKeydown);
        }

        function onCancel() {
            cleanup();
            resolve(null);
        }

        function onOk() {
            const v = parseFloat(String(input.value || '').replace(',', '.'));
            if (!Number.isFinite(v) || v <= 0) {
                err.textContent = 'Close price is required and must be > 0.';
                err.style.display = 'block';
                try { input.focus(); } catch { }
                return;
            }
            cleanup();
            resolve(v);
        }

        function onBackdrop(e) {
            if (e.target === modal) onCancel();
        }

        function onKeydown(e) {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter') onOk();
        }

        closeBtn.addEventListener('click', onCancel);
        cancelBtn.addEventListener('click', onCancel);
        okBtn.addEventListener('click', onOk);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKeydown);
    });
}

// Reusable confirm-style modal for weekly activations warning
function showWeeklyConfirmModal(message) {
    return new Promise(resolve => {
        const modal     = document.getElementById('weeklyConfirmModal');
        const body      = document.getElementById('weeklyConfirmModalBody');
        const okBtn     = document.getElementById('weeklyConfirmOkBtn');
        const cancelBtn = document.getElementById('weeklyConfirmCancelBtn');

        if (!modal || !body || !okBtn || !cancelBtn) {
            console.error('weeklyConfirmModal elements not found in DOM');
            console.error('Weekly confirm message:', message);
            // Если модалка не найдена — на всякий случай ведём себя как «Cancel»
            resolve(false);
            return;
        }

        body.textContent = message;
        // Используем flex, чтобы сработало центрирование по .modal в deals.css
        modal.style.display = 'flex';

        function cleanup() {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
        }

        function onOk() {
            cleanup();
            resolve(true);
        }

        function onCancel() {
            cleanup();
            resolve(false);
        }

        function onBackdrop(e) {
            if (e.target === modal) {
                cleanup();
                resolve(false);
            }
        }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
    });
}

// Reusable timing warning modal (ET Friday 14:00–16:00)
function showDealTimingModal(message) {
    return new Promise(resolve => {
        const modal     = document.getElementById('dealTimingModal');
        const body      = document.getElementById('dealTimingModalBody');
        const okBtn     = document.getElementById('dealTimingOkBtn');
        const cancelBtn = document.getElementById('dealTimingCancelBtn');

        if (!modal || !body || !okBtn || !cancelBtn) {
            console.error('dealTimingModal elements not found in DOM');
            resolve(false);
            return;
        }

        body.textContent = message;
        modal.style.display = 'flex';

        function cleanup() {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
        }

        function onOk() {
            cleanup();
            resolve(true);
        }

        function onCancel() {
            cleanup();
            resolve(false);
        }

        function onBackdrop(e) {
            if (e.target === modal) {
                onCancel();
            }
        }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
    });
}

// Check if current time is Friday 14:00–16:00 ET
function isEtFridayLast2Hours() {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay(); // 0 Sun ... 5 Fri
    const hour = et.getHours();
    const minute = et.getMinutes();
    const isFriday = day === 5;
    const inWindow = (hour > 14 || (hour === 14 && minute >= 0)) && hour < 16;
    return isFriday && inWindow;
}

// ===== TRADINGVIEW CHART HELPERS =====

function buildSymbolFromTicker(ticker) {
    if (!ticker) return null;
    const cleaned = String(ticker).trim().toUpperCase();
    if (!cleaned) return null;
    // TradingView widget in this setup expects plain ticker, e.g. "NVDA"
    return cleaned;
}

// Render (or re-render) TradingView widget in a given container
function renderTradingViewChart(containerId, symbol, interval) {
    if (typeof window.TradingView === 'undefined') {
        console.warn('TradingView library is not loaded yet');
        return;
    }

    const container = document.getElementById(containerId);
    if (!container) {
        console.warn('Chart container not found:', containerId);
        return;
    }

    // Clear container to avoid multiple iframes
    container.innerHTML = '';

    // eslint-disable-next-line no-undef
    new TradingView.widget({
        container_id: containerId,
        symbol,
        interval: interval || 'W',
        theme: 'dark',
        style: '1',
        locale: 'en',
        autosize: true,
        hide_top_toolbar: false,
        hide_legend: false
    });
}

// Format total sum for display
function formatTotalSum(totalSum) {
    if (!totalSum) return '';
    const num = parseFloat(String(totalSum).replace(',', '.')) || 0;
    return num > 0 ? `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
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

// ---------- JWT helpers ----------
function isJwtExpired(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return true;

        const payloadJson = atob(parts[1]);
        const payload = JSON.parse(payloadJson);

        if (!payload.exp) return true;

        const expMs = payload.exp * 1000; // exp в секундах
        const nowMs = Date.now();

        // небольшой запас 30 секунд, чтобы не упираться в границу
        return nowMs > expMs - 30000;
    } catch (e) {
        console.error('Failed to parse JWT', e);
        return true;
    }
}

// ---------- редирект если нет токена ИЛИ он истёк ----------
const token = localStorage.getItem('token');
if (!token || isJwtExpired(token)) {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
}

// ---------- заголовки авторизации ----------
function authHeaders() {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}

// ---------- универсальный fetch с авто-обработкой 401/403 ----------
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
        window.location.href = '/login.html';
        throw new Error('Unauthorized, redirect to login');
    }

    return response;
}

// ========== PORTFOLIO inline edit ==========
// Helper function to setup inline editing for portfolio fields
function setupPortfolioField(spanElement, localStorageKey, apiEndpoint, fieldName) {
    console.log('setupPortfolioField called:', { fieldName, element: spanElement, id: spanElement?.id });
    if (!spanElement) {
        console.error('setupPortfolioField: spanElement is null/undefined');
        return;
    }

    // Initialize from localStorage
    (function initField() {
        const stored = localStorage.getItem(localStorageKey);
        if (stored != null) {
            const num = Number(stored);
            spanElement.textContent = isNaN(num) ? stored : num.toFixed(2);
        }
    })();

    spanElement.addEventListener('click', () => {
        console.log('CLICK EVENT: Clicked on portfolio field:', fieldName, 'element:', spanElement);
        console.log('CLICK EVENT: Current data-editing value:', spanElement.dataset.editing);
        
        // If already editing, try to clean up and reset
        if (spanElement.dataset.editing === '1') {
            console.log('CLICK EVENT: Already editing, cleaning up...');
            // Remove any existing input
            const existingInput = spanElement.querySelector('input.portfolio-input');
            if (existingInput && existingInput.parentNode === spanElement) {
                console.log('CLICK EVENT: Found existing input, removing it');
                try {
                    spanElement.removeChild(existingInput);
                } catch (err) {
                    console.warn('CLICK EVENT: Input already removed, continuing');
                }
            }
            // Reset editing state
            spanElement.dataset.editing = '';
            console.log('CLICK EVENT: Reset data-editing, continuing with new edit');
            // Continue to create new input below
        }

        const currentText = spanElement.textContent.trim();
        const current = Number(currentText.replace(',', '.')) || 0;
        console.log('CLICK EVENT: Current value:', { currentText, current });

        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.min = '0';
        input.value = current.toString();
        input.className = 'portfolio-input';

        spanElement.textContent = '';
        spanElement.appendChild(input);
        spanElement.dataset.editing = '1';
        console.log('CLICK EVENT: Input created and appended, fieldName:', fieldName);

        input.focus();
        input.select();

        const finish = async (save) => {
            console.log('finish called:', { save, fieldName, editing: spanElement.dataset.editing });
            if (spanElement.dataset.editing !== '1') {
                console.log('finish: Not editing, returning');
                return;
            }
            
            // Remove input from DOM first
            if (input && input.parentNode === spanElement) {
                try {
                    spanElement.removeChild(input);
                    console.log('finish: Input removed from DOM');
                } catch (err) {
                    console.warn('finish: Input already removed from DOM:', err);
                }
            } else if (input) {
                console.log('finish: Input exists but is not a child of spanElement');
            }
            
            // Clear editing state
            spanElement.dataset.editing = '';

            let newVal = current;
            if (save) {
                const parsed = Number(input.value.replace(',', '.'));
                newVal = isNaN(parsed) ? current : parsed;
                console.log('finish: Parsed value:', { inputValue: input.value, parsed, newVal, current });
            }

            // Set new value
            spanElement.textContent = newVal.toFixed(2);
            console.log('finish: Updated spanElement.textContent to:', newVal.toFixed(2));

            if (save) {
                localStorage.setItem(localStorageKey, String(newVal));
                console.log('finish: Saved to localStorage, fieldName:', fieldName, 'isPortfolio:', fieldName === 'portfolio');

                // If Cash was updated, recalculate Total Sum immediately (before saving to DB)
                if (fieldName === 'portfolio') {
                    console.log('finish: Cash field detected, calling calculateAndUpdateTotalSum...');
                    // Wait for next tick to ensure DOM is updated, then calculate
                    await new Promise(resolve => setTimeout(resolve, 0));
                    console.log('finish: About to call calculateAndUpdateTotalSum');
                    await calculateAndUpdateTotalSum();
                    console.log('finish: calculateAndUpdateTotalSum completed');
                    // Refresh Risk value after Total Sum is updated
                    await calculateAndDisplayPortfolioRisk();
                } else {
                    console.log('finish: Not portfolio field, skipping Total Sum calculation');
                }

                try {
                    // Use PascalCase for API request (matching C# record property names)
                    const pascalFieldName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
                    const requestBody = {};
                    requestBody[pascalFieldName] = newVal;
                    const res = await apiFetch(apiEndpoint, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            ...authHeaders()
                        },
                        body: JSON.stringify(requestBody)
                    });
                    if (!res.ok) {
                        console.error(`Failed to save ${fieldName}`, res.status);
                    } else {
                        console.log(`${fieldName} saved to DB:`, newVal);
                        // Total Sum already recalculated and saved above
                    }
                } catch (e) {
                    console.error(`Error saving ${fieldName}`, e);
                }
            }
        };

        input.addEventListener('blur', async (e) => {
            console.log('BLUR EVENT: Input blur triggered for field:', fieldName, 'element:', input);
            console.log('BLUR EVENT: Current data-editing:', spanElement.dataset.editing);
            console.log('BLUR EVENT: Input value:', input.value);
            
            // Ensure we finish editing even if something went wrong
            try {
                // Check if we're still in editing mode
                if (spanElement.dataset.editing === '1') {
                    console.log('BLUR EVENT: Calling finish(true)...');
                    await finish(true);
                    console.log('BLUR EVENT: finish(true) completed');
                } else {
                    console.log('BLUR EVENT: Not in editing mode, but cleaning up anyway');
                    // Clean up anyway
                    if (input && input.parentNode === spanElement) {
                        const currentValue = input.value || spanElement.textContent;
                        spanElement.removeChild(input);
                        spanElement.textContent = currentValue;
                        spanElement.dataset.editing = '';
                    }
                }
                
                // Additional call to ensure Total Sum is recalculated after blur if it's Cash field
                if (fieldName === 'portfolio') {
                    console.log('BLUR EVENT: Portfolio field, scheduling additional recalculation...');
                    setTimeout(async () => {
                        console.log('BLUR EVENT: Executing delayed calculateAndUpdateTotalSum');
                        await calculateAndUpdateTotalSum();
                        console.log('BLUR EVENT: Delayed calculateAndUpdateTotalSum completed');
                        // Refresh Risk value after Total Sum is updated
                        await calculateAndDisplayPortfolioRisk();
                        await calculateAndDisplayInSharesRisk();
                    }, 200);
                } else {
                    console.log('BLUR EVENT: Not portfolio field, fieldName is:', fieldName);
                }
            } catch (err) {
                console.error('BLUR EVENT: Error in blur handler:', err);
                // Force cleanup on error
                try {
                    if (input && input.parentNode === spanElement) {
                        spanElement.removeChild(input);
                        spanElement.dataset.editing = '';
                    }
                } catch (cleanupErr) {
                    console.error('BLUR EVENT: Error during cleanup:', cleanupErr);
                }
            }
        });
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                console.log('ENTER EVENT: Enter key pressed for field:', fieldName);
                e.preventDefault();
                try {
                    await finish(true);
                    console.log('ENTER EVENT: finish(true) completed');
                    // Additional call to ensure Total Sum is recalculated after Enter if it's Cash field
                    if (fieldName === 'portfolio') {
                        console.log('ENTER EVENT: Portfolio field, scheduling additional recalculation...');
                        setTimeout(async () => {
                            console.log('ENTER EVENT: Executing delayed calculateAndUpdateTotalSum');
                            await calculateAndUpdateTotalSum();
                            console.log('ENTER EVENT: Delayed calculateAndUpdateTotalSum completed');
                            // Refresh Risk value after Total Sum is updated
                            await calculateAndDisplayPortfolioRisk();
                            await calculateAndDisplayInSharesRisk();
                        }, 200);
                    } else {
                        console.log('ENTER EVENT: Not portfolio field, fieldName is:', fieldName);
                    }
                } catch (err) {
                    console.error('ENTER EVENT: Error in Enter handler:', err);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finish(false);
            }
        });
    });
}

// Initialize portfolio fields when DOM is ready
function initPortfolioFields() {
    console.log('initPortfolioFields: Starting initialization...');
    const portfolioSpan = document.getElementById('portfolioValue');
    const totalSumSpan = document.getElementById('totalSumValue');
    const inSharesSpan = document.getElementById('inSharesValue');
    const inPlannedSpan = document.getElementById('inPlannedValue');

    console.log('initPortfolioFields: Found elements:', {
        portfolioSpan: !!portfolioSpan,
        totalSumSpan: !!totalSumSpan,
        inSharesSpan: !!inSharesSpan,
        inPlannedSpan: !!inPlannedSpan
    });

    if (portfolioSpan) {
        console.log('initPortfolioFields: Setting up portfolio field (Cash)');
        setupPortfolioField(portfolioSpan, 'portfolio', '/api/users/portfolio', 'portfolio');
    } else {
        console.error('initPortfolioFields: portfolioSpan not found!');
    }
    // Total Sum is readonly - calculated automatically, no editing
    // if (totalSumSpan) {
    //     setupPortfolioField(totalSumSpan, 'totalSum', '/api/users/totalsum', 'totalSum');
    // }
    // In Shares is readonly - calculated automatically, no editing
    // if (inSharesSpan) {
    //     setupPortfolioField(inSharesSpan, 'inShares', '/api/users/inshares', 'inShares');
    // }

    // Load values from API on page load
    async function loadPortfolioValues() {
        try {
            // Load portfolio
            const portfolioRes = await apiFetch('/api/users/portfolio', {
                headers: authHeaders()
            });
            if (portfolioRes.ok) {
                const portfolioData = await portfolioRes.json();
                const portfolio = portfolioData.portfolio ?? portfolioData.Portfolio;
                if (portfolio !== undefined && portfolioSpan) {
                    const val = Number(portfolio) || 0;
                    portfolioSpan.textContent = val.toFixed(2);
                    localStorage.setItem('portfolio', String(val));
                }
            }

            // Total Sum is calculated automatically (Cash + In Shares), not loaded from DB

            // Load inShares
            const inSharesRes = await apiFetch('/api/users/inshares', {
                headers: authHeaders()
            });
            if (inSharesRes.ok) {
                const inSharesData = await inSharesRes.json();
                const inShares = inSharesData.inShares ?? inSharesData.InShares;
                if (inShares !== undefined && inSharesSpan) {
                    const val = Number(inShares) || 0;
                    inSharesSpan.textContent = val.toFixed(2);
                    localStorage.setItem('inShares', String(val));
                }
            }
            
            // After loading all values, calculate Total Sum (Cash + In Shares + In Planned)
            await calculateAndUpdateTotalSum();
        } catch (e) {
            console.error('Error loading portfolio values', e);
        }
    }

    // Load values when page loads
    loadPortfolioValues();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPortfolioFields);
} else {
    initPortfolioFields();
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
                    const res = await apiFetch('/api/users/portfolio', {
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
        const res = await apiFetch('/api/stocks', {
            headers: authHeaders()
        });

        if (!res.ok) {
            throw new Error('Failed to load stocks for deals');
        }

        const stocks = await res.json();
        stocksCache = stocks || []; // Update cache
        return stocksCache;
    } catch (err) {
        console.error(err);
        stocksCache = [];
        return [];
    }
}

// Function to get stock by ticker from cache
function getStockByTicker(ticker) {
    if (!ticker || !stocksCache || stocksCache.length === 0) return null;
    return stocksCache.find(s => s.ticker === ticker) || null;
}

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
        window.warningsCache = warnings || [];
        return window.warningsCache;
    } catch (err) {
        console.error(err);
        window.warningsCache = [];
        return [];
    }
}

// Function to get warning by ticker from cache
function getWarningByTicker(ticker) {
    const cache = window.warningsCache || [];
    if (!ticker || !cache || cache.length === 0) return null;
    return cache.find(w => w.ticker === ticker?.toUpperCase()) || null;
}

// ========== ЗАГРУЗКА СДЕЛОК ==========

async function loadDeals() {
    try {
        const dirtyMap = captureDirtyMap(deals);
        const res = await apiFetch('/api/deals', {
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

        const freshDeals = await res.json();
        applyDirtyMap(freshDeals, dirtyMap);
        deals = freshDeals;
        dealsLoaded = true;
        
        // Load stocks and warnings to cache for volume indicator
        await loadStocksForDeals();
        await loadWarnings();
        
        renderAll();

        // IMPORTANT:
        // Server-side portfolio risk uses user.TotalSum as denominator.
        // TotalSum/InShares are maintained by the client (via /api/users/inshares and /api/users/totalsum),
        // so we must update those first before requesting risk to avoid showing 0.00%.
        await calculateAndUpdateInShares(); // also updates TotalSum and InShares risk

        // Now calculate and display portfolio risk after totals are up to date
        await calculateAndDisplayPortfolioRisk();
    } catch (e) {
        console.error('Load deals error', e);
        dealsLoaded = true;
    }
}

// Calculate total sum of all deals and update In Shares field
async function calculateAndUpdateInShares() {
    try {
        // Calculate total sum of only OPEN, ACTIVE (non-planned) deals
        let totalInShares = 0;
        
        deals.forEach(deal => {
            // Skip closed deals
            if (deal.closed) {
                return;
            }

            // Skip planned (future) deals - they are accounted separately in "In Planned"
            if (deal.planned_future) {
                return;
            }
            
            // Try to get total_sum from deal, or calculate it
            let dealTotal = 0;
            
            if (deal.total_sum) {
                // Use existing total_sum if available
                dealTotal = parseFloat(String(deal.total_sum).replace(',', '.')) || 0;
            } else {
                // Calculate from share_price * sum(amount_tobuy_stages)
                const sharePrice = parseNumber(deal.share_price);
                const stages = getStagesFromDeal(deal);
                dealTotal = sharePrice * sumStages(stages);
            }
            
            totalInShares += dealTotal;
        });
        
        // Update In Shares field
        const inSharesSpan = document.getElementById('inSharesValue');
        if (inSharesSpan) {
            const roundedTotal = Number(totalInShares.toFixed(2));
            inSharesSpan.textContent = roundedTotal.toFixed(2);
            localStorage.setItem('inShares', String(roundedTotal));
            
            // Save to database
            try {
                const res = await apiFetch('/api/users/inshares', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authHeaders()
                    },
                    body: JSON.stringify({ InShares: roundedTotal })
                });
                if (!res.ok) {
                    console.error('Failed to save In Shares', res.status);
                } else {
                    console.log('In Shares updated to:', roundedTotal);
                }
            } catch (e) {
                console.error('Error saving In Shares', e);
            }
        }

        // After updating In Shares, also recalculate In Planned (planned future deals)
        await calculateAndUpdateInPlanned();
        
        // After updating In Shares, calculate Total Sum (Cash + In Shares + In Planned)
        await calculateAndUpdateTotalSum();
        
        // After updating In Shares, also update Risk (In Shares)
        await calculateAndDisplayInSharesRisk();
    } catch (e) {
        console.error('Error calculating In Shares', e);
    }
}

// Calculate total sum of all planned (future) open deals and update In Planned field
async function calculateAndUpdateInPlanned() {
    try {
        let totalPlanned = 0;

        deals.forEach(deal => {
            // Consider only planned and not closed deals
            if (!deal || !deal.planned_future || deal.closed) {
                return;
            }

            let dealTotal = 0;

            if (deal.total_sum) {
                // Use existing total_sum if available
                dealTotal = parseFloat(String(deal.total_sum).replace(',', '.')) || 0;
            } else {
                // Fallback: calculate from share_price * sum(amount_tobuy_stages)
                const sharePrice = parseNumber(deal.share_price);
                const stages = getStagesFromDeal(deal);
                dealTotal = sharePrice * sumStages(stages);
            }

            totalPlanned += dealTotal;
        });

        const inPlannedSpan = document.getElementById('inPlannedValue');
        if (inPlannedSpan) {
            const roundedTotal = Number(totalPlanned.toFixed(2));
            inPlannedSpan.textContent = roundedTotal.toFixed(2);
            localStorage.setItem('inPlanned', String(roundedTotal));
        }
    } catch (e) {
        console.error('Error calculating In Planned', e);
    }
}

// Calculate and update Total Sum field (Cash + In Shares)
async function calculateAndUpdateTotalSum() {
    try {
        console.log('calculateAndUpdateTotalSum: Starting calculation...');
        const portfolioSpan = document.getElementById('portfolioValue');
        const inSharesSpan = document.getElementById('inSharesValue');
        const totalSumSpan = document.getElementById('totalSumValue');
        
        if (!portfolioSpan || !inSharesSpan || !totalSumSpan) {
            console.error('calculateAndUpdateTotalSum: Missing required elements', {
                portfolioSpan: !!portfolioSpan,
                inSharesSpan: !!inSharesSpan,
                totalSumSpan: !!totalSumSpan
            });
            return;
        }
        
        // Get Cash value - read directly from textContent
        const cashStr = portfolioSpan.textContent.trim().replace(',', '.');
        const cash = parseFloat(cashStr) || 0;
        console.log('calculateAndUpdateTotalSum: Cash value from DOM:', cashStr, 'parsed:', cash);
        
        // Get In Shares value
        const inSharesStr = inSharesSpan.textContent.trim().replace(',', '.');
        const inShares = parseFloat(inSharesStr) || 0;
        console.log('calculateAndUpdateTotalSum: In Shares value from DOM:', inSharesStr, 'parsed:', inShares);
        
        // Calculate Total Sum = Cash + In Shares
        const totalSum = cash + inShares;
        const roundedTotal = Number(totalSum.toFixed(2));
        
        console.log('calculateAndUpdateTotalSum: Calculated values', {
            cash,
            inShares,
            totalSum: roundedTotal,
            oldTotalSum: totalSumSpan.textContent
        });
        
        // Update Total Sum field
        const oldValue = totalSumSpan.textContent;
        totalSumSpan.textContent = roundedTotal.toFixed(2);
        localStorage.setItem('totalSum', String(roundedTotal));
        console.log('calculateAndUpdateTotalSum: Updated UI from', oldValue, 'to', roundedTotal.toFixed(2));
        
        // Save to database
        try {
            const res = await apiFetch('/api/users/totalsum', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders()
                },
                body: JSON.stringify({ TotalSum: roundedTotal })
            });
            if (!res.ok) {
                console.error('Failed to save Total Sum', res.status);
            } else {
                console.log('Total Sum updated to:', roundedTotal);
            }
        } catch (e) {
            console.error('Error saving Total Sum', e);
        }

        // Update planned "+Risk" badges (depends on Total Sum in header)
        try {
            updatePlannedRiskBadges();
        } catch {
            // ignore
        }
    } catch (e) {
        console.error('Error calculating Total Sum', e);
    }
}

async function saveDealToServer(deal, isEdit) {
    const hasValidId = typeof deal.id === 'string' && deal.id.trim().length === 24;
    const url = isEdit && hasValidId ? `/api/deals/${deal.id}` : '/api/deals';
    const method = isEdit && hasValidId ? 'PUT' : 'POST';

    const res = await apiFetch(url, {
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
    
    // After saving deal, recalculate In Shares, Cash, and Total Sum
    // This happens on the server side (Cash is deducted), so we need to refresh from server
    await refreshPortfolioFromServer();
    await calculateAndUpdateInShares();
    await calculateAndUpdateTotalSum();
}

// Refresh Cash (Portfolio) value from server
async function refreshPortfolioFromServer() {
    try {
        const res = await apiFetch('/api/users/portfolio', {
            headers: authHeaders()
        });
        if (res.ok) {
            const portfolioData = await res.json();
            const portfolio = portfolioData.portfolio ?? portfolioData.Portfolio;
            if (portfolio !== undefined) {
                const portfolioSpan = document.getElementById('portfolioValue');
                if (portfolioSpan) {
                    const val = Number(portfolio) || 0;
                    portfolioSpan.textContent = val.toFixed(2);
                    localStorage.setItem('portfolio', String(val));
                }
            }
        }
    } catch (e) {
        console.error('Error refreshing portfolio from server', e);
    }
}

// Handle deal form submission
async function handleDealSubmit(form, deal, isNew) {
    const formData = new FormData(form);
    const dealData = {};
    
    // Collect all form fields
    for (const [key, value] of formData.entries()) {
        dealData[key] = value;
    }
    
    // If editing, preserve the deal ID
    if (deal && deal.id) {
        dealData.id = deal.id;
    }
    
    try {
        await saveDealToServer(dealData, !!deal?.id);
        
        // Reload deals to show the updated list
        await loadDeals();
        
        // Calculate and display portfolio risk after saving deal
        await calculateAndDisplayPortfolioRisk();
        
        // If this was a new deal, close the form
        if (isNew) {
            newDealRow = null;
            expandedDealId = null;
            renderAll();
        }
    } catch (e) {
        console.error('Error saving deal', e);
        alert('Failed to save deal.');
    }
}

async function deleteDealOnServer(id) {
    const res = await apiFetch(`/api/deals/${id}`, {
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

// ========== HAMBURGER MENU ==========

const menuToggle = document.getElementById('menuToggle');
const mobileMenu = document.getElementById('mobileMenu');
const mobileMenuOverlay = document.createElement('div');
mobileMenuOverlay.className = 'mobile-menu-overlay';
document.body.appendChild(mobileMenuOverlay);

// Mobile menu buttons (clone functionality from desktop buttons)
const newDealBtnMobile = document.getElementById('newDealBtnMobile');
const logoutBtnMobile = document.getElementById('logoutBtnMobile');

if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
        const isOpen = mobileMenu.classList.contains('open');
        
        if (isOpen) {
            closeMobileMenu();
        } else {
            openMobileMenu();
        }
    });
    
    // Close menu when clicking overlay
    mobileMenuOverlay.addEventListener('click', closeMobileMenu);
    
    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
            closeMobileMenu();
        }
    });
}

function openMobileMenu() {
    if (mobileMenu) {
        mobileMenu.classList.add('open');
        mobileMenuOverlay.classList.add('active');
        if (menuToggle) menuToggle.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
}

function closeMobileMenu() {
    if (mobileMenu) {
        mobileMenu.classList.remove('open');
        mobileMenuOverlay.classList.remove('active');
        if (menuToggle) menuToggle.classList.remove('active');
        document.body.style.overflow = ''; // Restore scrolling
    }
}

// Wire up mobile menu buttons to same functionality as desktop buttons
if (newDealBtnMobile && elements.newDealBtn) {
    newDealBtnMobile.addEventListener('click', () => {
        // Trigger the same action as desktop New Deal button
        elements.newDealBtn.click();
        closeMobileMenu();
    });
}

if (logoutBtnMobile && elements.logoutBtn) {
    logoutBtnMobile.addEventListener('click', () => {
        // Trigger the same action as desktop Logout button
        elements.logoutBtn.click();
        closeMobileMenu();
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
                <label>
                    Share price
                    <input type="text" name="share_price" value="${escapeHtml(String(deal?.share_price || ''))}" placeholder="">
                    <span class="avg-entry-label">Avrg price</span>
                    <input type="text" class="avg-entry-input" data-role="avg-entry-input" value="" readonly placeholder="">
                </label>
                <input type="hidden" name="share_price_manual" value="${escapeHtml(String(!!deal?.share_price_manual))}">
               
                <div class="stages-block full">
                    <div class="stages-row">
                        <label class="stage-label">
                            Shares amount to buy (stage 1)
                            <input type="text" class="amount-stage-input" data-stage-index="0" name="amount_tobuy_stages[]"
                                   value="${escapeHtml((deal?.amount_tobuy_stages && deal.amount_tobuy_stages[0]) ? deal.amount_tobuy_stages[0] : (deal?.amount_tobuy_stage_1 || ''))}"
                                   placeholder="">
                        </label>
                        <label class="stage-label">
                            Buy price (stage 1)
                            <input type="text" class="buy-price-stage-input" data-stage-index="0" name="buy_price_stages[]"
                                   value="${escapeHtml((deal?.buy_price_stages && deal.buy_price_stages[0]) ? deal.buy_price_stages[0] : '')}"
                                   placeholder="">
                        </label>
                        <button type="button" class="add-stage-btn secondary">Add stage</button>
                    </div>
                    <div class="stages-extra"></div>
                </div>
                <label>Take profit<input type="text" name="take_profit" value="${escapeHtml(deal?.take_profit || '')}" placeholder=""></label>
                <label>Take profit %?<input type="text" name="take_profit_prcnt" value="${escapeHtml(deal?.take_profit_prcnt || '')}" placeholder=""></label>
                <label>Stop loss<input type="text" name="stop_loss" value="${escapeHtml(deal?.stop_loss || '')}" placeholder=""></label>
                <label>
                    Stop loss %?
                    <input type="text" name="stop_loss_prcnt" value="${escapeHtml(deal?.stop_loss_prcnt || '')}" placeholder="">
                    <small class="deal-risk-amount" data-role="deal-risk-amount">Risk: -</small>
                </label>

                <!--<label>
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
                </label>-->

                <label>
                    S&P 500 monthly trend
                    <select name="sp500_up">
                        <option value="" ${!deal?.sp500_up ? 'selected' : ''} disabled></option>
                        <option ${deal?.sp500_up === 'Down' ? 'selected' : ''}>Down</option>
                        <option ${deal?.sp500_up === 'Flat' ? 'selected' : ''}>Flat</option>
                        <option ${deal?.sp500_up === 'Up' ? 'selected' : ''}>Up</option>
                    </select>
                </label>

                <!--<label>
                    The share is in end of reversal pattern?
                    <select name="reversal">
                        <option value="" ${!deal?.reversal ? 'selected' : ''} disabled></option>
                        <option value="no" ${deal?.reversal === 'no' ? 'selected' : ''}>No</option>
                        <option value="yes" ${deal?.reversal === 'yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>-->
                <label>
                    Price range according all share history
                    <select name="price_range_pos">
                        <option value="" ${!deal?.price_range_pos ? 'selected' : ''} disabled></option>
                        <option value="1" ${deal?.price_range_pos === '1' ? 'selected' : ''}>Bottom</option>
                        <option value="2" ${deal?.price_range_pos === '2' ? 'selected' : ''}>Middle</option>
                        <option value="3" ${deal?.price_range_pos === '3' ? 'selected' : ''}>Highest</option>
                    </select>
                </label>

                <label>Support price on week timeline<input type="text" name="support_price" value="${escapeHtml(deal?.support_price || '')}" placeholder=""></label>
                <label>O price previous week<input type="text" name="o_price" value="${escapeHtml(deal?.o_price || '')}" placeholder=""></label>
                <label>H price previous week<input type="text" name="h_price" value="${escapeHtml(deal?.h_price || '')}" placeholder=""></label>

                <!--<label>
                    What is the timeframe you make decision
                    <select name="timeframe">
                        <option value="" ${!deal?.timeframe ? 'selected' : ''} disabled></option>
                        <option ${deal?.timeframe === 'Daily' ? 'selected' : ''}>Daily</option>
                        <option ${deal?.timeframe === 'Weekly' ? 'selected' : ''}>Weekly</option>
                        <option ${deal?.timeframe === 'Monthly' ? 'selected' : ''}>Monthly</option>
                    </select>
                </label>-->
                <label>
                    Monthly trend
                    <select name="monthly_dir">
                        <option value="" ${!deal?.monthly_dir ? 'selected' : ''} disabled></option>
                        <option ${deal?.monthly_dir === 'Down' ? 'selected' : ''}>Down</option>
                        <option ${deal?.monthly_dir === 'Up' ? 'selected' : ''}>Up</option>
                        <option ${deal?.monthly_dir === 'Flat' ? 'selected' : ''}>Flat</option>
                    </select>
                </label>
                <label>
                    Weekly trend
                    <select name="weekly_dir">
                        <option value="" ${!deal?.weekly_dir ? 'selected' : ''} disabled></option>
                        <option ${deal?.weekly_dir === 'Down' ? 'selected' : ''}>Down</option>
                        <option ${deal?.weekly_dir === 'Up' ? 'selected' : ''}>Up</option>
                        <option ${deal?.weekly_dir === 'Flat' ? 'selected' : ''}>Flat</option>
                    </select>
                </label>

                <!--<label>
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
                </label>-->

                <label>
                    Week candle color
                    <select name="buy_green_sell_red">
                        <option value="" ${!deal?.buy_green_sell_red ? 'selected' : ''} disabled></option>
                        <option ${deal?.buy_green_sell_red === 'Red' ? 'selected' : ''}>Red</option>
                        <option ${deal?.buy_green_sell_red === 'Green' ? 'selected' : ''}>Green</option>
                    </select>
                </label>
                <!--<label>
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
                </label>-->
  
                <!--<label>
                    Is current week candle O higher than previous  week O?
                    <select name="green_candle_higher">
                        <option value="" ${!deal?.green_candle_higher ? 'selected' : ''} disabled></option>
                        <option ${deal?.green_candle_higher === 'No' ? 'selected' : ''}>No</option>
                        <option ${deal?.green_candle_higher === 'Yes' ? 'selected' : ''}>Yes</option>
                    </select>
                </label>-->
                <label class="full">Deal details description<textarea name="notes">${escapeHtml(deal?.notes || '')}</textarea></label>


               <div class="full form-actions">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 50px; flex-wrap: wrap;">
                            ${isNew ? `
                            <button type="submit" data-original-text="Plan a deal">Plan a deal</button>
                            ` : deal?.planned_future ? `
                            <button type="button" class="activate-deal-btn">Create deal</button>
                            ${!deal?.closed ? `<button type="submit" class="secondary">Save changes</button>` : ''}
                            ` : `
                            ${!deal?.closed ? `<button type="submit">Save changes</button>` : ''}
                            `}
              </div>

            ${isNew
            ? `<button type="button" class="cancel-deal-btn secondary">Cancel</button>`
            : (isEdit && !deal?.closed
                ? `
                    <button type="button" class="secondary close-deal-btn">Close deal</button>
                    ${deal?.stock ? `
                        <button
                            type="button"
                            class="secondary ai-chat-btn"
                            data-ticker="${escapeHtml(deal.stock)}"
                            data-stock-id="${escapeHtml(dealId)}"
                            data-sl-pct="${escapeHtml(String(deal.stop_loss_prcnt || ''))}"
                        >AI chat</button>
                    ` : ''}
                  `
                : '')
                        }
                    </div>
                </div>

                ${!deal?.closed ? `
                <div class="deal-chart-section full">
                    <div id="tv_chart_${dealId}" class="deal-chart-container"></div>
                </div>
                ` : ''}


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
        elements.emptyOpen.innerHTML = '<div class="loading-container"><span class="loading-spinner"></span><span>Загружаем сделки...</span></div>';
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

    // Display count: all currently shown open rows (includes planned deals and the temporary "new deal" row)
    const count = open.length + (newDealRow ? 1 : 0);
    elements.openCount.textContent = count;
    
    // Warning count: only ACTIVE open deals (exclude planned_future deals)
    const activeOpenCount = deals.filter(d => d && !d.closed && !d.planned_future).length;
    
    // Add warning icon based on count
    // Find the container div that holds the count
    const countContainer = elements.openCount.parentElement;
    if (countContainer) {
        // Remove existing warning icon if any
        const existingWarning = countContainer.querySelector('.count-warning-icon');
        if (existingWarning) {
            existingWarning.remove();
        }
        
        // Add warning icon if ACTIVE open deals count exceeds thresholds
        if (activeOpenCount > 15) {
            // Red warning for count > 15
            const warningIcon = document.createElement('span');
            warningIcon.className = 'count-warning-icon count-warning-red';
            warningIcon.setAttribute('data-tooltip', `High number of open deals: ${activeOpenCount}. Consider closing some deals.`);
            warningIcon.textContent = '!';
            countContainer.appendChild(warningIcon);
        } else if (activeOpenCount > 10) {
            // Yellow warning for count > 10
            const warningIcon = document.createElement('span');
            warningIcon.className = 'count-warning-icon count-warning-yellow';
            warningIcon.setAttribute('data-tooltip', `Many open deals: ${activeOpenCount}. Monitor your portfolio carefully.`);
            warningIcon.textContent = '!';
            countContainer.appendChild(warningIcon);
        }
    }

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
        elements.emptyClosed.innerHTML = '<div class="loading-container"><span class="loading-spinner"></span><span>Загружаем сделки...</span></div>';
        elements.emptyClosed.style.display = 'block';
    } else if (closed.length === 0) {
        elements.emptyClosed.style.display = 'block';
    } else {
        elements.emptyClosed.style.display = 'none';

        closed.forEach(d => {
            const row = createDealRow(d, false);
            elements.closedList.appendChild(row);
        });
    }
    
    // Update closed deals count (no warning logic, just count)
    if (elements.closedCount) {
        elements.closedCount.textContent = closed.length;
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
    
    // Calculate and format total sum for display (all stages)
    const stagesForDisplay = getStagesFromDeal(deal);
    const totalSum = calculateTotalSumFromStages(deal?.share_price, stagesForDisplay);
    const totalSumFormatted = formatTotalSum(totalSum || deal?.total_sum);
    const totalSumDisplay = totalSumFormatted ? totalSumFormatted : '';
    
    // Add planned future indicator next to date (only for open planned deals)
    const plannedFutureLabel =
        deal?.planned_future && !deal?.closed
            ? ' <span style="color: #f59e0b; font-size: 12px; font-weight: 500; margin-left: 8px;">[Planned]</span>'
            : '';
    
    // Check if stock has warnings and add indicators
    let volumeIndicator = '';
    let sp500Indicator = '';
    let atrIndicator = '';
    let syncSp500Indicator = '';
    let betaVolatilityIndicator = '';
    if (deal?.stock) {
        // First check warnings cache (preferred method)
        const warning = getWarningByTicker(deal.stock);
        if (warning) {
            if (warning.regular_share_volume) {
                volumeIndicator = `<span class="volume-warning-icon" data-tooltip="Regular share volume: Small (around 50M per week)">!</span>`;
            }
            if (warning.sp500_member) {
                sp500Indicator = `<span class="volume-warning-icon" data-tooltip="S&amp;P 500 member: Not a member">!</span>`;
            }
            if (warning.atr_high_risk) {
                atrIndicator = `<span class="volume-warning-icon" data-tooltip="ATR (Average True Range): High risk (more than 10%)">!</span>`;
            }
            if (warning.sync_sp500_no) {
                syncSp500Indicator = `<span class="volume-warning-icon" data-tooltip="Is share movement synchronized with S&amp;P500?: No">!</span>`;
            }
            if (warning.beta_volatility_high) {
                betaVolatilityIndicator = `<span class="volume-warning-icon" data-tooltip="Share beta volatility: High (more volatile)">!</span>`;
            }
        }
        
        // Fallback: check stock's fields (for backward compatibility)
        const stock = getStockByTicker(deal.stock);
        if (stock) {
            const regularVolume = stock.regular_volume || stock.RegularVolume;
            if (regularVolume === '1' || regularVolume === 1) {
                volumeIndicator = `<span class="volume-warning-icon" data-tooltip="Regular share volume: Small (around 50M per week)">!</span>`;
            }
            // Check S&P 500 member status
            if (!stock.sp500Member && !stock.Sp500Member) {
                sp500Indicator = `<span class="volume-warning-icon" data-tooltip="S&amp;P 500 member: Not a member">!</span>`;
            }
            // Check ATR high risk
            if (isAtrHighRiskFromString(stock.atr || stock.Atr)) {
                atrIndicator = `<span class="volume-warning-icon" data-tooltip="ATR (Average True Range): High risk (more than 10%)">!</span>`;
            }
            // Check sync SP500
            if (stock.sync_sp500 === 'no' || stock.SyncSp500 === 'no') {
                syncSp500Indicator = `<span class="volume-warning-icon" data-tooltip="Is share movement synchronized with S&amp;P500?: No">!</span>`;
            }
            // Check beta volatility high
            if (stock.betaVolatility === '3' || stock.BetaVolatility === '3' || stock.betaVolatility === 3) {
                betaVolatilityIndicator = `<span class="volume-warning-icon" data-tooltip="Share beta volatility: High (more volatile)">!</span>`;
            }
        }
    }
    
    const avgEntryForBadge = deal ? calculateAvgEntryFromDeal(deal) : null;
    const spBadgeValue = avgEntryForBadge ? avgEntryForBadge.toFixed(2) : (deal?.share_price || '-');

    summary.innerHTML = `
        <div class="meta">
            ${deal?.stock 
                ? `<div class="deal-title-row">
                    <div class="stock-name">
                        <strong>${escapeHtml(deal.stock)}${volumeIndicator}${sp500Indicator}${atrIndicator}${syncSp500Indicator}${betaVolatilityIndicator}</strong>
                    </div>
                    ${totalSumDisplay ? `<div class="total-sum-display">${totalSumDisplay}</div>` : ''}
                    ${deal && !deal.closed ? `<div class="badge movement-metric-tooltip current-price-badge" data-tooltip="Current price (daily)" data-entry-price="${escapeHtml(deal.share_price || '')}">CP:-</div>` : ''}
                    ${deal && !deal.closed && deal.planned_future && deal.id ? `<div class="badge portfolio-display movement-metric-tooltip planned-risk-badge" data-deal-id="${deal.id}" data-tooltip="Planned deal: added risk if activated">+Risk:-</div>` : ''}
                    <div class="movement-metrics-container"></div>
                </div>`
                : `<div class="new-deal-title"><strong>New Deal</strong><div class="total-sum-display" style="display:none"></div><div class="reward-to-risk-badge"></div></div>`
            }
            ${deal ? `<span class="small" style="margin-top:4px">${formatDate(deal.date)}${plannedFutureLabel}</span>` : ''}
            ${deal ? `<div class="small" style="margin-top:6px">${escapeHtml((deal.notes || '').slice(0, 140))}</div>` : ''}
        </div>
        ${deal ? `
        <div class="chips" style="min-width:140px;justify-content:flex-end">
            <div class="badge movement-metric-tooltip" data-tooltip="Avrg price (avg entry)">SP:${escapeHtml(spBadgeValue)}</div>
            ${deal.closed && deal.close_price ? `<div class="badge movement-metric-tooltip" data-tooltip="Close Price">CL:${escapeHtml(deal.close_price)}</div>` : ''}
            ${deal.closed && deal.close_price ? (() => {
                const entry = parseNumber(deal.share_price || '');
                const close = parseNumber(deal.close_price || '');
                const shares = sumStages(getStagesFromDeal(deal));
                if (!entry || !close || !shares) return '';
                const pnl = (close - entry) * shares;
                const cls = pnl >= 0 ? 'pnl-green' : 'pnl-red';
                const sign = pnl >= 0 ? '+' : '';
                return `<div class="badge movement-metric-tooltip ${cls}" data-tooltip="P/L based on Close price">P/L:${sign}${pnl.toFixed(2)}</div>`;
            })() : ''}
            <div class="badge movement-metric-tooltip" data-tooltip="Stop Loss">SL:${escapeHtml(deal.stop_loss || '-')}</div>
            ${deal.stop_loss_prcnt ? (() => {
                // Extract numeric value from percentage string (supports optional minus sign)
                const slPercentMatch = String(deal.stop_loss_prcnt).match(/-?\d+(\.\d+)?/);
                const slPercentValue = slPercentMatch ? parseFloat(slPercentMatch[0]) : 0;
                
                // Determine color class based on SL percentage
                let colorClass = '';
                if (slPercentValue <= 0) {
                    // Zero or negative SL% → green badge
                    colorClass = 'sl-percent-green';
                } else if (slPercentValue > 10) {
                    colorClass = 'sl-percent-red'; // Red for SL% > 10%
                } else if (slPercentValue > 5) {
                    colorClass = 'sl-percent-yellow'; // Yellow for SL% > 5% (but <= 10%)
                }
                
                return `<div class="badge movement-metric-tooltip ${colorClass}" data-tooltip="Stop Loss Percentage">SL:${escapeHtml(deal.stop_loss_prcnt)}%</div>`;
            })() : ''}
            <div class="badge movement-metric-tooltip" data-tooltip="Take Profit">TP:${escapeHtml(deal.take_profit || '-')}</div>
            ${deal.take_profit_prcnt ? `<div class="badge movement-metric-tooltip" data-tooltip="Take Profit Percentage">TP:${escapeHtml(deal.take_profit_prcnt)}%</div>` : ''}
            ${deal.reward_to_risk ? (() => {
                // Extract numeric value from "1:4.3" format
                const ratioMatch = deal.reward_to_risk.match(/1:([\d.]+)/);
                const ratioValue = ratioMatch ? parseFloat(ratioMatch[1]) : 0;
                
                // Determine color class based on ratio
                let colorClass = '';
                if (ratioValue <= 1.0) {
                    colorClass = 'reward-risk-red'; // Red for 1:1 or worse
                } else if (ratioValue <= 2.0) {
                    colorClass = 'reward-risk-yellow'; // Yellow for 1:2 or worse (but better than 1:1)
                } else {
                    colorClass = 'reward-risk-green'; // Green for better than 1:2
                }
                
                return `<div class="badge movement-metric-tooltip ${colorClass}" data-tooltip="Reward to Risk Ratio">R ${escapeHtml(deal.reward_to_risk)}</div>`;
            })() : ''}
        </div>
        ` : ''}
    `;

    // Add current price badge (CP) in the title for open + planned deals (not closed)
    if (deal?.stock && deal?.id && !deal?.closed && !isNew) {
        const cpBadge = summary.querySelector('.current-price-badge');
        // Fire-and-forget; result is cached per UTC day
        attachCurrentPriceBadge(cpBadge, deal.stock).catch(err => {
            console.warn('attachCurrentPriceBadge failed', deal.stock, err);
        });
    }

    // Planned deal: show "assumed/added risk if activated"
    if (deal?.id && deal?.planned_future && !deal?.closed && !isNew) {
        const plannedBadge = summary.querySelector('.planned-risk-badge');
        if (plannedBadge) {
            // Try to compute immediately; will be refreshed globally after risk/totalSum updates.
            try {
                const added = calcAddedRiskPercentForPlannedDeal(deal);
                if (added > 0) {
                    const currentRisk =
                        (typeof latestPortfolioRiskPercent === 'number' ? latestPortfolioRiskPercent : null)
                        ?? getCurrentPortfolioRiskFromHeader();
                    const predicted = (Number(currentRisk) || 0) + added;
                    plannedBadge.textContent = `+Risk:+${added.toFixed(2)}%`;
                    applyPortfolioRiskClasses(plannedBadge, predicted);
                    plannedBadge.setAttribute(
                        'data-tooltip',
                        `Planned deal: added risk if activated: +${added.toFixed(2)}%.\n` +
                        `If active: ${predicted.toFixed(2)}% (current: ${(Number(currentRisk) || 0).toFixed(2)}%).`
                    );
                }
            } catch (e) {
                // ignore; placeholder stays
            }
        }
    }
    
    // Add movement metrics near the price (load asynchronously)
    // Only for open deals (not closed, and not new deals - new deals will get metrics when stock is selected)
    if (deal?.stock && deal?.id && !deal?.closed && !isNew) {
        console.log('Adding movement metrics for deal stock:', deal.stock);
        
        // Store deal ID and stock ticker on the row for later retrieval
        const dealId = deal?.id || 'new';
        row.dataset.dealStock = deal.stock;
        
        loadMovementMetrics(deal.stock).then(metrics => {
            console.log('Movement metrics received for', deal.stock, ':', metrics);
            
            // Re-find the row and summary (in case DOM was re-rendered)
            const currentRow = document.querySelector(`[data-deal-id="${dealId}"]`);
            if (!currentRow) {
                console.warn('Deal row not found for', dealId);
                return;
            }
            
            const currentSummary = currentRow.querySelector('.deal-summary');
            if (!currentSummary) {
                console.warn('Summary element not found in row for', deal.stock);
                return;
            }
            
            const metricsContainer = currentSummary.querySelector('.movement-metrics-container');
            if (!metricsContainer) {
                console.warn('movement-metrics-container not found for', deal.stock);
                return;
            }
            
            // Avoid duplicates
            const existing = metricsContainer.querySelector('.movement-metrics-display');
            if (existing) {
                console.log('Movement metrics already displayed for', deal.stock);
                return;
            }
            
            if (metrics) {
                const formatted = formatMovementMetrics(metrics);
                console.log('Formatted movement metrics:', formatted);
                
                metricsContainer.innerHTML = formatted;
                console.log('Movement metrics inserted into metrics container successfully');
            } else {
                console.log('No movement metrics available for', deal.stock);
            }
        }).catch(err => {
            console.error('Error loading movement metrics for', deal.stock, ':', err);
        });
    }
    // Note: Movement metrics are only shown for open deals with selected stock
    // This is expected behavior for new deals (no stock selected yet) or closed deals

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
        setDealFormLoading(formContainer, true, 'Loading…');
        try {
            // Explicitly reset select to ensure it's empty
            const select = form.querySelector('.deal-stock-select');
            if (select) {
                select.value = '';
                select.selectedIndex = -1;
            }
            await populateStockSelect(form, null);
            setupStockSelectListener(form, dealId);
            setupTrendSelectListeners(form);
        } finally {
            setDealFormLoading(formContainer, false);
        }
    }
    
    // Setup trend select listeners for all forms
    if (form) {
        renderStagesUI(form, deal);
        setupTrendSelectListeners(form);
        console.log('[CALL] setupSharePriceListener called, form:', form);
        const isPlannedDeal = isNew || !!(deal && deal.planned_future);
        form.dataset.isPlannedDeal = isPlannedDeal ? '1' : '0';
        setupSharePriceListener(form, isPlannedDeal);
        setupStopLossListener(form);
        setupTakeProfitListener(form);
        setupTotalSumCalculator(row, form, deal);
        // Track manual overrides for Buy price (stage 1) so quote autofill won't overwrite.
        if (!form.dataset.buyPriceManualBound) {
            form.dataset.buyPriceManualBound = '1';
            form.addEventListener('input', (e) => {
                const t = e.target;
                if (!t || !e.isTrusted) return;
                if (t.name === 'buy_price_stages[]') {
                    // Mark per-input manual override to prevent later autofill.
                    t.dataset.userSet = '1';
                    if (String(t.dataset.stageIndex) === '0') {
                        form.dataset.buyPriceStage1Manual = '1';
                    }
                }
            });
        }
        // Track manual override for Share price (current price) and persist it via hidden field.
        if (!form.dataset.sharePriceManualBound) {
            form.dataset.sharePriceManualBound = '1';
            form.addEventListener('input', (e) => {
                const t = e.target;
                if (!t || !e.isTrusted) return;
                if (t.name !== 'share_price') return;

                const manualInput = form.querySelector('input[name="share_price_manual"]');
                const hasValue = !!String(t.value || '').trim();
                if (manualInput) manualInput.value = String(hasValue);
                form.dataset.sharePriceManual = hasValue ? '1' : '0';
            });
        }
        // Avg entry depends on stages shares + buy prices
        if (!form.dataset.avgEntryBound) {
            form.dataset.avgEntryBound = '1';
            let avgTimeout = null;
            form.addEventListener('input', (e) => {
                const t = e.target;
                if (t?.name === 'amount_tobuy_stages[]' || t?.name === 'buy_price_stages[]') {
                    clearTimeout(avgTimeout);
                    avgTimeout = setTimeout(() => updateAvgEntryUI(form), 150);
                }
            });
            form.addEventListener('change', (e) => {
                const t = e.target;
                if (t?.name === 'amount_tobuy_stages[]' || t?.name === 'buy_price_stages[]') {
                    updateAvgEntryUI(form);
                }
            });
        }

        // Auto-fill Buy price for a stage with the latest quote when user enters shares for that stage.
        // (Do not overwrite manually entered prices.)
        if (!form.dataset.buyPriceAutoFillBound) {
            form.dataset.buyPriceAutoFillBound = '1';
            form.addEventListener('change', (e) => {
                const t = e.target;
                if (!t || t.name !== 'amount_tobuy_stages[]') return;

                const sharesNum = parseNumber(t.value);
                if (!sharesNum || sharesNum <= 0) return;

                const quote = parseNumber(form.dataset.lastQuotePrice || '');
                if (!quote || quote <= 0) return;

                const idx = Number(t.dataset.stageIndex || 0);
                const priceInputs = Array.from(form.querySelectorAll('input[name="buy_price_stages[]"]'));
                const pxInput = priceInputs[idx];
                if (!pxInput) return;

                // Respect manual override per-input (and stage1 manual lock)
                if (pxInput.dataset.userSet === '1') return;
                if (idx === 0 && form.dataset.buyPriceStage1Manual === '1') return;

                if (!String(pxInput.value || '').trim()) {
                    pxInput.value = quote.toFixed(2);
                }

                updateAvgEntryUI(form);
            });
        }

        updateAvgEntryUI(form);
        if (isNew) {
            setupNewDealRewardToRiskBadge(row, form);
        }

        // Planned deals: refresh auto fields on initial expanded render
        if (!isNew && row.classList.contains('expanded')) {
            setDealFormLoading(formContainer, true, 'Loading…');
            try {
                await refreshPlannedAutoFieldsOnExpand(form, deal);
            } catch (err) {
                console.warn('refreshPlannedAutoFieldsOnExpand failed:', err);
            } finally {
                setDealFormLoading(formContainer, false);
            }
        }

        // For new deals (which start expanded) or rows initially expanded,
        // initialize chart immediately; existing collapsed deals will
        // initialize chart on expand to avoid rendering into hidden container.
        if (isNew || row.classList.contains('expanded')) {
            setupDealChart(row, form, deal, dealId);
        }
        
        // Cancel button for new deals
        if (isNew) {
            const cancelBtn = form.querySelector('.cancel-deal-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    // Close the deal row without saving
                    newDealRow = null;
                    expandedDealId = null;
                    renderAll();
                    // Reset risk UI back to saved deals (discard temporary new-deal edits)
                    setTimeout(() => {
                        calculateAndDisplayPortfolioRisk();
                        calculateAndDisplayInSharesRisk();
                    }, 0);
                });
            }
        }
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
                // Reset risk UI back to saved deals (discard temporary new-deal edits)
                setTimeout(() => {
                    calculateAndDisplayPortfolioRisk();
                    calculateAndDisplayInSharesRisk();
                }, 0);
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
                setDealFormLoading(formContainer, true, 'Loading…');
                try {
                    const tickerToUse = isNew ? null : (deal?.stock || null);
                    await populateStockSelect(form, tickerToUse);
                    setupStockSelectListener(form, dealId);
                    renderStagesUI(form, deal);
                    setupTrendSelectListeners(form);
                    await refreshPlannedAutoFieldsOnExpand(form, deal);
                    console.log('[CALL] setupSharePriceListener called, form:', form);
                    const isPlannedDeal = isNew || !!(deal && deal.planned_future);
                    form.dataset.isPlannedDeal = isPlannedDeal ? '1' : '0';
                    setupSharePriceListener(form, isPlannedDeal);
                    setupStopLossListener(form);
                    setupDealChart(row, form, deal, dealId);
                } finally {
                    setDealFormLoading(formContainer, false);
                }
            }
        }
    });

    // Form submit
        if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleDealSubmit(form, deal, isNew);
        });

        // Activate deal button (for planned deals)
        const activateBtn = form.querySelector('.activate-deal-btn');
        if (activateBtn) {
            activateBtn.addEventListener('click', async () => {
                if (!deal || !deal.id) return;

                // Show spinner immediately on click (even if we end up showing warnings/confirms)
                setButtonLoading(activateBtn, true);
                try {
                    // Enforce stop loss <= share price ONLY when activating (Create deal)
                    // (do not block editing an already existing/active deal)
                    const slOk = validateStopLossVsPrice(form, true);
                    if (!slOk) {
                        await showDealLimitModal('Stop loss cannot be greater than Share price.');
                        return;
                    }

                    // Gather latest values from form (fallback to deal if inputs are empty)
                    let sharePriceNum = 0;
                    let stages = [];
                    let slPctNum = 0;
                    let monthlyVal = '';
                    let weeklyVal = '';

                    if (form) {
                        const spInput  = form.querySelector('input[name="share_price"]');
                        const slInput  = form.querySelector('input[name="stop_loss_prcnt"]');
                        const monthlySelect = form.querySelector('select[name="monthly_dir"]');
                        const weeklySelect = form.querySelector('select[name="weekly_dir"]');

                        if (spInput) sharePriceNum = parseNumber(spInput.value);
                        if (slInput) slPctNum      = parseNumber(slInput.value);
                        monthlyVal = monthlySelect?.value || '';
                        weeklyVal = weeklySelect?.value || '';

                        const stageInputs = Array.from(form.querySelectorAll('input[name="amount_tobuy_stages[]"]'));
                        const orderedStageNums = stageInputs.map(i => parseNumber(i.value));
                        const stage1Num = orderedStageNums[0] || 0;
                        if (!stage1Num || stage1Num <= 0) {
                            showDealLimitModal('Stage 1 amount is required and must be > 0.');
                            return;
                        }
                        for (const input of stageInputs) {
                            const raw = String(input.value || '').trim();
                            const n = parseNumber(raw);
                            if (raw && (!n || n <= 0)) {
                                showDealLimitModal('All stage amounts must be positive numbers.');
                                return;
                            }
                        }
                        stages = orderedStageNums.filter(n => n > 0);
                    }

                    // Fallback to deal values if form fields are empty
                    if (!sharePriceNum && deal.share_price) {
                        sharePriceNum = parseNumber(deal.share_price);
                    }
                    if ((!stages || stages.length === 0) && deal) {
                        stages = getStagesFromDeal(deal);
                    }
                    if (!slPctNum && deal.stop_loss_prcnt) {
                        slPctNum = parseNumber(deal.stop_loss_prcnt);
                    }

                    // Risk gate for activation:
                    // - warn above 5%
                    // - block at 10%+
                    let riskNow = null;
                    try {
                        const r = await apiFetch('/api/deals/risk-percent', { headers: authHeaders() });
                        if (r.ok) {
                            const v = await r.json();
                            const n = Number(v);
                            if (isFinite(n)) riskNow = n;
                        }
                    } catch (e) {
                        console.warn('Failed to fetch current portfolio risk percent before activation', e);
                    }

                    if (riskNow != null) {
                        if (riskNow >= 10) {
                            await showDealLimitModal(
                                `Your portfolio risk is ${riskNow.toFixed(2)}%.\n` +
                                `Activation is blocked when risk is 10% or higher.\n\n` +
                                `Reduce total risk first, then try again.`,
                                { title: 'High risk warning', mode: 'info' }
                            );
                            return;
                        }

                        if (riskNow > 5) {
                            const proceed = await showDealLimitModal(
                                `Your portfolio risk is ${riskNow.toFixed(2)}%.\n` +
                                `It is not recommended to activate new deals above 5% total risk.\n\n` +
                                `Do you still want to activate this deal?`,
                                { title: 'High risk warning', mode: 'confirm', okText: 'Yes', cancelText: 'Cancel' }
                            );
                            if (!proceed) return;
                        }
                    }

                    const totalPlanned = sharePriceNum * sumStages(stages);

                    // 0) Строгая проверка: хватает ли вообще Cash под эту позицию
                    try {
                        const portfolioSpan = document.getElementById('portfolioValue');
                        if (portfolioSpan) {
                            const cashStr = portfolioSpan.textContent.trim().replace(',', '.');
                            const cash = parseFloat(cashStr) || 0;
                            if (totalPlanned > cash) {
                                const proceed = await showWeeklyConfirmModal(
                                    `WARNING:\nNot enough Cash to activate this deal.\n` +
                                    `Required: ${totalPlanned.toFixed(2)}, available: ${cash.toFixed(2)}.\n\n` +
                                    `Do you still want to activate this deal?`
                                );
                                if (!proceed) return;
                            }
                        }
                    } catch (cashErr) {
                        console.error('Failed to validate cash before activation', cashErr);
                    }

                    // Limits/trading-time/weekly-activation validations should be best-effort:
                    // if they fail, we log but do not block activation.
                    try {
                        // 1) Жёсткая проверка лимитов по размеру позиции и риску
                        if (slPctNum > 0 && totalPlanned > 0) {
                            const res = await apiFetch(`/api/deals/limits?stopLossPercent=${encodeURIComponent(slPctNum)}`, {
                                headers: authHeaders()
                            });
                            if (res.ok) {
                                const limits = await res.json();
                                const isSingle = stages.length === 1;

                                if (isSingle) {
                                    if (totalPlanned > limits.singleStageMax) {
                                        const proceed = await showWeeklyConfirmModal(
                                            `WARNING:\nSingle-stage deal is too big.\n` +
                                            `Max allowed: ${limits.singleStageMax.toFixed(2)}.\n\n` +
                                            `Do you still want to activate this deal?`
                                        );
                                        if (!proceed) return;
                                    }
                                } else {
                                    const stage1Sum = sharePriceNum * (stages[0] || 0);
                                    if (stage1Sum > limits.maxStage1 || totalPlanned > limits.maxPosition) {
                                        const proceed = await showWeeklyConfirmModal(
                                            `WARNING:\nMulti-stage deal exceeds limits.\n` +
                                            `Stage 1 max: ${limits.maxStage1.toFixed(2)}, total max: ${limits.maxPosition.toFixed(2)}.\n\n` +
                                            `Do you still want to activate this deal?`
                                        );
                                        if (!proceed) return;
                                    }
                                }

                                // If we already warned for current risk > 5% above, don't spam another risk confirm here.
                                if (!limits.allowed && (riskNow == null || riskNow <= 5)) {
                                    const currentRiskText = (riskNow != null) ? `${riskNow.toFixed(2)}%` : '';
                                    const proceed = await showDealLimitModal(
                                        `High portfolio risk warning.\n` +
                                        (currentRiskText ? `Current Risk: ${currentRiskText}\n\n` : `\n`) +
                                        `This activation is not recommended because it would push total risk above the limit.\n` +
                                        `Do you still want to activate this deal?\n\n` +
                                        `Details:\n` +
                                        `Added risk (at max allowed sizing): ${limits.addedRiskPercent.toFixed(2)}%.`,
                                        { title: 'High risk warning', mode: 'confirm', okText: 'Yes', cancelText: 'Cancel' }
                                    );
                                    if (!proceed) return;
                                }
                            }
                        }

                    // 1.5) Warning: too many open (active) deals (recommended max = 5)
                    try {
                        const openDealsCount = (deals || []).filter(d => d && !d.closed && !d.planned_future).length;
                        const afterActivation = openDealsCount + 1;

                        if (openDealsCount >= 5) {
                            const proceed = await showWeeklyConfirmModal(
                                `WARNING:\n` +
                                `You already have ${openDealsCount} open deals.\n` +
                                `After activation you will have ${afterActivation} open deals.\n` +
                                `It is not recommended to have more than 5 open deals.\n\n` +
                                `Do you still want to activate this deal?`
                            );
                            if (!proceed) return;
                        }
                    } catch (e) {
                        console.warn('Failed to check open deals count before activation', e);
                        // Do not block activation if warning fails
                    }

                    // Timing guard: recommend only Friday 14:00–16:00 ET
                    if (!isEtFridayLast2Hours()) {
                        const proceed = await showDealTimingModal(
                            'Deal is recommended only on Friday between 14:00 and 16:00 ET.\nDo you want to continue?'
                        );
                        if (!proceed) {
                            return;
                        }
                    }

                    // 2) Мягкое предупреждение, если уже было 2 и более активаций за неделю
                    try {
                        const weeklyRes = await apiFetch('/api/deals/weekly-activations', {
                            headers: authHeaders()
                        });
                        if (weeklyRes.ok) {
                            const data = await weeklyRes.json();
                            if (data && data.exceeds) {
                                const msg =
                                    `You already activated ${data.count} deals this week.\n` +
                                    `Recommended maximum is ${data.maxPerWeek} per week.\n\n` +
                                    `Do you still want to activate this deal?`;
                                const proceed = await showWeeklyConfirmModal(msg);
                                if (!proceed) {
                                    return; // пользователь отменил активацию
                                }
                            }
                        }
                    } catch (warnErr) {
                        console.error('Failed to check weekly activations', warnErr);
                        // В случае ошибки предупреждения не блокируем активацию
                    }
                } catch (err) {
                    console.error('Failed to validate deal limits before activation', err);
                    // Если лимиты не смогли посчитать — не блокируем, но логируем
                }

                // ===== FINAL ENTRY CHECKS (must be the LAST check before activation) =====
                // Checks:
                // - weekly reversal+retest setup (weekly bars)
                // - monthly trend must be Up (server-calculated from weekly series)
                // - breakout trigger uses CURRENT quote price (current week)
                //
                // Always shows a message:
                // - if monthly trend Down/Flat -> NOT recommended
                // - if no weekly reversal -> NOT recommended
                // - if setup exists but breakout not triggered -> wait for breakout (still allow)
                // - if all ok -> OK (still show)
                try {
                    const ticker = deal.stock;
                    if (ticker) {
                        const [wRes, qRes, tRes] = await Promise.all([
                            apiFetch(`/api/prices/${encodeURIComponent(ticker)}`, { headers: authHeaders() }),
                            apiFetch(`/api/prices/${encodeURIComponent(ticker)}/quote`, { headers: authHeaders() }),
                            apiFetch(`/api/prices/${encodeURIComponent(ticker)}/trends`, { headers: authHeaders() })
                        ]);

                        const weeklyBars = wRes.ok ? await wRes.json() : null;
                        const quote = qRes.ok ? await qRes.json() : null;
                        const trends = tRes.ok ? await tRes.json() : null;

                        const priceNow = Number(quote?.price);
                        const monthlyTrend = String(trends?.monthly || '').trim();
                        const monthlyOk = monthlyTrend.toLowerCase() === 'up';

                        const setup = Array.isArray(weeklyBars)
                            ? detectWeeklyReversalRetestBreakout(weeklyBars, priceNow)
                            : { hasSetup: false, triggered: false, reason: 'No weekly bars' };

                        const hasSetup = !!setup?.hasSetup;
                        const triggered = !!setup?.triggered;

                        const lines = [];
                        lines.push(`Ticker: ${ticker}`);
                        lines.push(`Monthly trend: ${monthlyTrend || '(no data)'} ${monthlyOk ? '(OK)' : '(NOT OK)'}`);

                        if (!Array.isArray(weeklyBars)) {
                            lines.push(`Weekly reversal+retest: (no weekly data)`);
                        } else if (!hasSetup) {
                            lines.push(`Weekly reversal+retest: NOT FOUND`);
                            if (setup?.reason) lines.push(`Reason: ${setup.reason}`);
                        } else {
                            lines.push(`Weekly reversal+retest: FOUND`);
                            if (Number.isFinite(setup.support)) lines.push(`Support S (L_tau): ${setup.support.toFixed(2)}`);
                            if (Number.isFinite(setup.entryHigh)) lines.push(`Prev week high (H_r): ${setup.entryHigh.toFixed(2)}`);
                            if (Number.isFinite(setup.entryTrigger)) lines.push(`Entry trigger (H_r + δ): ${setup.entryTrigger.toFixed(2)}`);
                            if (Number.isFinite(setup.stop)) lines.push(`Suggested stop: ${setup.stop.toFixed(2)}`);
                            lines.push(`Breakout (quote): ${triggered ? 'TRIGGERED' : 'NOT triggered yet'}`);
                        }

                        if (Number.isFinite(priceNow)) lines.push(`Current price (quote): ${priceNow.toFixed(2)}`);

                        const hardFail = !monthlyOk || !hasSetup;
                        const timingWarn = !hardFail && hasSetup && !triggered;
                        const allOk = !hardFail && hasSetup && triggered;

                        let title = 'Entry checks';
                        let resultLine = 'Result: Continue activation?';
                        if (hardFail) {
                            title = 'Entry checks: NOT recommended';
                            resultLine = 'Result: NOT recommended. Continue activation anyway?';
                        } else if (timingWarn) {
                            title = 'Entry checks: wait for breakout';
                            resultLine = 'Result: Setup is valid, but breakout is NOT triggered yet. Continue activation anyway?';
                        } else if (allOk) {
                            title = 'Entry checks: OK';
                            resultLine = 'Result: All checks passed. Continue activation?';
                        }

                        const proceed = await showDealLimitModal(
                            lines.join('\n') + '\n\n' + resultLine,
                            { title, mode: 'confirm', okText: 'Continue', cancelText: 'Cancel' }
                        );

                        if (!proceed) return;
                    }
                } catch (e) {
                    console.warn('Final entry checks failed (non-blocking)', e);
                    const proceed = await showDealLimitModal(
                        `Entry checks could not be completed.\n\n${String(e?.message || e)}`,
                        { title: 'Entry checks error', mode: 'confirm', okText: 'Continue', cancelText: 'Cancel' }
                    );
                    if (!proceed) return;
                }

                // Change planned_future from true to false
                const updatedDeal = { ...deal, planned_future: false };
                
                let saveOk = false;
                let saveErr = null;
                try {
                    // IMPORTANT: saveDealToServer() already performs server save + some client-side refreshes.
                    // Any UI refresh after this should be best-effort and must not show "activation failed"
                    // if the server-side activation actually succeeded.
                    await saveDealToServer(updatedDeal, true);
                    saveOk = true;
                } catch (e) {
                    saveErr = e;
                    console.error('Activation save failed (may still have succeeded on server):', e);
                }

                // Always try to refresh UI state after activation attempt (best-effort)
                try { await refreshPortfolioFromServer(); } catch (e) { console.warn('refreshPortfolioFromServer failed after activation', e); }
                try { await loadDeals(); } catch (e) { console.warn('loadDeals failed after activation', e); }
                try { await calculateAndDisplayPortfolioRisk(); } catch (e) { console.warn('portfolio risk refresh failed after activation', e); }
                try { await calculateAndDisplayInSharesRisk(); } catch (e) { console.warn('inShares risk refresh failed after activation', e); }

                if (!saveOk) {
                    // Use the styled advisor modal instead of a browser alert.
                    const msg =
                        `Activation request returned an error.\n` +
                        `The deal may still have been activated (UI was refreshed).\n\n` +
                        `Details:\n${String(saveErr?.message || saveErr || 'Unknown error')}`;
                    await showDealLimitModal(msg, { title: 'Activation warning', mode: 'info' });
                }
                } finally {
                    setButtonLoading(activateBtn, false);
                }
            });
            // Setup risk/limits hints for this form
            setupRiskAndLimits(form);
        }

        // Close deal button
        const closeBtn = form.querySelector('.close-deal-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', async () => {
                try {
                    setButtonLoading(closeBtn, true);

                    // Planned deals do not affect Cash; allow closing without close price.
                    if (deal?.planned_future) {
                        const proceed = await showDealLimitModal(
                            'Close this planned deal?',
                            { title: 'Close planned deal', mode: 'confirm', okText: 'Close deal', cancelText: 'Cancel' }
                        );
                        if (!proceed) return;

                        const updatedDeal = { ...deal, closed: true, closedAt: new Date().toISOString() };
                        await saveDealToServer(updatedDeal, true);
                        await loadDeals();
                        return;
                    }

                    // Active deal: require close price.
                    let defaultPx = '';
                    try {
                        if (deal?.stock) {
                            const q = await getDailyQuote(deal.stock);
                            if (q && q.price != null) defaultPx = q.price;
                        }
                    } catch { }

                    const closePx = await showCloseDealModal({ ticker: deal?.stock || '', defaultPrice: defaultPx });
                    if (!closePx) return;

                    const updatedDeal = {
                        ...deal,
                        close_price: String(closePx),
                        closed: true,
                        closedAt: new Date().toISOString()
                    };

                    await saveDealToServer(updatedDeal, true);
                    await loadDeals();
                } catch (e) {
                    console.error(e);
                    alert('Failed to close deal.');
                } finally {
                    setButtonLoading(closeBtn, false);
                }
            });
        }
    }
}

// Setup TradingView chart for a specific deal row (once per form)
function setupDealChart(row, form, deal, dealId) {
    if (!form) return;

    const chartContainerId = `tv_chart_${dealId}`;
    const chartContainer = form.querySelector(`#${chartContainerId}`) || row.querySelector(`#${chartContainerId}`);
    if (!chartContainer) {
        return;
    }

    const toolbar = form.querySelector('.deal-chart-toolbar');
    const stockSelect = form.querySelector('.deal-stock-select');

    function getCurrentSymbol() {
        let ticker = null;

        if (stockSelect && stockSelect.value) {
            ticker = stockSelect.value;
        } else if (deal && deal.stock) {
            ticker = deal.stock;
        }

        return buildSymbolFromTicker(ticker);
    }

    // Initial render for existing deals with a stock
    const initialSymbol = getCurrentSymbol();
    if (initialSymbol) {
        renderTradingViewChart(chartContainerId, initialSymbol, 'W');
    }

    // React to stock selection changes
    if (stockSelect) {
        stockSelect.addEventListener('change', () => {
            const symbol = getCurrentSymbol();
            if (!symbol) return;

            renderTradingViewChart(chartContainerId, symbol, 'W');

            if (toolbar) {
                toolbar.querySelectorAll('button[data-interval]').forEach(b => b.classList.remove('active'));
                const wBtn = toolbar.querySelector('button[data-interval="W"]');
                if (wBtn) wBtn.classList.add('active');
            }
        });
    }

}

// setupTotalSumCalculator is defined later (supports multi-stage).

// Show deal limits (max position, stages, added risk) under the form
async function updateDealLimitsUI(form) {
    const slPctInput = form.querySelector('input[name="stop_loss_prcnt"]');
    if (!slPctInput) return;

    const slPct = parseFloat((slPctInput.value || '').replace(',', '.'));
    if (!slPct || slPct <= 0) return;

    try {
        const res = await apiFetch(`/api/deals/limits?stopLossPercent=${encodeURIComponent(slPct)}`, {
            headers: authHeaders()
        });
        if (!res.ok) {
            console.warn('Failed to load deal limits', res.status);
            return;
        }
        const limits = await res.json();

        let info = form.querySelector('.deal-limits-info');
        if (!info) {
            info = document.createElement('div');
            info.className = 'deal-limits-info big';
            info.style.marginTop = '8px';
            info.style.color = 'var(--muted)';

            const actions = form.querySelector('.form-actions');
            if (actions && actions.parentNode) {
                actions.parentNode.insertBefore(info, actions);
            } else {
                form.appendChild(info);
            }
        }

        if (!limits.allowed) {
            info.innerHTML = `
                <span style="color:#dc2626;font-weight:600;">
                    Planned deal exceeds portfolio risk limits.
                    Max position: ${limits.maxPosition.toFixed(2)}
                    (adds ${limits.addedRiskPercent.toFixed(2)}% risk).
                </span>`;
        } else {
            info.innerHTML = `
                Max position: <strong>${limits.maxPosition.toFixed(2)}</strong>
                (adds ${limits.addedRiskPercent.toFixed(2)}% risk).<br>
                Stage 1 ≤ <strong>${limits.maxStage1.toFixed(2)}</strong>
                (single-stage max: ${limits.singleStageMax.toFixed(2)}).<br>
                Recommended split: ${limits.recommendedStage1.toFixed(2)}
                + ${limits.recommendedStage2.toFixed(2)}.
            `;
        }
    } catch (e) {
        console.error('Error updating deal limits UI', e);
    }
}

function setupRiskAndLimits(form) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stageInputs     = Array.from(form.querySelectorAll('input[name="amount_tobuy_stages[]"]'));
    const slPctInput      = form.querySelector('input[name="stop_loss_prcnt"]');

    if (!sharePriceInput || !slPctInput || stageInputs.length === 0) return;

    const trigger = () => {
        if (slPctInput.value) {
            updateDealLimitsUI(form);
        }
    };

    sharePriceInput.addEventListener('input', trigger);
    stageInputs.forEach(i => i.addEventListener('input', trigger));
    slPctInput.addEventListener('input', trigger);

    // Also bind delegated listener once (covers dynamically added stages)
    if (!form.dataset.stagesLimitsBound) {
        form.dataset.stagesLimitsBound = '1';
        form.addEventListener('input', (e) => {
            const t = e.target;
            if (t && t.matches && t.matches('input[name="amount_tobuy_stages[]"]')) {
                trigger();
            }
        });
    }
}

// Setup event listener for stop loss input to calculate stop loss percentage
function setupStopLossListener(form) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stopLossInput = form.querySelector('input[name="stop_loss"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    
    if (!stopLossInput || !sharePriceInput) return;
    
    const calculateStopLossPercent = () => {
        const sharePrice = getStopLossBasePrice(form);
        const stopLoss = parseFloat(String(stopLossInput.value || '').replace(',', '.'));
        
        if (isNaN(sharePrice) || sharePrice <= 0) {
            if (stopLossPrcntInput) stopLossPrcntInput.value = '';
            return;
        }
        
        if (isNaN(stopLoss) || stopLoss <= 0) {
            if (stopLossPrcntInput) stopLossPrcntInput.value = '';
            return;
        }
        
        const stopLossPrcnt = ((sharePrice - stopLoss) / sharePrice) * 100;
        if (stopLossPrcntInput) {
            stopLossPrcntInput.value = stopLossPrcnt.toFixed(2);
        }
    };
    
    stopLossInput.addEventListener('input', calculateStopLossPercent);
    stopLossInput.addEventListener('blur', calculateStopLossPercent);
}

// Function to recalculate take profit percentage (can be called from anywhere)
function recalculateTakeProfitPercent(form) {
    if (!form) {
        console.log('recalculateTakeProfitPercent: form is null');
        return;
    }
    
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const takeProfitInput = form.querySelector('input[name="take_profit"]');
    const takeProfitPrcntInput = form.querySelector('input[name="take_profit_prcnt"]');
    
    console.log('recalculateTakeProfitPercent called:', {
        hasSharePrice: !!sharePriceInput,
        hasTakeProfit: !!takeProfitInput,
        hasTakeProfitPrcnt: !!takeProfitPrcntInput,
        sharePriceValue: sharePriceInput?.value,
        takeProfitValue: takeProfitInput?.value
    });
    
    if (!sharePriceInput || !takeProfitInput || !takeProfitPrcntInput) {
        console.log('recalculateTakeProfitPercent: Missing inputs');
        return;
    }
    
    const sharePriceStr = String(sharePriceInput.value || '').trim().replace(',', '.');
    const takeProfitStr = String(takeProfitInput.value || '').trim().replace(',', '.');
    
    console.log('recalculateTakeProfitPercent: Parsed strings:', {
        sharePriceStr,
        takeProfitStr,
        sharePriceEmpty: !sharePriceStr,
        takeProfitEmpty: !takeProfitStr
    });
    
    // Only calculate if BOTH values are present
    if (!sharePriceStr || !takeProfitStr) {
        console.log('recalculateTakeProfitPercent: One or both values empty, skipping');
        return;
    }
    
    const sharePrice = parseFloat(sharePriceStr);
    const takeProfit = parseFloat(takeProfitStr);
    
    console.log('recalculateTakeProfitPercent: Parsed numbers:', {
        sharePrice,
        takeProfit,
        sharePriceValid: !isNaN(sharePrice) && sharePrice > 0,
        takeProfitValid: !isNaN(takeProfit) && takeProfit > 0
    });
    
    if (isNaN(sharePrice) || sharePrice <= 0 || isNaN(takeProfit) || takeProfit <= 0) {
        console.log('recalculateTakeProfitPercent: Invalid numbers, skipping');
        return;
    }
    
    const takeProfitPrcnt = ((takeProfit - sharePrice) / sharePrice) * 100;
    const formattedValue = takeProfitPrcnt.toFixed(2);
    takeProfitPrcntInput.value = formattedValue;
    console.log('✓ recalculateTakeProfitPercent: Set value to', formattedValue, '%');
}

// Setup event listener for take profit input to calculate take profit percentage
function setupTakeProfitListener(form) {
    const takeProfitInput = form.querySelector('input[name="take_profit"]');
    const takeProfitPrcntInput = form.querySelector('input[name="take_profit_prcnt"]');
    
    if (!takeProfitInput || !takeProfitPrcntInput) {
        return;
    }

    // Avoid duplicate listeners (setup can be called more than once)
    if (form.dataset.takeProfitBound === '1') {
        return;
    }
    form.dataset.takeProfitBound = '1';
    
    // Track if we're waiting for share price to load
    let waitingForSharePrice = false;
    let checkInterval = null;
    
    const calculateTakeProfitPercent = () => {
        // Always query the DOM fresh to get the current value
        // This ensures we get the latest value even if it was set asynchronously
        const sharePriceInput = form.querySelector('input[name="share_price"]');
        if (!sharePriceInput) {
            console.log('calculateTakeProfitPercent: sharePriceInput not found in form');
            return;
        }
        
        const sharePriceStr = String(sharePriceInput.value || '').trim().replace(',', '.');
        const takeProfitStr = String(takeProfitInput.value || '').trim().replace(',', '.');
        
        console.log('calculateTakeProfitPercent called:', {
            sharePriceStr,
            takeProfitStr,
            sharePriceEmpty: !sharePriceStr,
            takeProfitEmpty: !takeProfitStr,
            sharePriceInputExists: !!sharePriceInput,
            sharePriceInputValue: sharePriceInput.value
        });
        
        // Only calculate if BOTH values are present
        // Don't clear the field if only one is empty (user might be typing)
        if (!sharePriceStr || !takeProfitStr) {
            // If take profit is set but share price is empty, start checking periodically
            if (takeProfitStr && !sharePriceStr && !waitingForSharePrice) {
                console.log('calculateTakeProfitPercent: Take profit set but share price empty, starting periodic check');
                waitingForSharePrice = true;
                
                // Clear any existing interval
                if (checkInterval) {
                    clearInterval(checkInterval);
                }
                
                // Check every 200ms for up to 5 seconds (25 checks)
                let checkCount = 0;
                checkInterval = setInterval(() => {
                    checkCount++;
                    // Always query fresh from DOM
                    const currentSharePriceInput = form.querySelector('input[name="share_price"]');
                    const currentSharePrice = currentSharePriceInput ? String(currentSharePriceInput.value || '').trim() : '';
                    const currentTakeProfit = String(takeProfitInput.value || '').trim();
                    
                    if (currentSharePrice && currentTakeProfit) {
                        console.log('calculateTakeProfitPercent: Both values now available, calculating');
                        clearInterval(checkInterval);
                        checkInterval = null;
                        waitingForSharePrice = false;
                        calculateTakeProfitPercent();
                    } else if (checkCount >= 25) {
                        console.log('calculateTakeProfitPercent: Timeout waiting for share price');
                        clearInterval(checkInterval);
                        checkInterval = null;
                        waitingForSharePrice = false;
                    }
                }, 200);
            }
            console.log('calculateTakeProfitPercent: One or both values empty, skipping');
            return; // Don't clear, just return - let user finish typing
        }
        
        // Stop checking if both values are now available
        if (waitingForSharePrice && checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
            waitingForSharePrice = false;
        }
        
        const sharePrice = parseFloat(sharePriceStr);
        const takeProfit = parseFloat(takeProfitStr);
        
        console.log('calculateTakeProfitPercent: Parsed values:', {
            sharePrice,
            takeProfit,
            sharePriceValid: !isNaN(sharePrice) && sharePrice > 0,
            takeProfitValid: !isNaN(takeProfit) && takeProfit > 0
        });
        
        if (isNaN(sharePrice) || sharePrice <= 0) {
            console.log('calculateTakeProfitPercent: Share price invalid, clearing field');
            takeProfitPrcntInput.value = '';
            return;
        }
        
        if (isNaN(takeProfit) || takeProfit <= 0) {
            console.log('calculateTakeProfitPercent: Take profit invalid, clearing field');
            takeProfitPrcntInput.value = '';
            return;
        }
        
        const takeProfitPrcnt = ((takeProfit - sharePrice) / sharePrice) * 100;
        const formattedValue = takeProfitPrcnt.toFixed(2);
        takeProfitPrcntInput.value = formattedValue;
        console.log('✓ calculateTakeProfitPercent: Set value to', formattedValue, '%');
    };
    
    // Add event listeners - always try to calculate
    takeProfitInput.addEventListener('input', (e) => {
        // Always try to calculate - the function will check if both values are present
        calculateTakeProfitPercent();
    });
    takeProfitInput.addEventListener('blur', (e) => {
        // Always try to calculate on blur
        // This ensures calculation happens even if share price was loaded asynchronously
        calculateTakeProfitPercent();
    });
    
    // Also trigger calculation if share price changes (in case take profit is already set)
    // We need to query the form fresh each time to get the current sharePriceInput
    const sharePriceHandler = () => {
        // Always try to calculate - the function will check if both values are present
        console.log('sharePriceHandler: Share price changed, recalculating');
        calculateTakeProfitPercent();
    };
    
    // Find sharePriceInput fresh and attach listeners
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    if (sharePriceInput) {
        sharePriceInput.addEventListener('input', sharePriceHandler);
        sharePriceInput.addEventListener('blur', sharePriceHandler);
        sharePriceInput.addEventListener('change', sharePriceHandler);
    }
    
    // Calculate immediately if both values are already present and not empty
    // This will work for both new deals (after stock is selected) and existing deals
    if (sharePriceInput && sharePriceInput.value && takeProfitInput.value && 
        sharePriceInput.value.trim() && takeProfitInput.value.trim()) {
        setTimeout(() => {
            calculateTakeProfitPercent();
        }, 100);
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

    // Track the last loaded ticker to avoid duplicate calls
    let lastLoadedTicker = currentValue;
    let isLoading = false;

    // Function to load data for a ticker
    const loadDataForTicker = async (ticker) => {
        // Skip if already loading the same ticker
        if (isLoading && lastLoadedTicker === ticker) {
            console.log('Skipping duplicate load for ticker:', ticker);
            return;
        }
        
        if (ticker && ticker.trim() !== '') {
            // Mark as loading and update last loaded ticker
            isLoading = true;
            lastLoadedTicker = ticker;
            
            const formContainer = form.closest('.deal-form-container');
            console.log('Loading data for ticker:', ticker);
            
            try {
                // Show overlay spinner while all async fields are loading.
                setDealFormLoading(formContainer, true, 'Loading…');

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
                    }),
                    loadAverageWeeklyVolume(ticker).catch(err => {
                        console.error('loadAverageWeeklyVolume failed:', err);
                        return null;
                    }),
                    loadMovementMetricsAndDisplay(ticker, form).catch(err => {
                        console.error('loadMovementMetricsAndDisplay failed:', err);
                        return null;
                    }),
                    loadCandleColor(ticker, form).catch(err => {
                        console.error('loadCandleColor failed:', err);
                        return null;
                    }),
                    loadSp500Trend(form).catch(err => {
                        console.error('loadSp500Trend failed:', err);
                        return null;
                    })
                ]);
                
                console.log('All requests completed:', results);
            } finally {
                setDealFormLoading(formContainer, false);
                // Reset loading flag after all requests complete
                isLoading = false;
            }
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
            
            // Clear movement metrics from title when stock is deselected
            const dealRow = formContainer?.closest('.deal-row');
            if (dealRow) {
                const summary = dealRow.querySelector('.deal-summary');
                const titleElement = summary?.querySelector('strong');
                if (titleElement) {
                    const metricsDisplay = titleElement.querySelector('.movement-metrics-display');
                    if (metricsDisplay) {
                        metricsDisplay.remove();
                    }
                    
                    // Reset title to "New Deal" if no stock selected
                    const stockSelect = form.querySelector('.deal-stock-select');
                    if (stockSelect && !stockSelect.value) {
                        const currentText = titleElement.textContent.split('!')[0].trim(); // Remove warning icons
                        if (currentText && currentText !== 'New Deal') {
                            titleElement.innerHTML = titleElement.innerHTML.replace(/^[^<]+/, 'New Deal');
                        }
                    }
                }
            }
        }
    };

    const chartContainerId = `tv_chart_${dealId}`;
    
    // Add change event listener
    newSelect.addEventListener('change', async (e) => {
        const ticker = e.target.value;
        // Only load if ticker changed from last loaded
        if (ticker !== lastLoadedTicker) {
            await loadDataForTicker(ticker);
        }
        
        // Always attempt to render chart for the selected ticker
        const symbol = buildSymbolFromTicker(ticker);
        if (symbol) {
            renderTradingViewChart(chartContainerId, symbol, 'W');
        }
    });
    
    // Also listen to input event (for when user types in a select with search/autocomplete)
    // But skip if change event already handled it
    newSelect.addEventListener('input', async (e) => {
        const ticker = e.target.value;
        // Only trigger if value actually changed and not already loading
        if (ticker !== lastLoadedTicker && !isLoading) {
            await loadDataForTicker(ticker);
        }
        
        const symbol = buildSymbolFromTicker(ticker);
        if (symbol) {
            renderTradingViewChart(chartContainerId, symbol, 'W');
        }
    });
    
    // Setup listeners for monthly_dir and weekly_dir selects to add red border when "Down" is selected
    setupTrendSelectListeners(form);
}

async function handleDealSubmit(form, deal, isNew) {
    const submitButton = form.querySelector('button[type="submit"]');
    if (!submitButton) return;
    
    try {
        // NOTE:
        // Do NOT block planning/saving deals by trends.
        // Trends blocking is enforced only when activating planned -> real (Create deal).

        setButtonLoading(submitButton, true);
        
        const formData = new FormData(form);
        const obj = {
            id: deal?.id || null,
            closed: deal?.closed || false,
            closedAt: deal?.closedAt || null
        };

        const stagesPayload = [];
        const stagePricesPayload = [];
        for (const [k, v] of formData.entries()) {
            if (k === 'amount_tobuy_stages[]') {
                stagesPayload.push(v);
            } else if (k === 'buy_price_stages[]') {
                stagePricesPayload.push(v);
            } else {
                obj[k] = v;
            }
        }

        // planned_future: new deals are always created as planned; existing keep their flag
        if (isNew) {
            obj.planned_future = true;
        } else {
            obj.planned_future = !!(deal && deal.planned_future);
        }

        // Calculate and include total sum (all stages)
        const sharePriceStr = obj.share_price || '';
        const sharePriceNum = parseNumber(sharePriceStr);

        const stageInputs = Array.from(form.querySelectorAll('input[name="amount_tobuy_stages[]"]'));
        const orderedStageNums = stageInputs.map(i => parseNumber(i.value));
        const stage1Num = orderedStageNums[0] || 0;

        // Validate: stage 1 must be present and > 0; any non-empty stage must parse to > 0
        if (!stage1Num || stage1Num <= 0) {
            showDealLimitModal('Stage 1 amount is required and must be > 0.');
            setButtonLoading(submitButton, false);
            return;
        }

        for (const input of stageInputs) {
            const raw = String(input.value || '').trim();
            const n = parseNumber(raw);
            if (raw && (!n || n <= 0)) {
                showDealLimitModal('All stage amounts must be positive numbers.');
                setButtonLoading(submitButton, false);
                return;
            }
        }

        // Build payload for amount_tobuy_stages and buy_price_stages aligned by index.
        // Server requires all amount_tobuy_stages to be positive numbers (no blanks).
        const stagePriceInputs = Array.from(form.querySelectorAll('input[name="buy_price_stages[]"]'));
        const stagesNums = [];
        const stagesRaw = [];
        const pricesRaw = [];
        for (let i = 0; i < stageInputs.length; i++) {
            const rawShares = String(stageInputs[i]?.value || '').trim();
            const sharesNum = parseNumber(rawShares);
            if (sharesNum && sharesNum > 0) {
                stagesNums.push(sharesNum);
                stagesRaw.push(String(sharesNum));

                const rawPrice = String(stagePriceInputs[i]?.value || '').trim();
                if (rawPrice) {
                    const priceNum = parseNumber(rawPrice);
                    if (!priceNum || priceNum <= 0) {
                        showDealLimitModal('All Buy price values must be positive numbers.');
                        setButtonLoading(submitButton, false);
                        return;
                    }
                    pricesRaw.push(String(priceNum));
                } else {
                    // Keep alignment with stages
                    pricesRaw.push('');
                }
            }
        }

        if (stagesRaw.length > 0) {
            obj.amount_tobuy_stages = stagesRaw;
        }
        // Only include buy_price_stages if user provided at least one price
        if (pricesRaw.some(p => String(p || '').trim() !== '')) {
            obj.buy_price_stages = pricesRaw;
        }

        const totalSum = calculateTotalSumFromStages(sharePriceStr, stagesNums);
        if (totalSum) obj.total_sum = totalSum;

        const totalPlanned = sharePriceNum * sumStages(stagesNums);

        if (!obj.date) {
            obj.date = new Date().toISOString().slice(0, 10);
        }

        // ATH proximity warning (new deals only)
        if (isNew) {
            const ticker = String(obj.stock || '').trim();
            const priceNow = parseNumber(form?.dataset?.lastQuotePrice || obj.share_price || '');
            const proceed = await warnIfNearAthForNewDeal(form, ticker, priceNow);
            if (!proceed) {
                setButtonLoading(submitButton, false);
                return;
            }
        }

        // Persist stop_loss_prcnt based on Avrg price (avg entry) when available.
        // This keeps the badge (server data) consistent with the live form calculation.
        try {
            const slInput = form.querySelector('input[name="stop_loss"]');
            const slPctInput = form.querySelector('input[name="stop_loss_prcnt"]');
            const base = getStopLossBasePrice(form);
            const sl = parseMoney(slInput?.value);
            if (base > 0 && sl > 0) {
                const pct = ((base - sl) / base) * 100;
                if (Number.isFinite(pct)) {
                    const pctText = pct.toFixed(2);
                    obj.stop_loss_prcnt = pctText;
                    if (slPctInput) slPctInput.value = pctText;
                }
            }
        } catch {
            // ignore; server will validate stop_loss_prcnt anyway
        }

        // Validate against deal limits (risk constraints).
        // NOTE: We do NOT check Cash on Save changes / planning.
        // Planned deals must not "reserve" Cash. Cash is checked only on Activate (Create deal).

        const slPctNum = parseNumber(obj.stop_loss_prcnt || '');
        if (isNaN(slPctNum)) {
            showDealLimitModal('Stop loss % is required.');
            setButtonLoading(submitButton, false);
            return;
        }
        // Limit checks only for new deals; existing edits should not be blocked
        if (isNew && slPctNum > 0 && totalPlanned > 0) {
            try {
                const res = await apiFetch(`/api/deals/limits?stopLossPercent=${encodeURIComponent(slPctNum)}`, {
                    headers: authHeaders()
                });
                if (res.ok) {
                    const limits = await res.json();
                    const isSingle = stagesNums.length === 1;

                    if (isSingle) {
                        if (totalPlanned > limits.singleStageMax) {
                            const proceed = await showDealLimitModal(
                                `Single-stage deal is too big.\n` +
                                `Max allowed: ${limits.singleStageMax.toFixed(2)}.\n\n` +
                                `Do you still want to PLAN this deal?`,
                                { title: 'Deal limit warning', mode: 'confirm', okText: 'Continue', cancelText: 'Cancel' }
                            );
                            if (!proceed) {
                                setButtonLoading(submitButton, false);
                                return;
                            }
                        }
                    } else {
                        const stage1Sum = sharePriceNum * (stagesNums[0] || 0);
                        if (stage1Sum > limits.maxStage1 || totalPlanned > limits.maxPosition) {
                            const proceed = await showDealLimitModal(
                                `Multi-stage deal exceeds limits.\n` +
                                `Stage 1 max: ${limits.maxStage1.toFixed(2)}, total max: ${limits.maxPosition.toFixed(2)}.\n\n` +
                                `Do you still want to PLAN this deal?`,
                                { title: 'Deal limit warning', mode: 'confirm', okText: 'Continue', cancelText: 'Cancel' }
                            );
                            if (!proceed) {
                                setButtonLoading(submitButton, false);
                                return;
                            }
                        }
                    }

                    if (!limits.allowed) {
                        // For PLANNED deals we do not block saving; we only warn.
                        // Blocking is applied on activation with separate thresholds (warn >5%, block >=10%).
                        let currentRiskText = '';
                        try {
                            const riskEl = document.getElementById('portfolioRiskValue');
                            currentRiskText = riskEl ? riskEl.textContent.trim() : '';
                        } catch { }

                        showDealLimitModal(
                            `Your portfolio risk is already high${currentRiskText ? ` (${currentRiskText})` : ''}.\n` +
                            `This deal is NOT recommended right now.\n\n` +
                            `You can still PLAN the deal (it won’t change Cash/In Shares).\n` +
                            `But activating it is better after reducing total risk.\n\n` +
                            `Details:\n` +
                            `Added risk (at max allowed sizing): ${limits.addedRiskPercent.toFixed(2)}%.`,
                            { title: 'High risk warning', mode: 'info' }
                        );
                        // Continue saving (no return)
                    }
                }
            } catch (err) {
                console.error('Failed to validate deal limits', err);
            }
        }

        const isEdit = !isNew;
        const hasValidId = typeof obj.id === 'string' && obj.id.trim().length === 24;
        if (isEdit && !hasValidId) {
            alert('Deal id is invalid. Please refresh the list and try again.');
            return;
        }

        // FormData produces strings; API expects boolean for share_price_manual.
        // If user edited Share price, we store "true"/"false" in the hidden input.
        // Convert it to a real boolean before sending JSON.
        obj.share_price_manual =
            obj.share_price_manual === true ||
            obj.share_price_manual === 'true' ||
            obj.share_price_manual === '1';

        await saveDealToServer(obj, isEdit);

        // New planned deals should NOT affect cash / In Shares until activated.
        const isPlannedNew = isNew && obj.planned_future === true;

        // Portfolio deduction is now handled server-side in DealsController.
        // Refresh portfolio only when deal actually affects it.
        if (!isPlannedNew) {
            await refreshPortfolioFromServer();
        }
        
        if (isNew) {
            newDealRow = null;
        }
        expandedDealId = null;
        await loadDeals();
        
        // Recalculate risk metrics only when portfolio is affected.
        if (!isPlannedNew) {
            await calculateAndDisplayPortfolioRisk();
            await calculateAndDisplayInSharesRisk();
        }
    } catch (e) {
        console.error(e);
        alert('Failed to save deal.');
    } finally {
        setButtonLoading(submitButton, false);
    }
}

// Function to refresh portfolio value from server
// Portfolio deduction is now handled server-side for security
async function refreshPortfolioFromServer() {
    if (!portfolioSpan) return;
    
    try {
        const res = await apiFetch('/api/users/portfolio', {
            method: 'GET',
            headers: {
                ...authHeaders()
            }
        });
        
        if (res.ok) {
            const data = await res.json();
            const portfolioValue = data.portfolio || 0;
            
            // Update localStorage
            localStorage.setItem('portfolio', String(portfolioValue));
            
            // Update UI
            portfolioSpan.textContent = Number(portfolioValue).toFixed(2);
            
            console.log('Portfolio refreshed from server:', portfolioValue);
        } else {
            console.warn('Failed to refresh portfolio from server', res.status);
        }
    } catch (e) {
        console.error('Error refreshing portfolio from server', e);
    }
}

// Function to calculate and display portfolio risk percentage
async function calculateAndDisplayPortfolioRisk() {
    try {
        const res = await apiFetch('/api/deals/risk-percent', {
            method: 'GET',
            headers: {
                ...authHeaders()
            }
        });

        if (res.ok) {
            const riskPercent = await res.json();
            
            // Find or create risk display element
            let riskDisplay = document.getElementById('portfolioRiskDisplay');
            if (!riskDisplay) {
                // Create display element near portfolio value
                riskDisplay = document.createElement('span');
                riskDisplay.id = 'portfolioRiskDisplay';
                riskDisplay.className = 'portfolio-risk';
                riskDisplay.style.marginLeft = '12px';
                riskDisplay.style.color = 'var(--muted)';
                riskDisplay.style.fontSize = '14px';
                
                // Insert after portfolio span
                if (portfolioSpan && portfolioSpan.parentNode) {
                    portfolioSpan.parentNode.insertBefore(riskDisplay, portfolioSpan.nextSibling);
                }
            }
            
            // Update display
            riskDisplay.textContent = `Risk: ${riskPercent.toFixed(2)}%`;
            
            // Add warning class if risk is high (>10%)
            if (riskPercent > 10) {
                riskDisplay.style.color = '#dc2626'; // red
                riskDisplay.style.fontWeight = '600';
            } else if (riskPercent > 5) {
                riskDisplay.style.color = '#f59e0b'; // orange
                riskDisplay.style.fontWeight = '500';
            } else {
                riskDisplay.style.color = 'var(--muted)';
                riskDisplay.style.fontWeight = 'normal';
            }
            
            return riskPercent;
        } else {
            console.warn('Failed to get portfolio risk percent', res.status);
        }
    } catch (e) {
        console.error('Error calculating portfolio risk', e);
    }
    return null;
}

// Function to fetch previous week's low and high prices
async function loadPreviousWeekLowPrice(ticker, form) {
    if (!ticker || !form) return;

    const formContainer = form.closest('.deal-form-container');
    setPriceError(formContainer, '');

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}`, {
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
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}/quote`, {
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
            const quotePx = data.price.toString();
            form.dataset.lastQuotePrice = quotePx;

            // Share price is the CURRENT price (quote) unless user manually locked it.
            const sharePriceInput = form.querySelector('input[name="share_price"]');
            const sharePriceManualInput = form.querySelector('input[name="share_price_manual"]');
            const shareLocked = (sharePriceManualInput?.value === 'true') || (form.dataset.sharePriceManual === '1');
            if (sharePriceInput && !shareLocked) {
                sharePriceInput.value = quotePx;
                sharePriceInput.dispatchEvent(new Event('input', { bubbles: true }));
                sharePriceInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // "Current price" is Buy price (stage 1). Auto-fill unless user manually edited it.
            const bp1 = form.querySelector('input[name="buy_price_stages[]"][data-stage-index="0"]')
                || form.querySelector('input[name="buy_price_stages[]"]');
            if (bp1) {
                const locked = form.dataset.buyPriceStage1Manual === '1';
                if (!locked && bp1.dataset.userSet !== '1') {
                    bp1.value = quotePx;
                    // Ensure avg gets recomputed when quote arrives
                    bp1.dispatchEvent(new Event('input', { bubbles: true }));
                    bp1.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }

            // Avg entry is computed and displayed separately (read-only).
            updateAvgEntryUI(form);

            // Also trigger a small delay to ensure all event handlers have processed
            setTimeout(() => {
                recalculateTakeProfitPercent(form);
            }, 50);

            // Calculate stop loss after prices are available (avg entry may have updated share_price)
            await calculateStopLoss(form);

            // Recalculate take profit percentage if take profit is already set
            recalculateTakeProfitPercent(form);
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
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}/trends`, {
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
                const canAutoMonthly = !monthlySelect.value && !isDirty(form, 'monthly_dir');
                if (canAutoMonthly) {
                    monthlySelect.value = data.monthly;
                    updateTrendSelectClass(monthlySelect);
                    console.log('Auto-set monthly_dir to:', data.monthly);
                } else {
                    updateTrendSelectClass(monthlySelect);
                }
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
                const canAutoWeekly = !weeklySelect.value && !isDirty(form, 'weekly_dir');
                if (canAutoWeekly) {
                    weeklySelect.value = data.weekly;
                    updateTrendSelectClass(weeklySelect);
                    console.log('Auto-set weekly_dir to:', data.weekly);
                } else {
                    updateTrendSelectClass(weeklySelect);
                }
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

const defaultMovementSettings = {
    timeframe: 'Weekly',
    lookback: 52
};

function loadMovementSettings() {
    try {
        const raw = localStorage.getItem('movementSettings');
        if (!raw) return { ...defaultMovementSettings };
        const parsed = JSON.parse(raw);
        return {
            timeframe: parsed.timeframe || 'Weekly',
            lookback: parsed.lookback || 52
        };
    } catch {
        return { ...defaultMovementSettings };
    }
}

function saveMovementSettings(settings) {
    try {
        localStorage.setItem('movementSettings', JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save movement settings', e);
    }
}

window.movementSettings = loadMovementSettings();

// ======== Current Price badge (CP) in deal title (open + planned only) ========
// Goal:
// - Share price remains the entry/buy price in the form.
// - Current price is shown as CP:<value> in the title.
// - Cache once per UTC day to avoid API quota issues.

const quotePromiseCache = new Map(); // key -> Promise<{price,lastUpdatedUtc} | null>

// ======== Portfolio Risk badge in deal title (open + planned only) ========
// Mirrors header color thresholds: green <=5%, orange (5..10], red >10%
let latestPortfolioRiskPercent = null;

function applyPortfolioRiskClasses(el, riskValue) {
    if (!el) return;
    el.classList.remove('risk-low', 'risk-medium', 'risk-high');
    if (riskValue > 10) el.classList.add('risk-high');
    else if (riskValue > 5) el.classList.add('risk-medium');
    else el.classList.add('risk-low');
}

function getHeaderTotalSumValue() {
    const el = document.getElementById('totalSumValue');
    if (!el) return 0;
    const raw = String(el.textContent || '').trim().replace(',', '.');
    return parseFloat(raw) || 0;
}

function getCurrentPortfolioRiskFromHeader() {
    const el = document.getElementById('portfolioRiskValue');
    if (!el) return 0;
    // Might be formatted like "3.42%" or "3.42% [..]"
    return parseNumber(String(el.textContent || ''));
}

function getPlannedDealTotalSumValue(deal) {
    if (!deal) return 0;

    // Prefer persisted total_sum
    const totalSumRaw = deal.total_sum;
    if (totalSumRaw != null && String(totalSumRaw).trim() !== '') {
        const n = parseFloat(String(totalSumRaw).trim().replace(',', '.')) || 0;
        if (n > 0) return n;
    }

    // Fallback: share_price * sum(stages)
    const sharePrice = parseNumber(deal.share_price);
    const stages = getStagesFromDeal(deal);
    const shares = sumStages(stages);
    const total = sharePrice * shares;
    return total > 0 ? total : 0;
}

function calcAddedRiskPercentForPlannedDeal(deal) {
    const totalSum = getHeaderTotalSumValue();
    if (totalSum <= 0) return 0;

    const plannedTotal = getPlannedDealTotalSumValue(deal);
    const slPct = parseNumber(deal?.stop_loss_prcnt);
    if (plannedTotal <= 0 || slPct <= 0) return 0;

    const addedRiskAmount = plannedTotal * (slPct / 100);
    const addedRiskPercent = (addedRiskAmount / totalSum) * 100;
    return Math.round(addedRiskPercent * 100) / 100; // 2 decimals
}

function updatePlannedRiskBadges() {
    const badges = document.querySelectorAll('.planned-risk-badge');
    if (!badges || badges.length === 0) return;

    const currentRisk =
        (typeof latestPortfolioRiskPercent === 'number' ? latestPortfolioRiskPercent : null)
        ?? getCurrentPortfolioRiskFromHeader();

    badges.forEach(badge => {
        const dealId = badge.getAttribute('data-deal-id') || '';
        const deal = deals?.find?.(d => d && String(d.id) === dealId);
        if (!deal || deal.closed || !deal.planned_future) {
            badge.textContent = '+Risk:-';
            badge.setAttribute('data-tooltip', 'Planned deal: added risk if activated');
            badge.classList.remove('risk-low', 'risk-medium', 'risk-high');
            return;
        }

        const added = calcAddedRiskPercentForPlannedDeal(deal);
        if (!added) {
            badge.textContent = '+Risk:-';
            badge.setAttribute('data-tooltip', 'Planned deal: added risk if activated');
            badge.classList.remove('risk-low', 'risk-medium', 'risk-high');
            return;
        }

        const predicted = (Number(currentRisk) || 0) + added;
        const sign = added > 0 ? '+' : '';
        badge.textContent = `+Risk:${sign}${added.toFixed(2)}%`;

        // Color by predicted portfolio risk if activated
        applyPortfolioRiskClasses(badge, predicted);

        badge.setAttribute(
            'data-tooltip',
            `Planned deal: added risk if activated: ${sign}${added.toFixed(2)}%.\n` +
            `If active: ${predicted.toFixed(2)}% (current: ${(Number(currentRisk) || 0).toFixed(2)}%).`
        );
    });
}

function getUtcDayKey() {
    // Use UTC day to match backend IsSameDay(DateTime.UtcNow.Date)
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getQuoteStorageKey(ticker) {
    const t = (ticker || '').trim().toUpperCase();
    return `dm_quote_${t}_${getUtcDayKey()}`;
}

function formatPriceForBadge(price) {
    const n = typeof price === 'number' ? price : parseFloat(String(price));
    if (!isFinite(n)) return String(price ?? '-');
    return n.toFixed(2);
}

function formatLastUpdatedUtcForTooltip(lastUpdatedUtc) {
    if (!lastUpdatedUtc) return '';
    try {
        // Display explicitly as UTC to avoid confusion
        const iso = new Date(lastUpdatedUtc).toISOString(); // always UTC
        return iso.replace('T', ' ').replace('.000Z', 'Z').replace('Z', ' UTC');
    } catch {
        return String(lastUpdatedUtc);
    }
}

async function getDailyQuote(ticker) {
    const t = (ticker || '').trim().toUpperCase();
    if (!t) return null;

    const storageKey = getQuoteStorageKey(t);

    // 1) localStorage cache (per UTC day)
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.price != null) return parsed;
        }
    } catch {
        // ignore cache errors
    }

    // 2) in-flight dedupe (avoid concurrent requests for many rows)
    if (quotePromiseCache.has(storageKey)) {
        return await quotePromiseCache.get(storageKey);
    }

    const p = (async () => {
        try {
            const res = await apiFetch(`/api/prices/${encodeURIComponent(t)}/quote`, {
                headers: { ...authHeaders() }
            });

            if (!res.ok) return null;

            const data = await res.json();
            if (!data || data.price == null) return null;

            // Expected from backend: { price, lastUpdatedUtc }
            const payload = {
                price: data.price,
                lastUpdatedUtc: data.lastUpdatedUtc || null
            };

            try {
                localStorage.setItem(storageKey, JSON.stringify(payload));
            } catch {
                // ignore storage quota issues
            }

            return payload;
        } catch (e) {
            console.warn('Failed to load current quote for badge', t, e);
            return null;
        } finally {
            // Allow retries on subsequent renders if something transient happened
            quotePromiseCache.delete(storageKey);
        }
    })();

    quotePromiseCache.set(storageKey, p);
    return await p;
}

async function attachCurrentPriceBadge(badgeEl, ticker) {
    if (!badgeEl || !ticker) return;

    const t = (ticker || '').trim().toUpperCase();
    if (!t) return;

    // Color rules vs entry/share price:
    // - CP >= SP: green
    // - CP <  SP: red
    const updateColorByEntry = (currentPriceRaw) => {
        badgeEl.classList.remove('cp-green', 'cp-red');
        const entryRaw = badgeEl.getAttribute('data-entry-price') || '';
        const entry = parseNumber(entryRaw);
        const current = parseNumber(currentPriceRaw);
        if (!entry || !current) return;
        badgeEl.classList.add(current >= entry ? 'cp-green' : 'cp-red');
    };

    // Show loading state (small and non-intrusive)
    if (!badgeEl.textContent || badgeEl.textContent.trim() === '') {
        badgeEl.textContent = 'CP:-';
    }

    const quote = await getDailyQuote(t);
    if (!quote) {
        badgeEl.textContent = 'CP:-';
        badgeEl.setAttribute('data-tooltip', 'Current price is unavailable');
        badgeEl.classList.remove('cp-green', 'cp-red');
        return;
    }

    const priceText = formatPriceForBadge(quote.price);
    badgeEl.textContent = `CP:${priceText}`;
    updateColorByEntry(quote.price);

    const updated = formatLastUpdatedUtcForTooltip(quote.lastUpdatedUtc);
    badgeEl.setAttribute(
        'data-tooltip',
        updated
            ? `Current price (as of ${updated})`
            : 'Current price (cached today)'
    );
}

// Load movement metrics for a ticker
async function loadMovementMetrics(ticker) {
    if (!ticker) {
        console.log('loadMovementMetrics: No ticker provided');
        return null;
    }
    
    try {
        console.log('Loading movement metrics for ticker:', ticker);
        const s = window.movementSettings || defaultMovementSettings;
        const lookback = s.lookback || 52;
        const timeframe = encodeURIComponent(s.timeframe || 'Weekly');
        const url = `/api/prices/${encodeURIComponent(ticker)}/movement-score?lookback=${lookback}&timeframe=${timeframe}`;
        console.log('Request URL:', url);
        
        const res = await apiFetch(url, {
            headers: { ...authHeaders() }
        });
        
        console.log('Response status:', res.status, 'OK:', res.ok);
        
        if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            console.warn('Failed to load movement metrics for', ticker, 'Status:', res.status, 'Error:', errorText);
            
            // If 404, the endpoint might not exist yet (needs app restart)
            if (res.status === 404) {
                console.warn('Endpoint not found - application may need to be restarted');
            }
            
            return null;
        }
        
        const data = await res.json();
        console.log('Movement metrics loaded for', ticker, ':', JSON.stringify(data, null, 2));
        
        // Verify we have the expected fields
        if (data && (data.speedPct !== undefined || data.strengthPct !== undefined)) {
            console.log('Movement metrics data is valid');
            return data;
        } else {
            console.warn('Movement metrics data missing expected fields:', data);
            return null;
        }
    } catch (err) {
        console.error('Error loading movement metrics for', ticker, ':', err);
        return null;
    }
}

// Load movement metrics for a composite index built from multiple tickers
async function loadCompositeMovementMetrics(tickersArray) {
    if (!Array.isArray(tickersArray)) return null;

    const symbols = [...new Set(
        tickersArray
            .map(t => (t || '').trim().toUpperCase())
            .filter(Boolean)
    )];

    if (symbols.length < 2) {
        console.warn('loadCompositeMovementMetrics: need at least 2 tickers', symbols);
        return null;
    }

    const s = window.movementSettings || defaultMovementSettings;
    let lookback = parseInt(String(s.lookback || 52), 10);
    if (!Number.isFinite(lookback) || lookback < 2) lookback = 52;

    const buildUrl = (lb) => {
        const params = new URLSearchParams();
        params.set('lookback', String(lb));
        params.set('tickers', symbols.join(','));
        return `/api/prices/composite/movement-score?${params.toString()}`;
    };

    const tryFetch = async (lb) => {
        const url = buildUrl(lb);
        const res = await apiFetch(url, { headers: { ...authHeaders() } });
        if (res.ok) return { ok: true, data: await res.json(), url, status: res.status };
        const errorText = await res.text().catch(() => '');
        return { ok: false, errorText, url, status: res.status };
    };

    try {
        // First attempt: current settings lookback
        let attempt = await tryFetch(lookback);

        // If backend says "not enough common history", clamp and retry once
        if (!attempt.ok && attempt.status === 400) {
            const msg = attempt.errorText || '';
            const haveMatch = msg.match(/have\s+(\d+)/i);
            const have = haveMatch ? parseInt(haveMatch[1], 10) : NaN;

            // Need at least lookback+1 bars -> max usable lookback is (have-1)
            if (Number.isFinite(have) && have > 2) {
                const clamped = Math.max(2, Math.min(lookback, have - 1));
                if (clamped !== lookback) {
                    console.warn(
                        'Composite movement metrics: clamping lookback due to common history limit',
                        { requested: lookback, have, clamped }
                    );
                    lookback = clamped;
                    attempt = await tryFetch(lookback);
                }
            }
        }

        if (!attempt.ok) {
            console.warn('Failed to load composite movement metrics', attempt.status, attempt.url, attempt.errorText);
            return null;
        }

        console.log('Composite movement metrics loaded for', symbols.join('+'), ':', JSON.stringify(attempt.data, null, 2));
        return attempt.data;
    } catch (err) {
        console.error('Error loading composite movement metrics:', err);
        return null;
    }
}

// Format movement metrics for display
function formatMovementMetrics(metrics) {
    if (!metrics) {
        console.log('formatMovementMetrics: No metrics provided');
        return '';
    }
    
    console.log('formatMovementMetrics: Processing metrics:', JSON.stringify(metrics, null, 2));
    
    // Handle both camelCase and potential variations
    const direction = (metrics.direction === 1 || metrics.Direction === 1) ? '↑' : 
                      (metrics.direction === -1 || metrics.Direction === -1) ? '↓' : '→';
    
    // Determine arrow color based on direction
    let arrowColor;
    if (direction === '↑') {
        arrowColor = '#22c55e'; // Green for up
    } else if (direction === '↓') {
        arrowColor = '#ef4444'; // Red for down
    } else {
        arrowColor = '#f59e0b'; // Yellow for flat
    }
    
    const signed = (metrics.signedPct || metrics.SignedPct || 0);
    const signedDisplay = signed > 0 ? `+${signed.toFixed(2)}` : signed.toFixed(2); // Mv
    
    const speed = Math.round(metrics.speedPct || metrics.SpeedPct || 0);          // Sp
    const strength = Math.round(metrics.strengthPct || metrics.StrengthPct || 0); // St
    const ease = Math.round(metrics.easeOfMovePct || metrics.EaseOfMovePct || 0); // E
    
    const returnPctValue = metrics.returnPct || metrics.ReturnPct || 0;
    const returnPct = returnPctValue
        ? (returnPctValue > 0 ? '+' : '') + returnPctValue.toFixed(2)
        : '0.00';
    
    // Helper function to color negative values red
    const formatValue = (value) => {
        const valueStr = String(value);
        if (valueStr.startsWith('-') || parseFloat(valueStr) < 0) {
            return `<span style="color: #ef4444;">${valueStr}</span>`;
        }
        return valueStr;
    };
    
    // Helper function to format metric with tooltip (same style as risk icons)
    // Tooltip is visible on both label and value
    const formatMetric = (label, value, tooltip) => {
        return `<span class="movement-metric-tooltip" data-tooltip="${tooltip}" style="cursor: help; position: relative; display: inline-block;">${label}</span>:<span class="movement-metric-tooltip" data-tooltip="${tooltip}" style="cursor: help; position: relative; display: inline-block;">${formatValue(value)}</span>%`;
    };
    
    // Base (existing) description for Mv
    const baseMvTooltip = 'This is a composite index of Speed, Strength and EaseOfMove.';
    // Append removed metrics (Sp/St/E) to the end of tooltip
    const mvTooltip =
        `${baseMvTooltip}\n\n` +
        `Sp (Speed): ${speed}% | St (Strength): ${strength}% | E (Ease): ${ease}%`;
    
    const retTooltip = 'Percentage change in price of the last bar';
    
    // Visibly show only arrow, Mv and Ret in the deal title
    const formatted = `<span class="movement-metrics-display" style="font-size: 11px; color: #64748b; margin-left: 8px; font-weight: normal;">
        <span style="color: ${arrowColor}; font-weight: 900; font-size: 18px; text-shadow: 0.5px 0.5px 0.5px rgba(0,0,0,0.2);">${direction}</span>
        | ${formatMetric('Mv', signedDisplay, mvTooltip)}
        | ${formatMetric('Ret', returnPct, retTooltip)}
    </span>`;
    
    console.log('formatMovementMetrics: Formatted result:', formatted);
    return formatted;
}

// Track loading state to prevent duplicate calls
const movementMetricsLoading = new Set();

// Load and display movement metrics in the deal row title
async function loadMovementMetricsAndDisplay(ticker, form) {
    if (!ticker || !form) return;
    
    // Create a unique key for this deal row to track loading state
    const formContainer = form.closest('.deal-form-container');
    const dealRow = formContainer?.closest('.deal-row');
    if (!dealRow) {
        console.warn('Deal row not found for movement metrics');
        return;
    }
    
    const loadingKey = `${dealRow.dataset.dealId || 'new'}-${ticker}`;
    
    // Check if already loading or already loaded
    if (movementMetricsLoading.has(loadingKey)) {
        console.log('Movement metrics already loading for', ticker);
        return;
    }
    
    try {
        movementMetricsLoading.add(loadingKey);
        
        const summary = dealRow.querySelector('.deal-summary');
        const stockNameDiv = summary?.querySelector('.stock-name');
        const titleElement = stockNameDiv?.querySelector('strong');
        const metricsContainer = summary?.querySelector('.movement-metrics-container');
        
        if (!titleElement) {
            console.warn('Title element not found in deal row');
            movementMetricsLoading.delete(loadingKey);
            return;
        }
        
        // Remove any movement metrics from stock name (cleanup - they should only be after price)
        const movementMetricsInStockName = titleElement.querySelectorAll('.movement-metrics-display');
        movementMetricsInStockName.forEach(metric => metric.remove());
        
        // Update title from "New Deal" to ticker if needed
        const currentTitleText = titleElement.textContent.trim().split('!')[0].trim(); // Get text without warning icons
        if (currentTitleText === 'New Deal') {
            // Get warning indicators if they exist (they might be added after)
            const warningIcons = titleElement.querySelectorAll('.volume-warning-icon');
            const warningHTML = Array.from(warningIcons).map(icon => icon.outerHTML).join('');
            
            // Clear current content and set ticker
            titleElement.innerHTML = '';
            const tickerText = document.createTextNode(ticker);
            titleElement.appendChild(tickerText);
            
            // Append warning icons after ticker text
            if (warningHTML) {
                titleElement.insertAdjacentHTML('beforeend', warningHTML);
            }
            
            console.log('Updated deal title to:', ticker);
        }
        
        // Load metrics
        const metrics = await loadMovementMetrics(ticker);
        
        // Remove any existing movement metrics from the container AND from stock name (double cleanup)
        const allMetricsInStockName = titleElement.querySelectorAll('.movement-metrics-display');
        allMetricsInStockName.forEach(metric => metric.remove());
        
        // Also remove from stock-name div itself (not just the strong tag)
        if (stockNameDiv) {
            const metricsInStockNameDiv = stockNameDiv.querySelectorAll('.movement-metrics-display');
            metricsInStockNameDiv.forEach(metric => metric.remove());
        }
        
        if (metricsContainer) {
            const existingMetrics = metricsContainer.querySelectorAll('.movement-metrics-display');
            existingMetrics.forEach(metric => metric.remove());
            
            if (metrics) {
                const formatted = formatMovementMetrics(metrics);
                
                // Final cleanup - ensure no metrics in stock name before adding to container
                titleElement.querySelectorAll('.movement-metrics-display').forEach(m => m.remove());
                if (stockNameDiv) {
                    stockNameDiv.querySelectorAll('.movement-metrics-display').forEach(m => m.remove());
                }
                
                // Append formatted HTML ONLY to the container (after price)
                metricsContainer.innerHTML = formatted;
                
                console.log('Movement metrics displayed after price for', ticker);
            } else {
                console.log('No movement metrics available for', ticker);
                metricsContainer.innerHTML = '';
            }
        } else {
            // Fallback: if container doesn't exist, create it and insert after price
            const metaDiv = summary?.querySelector('.meta > div:first-child');
            if (metaDiv && metrics) {
                const container = document.createElement('div');
                container.className = 'movement-metrics-container';
                const formatted = formatMovementMetrics(metrics);
                container.innerHTML = formatted;
                
                // Ensure we remove any metrics from stock name first
                const stockNameElement = metaDiv.querySelector('.stock-name strong');
                if (stockNameElement) {
                    const metricsInStockName = stockNameElement.querySelectorAll('.movement-metrics-display');
                    metricsInStockName.forEach(metric => metric.remove());
                }
                
                // Insert after price (total-sum-display) if it exists
                const priceDiv = metaDiv.querySelector('.total-sum-display');
                if (priceDiv) {
                    // Insert after price div (after the price, before anything else)
                    priceDiv.insertAdjacentElement('afterend', container);
                } else {
                    // If no price, append to end after stock-name (shouldn't happen normally)
                    const stockNameDiv = metaDiv.querySelector('.stock-name');
                    if (stockNameDiv) {
                        stockNameDiv.insertAdjacentElement('afterend', container);
                    } else {
                        metaDiv.appendChild(container);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error loading movement metrics for deal title:', err);
    } finally {
        // Remove from loading set after a short delay to allow rendering
        setTimeout(() => {
            movementMetricsLoading.delete(loadingKey);
        }, 100);
    }
}

async function loadAverageWeeklyVolume(ticker) {
    if (!ticker || !ticker.trim()) return null;

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker.trim().toUpperCase())}/average-volume`, {
            headers: authHeaders()
        });

        if (res.ok) {
            const data = await res.json();
            console.log(`Average weekly volume for ${ticker}: ${data.averageVolumeFormatted} (${data.averageVolumeInDollarsFormatted})`);
            return data;
        } else {
            console.warn('Failed to get average weekly volume', res.status);
        }
    } catch (err) {
        console.error('Error loading average weekly volume', err);
    }
    return null;
}

async function loadSupportResistance(ticker, form) {
    if (!ticker || !form) return;

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}/support-resistance`, {
            headers: { ...authHeaders() }
        });

        if (!res.ok) {
            console.warn('Failed to load support/resistance levels');
            return;
        }

        const data = await res.json();
        console.log('Support/resistance data received for', ticker, ':', data);
        
        // Set support_price to first two levels only
        const supportInput = form.querySelector('input[name="support_price"]');
        if (supportInput && data.firstTwo && data.firstTwo.length > 0) {
            // Use firstTwo - only the first two levels
            supportInput.value = data.firstTwo.map(l => parseFloat(l).toFixed(2)).join(', ');
            console.log(`First two support levels loaded for ${ticker}: ${supportInput.value}`);
        } else if (supportInput && data.supportPrice) {
            // Fallback to supportPrice if firstTwo is not available
            supportInput.value = data.supportPrice;
            console.log(`Support levels loaded for ${ticker}: ${data.supportPrice}`);
        } else if (supportInput && data.levels && data.levels.length >= 2) {
            // Fallback: use first two from levels array if firstTwo is not available
            const firstTwoLevels = data.levels.slice(0, 2);
            supportInput.value = firstTwoLevels.map(l => parseFloat(l).toFixed(2)).join(', ');
            console.log(`First two support levels loaded from levels array for ${ticker}: ${supportInput.value}`);
        } else if (supportInput && data.levels && data.levels.length > 0) {
            // If only one level available, use it
            supportInput.value = parseFloat(data.levels[0]).toFixed(2);
            console.log(`Single support level loaded for ${ticker}: ${supportInput.value}`);
        }
    } catch (err) {
        console.error('Error loading support/resistance levels', err);
    }
}

async function loadCurrentPrice(ticker, form) {
    if (!ticker || !form) {
        console.log('loadCurrentPrice: ticker or form is null', { ticker, form: !!form });
        return;
    }

    const formContainer = form.closest('.deal-form-container');
    setPriceError(formContainer, '');

    console.log('loadCurrentPrice: Starting to load price for ticker:', ticker);

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}/quote`, {
            headers: { ...authHeaders() }
        });

        console.log('loadCurrentPrice: API response status:', res.status);

        if (!res.ok) {
            const sharePriceInput = form.querySelector('input[name="share_price"]');
            if (sharePriceInput) sharePriceInput.value = '';
            setPriceError(formContainer, 'Current price is temporarily unavailable (API quota reached).');
            console.log('loadCurrentPrice: API request failed, clearing share price');
            return;
        }

        const data = await res.json();
        console.log('loadCurrentPrice: API response data:', data);
        
        if (data && data.price !== undefined && data.price !== null) {
            const quotePx = data.price.toString();
            form.dataset.lastQuotePrice = quotePx;

            const stopLossInput = form.querySelector('input[name="stop_loss"]');
            const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');

            // Share price is the CURRENT price (quote) unless user manually locked it.
            const sharePriceInput = form.querySelector('input[name="share_price"]');
            const sharePriceManualInput = form.querySelector('input[name="share_price_manual"]');
            const shareLocked = (sharePriceManualInput?.value === 'true') || (form.dataset.sharePriceManual === '1');
            if (sharePriceInput && !shareLocked) {
                const oldSp = sharePriceInput.value;
                sharePriceInput.value = quotePx;
                console.log('✓ Share price (current) set to:', quotePx, '(was:', oldSp, ')');
                sharePriceInput.dispatchEvent(new Event('input', { bubbles: true }));
                sharePriceInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // "Current price" is Buy price (stage 1). Auto-fill unless user manually edited it.
            const bp1 = form.querySelector('input[name="buy_price_stages[]"][data-stage-index="0"]')
                || form.querySelector('input[name="buy_price_stages[]"]');
            if (bp1) {
                const locked = form.dataset.buyPriceStage1Manual === '1';
                if (!locked && bp1.dataset.userSet !== '1') {
                    const old = bp1.value;
                    bp1.value = quotePx;
                    console.log('✓ Buy price (stage 1) set to:', quotePx, '(was:', old, ')');
                    bp1.dispatchEvent(new Event('input', { bubbles: true }));
                    bp1.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else {
                console.warn('loadCurrentPrice: buy_price_stages[0] input not found in form');
            }

            // Avg entry is computed and displayed separately (read-only).
            updateAvgEntryUI(form);

            // Reset stop loss fields so that calculateStopLoss can refill for this ticker
            if (stopLossInput) stopLossInput.value = '';
            if (stopLossPrcntInput) stopLossPrcntInput.value = '';

            // Calculate stop loss after prices are available (avg entry may have updated share_price)
            await calculateStopLoss(form);

            // Validate stop loss vs share price after autofill (highlight if planned)
            validateStopLossVsPrice(form, form?.dataset?.isPlannedDeal === '1');

            // Recalculate take profit percentage if take profit is already set
            // Use multiple delays to catch cases where take profit is entered after price loads
            console.log('loadCurrentPrice: Calling recalculateTakeProfitPercent after price load');
            recalculateTakeProfitPercent(form);

            setTimeout(() => recalculateTakeProfitPercent(form), 100);
            setTimeout(() => recalculateTakeProfitPercent(form), 500);
            setTimeout(() => recalculateTakeProfitPercent(form), 1000);

            setPriceError(formContainer, '');
        } else {
            console.warn('loadCurrentPrice: Invalid data received', data);
        }
    } catch (err) {
        console.error('Error loading current price', err);
        const formContainer = form.closest('.deal-form-container');
        setPriceError(formContainer, 'Current price is temporarily unavailable (API error).');
    }
}

async function calculateStopLoss(form) {
    const stopLossInput = form.querySelector('input[name="stop_loss"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    
    if (!stopLossInput || !stopLossPrcntInput) return;
    
    const basePrice = getStopLossBasePrice(form);
    if (!basePrice || isNaN(basePrice) || basePrice <= 0) {
        return; // Invalid share price
    }
    
    // Keep manual stop-loss: if user already set a value, do not overwrite
    if (stopLossInput.value && stopLossInput.value.trim() !== '') {
        return;
    }

    // Get the ticker to fetch previous week Low price
    const stockSelect = form.querySelector('select[name="stock"]');
    if (!stockSelect || !stockSelect.value) {
        return; // No stock selected
    }
    
    const ticker = stockSelect.value;
    
    try {
        // Fetch weekly prices to get previous week Low
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}`, {
            headers: { ...authHeaders() }
        });
        
        if (!res.ok) {
            console.warn('Failed to fetch weekly prices for stop loss calculation');
            return;
        }
        
        const data = await res.json();
        if (data && Array.isArray(data) && data.length >= 1) {
            // Get the latest completed week (last element, data sorted ascending)
            const latestWeek = data[data.length - 1];
            
            // Get Low price from latest week
            const lowPrice = latestWeek.Low !== undefined ? latestWeek.Low : 
                           (latestWeek.low !== undefined ? latestWeek.low : null);
            
            if (lowPrice !== null && lowPrice !== undefined && !isNaN(lowPrice)) {
                // Set stop loss price to latest week Low
                stopLossInput.value = lowPrice.toString();
                
                // Calculate percentage: ((avg_entry_or_share_price - stop_loss) / avg_entry_or_share_price) * 100
                const percentage = ((basePrice - lowPrice) / basePrice) * 100;
                stopLossPrcntInput.value = percentage.toFixed(2);
                
                // Check and apply error styling if needed
                updateStopLossErrorClass(stopLossPrcntInput, percentage);
                updateStopLossPercentBadge(form, percentage);
                
                console.log(`Stop loss calculated: Price=${lowPrice}, Percentage=${percentage.toFixed(2)}%`);
            }
        }
    } catch (err) {
        console.error('Error calculating stop loss:', err);
    }
}

// Calculate stop loss percentage from share price and stop loss value
function calculateStopLossPercentage(form) {
    console.log('[calculateStopLossPercentage] START');
    const stopLossInput = form.querySelector('input[name="stop_loss"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    
    console.log('[calculateStopLossPercentage] Inputs found:', {
        stopLossInput: !!stopLossInput,
        stopLossPrcntInput: !!stopLossPrcntInput,
        basePrice: getStopLossBasePrice(form),
        stopLossValue: stopLossInput?.value
    });
    
    if (!stopLossInput || !stopLossPrcntInput) {
        console.log('[calculateStopLossPercentage] EXIT: Missing inputs');
        return;
    }
    
    const sharePrice = getStopLossBasePrice(form);
    const stopLoss = parseFloat(String(stopLossInput.value || '').replace(',', '.'));
    
    console.log('[calculateStopLossPercentage] Parsed values:', {
        sharePrice,
        stopLoss,
        sharePriceValid: !isNaN(sharePrice) && sharePrice > 0,
        stopLossValid: !isNaN(stopLoss) && stopLoss > 0
    });
    
    // Both values must be valid numbers
    if (isNaN(sharePrice) || sharePrice <= 0 || isNaN(stopLoss) || stopLoss <= 0) {
        console.log('[calculateStopLossPercentage] EXIT: Invalid values');
        return; // Invalid values
    }
    
    // Calculate percentage: ((share_price - stop_loss) / share_price) * 100
    const percentage = ((sharePrice - stopLoss) / sharePrice) * 100;
    stopLossPrcntInput.value = percentage.toFixed(2);
    
    console.log('[calculateStopLossPercentage] Calculated:', {
        percentage: percentage.toFixed(2),
        sharePrice,
        stopLoss,
        resultValue: stopLossPrcntInput.value
    });
    
    // Check and apply error styling if needed
    updateStopLossErrorClass(stopLossPrcntInput, percentage);
    updateStopLossPercentBadge(form, percentage);

    // Notify listeners (e.g., risk calculator) that the value changed
    stopLossPrcntInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    console.log(`Stop loss percentage recalculated: ${percentage.toFixed(2)}% (Share: ${sharePrice}, Stop Loss: ${stopLoss})`);
}

function updateTrendSelectClass(select) {
    if (!select) return;
    select.classList.remove('has-down-selected', 'has-up-selected', 'has-flat-selected');
    if (select.value === 'Down') {
        select.classList.add('has-down-selected');
    } else if (select.value === 'Up') {
        select.classList.add('has-up-selected');
    } else if (select.value === 'Flat') {
        select.classList.add('has-flat-selected');
    }
}

// Auto-set current week candle color based on latest weekly candle (close vs open)
async function loadCandleColor(ticker, form) {
    if (!ticker || !form) return;
    const select = form.querySelector('select[name="buy_green_sell_red"]');
    if (!select) return;
    if (select.value) return; // do not override existing value
    if (isDirty(form, 'buy_green_sell_red')) return; // do not override manual edits

    try {
        const res = await apiFetch(`/api/prices/${encodeURIComponent(ticker)}`, {
            headers: { ...authHeaders() }
        });

        if (!res.ok) {
            console.warn('Failed to fetch weekly prices for candle color');
            return;
        }

        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return;

        const last = data[data.length - 1];
        const open = parseFloat(last.Open ?? last.open);
        const close = parseFloat(last.Close ?? last.close);

        if (isNaN(open) || isNaN(close)) return;

        const color = close < open ? 'Red' : 'Green';
        select.value = color;
        updateCandleColorClass(select, color);
    } catch (err) {
        console.error('Error auto-setting candle color:', err);
    }
}

function updateCandleColorClass(select, color) {
    if (!select) return;
    select.classList.remove('candle-red', 'candle-green');
    if (color === 'Red') select.classList.add('candle-red');
    if (color === 'Green') select.classList.add('candle-green');
}

// Auto-set S&P500 monthly trend (SPY) into sp500_up select if empty
async function loadSp500Trend(form) {
    if (!form) return;
    const select = form.querySelector('select[name="sp500_up"]');
    if (!select) return;
    if (isDirty(form, 'sp500_up')) {
        updateTrendSelectClass(select);
        return;
    }

    // Do not override if user/deal already has a value
    if (select.value) {
        updateTrendSelectClass(select);
        return;
    }

    try {
        const res = await apiFetch('/api/prices/SPY/trends', {
            headers: { ...authHeaders() }
        });

        if (!res.ok) {
            console.warn('Failed to load SP500 trend (SPY)');
            return;
        }

        const data = await res.json();
        const trend = data?.monthly;
        if (trend === 'Down' || trend === 'Up' || trend === 'Flat') {
            select.value = trend;
            updateTrendSelectClass(select);
            console.log('Set sp500_up to:', trend);
        }
    } catch (err) {
        console.error('Error auto-setting SP500 trend:', err);
    }
}

function setupTrendSelectListeners(form) {
    const monthlySelect = form.querySelector('select[name="monthly_dir"]');
    const weeklySelect = form.querySelector('select[name="weekly_dir"]');
    const sp500Select = form.querySelector('select[name="sp500_up"]');
    
    if (monthlySelect) {
        updateTrendSelectClass(monthlySelect);
        monthlySelect.addEventListener('change', (e) => {
            updateTrendSelectClass(monthlySelect);
            if (e?.isTrusted) markDirty(form, 'monthly_dir');
        });
    }
    
    if (weeklySelect) {
        updateTrendSelectClass(weeklySelect);
        weeklySelect.addEventListener('change', (e) => {
            updateTrendSelectClass(weeklySelect);
            if (e?.isTrusted) markDirty(form, 'weekly_dir');
        });
    }

    if (sp500Select) {
        updateTrendSelectClass(sp500Select);
        sp500Select.addEventListener('change', (e) => {
            updateTrendSelectClass(sp500Select);
            if (e?.isTrusted) markDirty(form, 'sp500_up');
        });
    }

    // Week candle color (buy_green_sell_red) manual selection colorization
    const candleSelect = form.querySelector('select[name="buy_green_sell_red"]');
    if (candleSelect) {
        const applyCandleClass = () => updateCandleColorClass(candleSelect, candleSelect.value);
        applyCandleClass(); // apply on init (existing value)
        candleSelect.addEventListener('change', (e) => {
            applyCandleClass();
            if (e?.isTrusted) markDirty(form, 'buy_green_sell_red');
        });
        candleSelect.addEventListener('input', (e) => {
            applyCandleClass();
            if (e?.isTrusted) markDirty(form, 'buy_green_sell_red');
        });
    }
}

function updateStopLossErrorClass(input, value) {
    if (!input) return;
    
    // Remove previous state classes
    input.classList.remove('has-stop-loss-error');
    input.classList.remove('has-stop-loss-good');
    
    if (value <= 0) {
        // Zero or negative stop loss % → good (green)
        input.classList.add('has-stop-loss-good');
    } else if (value > 10) {
        // Too high risk → error (red)
        input.classList.add('has-stop-loss-error');
    }
}

// Validate that stop loss is not greater than share price
function validateStopLossVsPrice(form, isPlanned) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stopLossInput   = form.querySelector('input[name="stop_loss"]');
    if (!sharePriceInput || !stopLossInput) return true;

    // Reset previous highlight
    stopLossInput.classList.remove('has-stop-loss-error');

    // Do not enforce for active deals (editing should be allowed)
    if (!isPlanned) return true;

    const share = getStopLossBasePrice(form);
    const sl    = parseNumber(stopLossInput.value);

    // If cannot parse numbers, do not block
    if (isNaN(share) || isNaN(sl)) return true;

    if (sl > share) {
        // For planned deals, highlight the field
        stopLossInput.classList.add('has-stop-loss-error');
        return false; // signal to block submission
    }

    return true;
}

function setupSharePriceListener(form, isPlannedDeal) {
    console.log('[setupSharePriceListener] START - Setting up share price listener', { form, formId: form?.id, formName: form?.name });
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    console.log('[setupSharePriceListener] sharePriceInput found:', sharePriceInput, 'value:', sharePriceInput?.value);
    
    if (!sharePriceInput) {
        console.log('[setupSharePriceListener] ERROR: sharePriceInput not found! Form:', form);
        return;
    }

    // Avoid duplicate listeners (setup is called on expand/collapse)
    if (form.dataset.sharePriceBound === '1') {
        return;
    }
    form.dataset.sharePriceBound = '1';
    
    // Store timeout ID on form to avoid conflicts
    if (!form._sharePriceTimeout) {
        form._sharePriceTimeout = null;
    }
    
    // Function to calculate percentages when share price changes
    const calculatePercentages = async () => {
        console.log('[calculatePercentages] START - Share price changed');
        // Get fresh references to inputs in case they were replaced
        const currentSharePriceInput = form.querySelector('input[name="share_price"]');
        const currentStopLossInput = form.querySelector('input[name="stop_loss"]');
        const currentTakeProfitInput = form.querySelector('input[name="take_profit"]');
        const currentTakeProfitPrcntInput = form.querySelector('input[name="take_profit_prcnt"]');
        
        if (!currentSharePriceInput) {
            console.log('[calculatePercentages] ERROR: sharePriceInput not found in form');
            return;
        }
        
        const sharePriceValue = currentSharePriceInput.value;
        const stopLossValue = currentStopLossInput?.value;
        console.log('[calculatePercentages] Before calculateStopLoss:', {
            sharePrice: sharePriceValue,
            stopLoss: stopLossValue
        });
        
        // First try to auto-fill stop loss (if user hasn't set it)
        await calculateStopLoss(form);
        
        // Get fresh reference again after calculateStopLoss
        const stopLossValueAfter = form.querySelector('input[name="stop_loss"]')?.value;
        console.log('[calculatePercentages] After calculateStopLoss:', {
            sharePrice: sharePriceValue,
            stopLoss: stopLossValueAfter,
            stopLossChanged: stopLossValue !== stopLossValueAfter
        });
        
        // Always recalc stop loss percentage when share price changes
        console.log('[calculatePercentages] Calling calculateStopLossPercentage...');
        calculateStopLossPercentage(form);
        console.log('[calculatePercentages] After calculateStopLossPercentage');
        
        // Calculate take profit percentage if take profit is set
        const freshTakeProfitInput = form.querySelector('input[name="take_profit"]');
        const freshTakeProfitPrcntInput = form.querySelector('input[name="take_profit_prcnt"]');
        if (freshTakeProfitInput && freshTakeProfitInput.value && freshTakeProfitPrcntInput) {
            recalculateTakeProfitPercent(form);
        }
    };
    
    // Add listeners for both 'input' (real-time) and 'change' (on blur)
    sharePriceInput.addEventListener('input', (e) => {
        console.log('[setupSharePriceListener] input event fired, value:', e.target.value, 'target:', e.target);
        // Debounce to avoid too many calculations while typing
        if (form._sharePriceTimeout) {
            clearTimeout(form._sharePriceTimeout);
        }
        form._sharePriceTimeout = setTimeout(() => {
            calculatePercentages();
        }, 500); // Wait 500ms after user stops typing
    });
    
    sharePriceInput.addEventListener('change', (e) => {
        console.log('[setupSharePriceListener] change event fired, value:', e.target.value, 'target:', e.target);
        if (form._sharePriceTimeout) {
            clearTimeout(form._sharePriceTimeout);
        }
        calculatePercentages();
    });
    
    // Recalculate on blur (immediate, no debounce)
    sharePriceInput.addEventListener('blur', (e) => {
        console.log('[setupSharePriceListener] blur event fired, value:', e.target.value, 'target:', e.target);
        if (form._sharePriceTimeout) {
            clearTimeout(form._sharePriceTimeout);
        }
        calculatePercentages();
    });
    
    console.log('[setupSharePriceListener] Event listeners added to sharePriceInput. Element:', sharePriceInput, 'has input listener:', true, 'has change listener:', true, 'has blur listener:', true);

    // Also validate stop loss vs share price (highlight and later block on submit)
    const applyStopLossCheck = () => validateStopLossVsPrice(form, !!isPlannedDeal);
    sharePriceInput.addEventListener('input', applyStopLossCheck);
    sharePriceInput.addEventListener('change', applyStopLossCheck);
    const currentStopLossInput = form.querySelector('input[name="stop_loss"]');
    if (currentStopLossInput) {
        currentStopLossInput.addEventListener('input', applyStopLossCheck);
        currentStopLossInput.addEventListener('change', applyStopLossCheck);
    }
    
    // Also trigger calculation if share price is already set and take profit is also set
    const currentTakeProfitInput = form.querySelector('input[name="take_profit"]');
    if (sharePriceInput.value && currentTakeProfitInput && currentTakeProfitInput.value) {
        setTimeout(() => {
            calculatePercentages();
        }, 100);
    }
    
    // Also trigger calculation after a delay to catch cases where share price is loaded via API
    // This ensures that if share price is set programmatically, the calculation still happens
    setTimeout(() => {
        const freshSharePriceInput = form.querySelector('input[name="share_price"]');
        const freshTakeProfitInput = form.querySelector('input[name="take_profit"]');
        if (freshSharePriceInput && freshSharePriceInput.value && freshTakeProfitInput && freshTakeProfitInput.value) {
            calculatePercentages();
        }
    }, 500);
    
    // Also check stop loss % field when user manually changes it
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
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
                updateStopLossPercentBadge(form, value);
            } else {
                newStopLossPrcnt.classList.remove('has-stop-loss-error');
            }
        });
        
        newStopLossPrcnt.addEventListener('change', () => {
            const value = parseFloat(newStopLossPrcnt.value);
            if (!isNaN(value)) {
                updateStopLossErrorClass(newStopLossPrcnt, value);
                updateStopLossPercentBadge(form, value);
            } else {
                newStopLossPrcnt.classList.remove('has-stop-loss-error');
            }
        });
    }
}

function setupStopLossListener(form) {
    const stopLossInput = form.querySelector('input[name="stop_loss"]');
    
    if (!stopLossInput) return;

    // Avoid duplicate listeners (setup is called on expand/collapse)
    if (form.dataset.stopLossBound === '1') {
        return;
    }
    form.dataset.stopLossBound = '1';
    
    // Remove existing listeners by cloning
    const newInput = stopLossInput.cloneNode(true);
    stopLossInput.parentNode.replaceChild(newInput, stopLossInput);
    
    // Add listeners for both 'input' (real-time) and 'change' (on blur)
    newInput.addEventListener('input', () => {
        // Debounce to avoid too many calculations while typing
        clearTimeout(newInput._stopLossTimeout);
        newInput._stopLossTimeout = setTimeout(() => {
            calculateStopLossPercentage(form);
        }, 500); // Wait 500ms after user stops typing
    });
    
    newInput.addEventListener('change', () => {
        calculateStopLossPercentage(form);
    });
    
    // Recalculate on blur (immediate, no debounce)
    newInput.addEventListener('blur', () => {
        calculateStopLossPercentage(form);
    });

    // Also recalc stop loss % when share price changes
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    if (sharePriceInput) {
        const handleSharePriceChange = () => calculateStopLossPercentage(form);
        sharePriceInput.addEventListener('input', handleSharePriceChange);
        sharePriceInput.addEventListener('change', handleSharePriceChange);
    }
}

// Setup total sum calculation and update row title
function setupTotalSumCalculator(row, form, deal) {
    const sharePriceInput = form.querySelector('input[name="share_price"]');
    const stockSelect = form.querySelector('.deal-stock-select');
    const summary = row.querySelector('.deal-summary');
    
    if (!sharePriceInput || !summary) return;

    // Avoid duplicate listeners (setup can be called more than once)
    if (form.dataset.totalSumBound === '1') {
        return;
    }
    form.dataset.totalSumBound = '1';
    
    // Function to update the row title (deal-summary) with total sum
    const updateRowTitle = () => {
        const sharePrice = sharePriceInput.value || '';
        let stages = getStagesFromForm(form);
        if (!stages.length && deal) stages = getStagesFromDeal(deal);
        const totalSum = calculateTotalSumFromStages(sharePrice, stages);
        const totalSumFormatted = formatTotalSum(totalSum);
        const totalSumDisplay = totalSumFormatted ? totalSumFormatted : '';
        
        // Get current stock name from select or from deal
        let currentStock = 'New Deal';
        if (stockSelect && stockSelect.value) {
            currentStock = stockSelect.value;
        } else if (deal?.stock) {
            currentStock = deal.stock;
        }
        
        // Find the stock name element (strong tag inside div)
        const stockNameDiv = summary.querySelector('.stock-name');
        const stockElement = stockNameDiv?.querySelector('strong');
        if (stockElement) {
            // Get warning icons from current DOM (movement metrics are now after price, not here)
            const warningIcons = Array.from(stockElement.querySelectorAll('.volume-warning-icon'));
            
            // Remove any movement metrics that might still be in stock name (cleanup)
            const movementMetricsInStockName = stockElement.querySelectorAll('.movement-metrics-display');
            movementMetricsInStockName.forEach(metric => metric.remove());
            
            // Build new HTML with only ticker and warning icons (NO movement metrics, NO total sum)
            let newHTML = escapeHtml(currentStock);
            
            // Add warning icons
            warningIcons.forEach(icon => {
                newHTML += icon.outerHTML;
            });
            
            // Update titleElement (without total sum, without movement metrics)
            if (stockElement.innerHTML !== newHTML) {
                stockElement.innerHTML = newHTML;
            }
        } else if (stockNameDiv) {
            // If stockNameDiv exists but strong doesn't, create it
            const strongEl = document.createElement('strong');
            strongEl.textContent = currentStock;
            stockNameDiv.innerHTML = '';
            stockNameDiv.appendChild(strongEl);
        }
        
        // Update total sum in separate div
        const metaDiv = summary.querySelector('.meta > div:first-child');
        if (metaDiv) {
            let totalSumDiv = metaDiv.querySelector('.total-sum-display');
            if (totalSumDisplay) {
                if (!totalSumDiv) {
                    totalSumDiv = document.createElement('div');
                    totalSumDiv.className = 'total-sum-display';
                    metaDiv.appendChild(totalSumDiv);
                }
                totalSumDiv.textContent = totalSumDisplay;
                totalSumDiv.style.display = '';
            } else if (totalSumDiv) {
                totalSumDiv.style.display = 'none';
            }
        }
        
        // Store totalSum in a data attribute for later use
        row.dataset.totalSum = totalSum || '';
    };
    
    // Function to calculate and display total sum in the row title (deal-summary)
    const calculateAndDisplayTotalSum = () => {
        // Update row title which shows the total sum in the deal-summary element
        updateRowTitle();
    };
    
    // Add event listeners for share_price
    sharePriceInput.addEventListener('input', () => {
        clearTimeout(sharePriceInput._totalSumTimeout);
        sharePriceInput._totalSumTimeout = setTimeout(() => {
            updateRowTitle();
        }, 300);
    });
    
    // Calculate and display total sum when share_price loses focus (blur)
    sharePriceInput.addEventListener('blur', () => {
        calculateAndDisplayTotalSum();
    });
    
    sharePriceInput.addEventListener('change', () => {
        updateRowTitle();
    });
    
    // Listen to stage inputs (delegated, supports dynamic stages)
    if (!form.dataset.stagesTotalBound) {
        form.dataset.stagesTotalBound = '1';
        let stagesTimeout = null;
        form.addEventListener('input', (e) => {
            const t = e.target;
            if (t && t.matches && t.matches('input[name="amount_tobuy_stages[]"]')) {
                clearTimeout(stagesTimeout);
                stagesTimeout = setTimeout(() => updateRowTitle(), 300);
            }
        });
        form.addEventListener('change', (e) => {
            const t = e.target;
            if (t && t.matches && t.matches('input[name="amount_tobuy_stages[]"]')) {
                updateRowTitle();
            }
        });
    }
    
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
    
    // Setup risk calculation when total_sum or stop_loss_prcnt changes
    setupRiskCalculator(form);
}

// Calculate portfolio risk on client side (for new deals that aren't saved yet)
async function calculatePortfolioRiskClientSide(form) {
    try {
        // Get current Total Sum value (Cash + In Shares)
        const totalSumSpan = document.getElementById('totalSumValue');
        if (!totalSumSpan) return 0;
        
        const totalSumStr = totalSumSpan.textContent.trim().replace(',', '.');
        const totalSum = parseFloat(totalSumStr) || 0;
        
        if (totalSum <= 0) return 0;
        
        // Calculate total risk from all existing open deals
        let totalRisk = 0;
        
        // Get all open deals (excluding closed ones)
        const openDeals = deals.filter(d => !d.closed);
        
        for (const deal of openDeals) {
            // Parse total_sum
            let totalSum = 0;
            if (deal.total_sum) {
                totalSum = parseFloat(String(deal.total_sum).replace(',', '.')) || 0;
            } else if (deal.share_price) {
                // Calculate from share_price * sum(amount_tobuy_stages)
                const sharePrice = parseNumber(deal.share_price);
                const stages = getStagesFromDeal(deal);
                totalSum = sharePrice * sumStages(stages);
            }
            
            // Parse stop_loss_prcnt
            let stopLossPercent = 0;
            if (deal.stop_loss_prcnt) {
                stopLossPercent = parseFloat(String(deal.stop_loss_prcnt).replace(',', '.')) || 0;
            }
            
            // Calculate risk for this deal: total_sum * (stop_loss_percent / 100)
            if (stopLossPercent > 0 && totalSum > 0) {
                const dealRisk = totalSum * (stopLossPercent / 100);
                totalRisk += dealRisk;
            }
        }
        
        // Add risk from the current form (new deal being created)
        if (form) {
            const totalSumInput = form.querySelector('input[name="total_sum"]');
            const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
            const sharePriceInput = form.querySelector('input[name="share_price"]');
            
            let formTotalSum = 0;
            let formStopLossPercent = 0;
            
            // Get total_sum from form
            if (totalSumInput && totalSumInput.value) {
                formTotalSum = parseFloat(String(totalSumInput.value).replace(',', '.')) || 0;
            } else if (sharePriceInput && sharePriceInput.value) {
                // Calculate from share_price * sum(amount_tobuy_stages)
                const sharePrice = parseNumber(sharePriceInput.value);
                const stages = getStagesFromForm(form);
                formTotalSum = sharePrice * sumStages(stages);
            }
            
            // Get stop_loss_prcnt from form
            if (stopLossPrcntInput && stopLossPrcntInput.value) {
                formStopLossPercent = parseFloat(String(stopLossPrcntInput.value).replace(',', '.')) || 0;
            }
            
            // Add risk from current form deal
            if (formStopLossPercent > 0 && formTotalSum > 0) {
                const formDealRisk = formTotalSum * (formStopLossPercent / 100);
                totalRisk += formDealRisk;
            }
        }
        
        // Calculate percentage: (total_risk / totalSum) * 100
        const riskPercent = (totalRisk / totalSum) * 100;
        return Math.round(riskPercent * 100) / 100; // Round to 2 decimal places
    } catch (e) {
        console.error('Error calculating portfolio risk client side', e);
        return 0;
    }
}

// Setup risk calculator for real-time updates when editing deal data
function setupRiskCalculator(form) {
    const dealId = form?.dataset?.dealId;
    const isNewDeal = dealId === 'new';
    
    const totalSumInput = form.querySelector('input[name="total_sum"]');
    const stopLossPrcntInput = form.querySelector('input[name="stop_loss_prcnt"]');
    const sharePriceInput = form.querySelector('input[name="share_price"]');

    // Deal risk amount UI ("Risk: $X") for the current form:
    // riskAmount = positionSize * (stop_loss_prcnt / 100)
    // positionSize = share_price * sum(amount_tobuy_stages[])
    const updateDealRiskAmountUI = () => {
        try {
            const riskEl = form.querySelector('[data-role="deal-risk-amount"]');
            if (!riskEl) return;

            // Always query fresh inputs because some listeners clone/replace inputs.
            const slPctInput = form.querySelector('input[name="stop_loss_prcnt"]');
            const spInput = form.querySelector('input[name="share_price"]');

            const slPct = parseNumber(slPctInput?.value || '');
            const sharePrice = parseNumber(spInput?.value || '');
            const stages = getStagesFromForm(form);
            const shares = sumStages(stages);

            if (!Number.isFinite(slPct) || slPct <= 0 || !Number.isFinite(sharePrice) || sharePrice <= 0 || !shares || shares <= 0) {
                riskEl.textContent = 'Risk: -';
                return;
            }

            const positionSize = sharePrice * shares;
            const riskAmount = positionSize * (slPct / 100);
            riskEl.textContent = `Risk: ${formatTotalSum(riskAmount) || '-'}`;
        } catch (e) {
            // Never break the form if formatting fails
            console.warn('updateDealRiskAmountUI failed', e);
        }
    };
    
    // Function to calculate and display risk
    const calculateAndDisplayRisk = async () => {
        // Update per-deal risk amount immediately (fast UI feedback)
        updateDealRiskAmountUI();

        if (isNewDeal) {
            // For new deals, calculate on client side
            const riskPercent = await calculatePortfolioRiskClientSide(form);
            const riskSpan = document.getElementById('portfolioRiskValue');
            if (riskSpan) {
                const riskValue = Number(riskPercent) || 0;
                riskSpan.textContent = riskValue.toFixed(2) + '%';
                
                // Apply color classes based on risk level
                riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
                if (riskValue > 10) {
                    riskSpan.classList.add('risk-high'); // Red color for high risk
                } else if (riskValue > 5) {
                    riskSpan.classList.add('risk-medium'); // Yellow/Orange color for medium risk
                } else {
                    riskSpan.classList.add('risk-low'); // Green color for low risk
                }
            }
        } else {
            // For existing deals, use server-side calculation
            await calculateAndDisplayPortfolioRisk();
            await calculateAndDisplayInSharesRisk();
        }
    };
    
    // Debounce function for risk calculation
    let riskCalculationTimeout = null;
    const calculateRisk = () => {
        // Update deal risk amount without waiting for the 1s debounce
        updateDealRiskAmountUI();
        clearTimeout(riskCalculationTimeout);
        riskCalculationTimeout = setTimeout(async () => {
            await calculateAndDisplayRisk();
        }, 1000); // Wait 1 second after user stops typing
    };
    
    // Add listeners to total_sum if it exists (calculated field)
    if (totalSumInput) {
        totalSumInput.addEventListener('input', calculateRisk);
        totalSumInput.addEventListener('change', calculateAndDisplayRisk);
    }
    
    // Add listeners to stop_loss_prcnt
    if (stopLossPrcntInput) {
        stopLossPrcntInput.addEventListener('input', calculateRisk);
        stopLossPrcntInput.addEventListener('change', calculateAndDisplayRisk);
    }
    
    // Also listen to share_price and amount_tobuy_stage_1 since they affect total_sum
    if (sharePriceInput) {
        sharePriceInput.addEventListener('change', async () => {
            // Wait a bit for total_sum to be recalculated
            setTimeout(async () => {
                await calculateAndDisplayRisk();
            }, 500);
        });
    }

    // Listen to stages (delegated, supports dynamic inputs)
    if (!form.dataset.stagesRiskBound) {
        form.dataset.stagesRiskBound = '1';
        form.addEventListener('change', async (e) => {
            const t = e.target;
            if (t && t.matches && t.matches('input[name="amount_tobuy_stages[]"]')) {
                setTimeout(async () => {
                    await calculateAndDisplayRisk();
                }, 500);
            }
        });
    }

    // Bind delegated listeners for deal risk amount UI (survives input cloning/replacement)
    if (!form.dataset.dealRiskAmountBound) {
        form.dataset.dealRiskAmountBound = '1';
        let uiTimeout = null;
        const scheduleUI = () => {
            clearTimeout(uiTimeout);
            uiTimeout = setTimeout(updateDealRiskAmountUI, 150);
        };
        form.addEventListener('input', (e) => {
            const t = e.target;
            if (!t || !t.name) return;
            if (t.name === 'share_price' || t.name === 'stop_loss_prcnt' || t.name === 'amount_tobuy_stages[]') {
                scheduleUI();
            }
        });
        form.addEventListener('change', (e) => {
            const t = e.target;
            if (!t || !t.name) return;
            if (t.name === 'share_price' || t.name === 'stop_loss_prcnt' || t.name === 'amount_tobuy_stages[]') {
                updateDealRiskAmountUI();
            }
        });
    }
    
    // Initial risk calculation if form already has values (for new deals)
    if (isNewDeal) {
        // Check if form has values that would affect risk calculation
        const hasValues = (stopLossPrcntInput && stopLossPrcntInput.value) ||
                          (totalSumInput && totalSumInput.value) ||
                          (sharePriceInput && sharePriceInput.value && form.querySelector('input[name="amount_tobuy_stages[]"]') && getStagesFromForm(form).length > 0);
        
        if (hasValues) {
            // Wait a bit for form to be fully initialized
            setTimeout(async () => {
                await calculateAndDisplayRisk();
            }, 300);
        }
    }

    // Initial UI update for deal risk amount
    updateDealRiskAmountUI();
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

// Listen for stocks updated event to reload cache
window.addEventListener('stocksUpdated', async () => {
    await loadStocksForDeals();
    await loadWarnings(); // Also reload warnings
    renderAll(); // Re-render deals to show updated indicators
});

// Calculate and display portfolio risk percentage
async function calculateAndDisplayPortfolioRisk() {
    try {
        const res = await apiFetch('/api/deals/risk-percent', {
            headers: authHeaders()
        });
        
        if (res.ok) {
            const riskPercent = await res.json();
            const riskSpan = document.getElementById('portfolioRiskValue');
            if (riskSpan) {
                const riskValue = Number(riskPercent) || 0;
                riskSpan.textContent = riskValue.toFixed(2) + '%';
                
                // Apply color classes based on risk level
                riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
                if (riskValue > 10) {
                    riskSpan.classList.add('risk-high'); // Red color for high risk
                } else if (riskValue > 5) {
                    riskSpan.classList.add('risk-medium'); // Yellow/Orange color for medium risk
                } else {
                    riskSpan.classList.add('risk-low'); // Green color for low risk
                }
            }

            // Keep last known value for fast UI re-renders and update all title badges.
            latestPortfolioRiskPercent = Number(riskPercent) || 0;
            updatePlannedRiskBadges();
        } else {
            console.error('Failed to load portfolio risk', res.status);
            const riskSpan = document.getElementById('portfolioRiskValue');
            if (riskSpan) {
                riskSpan.textContent = '0.00%';
                // Reset classes on error
                riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
                riskSpan.classList.add('risk-low');
            }

            latestPortfolioRiskPercent = 0;
            updatePlannedRiskBadges();
        }
    } catch (e) {
        console.error('Error loading portfolio risk', e);
        const riskSpan = document.getElementById('portfolioRiskValue');
        if (riskSpan) {
            riskSpan.textContent = '0.00%';
            // Reset classes on error
            riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
            riskSpan.classList.add('risk-low');
        }

        latestPortfolioRiskPercent = 0;
        updatePlannedRiskBadges();
    }
}

// Calculate and display risk percentage relative to In Shares
async function calculateAndDisplayInSharesRisk() {
    try {
        // First check if In Shares value is available
        const inSharesSpan = document.getElementById('inSharesValue');
        const inSharesValue = inSharesSpan ? parseFloat(inSharesSpan.textContent.replace(/,/g, '')) || 0 : 0;
        
        console.log('calculateAndDisplayInSharesRisk - In Shares value from DOM:', inSharesValue);
        
        const res = await apiFetch('/api/deals/risk-percent-inshares', {
            headers: authHeaders()
        });
        
        if (res.ok) {
            const riskPercent = await res.json();
            console.log('In Shares Risk API response:', riskPercent, 'In Shares:', inSharesValue);
            const riskSpan = document.getElementById('inSharesRiskValue');
            if (riskSpan) {
                const riskValue = Number(riskPercent) || 0;
                console.log('In Shares Risk calculated value:', riskValue);

                // Calculate money at risk based on In Shares value
                let moneyAtRiskText = '';
                if (inSharesValue > 0 && riskValue !== 0) {
                    const moneyAtRisk = inSharesValue * (riskValue / 100);
                    moneyAtRiskText = ` [${moneyAtRisk.toFixed(2)}]`;
                }

                // Show: "8.64% [10000.00]"
                riskSpan.textContent = `${riskValue.toFixed(2)}%${moneyAtRiskText}`;
                
                // Apply color classes based on risk level
                riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
                if (riskValue > 10) {
                    riskSpan.classList.add('risk-high'); // Red color for high risk
                } else if (riskValue > 5) {
                    riskSpan.classList.add('risk-medium'); // Yellow/Orange color for medium risk
                } else {
                    riskSpan.classList.add('risk-low'); // Green color for low risk
                }
            } else {
                console.warn('inSharesRiskValue element not found in DOM');
            }
        } else {
            const errorText = await res.text().catch(() => '');
            console.error('Failed to load in shares risk', res.status, errorText);
            const riskSpan = document.getElementById('inSharesRiskValue');
            if (riskSpan) {
                riskSpan.textContent = '0.00%';
                // Reset classes on error
                riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
                riskSpan.classList.add('risk-low');
            }
        }
    } catch (e) {
        console.error('Error loading in shares risk', e);
        const riskSpan = document.getElementById('inSharesRiskValue');
        if (riskSpan) {
            riskSpan.textContent = '0.00%';
            // Reset classes on error
            riskSpan.classList.remove('risk-low', 'risk-medium', 'risk-high');
            riskSpan.classList.add('risk-low');
        }
    }
}

// ========== PINNED STOCKS (TOOLS PANEL) ==========

let pinnedStocks = [];
let draggedPinnedId = null;

async function loadPinnedStocks() {
    const container = document.getElementById('pinnedStocksContainer');
    if (!container) return;

    try {
        const res = await apiFetch('/api/pinnedstocks', {
            headers: authHeaders()
        });
        if (!res.ok) {
            console.warn('Failed to load pinned stocks', res.status);
            container.innerHTML = '';
            return;
        }

        pinnedStocks = await res.json(); // [{ id, ticker, order }]
        renderPinnedStocks();
    } catch (e) {
        console.error('Error loading pinned stocks', e);
    }
}

function renderPinnedStocks() {
    const container = document.getElementById('pinnedStocksContainer');
    if (!container) return;

    container.innerHTML = '';

    if (!pinnedStocks || pinnedStocks.length === 0) {
        return;
    }

    pinnedStocks.forEach(item => {
        const chip = document.createElement('div');
        chip.className = 'pinned-stock-chip';
        chip.dataset.pinnedId = item.id;
        chip.draggable = true;

        const label = document.createElement('strong');
        label.textContent = (item.ticker || '').toUpperCase();
        chip.appendChild(label);

        const metricsDiv = document.createElement('div');
        metricsDiv.className = 'movement-metrics-container';
        metricsDiv.style.marginLeft = '6px';
        chip.appendChild(metricsDiv);

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.className = 'secondary';
        removeBtn.style.padding = '0 4px';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deletePinnedStock(item.id);
        });
        chip.appendChild(removeBtn);

        setupPinnedDragHandlers(chip, item.id);

        container.appendChild(chip);

        attachPinnedMetrics(metricsDiv, item.ticker);
    });
}

async function attachPinnedMetrics(containerEl, ticker) {
    if (!containerEl || !ticker) return;

    if (typeof loadMovementMetrics !== 'function' || typeof formatMovementMetrics !== 'function') {
        console.warn('Movement metrics helpers are not available for pinned stocks');
        containerEl.textContent = '';
        return;
    }

    const raw = (ticker || '').trim().toUpperCase();

    try {
        let metrics = null;

        // If ticker contains '+', treat it as a composite index
        if (raw.includes('+') && typeof loadCompositeMovementMetrics === 'function') {
            const parts = raw
                .split('+')
                .map(t => t.trim())
                .filter(Boolean);

            metrics = await loadCompositeMovementMetrics(parts);
        } else {
            // Regular single ticker
            metrics = await loadMovementMetrics(raw);
        }

        if (!metrics) {
            containerEl.textContent = '';
            return;
        }

        const html = formatMovementMetrics(metrics);
        containerEl.innerHTML = html;
    } catch (e) {
        console.error('Error loading movement metrics for pinned item', ticker, e);
        containerEl.textContent = '';
    }
}

function setupPinnedDragHandlers(chip, pinnedId) {
    chip.addEventListener('dragstart', (e) => {
        draggedPinnedId = pinnedId;
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    chip.addEventListener('dragend', () => {
        draggedPinnedId = null;
        chip.classList.remove('dragging');
    });

    chip.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedPinnedId || draggedPinnedId === pinnedId) return;

        const container = document.getElementById('pinnedStocksContainer');
        if (!container) return;

        const chips = Array.from(container.querySelectorAll('.pinned-stock-chip'));
        const draggedEl = chips.find(c => c.dataset.pinnedId === draggedPinnedId);
        if (!draggedEl) return;

        const target = e.currentTarget;
        const rect = target.getBoundingClientRect();
        const before = (e.clientX - rect.left) < rect.width / 2;

        if (before) {
            container.insertBefore(draggedEl, target);
        } else {
            container.insertBefore(draggedEl, target.nextSibling);
        }
    });

    chip.addEventListener('drop', async (e) => {
        e.preventDefault();
        await savePinnedOrderToServer();
    });
}

async function savePinnedOrderToServer() {
    const container = document.getElementById('pinnedStocksContainer');
    if (!container) return;

    const orderedIds = Array.from(container.querySelectorAll('.pinned-stock-chip'))
        .map(el => el.dataset.pinnedId)
        .filter(Boolean);

    if (!orderedIds.length) return;

    try {
        const res = await apiFetch('/api/pinnedstocks/reorder', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders()
            },
            body: JSON.stringify({ orderedIds })
        });

        if (!res.ok) {
            console.error('Failed to save pinned stocks order', res.status);
            return;
        }

        // Обновим локальный порядок
        pinnedStocks.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
    } catch (e) {
        console.error('Error saving pinned stocks order', e);
    }
}

async function addPinnedStock(ticker) {
    const t = (ticker || '').trim().toUpperCase();
    if (!t) return;

    try {
        const res = await apiFetch('/api/pinnedstocks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders()
            },
            body: JSON.stringify({ ticker: t })
        });

        if (!res.ok) {
            console.error('Failed to add pinned stock', res.status);
            return;
        }

        await loadPinnedStocks();
    } catch (e) {
        console.error('Error adding pinned stock', e);
    }
}

async function deletePinnedStock(id) {
    if (!id) return;
    try {
        const res = await apiFetch(`/api/pinnedstocks/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (!res.ok) {
            console.error('Failed to delete pinned stock', res.status);
            return;
        }
        await loadPinnedStocks();
    } catch (e) {
        console.error('Error deleting pinned stock', e);
    }
}

function setupPinnedStocksUI() {
    const input = document.getElementById('pinnedTickerInput');
    const openBtn = document.getElementById('openPinnedModalBtn');
    const confirmBtn = document.getElementById('confirmPinnedAddBtn');
    const closeBtn = document.getElementById('closePinnedModalBtn');
    const modal = document.getElementById('pinnedModal');

    if (!input || !openBtn || !confirmBtn || !closeBtn || !modal) return;

    const openModal = () => {
        modal.style.display = 'flex';
        input.value = '';
        setTimeout(() => input.focus(), 0);
    };

    const closeModal = () => {
        modal.style.display = 'none';
        input.value = '';
    };

    openBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
    });

    closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal();
    });

    // Force uppercase input by default for pinned tickers (including composite like AAPL+TSLA)
    input.addEventListener('input', () => {
        if (!input.value) return;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.toUpperCase();
        // Try to preserve caret position
        if (start != null && end != null) {
            input.setSelectionRange(start, end);
        }
    });

    const submit = () => {
        addPinnedStock(input.value);
        closeModal();
    };

    confirmBtn.addEventListener('click', (e) => {
        e.preventDefault();
        submit();
    });

    const form = document.getElementById('pinnedForm');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            submit();
        });
    }

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    });
}

function setupSettingsUI() {
    const btn = document.getElementById('settingsBtn');
    const modal = document.getElementById('settingsModal');
    const closeBtn = document.getElementById('closeSettingsModalBtn');
    const form = document.getElementById('settingsForm');
    const tfSelect = document.getElementById('movementTimeframeSelect');
    const lbSelect = document.getElementById('movementLookbackSelect');

    if (!btn || !modal || !closeBtn || !form || !tfSelect || !lbSelect) return;

    const openModal = () => {
        const s = window.movementSettings || defaultMovementSettings;
        tfSelect.value = s.timeframe || 'Weekly';
        lbSelect.value = String(s.lookback || 52);
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
    };

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
    });

    closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal();
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const settings = {
            timeframe: tfSelect.value || 'Weekly',
            lookback: parseInt(lbSelect.value || '52', 10)
        };
        window.movementSettings = settings;
        saveMovementSettings(settings);
        closeModal();
    });
}

// ======== СТАРТ =========
(async function init() {
    setupPinnedStocksUI();
    setupSettingsUI();
    await loadDeals();
    // Calculate and display portfolio risk on page load
    await calculateAndDisplayPortfolioRisk();
    await calculateAndDisplayInSharesRisk();
    await loadPinnedStocks();
})();

document.addEventListener('keydown', e => {
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        elements.newDealBtn.click();
    }
});

