/* ── State ─────────────────────────────────────────────────────── */
const state = {
    periode: { van: null, tot: null },
    currentPage: 'overzicht',
    productieData: [],
    overzichtData: null,
    normen: [],
    instellingen: [],
    planplaatsen: [],
    sortCol: null,
    sortDir: 'asc',
    charts: {},  // Track active Chart.js instances for cleanup
    previousPage: null,  // For back navigation from machine detail
    machineCode: null,   // Currently viewed machine
    machineVestigingFilter: 'beide',  // Filter for next/prev navigation
    beheerUnlocked: false,  // Beheer password protection
};

/* ── Init ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    const tot = new Date();
    const van = new Date();
    van.setDate(van.getDate() - 7);
    document.getElementById('datum-van').value = formatDate(van);
    document.getElementById('datum-tot').value = formatDate(tot);
    state.periode.van = formatDate(van);
    state.periode.tot = formatDate(tot);

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.page));
    });
    document.getElementById('btn-refresh').addEventListener('click', loadCurrentPage);
    document.getElementById('datum-van').addEventListener('change', e => { state.periode.van = e.target.value; loadCurrentPage(); });
    document.getElementById('datum-tot').addEventListener('change', e => { state.periode.tot = e.target.value; loadCurrentPage(); });

    document.querySelectorAll('.subtab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.subtab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    navigateTo('overzicht');
    loadPlanplaatsen();
});

/* ── Chart cleanup helper ─────────────────────────────────────── */
function destroyChart(id) {
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
}

function createChart(id, config) {
    destroyChart(id);
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    const chart = new Chart(ctx.getContext('2d'), config);
    state.charts[id] = chart;
    return chart;
}

/* ── Toggle detail panel ──────────────────────────────────────── */
function toggleDetail(id) {
    const panel = document.getElementById(id);
    const icon = document.getElementById(id + '-icon');
    if (!panel) return;
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    if (icon) icon.style.transform = visible ? '' : 'rotate(90deg)';
}

/* ── Navigation ───────────────────────────────────────────────── */
function navigateTo(page) {
    if (page !== 'machine') state.previousPage = state.currentPage;
    state.currentPage = page;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
    loadCurrentPage();
}

function navigateBack() {
    navigateTo(state.previousPage || 'overzicht');
}

function loadCurrentPage() {
    switch (state.currentPage) {
        case 'overzicht': loadOverzicht(); break;
        case 'productie': loadProductie(); break;
        case 'drukkerij': loadDrukkerij(); break;
        case 'vouwerij': loadVouwerij(); break;
        case 'beheer': loadBeheer(); break;
        case 'machine': renderMachineDetail(); break;
    }
}

/* ── API helpers ──────────────────────────────────────────────── */
async function api(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
}
async function apiPost(url, data) { return (await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) })).json(); }
async function apiPut(url, data) { return (await fetch(url, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) })).json(); }
async function apiDelete(url) { return (await fetch(url, { method: 'DELETE' })).json(); }

function formatDate(d) { return d.toISOString().split('T')[0]; }
function getAllDaysInPeriod(van, tot) {
    const days = [];
    const d = new Date(van + 'T00:00:00');
    const end = new Date(tot + 'T00:00:00');
    while (d <= end) {
        days.push(d.toISOString().split('T')[0]);
        d.setDate(d.getDate() + 1);
    }
    return days;
}
function formatNumber(n, decimals = 0) {
    if (n === null || n === undefined) return '-';
    return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}
function formatCurrency(n) { return n == null ? '-' : '\u20AC ' + formatNumber(n, 0); }
function formatPercent(n) { return n == null ? '-' : formatNumber(n, 1) + '%'; }

/* ══════════════════════════════════════════════════════════════════
   PAGE: OVERZICHT
   ══════════════════════════════════════════════════════════════════ */
async function loadOverzicht() {
    const container = document.getElementById('overzicht-content');
    container.innerHTML = '<div class="loading">Data laden...</div>';
    try {
        const data = await api(`/api/overzicht?van=${state.periode.van}&tot=${state.periode.tot}`);
        state.overzichtData = data;
        renderOverzicht(data);
    } catch (e) {
        container.innerHTML = `<div class="empty-state">Kon data niet laden. Controleer de verbinding met ixgram.<br><small>${e.message}</small></div>`;
    }
}

async function renderOverzicht(data) {
    const kpi = data.kpi;
    const container = document.getElementById('overzicht-content');
    const signalHtml = data.signalen.length > 0
        ? data.signalen.map(s => `
            <li class="signal-item clickable" onclick="showMachineDetail('${s.code}')">
                <span class="signal-dot ${s.type}"></span>
                <span>${s.tekst}</span>
            </li>`).join('')
        : '<li class="empty-state">Geen signalen - alle machines presteren binnen norm</li>';

    // Bereken historische gemiddelden per vestiging — alle dagen in periode tonen
    const dagen = getAllDaysInPeriod(state.periode.van, state.periode.tot);
    const wdKort = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
    const chartLabels = dagen.map(d => {
        const dt = new Date(d + 'T00:00:00');
        return wdKort[dt.getDay()] + ' ' + parseInt(d.slice(8)) + '/' + parseInt(d.slice(5,7));
    });
    const alkData = dagen.map(d => (data.omzet_per_dag[d] || {}).alkmaar || 0);
    const uitData = dagen.map(d => (data.omzet_per_dag[d] || {}).uitgeest || 0);

    let gemData = new Array(dagen.length).fill(0);
    let afwData = new Array(dagen.length).fill(0);
    let wdGemTotaal = {}, wdGemAlk = {}, wdGemUit = {};

    try {
        const hist = await api('/api/productie?van=2026-01-01&tot=2026-12-31');
        const dagTotaal = {}, dagAlk = {}, dagUit = {};
        hist.data.forEach(r => {
            dagTotaal[r.datum] = (dagTotaal[r.datum] || 0) + (r.omzet || 0);
            if (r.vestiging === 'Alkmaar') dagAlk[r.datum] = (dagAlk[r.datum] || 0) + (r.omzet || 0);
            if (r.vestiging === 'Uitgeest') dagUit[r.datum] = (dagUit[r.datum] || 0) + (r.omzet || 0);
        });
        // Per weekdag gemiddelden berekenen (alleen dagen met omzet > 0)
        const wdBuckets = { totaal: {}, alk: {}, uit: {} };
        for (const [d, omzet] of Object.entries(dagTotaal)) {
            if (omzet <= 0) continue;
            const wd = new Date(d + 'T00:00:00').getDay();
            if (!wdBuckets.totaal[wd]) { wdBuckets.totaal[wd] = []; wdBuckets.alk[wd] = []; wdBuckets.uit[wd] = []; }
            wdBuckets.totaal[wd].push(omzet);
            wdBuckets.alk[wd].push(dagAlk[d] || 0);
            wdBuckets.uit[wd].push(dagUit[d] || 0);
        }
        const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        for (const wd of Object.keys(wdBuckets.totaal)) {
            wdGemTotaal[wd] = avg(wdBuckets.totaal[wd]);
            wdGemAlk[wd] = avg(wdBuckets.alk[wd]);
            wdGemUit[wd] = avg(wdBuckets.uit[wd]);
        }
        dagen.forEach((d, i) => {
            const wd = new Date(d + 'T00:00:00').getDay();
            const gem = wdGemTotaal[wd] || 0;
            const totaal = alkData[i] + uitData[i];
            gemData[i] = Math.round(gem);
            afwData[i] = gem > 0 ? Math.round(((totaal - gem) / gem) * 1000) / 10 : 0;
        });
    } catch(e) { /* ignore */ }

    // Bereken periode-gemiddelde per vestiging (gewogen naar weekdagen in selectie)
    let gemTotaalPeriode = 0, gemAlkPeriode = 0, gemUitPeriode = 0;
    let aantalDagen = 0;
    dagen.forEach(d => {
        const wd = new Date(d + 'T00:00:00').getDay();
        const gt = wdGemTotaal[wd] || 0;
        if (gt > 0) { gemTotaalPeriode += gt; gemAlkPeriode += (wdGemAlk[wd] || 0); gemUitPeriode += (wdGemUit[wd] || 0); aantalDagen++; }
    });
    const afwTotaal = gemTotaalPeriode > 0 ? ((kpi.totaal_omzet - gemTotaalPeriode) / gemTotaalPeriode) * 100 : 0;
    const afwAlk = gemAlkPeriode > 0 ? ((kpi.omzet_alkmaar - gemAlkPeriode) / gemAlkPeriode) * 100 : 0;
    const afwUit = gemUitPeriode > 0 ? ((kpi.omzet_uitgeest - gemUitPeriode) / gemUitPeriode) * 100 : 0;

    const afwLabel = (v) => { const s = v >= 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`; return `<span class="${v >= 0 ? 'kpi-pct-groen' : 'kpi-pct-rood'}">${s}</span>`; };
    const pctAlk = kpi.totaal_omzet > 0 ? (kpi.omzet_alkmaar/kpi.totaal_omzet)*100 : 0;
    const pctUit = kpi.totaal_omzet > 0 ? (kpi.omzet_uitgeest/kpi.totaal_omzet)*100 : 0;

    container.innerHTML = `
        <div class="card-grid-2">
            <div class="overzicht-kpi-row">
                <div class="kpi-tile" onclick="navigateTo('productie')">
                    <div class="kpi-label">Totaal omzet</div>
                    <div class="kpi-value">${formatCurrency(kpi.totaal_omzet)}</div>
                    <div class="kpi-sub">${afwLabel(afwTotaal)} t.o.v. gemiddelde</div>
                </div>
                <div class="kpi-tile" onclick="navigateTo('productie')">
                    <div class="kpi-label">Omzet Alkmaar (${formatPercent(pctAlk)})</div>
                    <div class="kpi-value">${formatCurrency(kpi.omzet_alkmaar)}</div>
                    <div class="kpi-sub">${afwLabel(afwAlk)} t.o.v. gemiddelde</div>
                </div>
                <div class="kpi-tile" onclick="navigateTo('productie')">
                    <div class="kpi-label">Omzet Uitgeest (${formatPercent(pctUit)})</div>
                    <div class="kpi-value">${formatCurrency(kpi.omzet_uitgeest)}</div>
                    <div class="kpi-sub">${afwLabel(afwUit)} t.o.v. gemiddelde</div>
                </div>
            </div>
            <div></div>
        </div>

        <div class="card-grid-2">
            <div class="card">
                <div class="card-title">Omzet per dag (gestapeld per vestiging)</div>
                <div class="chart-container"><canvas id="chart-omzet-dag"></canvas></div>
            </div>
            <div class="card">
                <div class="card-title">Signalen</div>
                <ul class="signal-list">${signalHtml}</ul>
            </div>
        </div>

    `;

    // Chart 1: Omzet per dag gestapeld + gemiddelde lijn
    createChart('chart-omzet-dag', {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [
                { label: 'Alkmaar', data: alkData, backgroundColor: '#1B3A5C', stack: 'omzet', order: 2 },
                { label: 'Uitgeest', data: uitData, backgroundColor: '#6BAED6', stack: 'omzet', order: 2 },
                { label: 'Gem. weekdag', data: gemData, type: 'line',
                  borderColor: 'transparent', backgroundColor: 'transparent',
                  borderWidth: 0, pointRadius: 0, fill: false, order: 1, yAxisID: 'y',
                  tension: 0, hidden: false },
            ]
        },
        plugins: [{
            id: 'afwijkingLabels',
            afterDatasetsDraw(chart) {
                const ctx = chart.ctx;
                const meta = chart.getDatasetMeta(2); // gemiddelde lijn dataset
                if (!meta || !meta.data) return;
                ctx.save();
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center';
                dagen.forEach((d, i) => {
                    const afw = afwData[i];
                    if (afw === 0 && gemData[i] === 0) return;
                    const totaal = alkData[i] + uitData[i];
                    if (totaal === 0) return;
                    // Position above the stacked bar
                    const barMeta0 = chart.getDatasetMeta(0);
                    const barMeta1 = chart.getDatasetMeta(1);
                    const topY = Math.min(
                        barMeta0.data[i] ? barMeta0.data[i].y : 999,
                        barMeta1.data[i] ? barMeta1.data[i].y : 999
                    );
                    const x = barMeta0.data[i] ? barMeta0.data[i].x : 0;
                    ctx.fillStyle = afw >= 0 ? '#28A745' : '#DC3545';
                    const label = (afw >= 0 ? '+' : '') + afw.toFixed(1) + '%';
                    ctx.fillText(label, x, topY - 6);
                });
                ctx.restore();
            }
        }],
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { filter: (item) => item.datasetIndex !== 2 } },  // hide gem. weekdag, show vorig jaar
                tooltip: { callbacks: {
                    label: (ctx) => {
                        if (ctx.datasetIndex === 2) return null;
                        return ctx.dataset.label + ': €' + formatNumber(ctx.parsed.y);
                    },
                    afterBody: (items) => {
                        const i = items[0].dataIndex;
                        const totaal = alkData[i] + uitData[i];
                        const gem = gemData[i];
                        const afw = afwData[i];
                        const afwLabel = afw >= 0 ? `+${afw.toFixed(1)}%` : `${afw.toFixed(1)}%`;
                        return [`─────────────`, `Totaal: €${formatNumber(totaal)}`, `Gem. ${chartLabels[i].substring(0,2)}: €${formatNumber(gem)}`, `Afwijking: ${afwLabel}`];
                    }
                }}
            },
            scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: v => '\u20AC' + formatNumber(v) } } }
        }
    });

}

/* ══════════════════════════════════════════════════════════════════
   PAGE: PRODUCTIE DETAIL
   ══════════════════════════════════════════════════════════════════ */
async function loadProductie() {
    const container = document.getElementById('productie-table');
    container.innerHTML = '<div class="loading">Data laden...</div>';
    try {
        const vestiging = document.getElementById('filter-vestiging')?.value || '';
        const groep = document.getElementById('filter-machinegroep')?.value || '';
        let url = `/api/productie?van=${state.periode.van}&tot=${state.periode.tot}`;
        if (vestiging) url += `&vestiging=${vestiging}`;
        if (groep) url += `&machinegroep=${groep}`;
        const result = await api(url);
        state.productieData = result.data;
        renderProductieTable(result.data);
    } catch (e) {
        container.innerHTML = `<div class="empty-state">Kon data niet laden.<br><small>${e.message}</small></div>`;
    }
}

function renderProductieTable(data) {
    const container = document.getElementById('productie-table');
    const productive = data.filter(r => r.machinegroep !== 'Overig' && (r.productie_totaal > 0 || r.centiuren_totaal > 0));
    if (productive.length === 0) {
        container.innerHTML = '<div class="empty-state">Geen productiedata beschikbaar voor deze periode en filters.</div>';
        return;
    }
    const sortedData = sortData(productive);
    const rows = sortedData.map(r => `
        <tr>
            <td>${r.datum || '-'}</td>
            <td class="clickable" onclick="showMachineDetail('${r.planplaats_code}')">${r.planplaats_code}</td>
            <td>${r.planplaats_naam}</td>
            <td>${r.vestiging}</td>
            <td>${r.machinegroep}</td>
            <td class="num">${formatNumber(r.centiuren_totaal, 2)}</td>
            <td class="num">${formatNumber(r.centiuren_stellen, 2)}</td>
            <td class="num">${formatNumber(r.centiuren_draaien, 2)}</td>
            <td class="num" style="color:${r.centiuren_foute_bewerking > 0 ? 'var(--red)' : 'inherit'}">${formatNumber(r.centiuren_foute_bewerking, 2)}</td>
            <td class="num">${formatNumber(r.productie_totaal)}</td>
            <td class="num">${formatNumber(r.gem_snelheid, 1)}</td>
            <td class="num">${formatPercent(r.stelpercentage)}</td>
            <td class="num">${formatCurrency(r.omzet)}</td>
            <td>${renderNormBar(r.norm_afwijking_snelheid)}</td>
        </tr>`).join('');

    container.innerHTML = `
        <div class="data-table-wrapper">
            <table class="data-table" id="tbl-productie">
                <thead><tr>
                    <th onclick="sortTable('datum')">Datum</th>
                    <th onclick="sortTable('planplaats_code')">Code</th>
                    <th onclick="sortTable('planplaats_naam')">Machine</th>
                    <th onclick="sortTable('vestiging')">Vestiging</th>
                    <th onclick="sortTable('machinegroep')">Groep</th>
                    <th onclick="sortTable('centiuren_totaal')">Uren totaal</th>
                    <th onclick="sortTable('centiuren_stellen')">Uren stellen</th>
                    <th onclick="sortTable('centiuren_draaien')">Uren draaien</th>
                    <th onclick="sortTable('centiuren_foute_bewerking')">Uren fout</th>
                    <th onclick="sortTable('productie_totaal')">Productie</th>
                    <th onclick="sortTable('gem_snelheid')">Gem. snelheid</th>
                    <th onclick="sortTable('stelpercentage')">Stel %</th>
                    <th onclick="sortTable('omzet')">Omzet</th>
                    <th>Norm</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function renderNormBar(afwijking) {
    if (afwijking === null || afwijking === undefined) return '<span class="badge">-</span>';
    let cls = 'groen';
    if (afwijking < -20) cls = 'rood';
    else if (afwijking < -10) cls = 'oranje';
    return `<span class="badge badge-${cls}">${afwijking > 0 ? '+' : ''}${afwijking}%</span>`;
}

function sortTable(col) {
    if (state.sortCol === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortCol = col; state.sortDir = 'asc'; }
    renderProductieTable(state.productieData);
}

function sortData(data) {
    if (!state.sortCol) return data;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
        const va = a[state.sortCol] ?? '', vb = b[state.sortCol] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
    });
}

function showMachineDetail(code) {
    state.machineCode = code;
    navigateTo('machine');
}

function getMachineNavList() {
    // Build ordered list of machine codes respecting vestiging filter
    const allData = [
        ...(state._sectieData_druk || []),
        ...(state._sectieData_vouw || []),
        ...(state.productieData || [])
    ];
    const filter = state.machineVestigingFilter || 'beide';
    const seen = new Map();
    allData.forEach(r => {
        if (!seen.has(r.planplaats_code)) {
            seen.set(r.planplaats_code, { code: r.planplaats_code, naam: r.planplaats_naam, vestiging: r.vestiging, machinegroep: r.machinegroep });
        }
    });
    let machines = [...seen.values()];
    if (filter !== 'beide') {
        machines = machines.filter(m => m.vestiging && m.vestiging.toLowerCase() === filter.toLowerCase());
    }
    // Sort by machinegroep then code
    const grpOrder = { 'Drukkerij': 0, 'Vouwerij': 1, 'Snijderij': 2, 'Nabewerking': 3 };
    machines.sort((a, b) => {
        const ga = grpOrder[a.machinegroep] ?? 9;
        const gb = grpOrder[b.machinegroep] ?? 9;
        if (ga !== gb) return ga - gb;
        return a.code.localeCompare(b.code);
    });
    return machines;
}

function navigateMachine(direction) {
    const list = getMachineNavList();
    if (list.length === 0) return;
    const idx = list.findIndex(m => m.code === state.machineCode);
    let newIdx;
    if (direction === 'next') {
        newIdx = idx < list.length - 1 ? idx + 1 : 0;
    } else {
        newIdx = idx > 0 ? idx - 1 : list.length - 1;
    }
    state.machineCode = list[newIdx].code;
    renderMachineDetail();
}

function setMachineVestigingFilter(value) {
    state.machineVestigingFilter = value;
    // Check if current machine is still in the filtered list
    const list = getMachineNavList();
    if (list.length > 0 && !list.find(m => m.code === state.machineCode)) {
        state.machineCode = list[0].code;
    }
    renderMachineDetail();
}

function showSignalPopup(dagIdx, ploeg) {
    const d = state._machineDagen[dagIdx];
    if (!d) return;
    const ns = state._machineNormSnelheid || 0;
    const weekdagenFull = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
    const dt = new Date(d.datum + 'T00:00:00');
    const dagLabel = weekdagenFull[dt.getDay()] + ' ' + parseInt(d.datum.slice(8)) + '/' + parseInt(d.datum.slice(5,7));

    const allePloegen = [
        { naam: 'Ochtend', prod: d.prod_ochtend, draai: d.draai_ochtend, stel: d.stel_ochtend, cnt: d.cnt_ochtend },
        { naam: 'Middag', prod: d.prod_middag, draai: d.draai_middag, stel: d.stel_middag, cnt: d.cnt_middag },
        { naam: 'Nacht', prod: d.prod_nacht, draai: d.draai_nacht, stel: d.stel_nacht, cnt: d.cnt_nacht },
    ];
    const ploegen = allePloegen.filter(p => p.prod > 0 || p.draai > 0 || p.cnt > 0);

    const ploegRows = ploegen.map(p => {
        const snelheid = p.draai > 0 ? p.prod / p.draai : 0;
        const afwPct = ns > 0 && p.draai > 0 ? ((snelheid - ns) / ns) * 100 : 0;
        const stelPct = p.cnt > 0 ? (p.stel / p.cnt) * 100 : 0;
        const highlight = ploeg && p.naam.toLowerCase() === ploeg ? ' class="signal-highlight"' : '';
        const afwClass = afwPct < -20 ? 'afw-kritiek' : afwPct < -10 ? 'afw-waarschuwing' : afwPct > 25 ? 'afw-positief' : '';
        const afwLabel = p.draai > 0 && ns > 0 ? (afwPct >= 0 ? `+${afwPct.toFixed(1)}%` : `${afwPct.toFixed(1)}%`) : '-';
        return `<tr${highlight}>
            <td><strong>${p.naam}</strong></td>
            <td class="num">${formatNumber(p.prod)}</td>
            <td class="num">${formatNumber(p.draai, 2)}</td>
            <td class="num">${formatNumber(p.stel, 2)}</td>
            <td class="num">${formatNumber(p.cnt, 2)}</td>
            <td class="num">${p.draai > 0 ? formatNumber(snelheid, 0) : '-'}</td>
            <td class="num ${afwClass}">${afwLabel}</td>
            <td class="num">${formatPercent(stelPct)}</td>
        </tr>`;
    }).join('');

    // Totalen
    const totProd = ploegen.reduce((s, p) => s + p.prod, 0);
    const totDraai = ploegen.reduce((s, p) => s + p.draai, 0);
    const totStel = ploegen.reduce((s, p) => s + p.stel, 0);
    const totCnt = ploegen.reduce((s, p) => s + p.cnt, 0);
    const totSnelheid = totDraai > 0 ? totProd / totDraai : 0;
    const totAfwPct = ns > 0 && totDraai > 0 ? ((totSnelheid - ns) / ns) * 100 : 0;
    const totStelPct = totCnt > 0 ? (totStel / totCnt) * 100 : 0;
    const totAfwLabel = totDraai > 0 && ns > 0 ? (totAfwPct >= 0 ? `+${totAfwPct.toFixed(1)}%` : `${totAfwPct.toFixed(1)}%`) : '-';

    // Remove existing popup
    const existing = document.getElementById('signal-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'signal-popup';
    popup.className = 'signal-popup-overlay';
    popup.onclick = (e) => { if (e.target === popup) popup.remove(); };

    popup.innerHTML = `
        <div class="signal-popup">
            <div class="signal-popup-header">
                <h3>${dagLabel} — ${state.machineCode}</h3>
                <button class="signal-popup-close" onclick="document.getElementById('signal-popup').remove()">&times;</button>
            </div>
            <div class="signal-popup-norm">Norm snelheid: <strong>${ns > 0 ? formatNumber(ns, 0) + ' st/uur' : 'niet ingesteld'}</strong></div>
            <div class="data-table-wrapper">
                <table class="data-table">
                    <thead><tr>
                        <th>Ploeg</th><th>Productie</th><th>Draaiuren</th><th>Steluren</th>
                        <th>Uren totaal</th><th>Snelheid</th><th>Afw. norm</th><th>Stel %</th>
                    </tr></thead>
                    <tbody>
                        ${ploegRows}
                        <tr class="totaal-row">
                            <td><strong>Totaal</strong></td>
                            <td class="num"><strong>${formatNumber(totProd)}</strong></td>
                            <td class="num"><strong>${formatNumber(totDraai, 2)}</strong></td>
                            <td class="num"><strong>${formatNumber(totStel, 2)}</strong></td>
                            <td class="num"><strong>${formatNumber(totCnt, 2)}</strong></td>
                            <td class="num"><strong>${formatNumber(totSnelheid, 0)}</strong></td>
                            <td class="num"><strong>${totAfwLabel}</strong></td>
                            <td class="num"><strong>${formatPercent(totStelPct)}</strong></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    document.body.appendChild(popup);
}

async function renderMachineDetail() {
    const code = state.machineCode;
    const container = document.getElementById('machine-detail-content');
    if (!code) {
        container.innerHTML = '<div class="empty-state">Selecteer een machine vanuit Drukkerij of Vouwerij.</div>';
        return;
    }

    // Gather data from all available sectie sources
    let allData = [
        ...(state._sectieData_druk || []),
        ...(state._sectieData_vouw || []),
        ...(state.productieData || [])
    ];
    let records = allData.filter(r => r.planplaats_code === code);

    // Als geen data beschikbaar, ophalen via API
    if (records.length === 0) {
        container.innerHTML = '<div class="loading">Data laden...</div>';
        try {
            const result = await api(`/api/productie?van=${state.periode.van}&tot=${state.periode.tot}`);
            state.productieData = result.data || [];
            allData = state.productieData;
            records = allData.filter(r => r.planplaats_code === code);
        } catch (e) {
            container.innerHTML = `<div class="empty-state">Kon data niet laden.<br><small>${e.message}</small></div>`;
            return;
        }
    }

    if (records.length === 0) {
        container.innerHTML = `<div class="empty-state">Geen data gevonden voor planplaats ${code}.</div>`;
        return;
    }

    // Normen laden als nog niet beschikbaar
    if (state.normen.length === 0) {
        try { state.normen = await api('/api/normen'); } catch(e) { /* ignore */ }
    }

    const machineNaam = records[0].planplaats_naam || `Planplaats ${code}`;
    const vestiging = records[0].vestiging || '';
    const machinegroep = records[0].machinegroep || '';
    document.getElementById('machine-page-title').textContent = `${machineNaam} — ${vestiging}`;

    // Build planplaats switcher from machines in same group
    // Groepeer alle machines per machinegroep
    const groepen = {};
    allData.forEach(r => {
        const grp = r.machinegroep || 'Overig';
        if (!groepen[grp]) groepen[grp] = new Map();
        if (!groepen[grp].has(r.planplaats_code)) {
            groepen[grp].set(r.planplaats_code, r.planplaats_naam || r.planplaats_code);
        }
    });
    const groepVolgorde = ['Drukkerij', 'Vouwerij', 'Snijderij', 'Nabewerking', 'Overig'];
    const switcherOptions = groepVolgorde
        .filter(g => groepen[g] && groepen[g].size > 0)
        .map(g => {
            const opts = [...groepen[g].entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([c, naam]) => `<option value="${c}" ${c === code ? 'selected' : ''}>${c} — ${naam}</option>`)
                .join('');
            return `<optgroup label="${g}">${opts}</optgroup>`;
        }).join('');

    // Totals for summary cards
    let totProd = 0, totDraaien = 0, totStellen = 0, totTotaal = 0, totOmzet = 0;
    records.forEach(r => {
        totProd += r.productie_totaal || 0;
        totDraaien += r.centiuren_draaien || 0;
        totStellen += r.centiuren_stellen || 0;
        totTotaal += r.centiuren_totaal || 0;
        totOmzet += r.omzet || 0;
    });
    const gemSnelheid = totDraaien > 0 ? totProd / totDraaien : 0;
    const stelPct = totTotaal > 0 ? (totStellen / totTotaal) * 100 : 0;

    // Norm lookup
    const norm = state.normen.find(n => n.planplaats_code === code);

    // Group by date
    const dagMap = {};
    records.forEach(r => {
        const d = typeof r.datum === 'string' ? r.datum : r.datum;
        if (!dagMap[d]) {
            dagMap[d] = { datum: d, prod_ochtend: 0, prod_middag: 0, prod_nacht: 0,
                stel_ochtend: 0, stel_middag: 0, stel_nacht: 0,
                draai_ochtend: 0, draai_middag: 0, draai_nacht: 0,
                cnt_ochtend: 0, cnt_middag: 0, cnt_nacht: 0,
                prod_totaal: 0, cnt_totaal: 0, cnt_stellen: 0, cnt_draaien: 0, omzet: 0 };
        }
        const dag = dagMap[d];
        dag.prod_ochtend += r.productie_ploeg2 || 0;
        dag.prod_middag += r.productie_ploeg3 || 0;
        dag.prod_nacht += r.productie_ploeg1 || 0;
        dag.stel_ochtend += r.stel_ploeg2 || 0;
        dag.stel_middag += r.stel_ploeg3 || 0;
        dag.stel_nacht += r.stel_ploeg1 || 0;
        dag.draai_ochtend += r.draai_ploeg2 || 0;
        dag.draai_middag += r.draai_ploeg3 || 0;
        dag.draai_nacht += r.draai_ploeg1 || 0;
        dag.cnt_ochtend += r.centiuren_ploeg2 || 0;
        dag.cnt_middag += r.centiuren_ploeg3 || 0;
        dag.cnt_nacht += r.centiuren_ploeg1 || 0;
        dag.prod_totaal += r.productie_totaal || 0;
        dag.cnt_totaal += r.centiuren_totaal || 0;
        dag.cnt_stellen += r.centiuren_stellen || 0;
        dag.cnt_draaien += r.centiuren_draaien || 0;
        dag.omzet += r.omzet || 0;
    });

    const weekdagen = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
    const emptyDag = { datum: '', prod_ochtend: 0, prod_middag: 0, prod_nacht: 0,
        stel_ochtend: 0, stel_middag: 0, stel_nacht: 0,
        draai_ochtend: 0, draai_middag: 0, draai_nacht: 0,
        cnt_ochtend: 0, cnt_middag: 0, cnt_nacht: 0,
        prod_totaal: 0, cnt_totaal: 0, cnt_stellen: 0, cnt_draaien: 0, omzet: 0 };
    const allDays = getAllDaysInPeriod(state.periode.van, state.periode.tot);
    const dagen = allDays.map(d => dagMap[d] || { ...emptyDag, datum: d });
    const labels = dagen.map(d => {
        const dt = new Date(d.datum + 'T00:00:00');
        return weekdagen[dt.getDay()] + ' ' + parseInt(d.datum.slice(8)) + '/' + parseInt(d.datum.slice(5,7));
    });

    // Day table rows
    const dagRows = dagen.map(d => {
        const snelh = d.cnt_draaien > 0 ? d.prod_totaal / d.cnt_draaien : 0;
        const sp = d.cnt_totaal > 0 ? (d.cnt_stellen / d.cnt_totaal) * 100 : 0;
        const dt = new Date(d.datum + 'T00:00:00');
        const label = weekdagen[dt.getDay()] + ' ' + parseInt(d.datum.slice(8)) + '/' + parseInt(d.datum.slice(5,7));
        return `<tr>
            <td>${label}</td>
            <td class="num">${formatNumber(d.prod_totaal)}</td>
            <td class="num">${formatNumber(d.cnt_totaal, 2)}</td>
            <td class="num">${formatNumber(d.cnt_draaien, 2)}</td>
            <td class="num">${formatNumber(d.cnt_stellen, 2)}</td>
            <td class="num">${formatNumber(snelh, 0)}</td>
            <td class="num">${formatPercent(sp)}</td>
            <td class="num">${formatCurrency(d.omzet)}</td>
        </tr>`;
    }).join('');

    let normInfo = '';
    if (norm && norm.norm_snelheid) {
        const afwijkingPct = norm.norm_snelheid > 0 ? ((gemSnelheid - norm.norm_snelheid) / norm.norm_snelheid) * 100 : 0;
        const afwijkingClass = afwijkingPct < -20 ? 'kpi-kritiek' : afwijkingPct < -10 ? 'kpi-waarschuwing' : 'kpi-goed';
        const afwijkingLabel = afwijkingPct >= 0 ? `+${afwijkingPct.toFixed(1)}%` : `${afwijkingPct.toFixed(1)}%`;
        normInfo = `
            <div class="kpi-card"><div class="kpi-label">Norm snelheid</div><div class="kpi-value">${formatNumber(norm.norm_snelheid, 0)} st/uur</div></div>
            <div class="kpi-card ${afwijkingClass}"><div class="kpi-label">Afwijking t.o.v. norm</div><div class="kpi-value">${afwijkingLabel}</div></div>`;
    }

    // Signalen: afwijkingen per dag en ploeg t.o.v. norm
    const weekdagenFull = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
    let signalenHtml = '';
    if (norm && norm.norm_snelheid && norm.norm_snelheid > 0) {
        const ns = norm.norm_snelheid;
        const signalen = [];

        // Store dag data globally for popup access
        state._machineDagen = dagen;
        state._machineNormSnelheid = ns;

        dagen.forEach((d, di) => {
            const dt = new Date(d.datum + 'T00:00:00');
            const dagLabel = weekdagenFull[dt.getDay()] + ' ' + parseInt(d.datum.slice(8)) + '/' + parseInt(d.datum.slice(5,7));

            // Snelheid per dag totaal
            const dagDraaien = d.draai_ochtend + d.draai_middag + d.draai_nacht;
            const dagProd = d.prod_ochtend + d.prod_middag + d.prod_nacht;
            if (dagDraaien > 0.5) {
                const dagSnelheid = dagProd / dagDraaien;
                const dagAfw = ((dagSnelheid - ns) / ns) * 100;
                if (dagAfw < -20) {
                    signalen.push({ type: 'kritiek', prio: dagAfw, dagIdx: di, ploeg: null,
                        tekst: `${dagLabel}: snelheid ${formatNumber(dagSnelheid, 0)} st/uur (${dagAfw.toFixed(1)}% onder norm)` });
                } else if (dagAfw < -10) {
                    signalen.push({ type: 'waarschuwing', prio: dagAfw, dagIdx: di, ploeg: null,
                        tekst: `${dagLabel}: snelheid ${formatNumber(dagSnelheid, 0)} st/uur (${dagAfw.toFixed(1)}% onder norm)` });
                } else if (dagAfw > 50) {
                    signalen.push({ type: 'positief-extreem', prio: -dagAfw, dagIdx: di, ploeg: null,
                        tekst: `${dagLabel}: snelheid ${formatNumber(dagSnelheid, 0)} st/uur (+${dagAfw.toFixed(1)}% boven norm — uitschieter!)` });
                } else if (dagAfw > 25) {
                    signalen.push({ type: 'positief', prio: -dagAfw, dagIdx: di, ploeg: null,
                        tekst: `${dagLabel}: snelheid ${formatNumber(dagSnelheid, 0)} st/uur (+${dagAfw.toFixed(1)}% boven norm)` });
                }
            }

            // Per ploeg
            const ploegen = [
                { naam: 'ochtend', prod: d.prod_ochtend, draai: d.draai_ochtend, stel: d.stel_ochtend, cnt: d.cnt_ochtend },
                { naam: 'middag', prod: d.prod_middag, draai: d.draai_middag, stel: d.stel_middag, cnt: d.cnt_middag },
                { naam: 'nacht', prod: d.prod_nacht, draai: d.draai_nacht, stel: d.stel_nacht, cnt: d.cnt_nacht },
            ];
            ploegen.forEach(p => {
                if (p.draai > 0.25) {
                    const pSnelheid = p.prod / p.draai;
                    const pAfw = ((pSnelheid - ns) / ns) * 100;
                    if (pAfw < -30) {
                        signalen.push({ type: 'kritiek', prio: pAfw, dagIdx: di, ploeg: p.naam,
                            tekst: `${dagLabel} ${p.naam}: ${formatNumber(pSnelheid, 0)} st/uur (${pAfw.toFixed(1)}% onder norm)` });
                    } else if (pAfw > 75) {
                        signalen.push({ type: 'positief-extreem', prio: -pAfw, dagIdx: di, ploeg: p.naam,
                            tekst: `${dagLabel} ${p.naam}: ${formatNumber(pSnelheid, 0)} st/uur (+${pAfw.toFixed(1)}% boven norm — uitschieter!)` });
                    }
                }
            });

            // Hoog stelpercentage per dag
            const dagCnt = d.cnt_ochtend + d.cnt_middag + d.cnt_nacht;
            const dagStel = d.stel_ochtend + d.stel_middag + d.stel_nacht;
            if (dagCnt > 0.5) {
                const dagStelPct = (dagStel / dagCnt) * 100;
                if (dagStelPct > 40) {
                    signalen.push({ type: 'waarschuwing', prio: -dagStelPct, dagIdx: di, ploeg: null,
                        tekst: `${dagLabel}: stelpercentage ${dagStelPct.toFixed(1)}% (hoog)` });
                }
            }

            // Meer dan 9 uur per ploeg
            const ploegUren = [
                { naam: 'ochtend', uren: d.cnt_ochtend },
                { naam: 'middag', uren: d.cnt_middag },
                { naam: 'nacht', uren: d.cnt_nacht },
            ];
            ploegUren.forEach(p => {
                if (p.uren > 9) {
                    signalen.push({ type: 'waarschuwing', prio: -p.uren, dagIdx: di, ploeg: p.naam,
                        tekst: `${dagLabel} ${p.naam}: ${p.uren.toFixed(2)} uur (meer dan 9 uur)` });
                }
            });
        });

        signalen.sort((a, b) => a.prio - b.prio);

        const nKritiek = signalen.filter(s => s.type === 'kritiek').length;
        const nWaarschuwing = signalen.filter(s => s.type === 'waarschuwing').length;
        const nPositief = signalen.filter(s => s.type === 'positief' || s.type === 'positief-extreem').length;
        const badges = [
            nKritiek > 0 ? `<span class="badge badge-rood">${nKritiek} kritiek</span>` : '',
            nWaarschuwing > 0 ? `<span class="badge badge-oranje">${nWaarschuwing} waarschuwing</span>` : '',
            nPositief > 0 ? `<span class="badge badge-blauw">${nPositief} positief</span>` : '',
        ].filter(Boolean).join(' ');

        if (signalen.length > 0) {
            signalenHtml = `
                <div class="detail-toggle" onclick="toggleDetail('md-signalen')">
                    <span class="toggle-icon" id="md-signalen-icon">&#9654;</span>
                    Signalen (${signalen.length}) ${badges}
                </div>
                <div class="detail-panel" id="md-signalen" style="display:none;">
                    <div class="card machine-signalen">
                        <ul class="signal-list">
                            ${signalen.map((s, i) => `
                                <li class="signal-item clickable" onclick="showSignalPopup(${s.dagIdx}, ${s.ploeg ? `'${s.ploeg}'` : 'null'})">
                                    <span class="signal-dot ${s.type}"></span>
                                    <span>${s.tekst}</span>
                                </li>`).join('')}
                        </ul>
                    </div>
                </div>`;
        } else {
            signalenHtml = `
                <div class="detail-toggle" style="cursor:default;">
                    <span style="color:#28A745;">&#10003;</span>
                    Signalen (0) — alle dagen en ploegen presteren binnen norm
                </div>`;
        }
    }

    // Navigation context
    const navList = getMachineNavList();
    const navIdx = navList.findIndex(m => m.code === code);
    const prevMachine = navIdx > 0 ? navList[navIdx - 1] : navList[navList.length - 1];
    const nextMachine = navIdx < navList.length - 1 ? navList[navIdx + 1] : navList[0];
    const navCount = navList.length;
    const navPos = navIdx >= 0 ? navIdx + 1 : '-';
    const vestFilter = state.machineVestigingFilter || 'beide';

    container.innerHTML = `
        <div class="machine-nav-bar">
            <div class="machine-nav-left">
                <div class="machine-switcher">
                    <label>Planplaats:</label>
                    <select onchange="showMachineDetail(this.value)">${switcherOptions}</select>
                </div>
                <div class="machine-vestiging-filter">
                    <label>Vestiging:</label>
                    <select onchange="setMachineVestigingFilter(this.value)">
                        <option value="beide" ${vestFilter === 'beide' ? 'selected' : ''}>Beide</option>
                        <option value="alkmaar" ${vestFilter === 'alkmaar' ? 'selected' : ''}>Alkmaar</option>
                        <option value="uitgeest" ${vestFilter === 'uitgeest' ? 'selected' : ''}>Uitgeest</option>
                    </select>
                </div>
            </div>
            <div class="machine-nav-right">
                <button class="machine-nav-btn" onclick="navigateMachine('prev')" title="${prevMachine ? prevMachine.naam : ''}">&#9664; Vorige</button>
                <span class="machine-nav-counter">${navPos} / ${navCount}</span>
                <button class="machine-nav-btn" onclick="navigateMachine('next')" title="${nextMachine ? nextMachine.naam : ''}">Volgende &#9654;</button>
            </div>
        </div>
        <div class="kpi-row">
            <div class="kpi-card"><div class="kpi-label">Productie</div><div class="kpi-value">${formatNumber(totProd)}</div></div>
            <div class="kpi-card"><div class="kpi-label">Uren totaal</div><div class="kpi-value">${formatNumber(totTotaal, 2)}</div></div>
            <div class="kpi-card"><div class="kpi-label">Gem. snelheid</div><div class="kpi-value">${formatNumber(gemSnelheid, 0)} st/uur</div></div>
            <div class="kpi-card"><div class="kpi-label">Stel %</div><div class="kpi-value">${formatPercent(stelPct)}</div></div>
            <div class="kpi-card"><div class="kpi-label">Omzet</div><div class="kpi-value">${formatCurrency(totOmzet)}</div></div>
            ${normInfo}
        </div>
        ${signalenHtml}

        <div class="chart-row">
            <div class="card chart-card">
                <div class="card-title">Productie per ploeg + steluren</div>
                <div class="chart-container"><canvas id="md-chart-ploeg"></canvas></div>
            </div>
            <div class="card chart-card">
                <div class="card-title">Gem. snelheid per ploeg + draaiuren</div>
                <div class="chart-container"><canvas id="md-chart-snelheid"></canvas></div>
            </div>
        </div>

        <div class="chart-row">
            <div class="card chart-card">
                <div class="card-title">Uren verdeling per ploeg (draaien / stellen)</div>
                <div class="chart-container"><canvas id="md-chart-uren"></canvas></div>
            </div>
            <div class="card chart-card">
                <div class="card-title">Stelpercentage per ploeg</div>
                <div class="chart-container"><canvas id="md-chart-stelpct"></canvas></div>
            </div>
        </div>

        <div class="detail-toggle" onclick="toggleDetail('md-dagtabel')">
            <span class="toggle-icon" id="md-dagtabel-icon">&#9654;</span>
            Dagoverzicht ${machineNaam}
        </div>
        <div class="detail-panel" id="md-dagtabel" style="display:none;">
            <div class="card">
                <div class="data-table-wrapper">
                    <table class="data-table"><thead><tr>
                        <th>Dag</th><th>Productie</th><th>Uren totaal</th><th>Uren draaien</th>
                        <th>Uren stellen</th><th>Gem. snelheid</th><th>Stel %</th><th>Omzet</th>
                    </tr></thead><tbody>${dagRows}</tbody></table>
                </div>
            </div>
        </div>
    `;

    if (typeof Chart === 'undefined' || dagen.length === 0) return;

    // Destroy previous charts
    destroyChart('md-chart-ploeg');
    destroyChart('md-chart-snelheid');
    destroyChart('md-chart-uren');
    destroyChart('md-chart-stelpct');

    // Chart 1: Productie per ploeg (stacked bars) + steluren (rechter Y-as)
    const stelTotaal = dagen.map(d => Math.round((d.stel_ochtend + d.stel_middag + d.stel_nacht) * 100) / 100);
    createChart('md-chart-ploeg', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Ochtend', data: dagen.map(d => d.prod_ochtend), backgroundColor: '#2E75B6', stack: 'prod', yAxisID: 'y', order: 2 },
                { label: 'Middag', data: dagen.map(d => d.prod_middag), backgroundColor: '#A5A5A5', stack: 'prod', yAxisID: 'y', order: 2 },
                { label: 'Nacht', data: dagen.map(d => d.prod_nacht), backgroundColor: '#1B3A5C', stack: 'prod', yAxisID: 'y', order: 2 },
                { label: 'Steluren', data: stelTotaal, type: 'bar', backgroundColor: '#FFC107',
                  yAxisID: 'y1', order: 1, barPercentage: 0.4 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' },
                tooltip: { callbacks: { label: (ctx) => {
                    const v = ctx.parsed.y;
                    return ctx.dataset.label + ': ' + (ctx.dataset.yAxisID === 'y1' ? v.toFixed(2) + ' uur' : formatNumber(v));
                }}}
            },
            scales: {
                x: { stacked: true },
                y: { stacked: true, position: 'left', beginAtZero: true, title: { display: true, text: 'stuks' },
                     ticks: { callback: v => formatNumber(v) } },
                y1: { position: 'right', beginAtZero: true, title: { display: true, text: 'steluren' },
                      grid: { drawOnChartArea: false } }
            }
        }
    });

    // Chart 2: Snelheid per ploeg (stacked bars) + draaiuren (rechter Y-as)
    const snelheidOchtend = dagen.map(d => d.draai_ochtend > 0 ? Math.round(d.prod_ochtend / d.draai_ochtend) : 0);
    const snelheidMiddag = dagen.map(d => d.draai_middag > 0 ? Math.round(d.prod_middag / d.draai_middag) : 0);
    const snelheidNacht = dagen.map(d => d.draai_nacht > 0 ? Math.round(d.prod_nacht / d.draai_nacht) : 0);
    const draaiTotaal = dagen.map(d => Math.round((d.draai_ochtend + d.draai_middag + d.draai_nacht) * 100) / 100);

    createChart('md-chart-snelheid', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Ochtend', data: snelheidOchtend, backgroundColor: '#2E75B6', stack: 'snelh', yAxisID: 'y', order: 2 },
                { label: 'Middag', data: snelheidMiddag, backgroundColor: '#A5A5A5', stack: 'snelh', yAxisID: 'y', order: 2 },
                { label: 'Nacht', data: snelheidNacht, backgroundColor: '#1B3A5C', stack: 'snelh', yAxisID: 'y', order: 2 },
                { label: 'Draaiuren', data: draaiTotaal, type: 'bar', backgroundColor: '#FFC107',
                  yAxisID: 'y1', order: 1, barPercentage: 0.4 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' },
                tooltip: { callbacks: { label: (ctx) => {
                    const v = ctx.parsed.y;
                    return ctx.dataset.label + ': ' + (ctx.dataset.yAxisID === 'y1' ? v.toFixed(2) + ' uur' : formatNumber(v) + ' st/uur');
                }}}
            },
            scales: {
                x: { stacked: true },
                y: { stacked: true, position: 'left', beginAtZero: true, title: { display: true, text: 'stuks/uur' },
                     ticks: { callback: v => formatNumber(v) } },
                y1: { position: 'right', beginAtZero: true, title: { display: true, text: 'draaiuren' },
                      grid: { drawOnChartArea: false } }
            }
        }
    });

    // Chart 3: Uren verdeling per ploeg (draaien + stellen gestapeld, gegroepeerd per ploeg)
    createChart('md-chart-uren', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Draaien ochtend', data: dagen.map(d => d.draai_ochtend), backgroundColor: '#2E75B6', stack: 'ochtend' },
                { label: 'Stellen ochtend', data: dagen.map(d => d.stel_ochtend), backgroundColor: '#7FB8E0', stack: 'ochtend' },
                { label: 'Draaien middag', data: dagen.map(d => d.draai_middag), backgroundColor: '#A5A5A5', stack: 'middag' },
                { label: 'Stellen middag', data: dagen.map(d => d.stel_middag), backgroundColor: '#D0D0D0', stack: 'middag' },
                { label: 'Draaien nacht', data: dagen.map(d => d.draai_nacht), backgroundColor: '#1B3A5C', stack: 'nacht' },
                { label: 'Stellen nacht', data: dagen.map(d => d.stel_nacht), backgroundColor: '#4A6A8C', stack: 'nacht' },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: {
                x: { stacked: true },
                y: { stacked: true, beginAtZero: true, title: { display: true, text: 'uren' } }
            }
        }
    });

    // Chart 4: Stelpercentage per ploeg per dag
    const stelPctOchtend = dagen.map(d => d.cnt_ochtend > 0 ? Math.round((d.stel_ochtend / d.cnt_ochtend) * 1000) / 10 : 0);
    const stelPctMiddag = dagen.map(d => d.cnt_middag > 0 ? Math.round((d.stel_middag / d.cnt_middag) * 1000) / 10 : 0);
    const stelPctNacht = dagen.map(d => d.cnt_nacht > 0 ? Math.round((d.stel_nacht / d.cnt_nacht) * 1000) / 10 : 0);
    const drempel = 30;

    createChart('md-chart-stelpct', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Ochtend', data: stelPctOchtend, backgroundColor: '#2E75B6' },
                { label: 'Middag', data: stelPctMiddag, backgroundColor: '#A5A5A5' },
                { label: 'Nacht', data: stelPctNacht, backgroundColor: '#1B3A5C' },
            ]
        },
        plugins: [{
            id: 'drempellijn',
            afterDraw(chart) {
                const yScale = chart.scales.y;
                const ctx = chart.ctx;
                const y = yScale.getPixelForValue(drempel);
                ctx.save();
                ctx.strokeStyle = '#DC3545';
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]);
                ctx.beginPath();
                ctx.moveTo(chart.chartArea.left, y);
                ctx.lineTo(chart.chartArea.right, y);
                ctx.stroke();
                ctx.fillStyle = '#DC3545';
                ctx.font = '11px Arial';
                ctx.fillText(`Drempel ${drempel}%`, chart.chartArea.right - 80, y - 5);
                ctx.restore();
            }
        }],
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: '%' } } }
        }
    });
}

/* ══════════════════════════════════════════════════════════════════
   PAGE: DRUKKERIJ (recap drukkerij + grafieken drukkerij)
   ══════════════════════════════════════════════════════════════════ */
async function loadDrukkerij() {
    const container = document.getElementById('drukkerij-content');
    container.innerHTML = '<div class="loading">Data laden...</div>';
    try {
        const result = await api(`/api/productie?van=${state.periode.van}&tot=${state.periode.tot}&machinegroep=drukkerij`);
        renderSectieDetail(result.data, container, 'Drukkerij', 'druk');
    } catch (e) {
        container.innerHTML = `<div class="empty-state">Kon data niet laden.<br><small>${e.message}</small></div>`;
    }
}

/* ══════════════════════════════════════════════════════════════════
   PAGE: VOUWERIJ (recap vouwerij + grafieken vouwerij)
   ══════════════════════════════════════════════════════════════════ */
async function loadVouwerij() {
    const container = document.getElementById('vouwerij-content');
    container.innerHTML = '<div class="loading">Data laden...</div>';
    try {
        const result = await api(`/api/productie?van=${state.periode.van}&tot=${state.periode.tot}&machinegroep=vouwerij`);
        renderSectieDetail(result.data, container, 'Vouwerij', 'vouw');
    } catch (e) {
        container.innerHTML = `<div class="empty-state">Kon data niet laden.<br><small>${e.message}</small></div>`;
    }
}

/* ══════════════════════════════════════════════════════════════════
   SHARED: Recap table + Charts for Drukkerij/Vouwerij
   Reproduces the key charts from:
   - recap drukkerij / recap vouwerij (aantallen, uren, snelheid per machine)
   - grafieken drukkerij / grafieken vouwerij (bar + line charts)
   ══════════════════════════════════════════════════════════════════ */
function renderSectieDetail(data, container, title, prefix) {
    if (data.length === 0) {
        container.innerHTML = '<div class="empty-state">Geen data beschikbaar voor deze periode.</div>';
        return;
    }

    // Store raw data for vestiging switching
    state[`_sectieData_${prefix}`] = data;

    // Determine available vestigingen
    const vestigingen = [...new Set(data.map(r => r.vestiging).filter(Boolean))].sort();

    // Build vestiging tabs
    const tabsHtml = `
        <div class="vestiging-tabs" id="${prefix}-vest-tabs">
            <button class="vest-tab active" data-vest="alle" onclick="switchVestiging('${prefix}', 'alle')">Alle</button>
            ${vestigingen.map(v => `<button class="vest-tab" data-vest="${v}" onclick="switchVestiging('${prefix}', '${v}')">${v}</button>`).join('')}
        </div>`;

    container.innerHTML = tabsHtml + `<div id="${prefix}-vest-content"></div>`;
    renderSectieVestiging(prefix, 'alle', title);
}

function switchVestiging(prefix, vestiging) {
    // Update active tab
    const tabs = document.querySelectorAll(`#${prefix}-vest-tabs .vest-tab`);
    tabs.forEach(t => t.classList.toggle('active', t.dataset.vest === vestiging));
    const title = prefix === 'druk' ? 'Drukkerij' : 'Vouwerij';
    renderSectieVestiging(prefix, vestiging, title);
}

function renderSectieVestiging(prefix, vestiging, title) {
    const allData = state[`_sectieData_${prefix}`];
    const data = vestiging === 'alle' ? allData : allData.filter(r => r.vestiging === vestiging);
    const vestLabel = vestiging === 'alle' ? 'Alle vestigingen' : vestiging;
    const subContainer = document.getElementById(`${prefix}-vest-content`);

    if (data.length === 0) {
        subContainer.innerHTML = `<div class="empty-state">Geen data voor ${vestLabel}.</div>`;
        return;
    }

    // Aggregate per machine
    const machines = {};
    data.forEach(r => {
        const code = r.planplaats_code;
        if (!machines[code]) {
            machines[code] = { code, naam: r.planplaats_naam, vestiging: r.vestiging,
                productie: 0, cnt_totaal: 0, cnt_stellen: 0, cnt_draaien: 0, cnt_fout: 0, omzet: 0,
                prod_ploeg1: 0, prod_ploeg2: 0, prod_ploeg3: 0,
                cnt_ploeg1: 0, cnt_ploeg2: 0, cnt_ploeg3: 0 };
        }
        const m = machines[code];
        m.productie += r.productie_totaal || 0;
        m.cnt_totaal += r.centiuren_totaal || 0;
        m.cnt_stellen += r.centiuren_stellen || 0;
        m.cnt_draaien += r.centiuren_draaien || 0;
        m.cnt_fout += r.centiuren_foute_bewerking || 0;
        m.omzet += r.omzet || 0;
        m.prod_ploeg1 += r.productie_ploeg1 || 0;
        m.prod_ploeg2 += r.productie_ploeg2 || 0;
        m.prod_ploeg3 += r.productie_ploeg3 || 0;
        m.cnt_ploeg1 += r.centiuren_ploeg1 || 0;
        m.cnt_ploeg2 += r.centiuren_ploeg2 || 0;
        m.cnt_ploeg3 += r.centiuren_ploeg3 || 0;
    });

    const machineList = Object.values(machines)
        .filter(m => m.productie > 0 || m.cnt_totaal > 0)
        .sort((a, b) => a.code.localeCompare(b.code));

    // Totaalrij berekenen
    const totaal = machineList.reduce((t, m) => {
        t.productie += m.productie; t.cnt_totaal += m.cnt_totaal;
        t.cnt_stellen += m.cnt_stellen; t.cnt_draaien += m.cnt_draaien;
        t.cnt_fout += m.cnt_fout; t.omzet += m.omzet;
        return t;
    }, { productie: 0, cnt_totaal: 0, cnt_stellen: 0, cnt_draaien: 0, cnt_fout: 0, omzet: 0 });
    const totSnelheid = totaal.cnt_draaien > 0 ? totaal.productie / totaal.cnt_draaien : 0;
    const totStelPct = totaal.cnt_totaal > 0 ? (totaal.cnt_stellen / totaal.cnt_totaal) * 100 : 0;

    // Recap table
    const rows = machineList.map(m => {
        const snelheid = m.cnt_draaien > 0 ? m.productie / m.cnt_draaien : 0;
        const stelPct = m.cnt_totaal > 0 ? (m.cnt_stellen / m.cnt_totaal) * 100 : 0;
        return `<tr>
            <td class="clickable" onclick="showMachineDetail('${m.code}')">${m.code}</td>
            <td>${m.naam}</td>${vestiging === 'alle' ? `<td>${m.vestiging}</td>` : ''}
            <td class="num">${formatNumber(m.productie)}</td>
            <td class="num">${formatNumber(m.cnt_totaal, 2)}</td>
            <td class="num">${formatNumber(m.cnt_draaien, 2)}</td>
            <td class="num">${formatNumber(m.cnt_stellen, 2)}</td>
            <td class="num">${formatNumber(snelheid, 0)}</td>
            <td class="num">${formatPercent(stelPct)}</td>
            <td class="num">${formatCurrency(m.omzet)}</td>
        </tr>`;
    }).join('');

    const totaalRow = `<tr class="totaal-row">
        <td colspan="${vestiging === 'alle' ? 3 : 2}"><strong>Totaal ${vestLabel}</strong></td>
        <td class="num"><strong>${formatNumber(totaal.productie)}</strong></td>
        <td class="num"><strong>${formatNumber(totaal.cnt_totaal, 2)}</strong></td>
        <td class="num"><strong>${formatNumber(totaal.cnt_draaien, 2)}</strong></td>
        <td class="num"><strong>${formatNumber(totaal.cnt_stellen, 2)}</strong></td>
        <td class="num"><strong>${formatNumber(totSnelheid, 0)}</strong></td>
        <td class="num"><strong>${formatPercent(totStelPct)}</strong></td>
        <td class="num"><strong>${formatCurrency(totaal.omzet)}</strong></td>
    </tr>`;

    // Unique chart IDs per vestiging to avoid conflicts
    const cid = `${prefix}-${vestiging.toLowerCase().replace(/\s/g, '')}`;
    const detailId = `${cid}-detail`;

    subContainer.innerHTML = `
        <div class="chart-row">
            <div class="card chart-card">
                <div class="card-title">Productie per machine</div>
                <div class="chart-container"><canvas id="${cid}-chart-productie"></canvas></div>
            </div>
            <div class="card chart-card">
                <div class="card-title">Gemiddelde snelheid vs. norm</div>
                <div class="chart-container"><canvas id="${cid}-chart-snelheid"></canvas></div>
            </div>
        </div>

        <div class="chart-row">
            <div class="card chart-card">
                <div class="card-title">Uren verdeling per machine (draaien / stellen)</div>
                <div class="chart-container"><canvas id="${cid}-chart-uren"></canvas></div>
            </div>
            <div class="card chart-card">
                <div class="card-title">Productie per ploeg</div>
                <div class="chart-container"><canvas id="${cid}-chart-ploeg"></canvas></div>
            </div>
        </div>

        <div class="chart-row">
            <div class="card chart-card">
                <div class="card-title">Stelpercentage per machine</div>
                <div class="chart-container"><canvas id="${cid}-chart-stelpct"></canvas></div>
            </div>
            <div class="card chart-card empty-chart-card"></div>
        </div>

        <div class="detail-toggle" onclick="toggleDetail('${detailId}')">
            <span class="toggle-icon" id="${detailId}-icon">&#9654;</span>
            Detailtabel ${title} — ${vestLabel}
        </div>
        <div class="detail-panel" id="${detailId}" style="display:none;">
            <div class="card">
                <div class="card-title">Recap ${title} — ${vestLabel} — ${state.periode.van} t/m ${state.periode.tot}</div>
                <div class="data-table-wrapper">
                    <table class="data-table"><thead><tr>
                        <th>Code</th><th>Machine</th>${vestiging === 'alle' ? '<th>Vestiging</th>' : ''}
                        <th>Productie</th><th>Uren totaal</th><th>Uren draaien</th>
                        <th>Uren stellen</th>
                        <th>Gem. snelheid</th><th>Stel %</th><th>Omzet</th>
                    </tr></thead><tbody>${rows}${totaalRow}</tbody></table>
                </div>
            </div>
        </div>
    `;

    if (typeof Chart === 'undefined' || machineList.length === 0) return;
    renderSectieCharts(cid, machineList);
}

function renderSectieCharts(cid, machineList) {
    const labels = machineList.map(m => m.naam.replace(/ (Alkmaar|Uitgeest)/, ''));
    const normenMap = {};
    state.normen.forEach(n => { normenMap[n.planplaats_code] = n; });

    // Vestiging-kleur per bar (Alkmaar = donkerblauw, Uitgeest = lichtblauw)
    const barColors = machineList.map(m => m.vestiging === 'Uitgeest' ? '#6BAED6' : '#1B3A5C');

    // Klik op bar → machine detail
    const chartOnClick = (evt, elements) => {
        if (elements.length > 0) {
            const idx = elements[0].index;
            if (machineList[idx]) showMachineDetail(machineList[idx].code);
        }
    };

    // Chart 1: Productie aantallen per machine (horizontal bar)
    createChart(`${cid}-chart-productie`, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label: 'Productie', data: machineList.map(m => m.productie), backgroundColor: barColors }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            onClick: chartOnClick, onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
            plugins: { legend: { display: false } },
            scales: { x: { ticks: { callback: v => formatNumber(v) } } }
        }
    });

    // Chart 2: Snelheid vs norm (grouped bar)
    const snelheden = machineList.map(m => m.cnt_draaien > 0 ? Math.round(m.productie / m.cnt_draaien) : 0);
    const normSnelheden = machineList.map(m => {
        const n = normenMap[m.code];
        return n ? n.norm_snelheid : null;
    });

    createChart(`${cid}-chart-snelheid`, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Werkelijk', data: snelheden, backgroundColor: barColors },
                { label: 'Norm', data: normSnelheden, backgroundColor: 'rgba(220,53,69,0.3)', borderColor: '#DC3545', borderWidth: 2, borderDash: [5,5] },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: chartOnClick, onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
            plugins: { legend: { position: 'top' } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'stuks/uur' } } }
        }
    });

    // Chart 3: Uren gestapeld (draaien / stellen per machine)
    createChart(`${cid}-chart-uren`, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Draaien', data: machineList.map(m => m.cnt_draaien), backgroundColor: '#28A745', stack: 'uren' },
                { label: 'Stellen', data: machineList.map(m => m.cnt_stellen), backgroundColor: '#FFC107', stack: 'uren' },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: chartOnClick, onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
            plugins: { legend: { position: 'top' } },
            scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'uren' } } }
        }
    });

    // Chart 4: Productie per ploeg (grouped bar)
    createChart(`${cid}-chart-ploeg`, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Nacht', data: machineList.map(m => m.prod_ploeg1), backgroundColor: '#1B3A5C' },
                { label: 'Ochtend', data: machineList.map(m => m.prod_ploeg2), backgroundColor: '#2E75B6' },
                { label: 'Middag', data: machineList.map(m => m.prod_ploeg3), backgroundColor: '#6BAED6' },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: chartOnClick, onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
            plugins: { legend: { position: 'top' } },
            scales: { y: { ticks: { callback: v => formatNumber(v) } } }
        }
    });

    // Chart 5: Stelpercentage per machine (bar + drempellijn)
    const stelData = machineList.map(m => m.cnt_totaal > 0 ? Math.round((m.cnt_stellen / m.cnt_totaal) * 1000) / 10 : 0);
    const drempel = 30;

    createChart(`${cid}-chart-stelpct`, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Stelpercentage', data: stelData,
                  backgroundColor: stelData.map(v => v > drempel ? '#DC3545' : v > 20 ? '#FFC107' : '#28A745') },
            ]
        },
        plugins: [{
            id: 'drempellijn',
            afterDraw(chart) {
                const yScale = chart.scales.y;
                const ctx = chart.ctx;
                const y = yScale.getPixelForValue(drempel);
                ctx.save();
                ctx.strokeStyle = '#DC3545';
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]);
                ctx.beginPath();
                ctx.moveTo(chart.chartArea.left, y);
                ctx.lineTo(chart.chartArea.right, y);
                ctx.stroke();
                ctx.fillStyle = '#DC3545';
                ctx.font = '11px Arial';
                ctx.fillText(`Drempel ${drempel}%`, chart.chartArea.right - 80, y - 5);
                ctx.restore();
            }
        }],
        options: {
            responsive: true, maintainAspectRatio: false,
            onClick: chartOnClick, onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: '%' } } }
        }
    });

    // Load normen if not yet loaded
    loadNormenForSectieCharts(cid, machineList);
}

async function loadNormenForSectieCharts(cid, machineList) {
    if (state.normen.length > 0) return;
    try {
        state.normen = await api('/api/normen');
        const labels = machineList.map(m => m.naam.replace(/ (Alkmaar|Uitgeest)/, ''));
        const snelheden = machineList.map(m => m.cnt_draaien > 0 ? Math.round(m.productie / m.cnt_draaien) : 0);
        const normMap2 = {};
        state.normen.forEach(n => { normMap2[n.planplaats_code] = n; });
        const normSnelheden = machineList.map(m => { const n = normMap2[m.code]; return n ? n.norm_snelheid : null; });
        const barColors = machineList.map(m => m.vestiging === 'Uitgeest' ? '#6BAED6' : '#1B3A5C');

        createChart(`${cid}-chart-snelheid`, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Werkelijk', data: snelheden, backgroundColor: barColors },
                    { label: 'Norm', data: normSnelheden, backgroundColor: 'rgba(220,53,69,0.3)', borderColor: '#DC3545', borderWidth: 2 },
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: { y: { beginAtZero: true, title: { display: true, text: 'stuks/uur' } } }
            }
        });
    } catch(e) { /* ignore */ }
}

/* ══════════════════════════════════════════════════════════════════
   PAGE: BEHEER
   ══════════════════════════════════════════════════════════════════ */
async function loadBeheer() {
    if (!state.beheerUnlocked) {
        showBeheerLogin();
        return;
    }
    await Promise.all([loadNormen(), loadInstellingen()]);
}

function showBeheerLogin() {
    const container = document.querySelector('#page-beheer');
    const subtabs = container.querySelector('.subtabs');
    const contents = container.querySelectorAll('.subtab-content');
    if (subtabs) subtabs.style.display = 'none';
    contents.forEach(c => c.style.display = 'none');

    let loginDiv = document.getElementById('beheer-login');
    if (!loginDiv) {
        loginDiv = document.createElement('div');
        loginDiv.id = 'beheer-login';
        loginDiv.className = 'beheer-login-card';
        container.appendChild(loginDiv);
    }
    loginDiv.style.display = 'flex';
    loginDiv.innerHTML = `
        <div class="card beheer-login-inner">
            <div class="card-title">Beheer — Toegang beveiligd</div>
            <p style="color:var(--gray-text);margin-bottom:16px;">Voer het wachtwoord in om toegang te krijgen tot de beheeromgeving.</p>
            <div class="form-row" style="gap:10px;">
                <input type="password" id="beheer-ww" placeholder="Wachtwoord" style="padding:10px 14px;border:1px solid #dde;border-radius:8px;font-size:14px;width:260px;"
                    onkeydown="if(event.key==='Enter') verifyBeheerWw()">
                <button class="btn-primary" onclick="verifyBeheerWw()">Inloggen</button>
            </div>
            <div id="beheer-login-error" style="color:var(--red);margin-top:10px;font-size:13px;"></div>
        </div>
    `;
    setTimeout(() => document.getElementById('beheer-ww')?.focus(), 100);
}

async function verifyBeheerWw() {
    const ww = document.getElementById('beheer-ww').value;
    const errEl = document.getElementById('beheer-login-error');
    if (!ww) { errEl.textContent = 'Vul een wachtwoord in.'; return; }
    try {
        const resp = await fetch('/api/auth/verify', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ wachtwoord: ww })
        });
        if (resp.ok) {
            state.beheerUnlocked = true;
            const loginDiv = document.getElementById('beheer-login');
            if (loginDiv) loginDiv.style.display = 'none';
            const container = document.querySelector('#page-beheer');
            const subtabs = container.querySelector('.subtabs');
            const activeContent = container.querySelector('.subtab-content.active');
            if (subtabs) subtabs.style.display = '';
            container.querySelectorAll('.subtab-content').forEach(c => c.style.display = '');
            // Only show active tab content
            container.querySelectorAll('.subtab-content').forEach(c => {
                c.style.display = c.classList.contains('active') ? '' : '';
            });
            await Promise.all([loadNormen(), loadInstellingen()]);
        } else {
            errEl.textContent = 'Onjuist wachtwoord.';
            document.getElementById('beheer-ww').value = '';
            document.getElementById('beheer-ww').focus();
        }
    } catch(e) {
        errEl.textContent = 'Fout bij verificatie: ' + e.message;
    }
}

async function loadNormen() {
    try {
        state.normen = await api('/api/normen');
        renderNormen();
    } catch (e) { document.getElementById('normen-table').innerHTML = '<div class="empty-state">Kon normen niet laden.</div>'; }
}

function renderNormen() {
    const container = document.getElementById('normen-table');
    const editCell = (id, field, val, type='number', step='1') => {
        const display = val != null ? (type === 'date' ? val : formatNumber(val, type === 'pct' ? 1 : (step === '0.01' ? 2 : 0))) : '-';
        const inputType = type === 'date' ? 'date' : 'number';
        const inputVal = val != null ? val : '';
        return `<td class="num editable" onclick="editNormCell(this, ${id}, '${field}', '${inputType}', '${step}')" title="Klik om te bewerken">${display}</td>`;
    };
    const rows = state.normen.map(n => `
        <tr>
            <td>${n.planplaats_code}</td><td>${n.planplaats_naam || '-'}</td><td>${n.vestiging || '-'}</td>
            ${editCell(n.id, 'norm_omzet_per_dienst', n.norm_omzet_per_dienst, 'number', '0.01')}
            ${editCell(n.id, 'norm_snelheid', n.norm_snelheid, 'number', '1')}
            ${editCell(n.id, 'norm_stelpercentage', n.norm_stelpercentage, 'pct', '0.1')}
            ${editCell(n.id, 'norm_bezetting', n.norm_bezetting, 'pct', '0.1')}
            ${editCell(n.id, 'geldig_vanaf', n.geldig_vanaf, 'date', '')}
            <td><button class="btn-danger" onclick="deleteNorm(${n.id})">Verwijder</button></td>
        </tr>`).join('');
    container.innerHTML = `<div class="data-table-wrapper"><table class="data-table"><thead><tr>
        <th>Code</th><th>Machine</th><th>Vestiging</th><th>Norm omzet/dienst</th><th>Norm snelheid</th>
        <th>Norm stel%</th><th>Norm bezetting</th><th>Geldig vanaf</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function editNormCell(td, normId, field, inputType, step) {
    if (td.querySelector('input')) return; // al in edit mode
    const norm = state.normen.find(n => n.id === normId);
    if (!norm) return;
    const oldVal = norm[field];
    const input = document.createElement('input');
    input.type = inputType;
    if (step) input.step = step;
    input.value = oldVal != null ? oldVal : '';
    input.className = 'norm-edit-input';
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    const save = async () => {
        const newVal = input.value;
        const parsedVal = inputType === 'date' ? newVal : (newVal ? parseFloat(newVal) : null);
        if (parsedVal === oldVal || (parsedVal === null && oldVal === null)) { loadNormen(); return; }
        const update = { ...norm };
        delete update.id;
        update[field] = parsedVal;
        await apiPut(`/api/normen/${normId}`, update);
        loadNormen();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { loadNormen(); }
    });
}

async function addNorm() {
    const code = document.getElementById('norm-code').value;
    const geldig = document.getElementById('norm-geldig').value;
    if (!code || !geldig) { alert('Vul minimaal code en geldig-vanaf in'); return; }
    await apiPost('/api/normen', {
        planplaats_code: code,
        norm_omzet_per_dienst: parseFloat(document.getElementById('norm-omzet').value) || null,
        norm_snelheid: parseFloat(document.getElementById('norm-snelheid').value) || null,
        norm_stelpercentage: parseFloat(document.getElementById('norm-stel').value) || null,
        norm_bezetting: parseFloat(document.getElementById('norm-bezetting').value) || null,
        geldig_vanaf: geldig,
    });
    loadNormen();
    document.querySelectorAll('#norm-form input').forEach(i => i.value = '');
}

async function deleteNorm(id) {
    if (!confirm('Weet u zeker dat u deze norm wilt verwijderen?')) return;
    await apiDelete(`/api/normen/${id}`);
    loadNormen();
}

async function loadInstellingen() {
    try {
        state.instellingen = await api('/api/instellingen');
        renderInstellingen();
    } catch (e) { document.getElementById('instellingen-content').innerHTML = '<div class="empty-state">Kon instellingen niet laden.</div>'; }
}

function renderInstellingen() {
    const container = document.getElementById('instellingen-content');
    container.innerHTML = state.instellingen.map(s => `
        <div class="form-row">
            <label style="min-width:250px;padding:8px 0;font-size:14px;">${s.label || s.key}</label>
            <input type="text" id="setting-${s.key}" value="${s.value}" style="width:150px;">
            <button class="btn-small" onclick="saveSetting('${s.key}')">Opslaan</button>
        </div>`).join('');
}

async function saveSetting(key) {
    await apiPut(`/api/instellingen/${key}`, { value: document.getElementById(`setting-${key}`).value });
    alert('Instelling opgeslagen');
}

async function loadPlanplaatsen() {
    try {
        state.planplaatsen = await api('/api/planplaatsen');
        const select = document.getElementById('norm-code');
        if (select) state.planplaatsen.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.code; opt.textContent = `${p.code} - ${p.naam}`;
            select.appendChild(opt);
        });
        // Also preload normen
        state.normen = await api('/api/normen');
    } catch (e) { /* ignore */ }
}
