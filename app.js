// 历史天气查询 - 前端逻辑（原生 JS，无构建步骤）
(function () {
  "use strict";

  // 优先走 /api 重定向；本地用 netlify dev 时亦可回退到函数原始路径
  async function apiFetch(path, params) {
    const qs = params ? "?" + new URLSearchParams(params) : "";
    const candidates = ["/api" + path + qs, "/.netlify/functions" + path + qs];
    let lastErr;
    for (const url of candidates) {
      try {
        const r = await fetch(url);
        if (r.ok) return await r.json();
        if (r.status === 404) { lastErr = new Error("接口不存在(404)，请确认已部署 Netlify Functions"); continue; }
        try { const j = await r.json(); lastErr = new Error(j.error || "请求失败 " + r.status); }
        catch { lastErr = new Error("请求失败 " + r.status); }
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // ---------- 日期工具 ----------
  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function lastOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

  // ---------- 状态 ----------
  const state = {
    region: null,      // { id, name, parent }
    records: [],       // 当前查询结果
    regionLabel: "",
  };

  const $ = (id) => document.getElementById(id);

  // ---------- 地区搜索 ----------
  async function doSearch() {
    const text = $("regionInput").value.trim();
    if (!text) { setStatus("请输入地区名称", "error"); return; }
    setStatus('<span class="spinner"></span>正在搜索地区…', "");
    try {
      const data = await apiFetch("/search", { text });
      const list = (data && data.data) || [];
      renderRegions(list);
      if (!list.length) setStatus("未找到匹配地区，请尝试更精确的名称（中文）", "error");
      else setStatus(`找到 ${list.length} 个匹配地区，请选择`, "ok");
    } catch (e) {
      setStatus("搜索失败：" + e.message, "error");
    }
  }

  function renderRegions(list) {
    const box = $("regionResults");
    box.innerHTML = "";
    list.forEach((item) => {
      const el = document.createElement("div");
      el.className = "region-item";
      const label = item.parent ? `${item.parent} / ${item.name}` : item.name;
      el.innerHTML = `<span class="r-name">${escapeHtml(item.name)}</span><span class="r-parent">${escapeHtml(item.parent || "")} · 级别${escapeHtml(item.level || "")}</span>`;
      el.addEventListener("click", () => selectRegion({ id: item.id, name: item.name, parent: item.parent }, label, el));
      box.appendChild(el);
    });
  }

  function selectRegion(region, label, el) {
    state.region = region;
    state.regionLabel = label || region.name;
    document.querySelectorAll(".region-item").forEach((n) => n.classList.remove("selected"));
    if (el) el.classList.add("selected");
    $("queryBtn").disabled = false;
    // 选中后自动按当前时间段查询
    doQuery();
  }

  // ---------- 时间段 ----------
  function setPreset(preset, btn) {
    document.querySelectorAll(".btn-preset").forEach((b) => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    const today = new Date();
    let start, end;
    if (preset === "7") { start = addDays(today, -6); end = today; }
    else if (preset === "15") { start = addDays(today, -14); end = today; }
    else if (preset === "30") { start = addDays(today, -29); end = today; }
    else if (preset === "thisMonth") { start = firstOfMonth(today); end = today; }
    else if (preset === "lastMonth") { const lm = addMonths(today, -1); start = firstOfMonth(lm); end = lastOfMonth(lm); }
    $("startDate").value = ymd(start);
    $("endDate").value = ymd(end);
  }

  function onCustomDate() {
    document.querySelectorAll(".btn-preset").forEach((b) => b.classList.remove("active"));
  }

  // ---------- 查询 ----------
  async function doQuery() {
    if (!state.region) { setStatus("请先选择地区", "error"); return; }
    const start = $("startDate").value;
    const end = $("endDate").value;
    if (!start || !end) { setStatus("请选择开始与结束日期", "error"); return; }
    if (start > end) { setStatus("开始日期不能晚于结束日期", "error"); return; }

    setStatus('<span class="spinner"></span>正在拉取历史天气数据…', "");
    $("exportBtn").disabled = true;
    try {
      const data = await apiFetch("/history", { id: state.region.id, start, end });
      state.records = data.records || [];
      renderResult(data);
    } catch (e) {
      setStatus("查询失败：" + e.message, "error");
    }
  }

  function renderResult(data) {
    const recs = state.records;
    $("resultCard").style.display = "";
    $("resultTitle").textContent = `查询结果 · ${state.regionLabel}`;
    $("exportBtn").disabled = recs.length === 0;

    if (!recs.length) {
      setStatus("该时间段内没有可用数据（源站可能未收录该月份，或日期超出范围）", "error");
      $("summary").innerHTML = ""; $("chartWrap").innerHTML = ""; $("tableBody").innerHTML = "";
      return;
    }

    const covered = (data.months || []).join(", ");
    const warn = (data.monthsWithData != null && data.months && data.monthsWithData < data.months.length)
      ? `（注意：请求的 ${data.months.length} 个月中仅 ${data.monthsWithData} 个月有数据，部分日期可能缺失）`
      : "";
    setStatus(`成功获取 <b>${recs.length}</b> 条记录，覆盖月份：${covered}${warn}`, "ok");

    renderSummary(recs);
    renderChart(recs);
    renderTable(recs);
  }

  function renderSummary(recs) {
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const valid = (arr) => arr.filter((v) => v != null);
    const tmaxArr = valid(recs.map((r) => r.tmax));
    const tminArr = valid(recs.map((r) => r.tmin));
    const precipArr = valid(recs.map((r) => r.precip));
    const humArr = valid(recs.map((r) => r.humidity));
    const windArr = valid(recs.map((r) => r.wind));
    const stats = [
      { label: "记录天数", value: recs.length },
      { label: "平均最高温", value: tmaxArr.length ? avg(tmaxArr).toFixed(1) + " °C" : "—" },
      { label: "平均最低温", value: tminArr.length ? avg(tminArr).toFixed(1) + " °C" : "—" },
      { label: "累计降雨量", value: precipArr.length ? precipArr.reduce((a, b) => a + b, 0).toFixed(1) + " mm" : "—" },
      { label: "平均湿度", value: humArr.length ? avg(humArr).toFixed(0) + " %" : "—" },
      { label: "最大风速", value: windArr.length ? Math.max(...windArr).toFixed(2) + " m/s" : "—" },
    ];
    $("summary").innerHTML = stats.map((s) =>
      `<div class="stat"><div class="label">${s.label}</div><div class="value">${s.value}</div></div>`
    ).join("");
  }

  function renderTable(recs) {
    const body = $("tableBody");
    body.innerHTML = recs.map((r) =>
      `<tr><td>${r.date}</td><td>${fmt(r.tmax)}</td><td>${fmt(r.tmin)}</td><td>${fmt(r.precip)}</td><td>${fmt(r.humidity)}</td><td>${fmt(r.wind)}</td><td>${fmt(r.sunshine)}</td></tr>`
    ).join("");
  }

  function fmt(v) { return v == null ? "—" : (Number.isInteger(v) ? v : v.toFixed(2)); }

  // ---------- 温度趋势图 (SVG) ----------
  function renderChart(recs) {
    const W = 640, H = 240, padL = 40, padR = 16, padT = 16, padB = 28;
    const vals = [];
    recs.forEach((r) => { if (r.tmax != null) vals.push(r.tmax); if (r.tmin != null) vals.push(r.tmin); });
    if (!vals.length) { $("chartWrap").innerHTML = ""; return; }
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = (max - min) || 1;
    const lo = min - range * 0.1, hi = max + range * 0.1;
    const n = recs.length;
    const x = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

    const line = (key, color) => {
      const pts = recs.map((r, i) => (r[key] == null ? null : `${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`)).filter(Boolean);
      if (!pts.length) return "";
      return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.join(" ")}"/>`;
    };

    // y 轴刻度
    let grid = "";
    for (let g = 0; g <= 4; g++) {
      const v = lo + (hi - lo) * (g / 4);
      const yy = y(v);
      grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="#e3e8ef" stroke-width="1"/>`;
      grid += `<text x="${padL - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b7280">${v.toFixed(0)}</text>`;
    }
    // x 轴标签：首/中/尾
    const xticks = [0, Math.floor((n - 1) / 2), n - 1].filter((i, idx, a) => a.indexOf(i) === idx);
    let xlabels = "";
    xticks.forEach((i) => {
      xlabels += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#6b7280">${recs[i].date.slice(5)}</text>`;
    });

    const svg =
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="温度趋势图">` +
      grid +
      line("tmax", "#dc2626") +
      line("tmin", "#2563eb") +
      `<circle cx="${padL - 30}" cy="14" r="4" fill="#dc2626"/><text x="${padL - 22}" y="18" font-size="12" fill="#374151">最高温</text>` +
      `<circle cx="${padL + 30}" cy="14" r="4" fill="#2563eb"/><text x="${padL + 38}" y="18" font-size="12" fill="#374151">最低温</text>` +
      xlabels +
      `</svg>`;
    $("chartWrap").innerHTML = svg;
  }

  // ---------- 导出 Excel ----------
  function exportExcel() {
    const recs = state.records;
    if (!recs.length || typeof XLSX === "undefined") { setStatus("无法导出：数据为空或 Excel 库未加载", "error"); return; }
    const header = ["日期", "最高温(°C)", "最低温(°C)", "降雨量(mm)", "湿度(%)", "最大风速(m/s)", "日照时长(h)"];
    const rows = recs.map((r) => [r.date, r.tmax, r.tmin, r.precip, r.humidity, r.wind, r.sunshine]);
    const titleRows = [
      [`历史天气数据 · ${state.regionLabel}`],
      [`查询区间：${(state.records[0] && state.records[0].date) || ""} ~ ${(state.records[recs.length - 1] && state.records[recs.length - 1].date) || ""}`],
      [`导出时间：${ymd(new Date())}`],
      [],
      header,
    ];
    const aoa = titleRows.concat(rows);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "历史天气");
    const fname = `历史天气_${state.region.name}_${recs[0].date}_${recs[recs.length - 1].date}.xlsx`;
    XLSX.writeFile(wb, fname);
  }

  // ---------- 工具 ----------
  function setStatus(html, cls) {
    const bar = $("statusBar");
    bar.innerHTML = html;
    bar.className = "status-bar" + (cls ? " " + cls : "");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- 绑定事件 ----------
  function init() {
    $("searchBtn").addEventListener("click", doSearch);
    $("regionInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
    $("queryBtn").addEventListener("click", doQuery);
    $("exportBtn").addEventListener("click", exportExcel);
    document.querySelectorAll(".btn-preset").forEach((b) => {
      b.addEventListener("click", () => setPreset(b.dataset.preset, b));
    });
    $("startDate").addEventListener("change", onCustomDate);
    $("endDate").addEventListener("change", onCustomDate);

    // 默认选中「最近30天」并填充日期
    const def = document.querySelector('.btn-preset[data-preset="30"]');
    setPreset("30", def);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
