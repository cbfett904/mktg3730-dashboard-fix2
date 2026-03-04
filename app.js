/**
 * Static dashboard powered by local data.json (exported from your Excel workbook)
 * Filters: Class, Platform, Team + search
 * Sort: click column headers (Shift+click to add secondary sort)
 */

const DATA_URL = "./data.json";

const el = (id) => document.getElementById(id);
const normalize = (s) => String(s ?? "").trim().toLowerCase();
const isNumberLike = (v) => v != null && v !== "" && !isNaN(Number(String(v).replace(/,/g,"")));

const state = {
  headers: [],
  rows: [],
  filtered: [],
  sort: [] // [{key, dir}] dir: 1 asc, -1 desc
};

let brandChart = null;
let platformChart = null;
let totalsChart = null;

function setStatus(msg){ el("status").textContent = msg; }

function uniqSorted(arr){
  return Array.from(new Set(arr.filter(v => String(v ?? "").trim() !== ""))).sort((a,b)=>String(a).localeCompare(String(b), undefined, {numeric:true}));
}

function buildSelect(selectEl, values, allLabel){
  selectEl.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = allLabel;
  selectEl.appendChild(o0);

  values.forEach(v => {
    const o = document.createElement("option");
    o.value = String(v);
    o.textContent = String(v);
    selectEl.appendChild(o);
  });
}

function toNumber(v){
  if (v == null) return 0;
  const s = String(v).replace(/,/g,"").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function getKeyCaseInsensitive(obj, wanted){
  // return actual key in obj matching wanted (case-insensitive)
  const keys = Object.keys(obj);
  const w = normalize(wanted);
  return keys.find(k => normalize(k) === w) || null;
}

function kpiCard(label, value){
  const div = document.createElement("div");
  div.className = "kpi";
  div.innerHTML = `<div class="kpi__label">${label}</div><div class="kpi__value">${value}</div>`;
  return div;
}

function renderKpis(rows){
  const wrap = el("kpis");
  wrap.innerHTML = "";

  wrap.appendChild(kpiCard("Rows", rows.length.toLocaleString()));

  const sample = rows[0] || {};
  const keyUp2 = getKeyCaseInsensitive(sample, "UP2 Followers");
  const keyGrowth = getKeyCaseInsensitive(sample, "Follower Growth");
  const keyReach2 = getKeyCaseInsensitive(sample, "UP2 Reach");
  const keyInter2 = getKeyCaseInsensitive(sample, "UP2 Interactions");

  const sumIf = (k) => k ? rows.reduce((a,r)=>a + toNumber(r[k]), 0) : null;

  const up2 = sumIf(keyUp2);
  const growth = sumIf(keyGrowth);
  const reach2 = sumIf(keyReach2);
  const inter2 = sumIf(keyInter2);

  if (up2 != null) wrap.appendChild(kpiCard("UP2 Followers (sum)", up2.toLocaleString()));
  if (growth != null) wrap.appendChild(kpiCard("Follower Growth (sum)", growth.toLocaleString()));
  if (reach2 != null) wrap.appendChild(kpiCard("UP2 Reach (sum)", reach2.toLocaleString()));
  if (inter2 != null) wrap.appendChild(kpiCard("UP2 Interactions (sum)", inter2.toLocaleString()));
}

function applySort(rows){
  if (!state.sort.length) return rows;
  const sorted = [...rows];
  sorted.sort((a,b)=>{
    for (const s of state.sort){
      const av = a[s.key];
      const bv = b[s.key];

      // numeric if both look numeric
      const num = isNumberLike(av) && isNumberLike(bv);
      let cmp = 0;
      if (num){
        cmp = toNumber(av) - toNumber(bv);
      } else {
        cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, {numeric:true, sensitivity:"base"});
      }
      if (cmp !== 0) return cmp * s.dir;
    }
    return 0;
  });
  return sorted;
}

function renderTable(headers, rows){
  const table = el("table");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const tr = document.createElement("tr");
  headers.forEach(h => {
    const th = document.createElement("th");
    th.dataset.key = h;

    const active = state.sort.find(s => s.key === h);
    const arrow = active ? (active.dir === 1 ? "▲" : "▼") : "";

    th.innerHTML = `${h || "(blank)"} <span class="sort">${arrow}</span>`;
    th.addEventListener("click", (e)=>{
      const isShift = e.shiftKey;
      toggleSort(h, isShift);
      applyFilters();
    });

    tr.appendChild(th);
  });
  thead.appendChild(tr);

  rows.forEach(r => {
    const trb = document.createElement("tr");
    headers.forEach(h => {
      const td = document.createElement("td");
      const v = r[h];
      td.textContent = v == null ? "" : String(v);
      trb.appendChild(td);
    });
    tbody.appendChild(trb);
  });

  el("rowCount").textContent = `${rows.length} rows`;
}

function toggleSort(key, additive){
  const existingIndex = state.sort.findIndex(s => s.key === key);
  if (!additive) state.sort = [];

  if (existingIndex === -1){
    state.sort.push({ key, dir: 1 });
  } else {
    const existing = state.sort[existingIndex];
    if (existing.dir === 1) existing.dir = -1;
    else {
      // remove sort
      state.sort.splice(existingIndex, 1);
    }
  }
}

function renderCharts(rows){
  // Platform counts
  const platKey = "Platform";
  const byPlat = new Map();
  rows.forEach(r=>{
    const p = String(r[platKey] ?? "Unknown").trim() || "Unknown";
    byPlat.set(p, (byPlat.get(p)||0) + 1);
  });

  const pLabels = Array.from(byPlat.keys());
  const pValues = pLabels.map(k=>byPlat.get(k));

  const ctxPlat = el("platformChart").getContext("2d");
  if (platformChart) platformChart.destroy();
  platformChart = new Chart(ctxPlat, {
    type: "bar",
    data: { labels: pLabels, datasets: [{ label: "Rows", data: pValues }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  // Brand chart: Follower Growth (preferred) or UP2 Followers
  const sample = rows[0] || {};
  const keyBrand = getKeyCaseInsensitive(sample, "Brand Page") || "Brand Page";
  const keyGrowth = getKeyCaseInsensitive(sample, "Follower Growth");
  const keyUp2 = getKeyCaseInsensitive(sample, "UP2 Followers");

  const metricKey = keyGrowth || keyUp2;
  const metricLabel = keyGrowth ? "Follower Growth" : (keyUp2 ? "UP2 Followers" : null);

  const byBrand = new Map();
  if (metricKey && keyBrand){
    rows.forEach(r=>{
      const b = String(r[keyBrand] ?? "Unknown").trim() || "Unknown";
      byBrand.set(b, (byBrand.get(b)||0) + toNumber(r[metricKey]));
    });
  }

  const brands = Array.from(byBrand.keys());
  // Sort by value desc, take top 12 to keep readable
  brands.sort((a,b)=> (byBrand.get(b)||0) - (byBrand.get(a)||0));
  const topBrands = brands.slice(0, 12);
  const topValues = topBrands.map(b=>byBrand.get(b));

  const ctxBrand = el("brandChart").getContext("2d");
  if (brandChart) brandChart.destroy();
  brandChart = new Chart(ctxBrand, {
    type: "bar",
    data: { labels: topBrands, datasets: [{ label: metricLabel || "Metric", data: topValues }] },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // Totals chart: show a few sums if present
  const keysWanted = ["UP1 Followers","UP2 Followers","Follower Growth","UP2 Reach","UP2 Interactions","UP2 Views"];
  const totalsLabels = [];
  const totalsValues = [];

  keysWanted.forEach(w=>{
    const k = getKeyCaseInsensitive(sample, w);
    if (k){
      const sum = rows.reduce((a,r)=>a + toNumber(r[k]), 0);
      totalsLabels.push(w);
      totalsValues.push(sum);
    }
  });

  const ctxTotals = el("totalsChart").getContext("2d");
  if (totalsChart) totalsChart.destroy();
  totalsChart = new Chart(ctxTotals, {
    type: "line",
    data: { labels: totalsLabels, datasets: [{ label: "Totals", data: totalsValues, tension: 0.25 }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function applyFilters(){
  const q = normalize(el("search").value);
  const c = el("filterClass").value;
  const p = el("filterPlatform").value;
  const t = el("filterTeam").value;

  const filtered = state.rows.filter(r=>{
    if (c && String(r["Class"] ?? "") !== c) return false;
    if (p && String(r["Platform"] ?? "") !== p) return false;
    if (t && String(r["Team"] ?? "") !== t) return false;

    if (q){
      let ok = false;
      for (const h of state.headers){
        if (normalize(r[h]).includes(q)){ ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  });

  const sorted = applySort(filtered);
  state.filtered = sorted;

  renderKpis(sorted);
  renderCharts(sorted);
  renderTable(state.headers, sorted);
}

function clearFilters(){
  el("search").value = "";
  el("filterClass").value = "";
  el("filterPlatform").value = "";
  el("filterTeam").value = "";
  state.sort = [];
  applyFilters();
}

async function loadData(){
  try{
    setStatus("Loading data.json…");
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load data.json (${res.status})`);
    const payload = await res.json();
    const rows = payload.rows || [];

    if (!rows.length) throw new Error("data.json has no rows.");

    state.rows = rows;
    state.headers = Object.keys(rows[0]);

    // Build filter options
    buildSelect(el("filterClass"), uniqSorted(rows.map(r=>r["Class"])), "All classes");
    buildSelect(el("filterPlatform"), uniqSorted(rows.map(r=>r["Platform"])), "All platforms");
    buildSelect(el("filterTeam"), uniqSorted(rows.map(r=>r["Team"])), "All teams");

    setStatus(`Loaded ${rows.length} rows from Excel export.`);
    applyFilters();
  } catch(err){
    console.error(err);
    setStatus("Error: " + (err?.message || String(err)));
  }
}

function downloadFilteredCsv(){
  const headers = state.headers;
  const rows = state.filtered;

  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };

  const lines = [];
  lines.push(headers.map(esc).join(","));
  rows.forEach(r => lines.push(headers.map(h=>esc(r[h])).join(",")));

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mktg3730_filtered.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function init(){
  el("btnReload").addEventListener("click", loadData);
  el("btnDownloadCsv").addEventListener("click", downloadFilteredCsv);
  el("btnClear").addEventListener("click", clearFilters);

  ["search","filterClass","filterPlatform","filterTeam"].forEach(id=>{
    el(id).addEventListener("input", applyFilters);
    el(id).addEventListener("change", applyFilters);
  });

  loadData();
}

document.addEventListener("DOMContentLoaded", init);
