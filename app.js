/**
 * MKTG 3730 Social Tracker Dashboard
 * - Static (no build step)
 * - Reads a *published* Google Sheet tab (pubhtml) using the gviz JSON endpoint
 * - Auto-detects common columns (date/team/platform/impressions/reach/engagements/clicks)
 */

const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS_JaWleEWAT2HEcl8j5ZMrv2XVivukkgOr_Xfbqw8K47Q1VJj2i61QaWnb6yOoGA/pubhtml?gid=1827516309&single=true";
const DEFAULT_GID = "1827516309";

const el = (id) => document.getElementById(id);

const state = {
  headers: [],
  rows: [],          // array of objects
  filtered: [],
  col: { date: null, team: null, platform: null, impressions: null, reach: null, engagements: null, clicks: null }
};

let trendChart = null;
let platformChart = null;

function setStatus(msg) {
  el("status").textContent = msg;
}

function normalize(s) {
  return String(s ?? "").trim().toLowerCase();
}

function detectColumns(headers) {
  const h = headers.map(x => normalize(x));

  const findIdx = (preds) => {
    for (let i = 0; i < h.length; i++) {
      for (const p of preds) {
        if (p instanceof RegExp) {
          if (p.test(h[i])) return i;
        } else {
          if (h[i].includes(p)) return i;
        }
      }
    }
    return null;
  };

  // generous matching (students name columns differently)
  return {
    date: findIdx([/^date$/, "post date", "day", "week of", "timestamp"]),
    team: findIdx(["team", "brand", "client", "group", "account"]),
    platform: findIdx(["platform", "channel", "network"]),
    impressions: findIdx(["impression", "impr"]),
    reach: findIdx(["reach"]),
    engagements: findIdx(["engagement", "engage", "interactions", "likes+comments", "likes & comments", "likes", "comments", "shares"]),
    clicks: findIdx(["click", "link clicks", "website clicks", "tap", "profile visits"])
  };
}

function toNumber(v) {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(v) {
  // Accept ISO, US formats, or Google date strings. If fails, return null.
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();

  // Some gviz dates come as "Date(2026,2,1)" style; but we mostly receive formatted strings.
  const m = s.match(/^Date\((\d+),(\d+),(\d+)\)/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    return new Date(y, mo, d);
  }

  const d1 = new Date(s);
  if (!isNaN(d1.getTime())) return d1;

  // Try MM/DD/YYYY
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m2) {
    const mm = Number(m2[1]) - 1;
    const dd = Number(m2[2]);
    const yy = Number(m2[3]);
    const yyyy = yy < 100 ? 2000 + yy : yy;
    const d2 = new Date(yyyy, mm, dd);
    if (!isNaN(d2.getTime())) return d2;
  }

  return null;
}

function formatDateKey(d) {
  // YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function gvizUrlFromPubhtml(pubhtmlUrl, gid) {
  // Convert:
  //  https://docs.google.com/spreadsheets/d/e/<PUB_ID>/pubhtml?gid=...&single=true
  // to:
  //  https://docs.google.com/spreadsheets/d/e/<PUB_ID>/gviz/tq?tqx=out:json&gid=...
  const u = new URL(pubhtmlUrl);
  const m = u.pathname.match(/\/spreadsheets\/d\/e\/([^/]+)\//);
  if (!m) throw new Error("Could not detect the published sheet id in the URL. Make sure it looks like .../spreadsheets/d/e/<id>/pubhtml");
  const pubId = m[1];
  const g = gid || u.searchParams.get("gid") || "";
  if (!g) throw new Error("No gid provided. Paste a pubhtml URL that includes ?gid=... or fill in the GID field.");
  return `https://docs.google.com/spreadsheets/d/e/${pubId}/gviz/tq?tqx=out:json&gid=${encodeURIComponent(g)}`;
}

async function fetchWithCache(url, cacheMinutes) {
  const mins = Number(cacheMinutes);
  const cacheKey = "mktg3730_cache_" + url;
  if (mins > 0) {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      try {
        const obj = JSON.parse(raw);
        if (Date.now() - obj.savedAt < mins * 60 * 1000) {
          return obj.payload;
        }
      } catch {}
    }
  }

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fetch failed (${res.status}). ${text.slice(0, 120)}`);
  }
  const text = await res.text();

  if (mins > 0) {
    localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload: text }));
  }
  return text;
}

function parseGvizResponse(text) {
  // gviz returns something like:
  //  /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Unexpected gviz response format.");
  const json = text.slice(start, end + 1);
  const data = JSON.parse(json);

  const cols = data?.table?.cols ?? [];
  const rows = data?.table?.rows ?? [];

  const headers = cols.map(c => c.label || c.id || "");
  const out = rows.map(r => (r.c || []).map(cell => (cell ? (cell.f ?? cell.v) : "")));

  return { headers, out };
}

function rowsToObjects(headers, outRows) {
  const objects = [];
  for (const arr of outRows) {
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = arr[i] ?? "";
    objects.push(obj);
  }
  return objects;
}

function buildSelectOptions(selectEl, values, labelAll) {
  selectEl.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = labelAll;
  selectEl.appendChild(optAll);

  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function renderTable(headers, rows) {
  const thead = el("table").querySelector("thead");
  const tbody = el("table").querySelector("tbody");

  thead.innerHTML = "";
  tbody.innerHTML = "";

  const trh = document.createElement("tr");
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h || "(blank)";
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  rows.forEach(r => {
    const tr = document.createElement("tr");
    headers.forEach(h => {
      const td = document.createElement("td");
      const v = r[h];
      td.textContent = v == null ? "" : String(v);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  el("rowCount").textContent = `${rows.length} rows`;
}

function renderKpis(rows) {
  const kpis = el("kpis");
  kpis.innerHTML = "";

  const add = (label, value) => {
    const div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML = `<div class="kpi__label">${label}</div><div class="kpi__value">${value}</div>`;
    kpis.appendChild(div);
  };

  const cols = state.col;

  const totalPosts = rows.length;
  const sum = (idx) => {
    if (idx == null) return null;
    const key = state.headers[idx];
    return rows.reduce((acc, r) => acc + toNumber(r[key]), 0);
  };

  const impressions = sum(cols.impressions);
  const reach = sum(cols.reach);
  const engagements = sum(cols.engagements);
  const clicks = sum(cols.clicks);

  add("Rows / posts", totalPosts.toLocaleString());

  if (impressions != null) add("Impressions", impressions.toLocaleString());
  if (reach != null) add("Reach", reach.toLocaleString());
  if (engagements != null) add("Engagements", engagements.toLocaleString());
  if (clicks != null) add("Clicks", clicks.toLocaleString());

  // If none detected, show “columns detected” instead.
  if (impressions == null && reach == null && engagements == null && clicks == null) {
    const detected = Object.entries(cols)
      .filter(([k,v]) => v != null)
      .map(([k,v]) => k)
      .join(", ") || "none";
    add("Detected fields", detected);
  }
}

function metricForTrend() {
  const cols = state.col;
  if (cols.impressions != null) return { label: "Impressions", idx: cols.impressions };
  if (cols.reach != null) return { label: "Reach", idx: cols.reach };
  if (cols.engagements != null) return { label: "Engagements", idx: cols.engagements };
  if (cols.clicks != null) return { label: "Clicks", idx: cols.clicks };
  return { label: "Posts", idx: null };
}

function renderCharts(rows) {
  // TREND
  const m = metricForTrend();
  const dateIdx = state.col.date;
  const metricKey = m.idx == null ? null : state.headers[m.idx];

  const byDay = new Map(); // key -> sum
  for (const r of rows) {
    let d = null;
    if (dateIdx != null) d = parseDate(r[state.headers[dateIdx]]);
    const key = d ? formatDateKey(d) : "Unknown date";
    const add = metricKey ? toNumber(r[metricKey]) : 1;
    byDay.set(key, (byDay.get(key) || 0) + add);
  }

  // Sort keys: keep Unknown last
  const keys = Array.from(byDay.keys()).sort((a,b) => {
    if (a === "Unknown date") return 1;
    if (b === "Unknown date") return -1;
    return a.localeCompare(b);
  });
  const values = keys.map(k => byDay.get(k));

  const ctxTrend = el("trendChart").getContext("2d");
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctxTrend, {
    type: "line",
    data: { labels: keys, datasets: [{ label: m.label, data: values, tension: 0.25 }] },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // PLATFORM MIX
  const platIdx = state.col.platform;
  const byPlat = new Map();
  if (platIdx != null) {
    const keyName = state.headers[platIdx];
    for (const r of rows) {
      const p = String(r[keyName] ?? "").trim() || "Unknown";
      byPlat.set(p, (byPlat.get(p) || 0) + 1);
    }
  } else {
    byPlat.set("Unknown (no platform column)", rows.length);
  }

  const pLabels = Array.from(byPlat.keys());
  const pValues = pLabels.map(k => byPlat.get(k));

  const ctxPlat = el("platformChart").getContext("2d");
  if (platformChart) platformChart.destroy();
  platformChart = new Chart(ctxPlat, {
    type: "bar",
    data: { labels: pLabels, datasets: [{ label: "Rows", data: pValues }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function applyFilters() {
  const q = normalize(el("search").value);
  const team = el("filterTeam").value;
  const platform = el("filterPlatform").value;
  const from = el("dateFrom").value ? new Date(el("dateFrom").value + "T00:00:00") : null;
  const to = el("dateTo").value ? new Date(el("dateTo").value + "T23:59:59") : null;

  const dateIdx = state.col.date;
  const teamIdx = state.col.team;
  const platIdx = state.col.platform;

  const dateKey = dateIdx != null ? state.headers[dateIdx] : null;
  const teamKey = teamIdx != null ? state.headers[teamIdx] : null;
  const platKey = platIdx != null ? state.headers[platIdx] : null;

  const headers = state.headers;

  const filtered = state.rows.filter(r => {
    if (team && teamKey && String(r[teamKey] ?? "") !== team) return false;
    if (platform && platKey && String(r[platKey] ?? "") !== platform) return false;

    if ((from || to) && dateKey) {
      const d = parseDate(r[dateKey]);
      if (d) {
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
    }

    if (q) {
      // search any cell
      let ok = false;
      for (const h of headers) {
        if (normalize(r[h]).includes(q)) { ok = true; break; }
      }
      if (!ok) return false;
    }

    return true;
  });

  state.filtered = filtered;

  renderKpis(filtered);
  renderCharts(filtered);
  renderTable(state.headers, filtered);
}

function downloadFilteredCsv() {
  const headers = state.headers;
  const rows = state.filtered;

  const escapeCsv = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  const lines = [];
  lines.push(headers.map(escapeCsv).join(","));
  rows.forEach(r => lines.push(headers.map(h => escapeCsv(r[h])).join(",")));

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

function clearFilters() {
  el("search").value = "";
  el("filterTeam").value = "";
  el("filterPlatform").value = "";
  el("dateFrom").value = "";
  el("dateTo").value = "";
  applyFilters();
}

async function loadData() {
  try {
    setStatus("Loading sheet…");

    const pubhtml = el("sheetUrl").value.trim();
    const gid = el("gid").value.trim();
    const cacheMins = el("cacheMins").value;

    const url = gvizUrlFromPubhtml(pubhtml, gid);
    const raw = await fetchWithCache(url, cacheMins);
    const { headers, out } = parseGvizResponse(raw);

    state.headers = headers;
    state.rows = rowsToObjects(headers, out);
    state.col = detectColumns(headers);

    // Build filter options
    const teamIdx = state.col.team;
    const platIdx = state.col.platform;

    const teams = teamIdx == null ? [] : Array.from(new Set(state.rows.map(r => String(r[headers[teamIdx]] ?? "").trim()).filter(Boolean))).sort();
    const plats = platIdx == null ? [] : Array.from(new Set(state.rows.map(r => String(r[headers[platIdx]] ?? "").trim()).filter(Boolean))).sort();

    buildSelectOptions(el("filterTeam"), teams, teamIdx == null ? "No team column detected" : "All teams");
    buildSelectOptions(el("filterPlatform"), plats, platIdx == null ? "No platform column detected" : "All platforms");

    // Default date range based on data (if we can)
    const dateIdx = state.col.date;
    if (dateIdx != null) {
      const key = headers[dateIdx];
      const dates = state.rows.map(r => parseDate(r[key])).filter(Boolean).sort((a,b)=>a-b);
      if (dates.length) {
        el("dateFrom").placeholder = formatDateKey(dates[0]);
        el("dateTo").placeholder = formatDateKey(dates[dates.length - 1]);
      }
    }

    setStatus(`Loaded ${state.rows.length} rows. Detected: ` +
      Object.entries(state.col).filter(([k,v]) => v != null).map(([k]) => k).join(", ") || "no standard columns"
    );

    applyFilters();
  } catch (err) {
    console.error(err);
    setStatus("Error: " + (err?.message || String(err)));
  }
}

function init() {
  // Prefill from URL params if present
  const params = new URLSearchParams(location.search);
  el("sheetUrl").value = params.get("sheet") || DEFAULT_SHEET_URL;
  el("gid").value = params.get("gid") || DEFAULT_GID;

  el("btnReload").addEventListener("click", loadData);
  el("btnDownloadCsv").addEventListener("click", downloadFilteredCsv);
  el("btnClear").addEventListener("click", clearFilters);

  ["search","filterTeam","filterPlatform","dateFrom","dateTo"].forEach(id => {
    el(id).addEventListener("input", applyFilters);
    el(id).addEventListener("change", applyFilters);
  });

  loadData();
}

document.addEventListener("DOMContentLoaded", init);
