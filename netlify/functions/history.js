// Netlify Function: 历史天气抓取与解析
// 源站 /wea_history/<id>/<YYYY-MM> 页面把整月每日天气以「并行数组」形式内嵌在 RSC 流中
// （字段：iso_dates / t2m_max_num / t2m_min_num / precipitation / humidity_num / wind_max_num / sunshine_num）。
// 该页面不带 CORS 头，浏览器无法直连，故在服务端抓取并解析为干净 JSON 返回。
const BASE = "https://mirror-earth.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function reqHeaders(json) {
  const h = {
    "User-Agent": UA,
    "Accept": json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  };
  // 非 JSON 的文档请求：补齐浏览器导航类请求头，降低被 WAF 当机器人/挑战页处理的概率
  if (!json) {
    h["sec-fetch-site"] = "none";
    h["sec-fetch-mode"] = "navigate";
    h["sec-fetch-dest"] = "document";
    h["sec-fetch-user"] = "?1";
    h["upgrade-insecure-requests"] = "1";
  }
  return h;
}

function causeOf(err) {
  const c = err && err.cause;
  if (!c) return "";
  return " (" + (c.code || c.message || String(c)) + ")";
}

function json(statusCode, body, extraHeaders = {}) {
  // 成功响应可缓存；错误响应禁止缓存（避免把 502 缓存住误导用户）
  const cache = statusCode === 200 ? "public, max-age=1800" : "no-store";
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cache,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function toNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// 从月度页面 HTML 中解析出每日天气记录
function parseMonthHtml(html) {
  const marker = "t2m_max_num";
  const mi = html.indexOf(marker);
  if (mi < 0) return null;

  // 引号在 RSC 流中全部被转义为 \"，因此所有 { 都是真实括号；向前找到对象开头
  let start = mi;
  while (start > 0 && html[start] !== "{") start--;

  const seg = html.slice(start);
  // 还原转义引号：\" -> "
  const clean = seg.split('\\"').join('"');

  // 括号配对，截出完整 JSON 对象
  let depth = 0;
  let end = -1;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return null;

  let obj;
  try {
    obj = JSON.parse(clean.slice(0, end + 1));
  } catch (e) {
    return null;
  }

  const dates = obj.iso_dates || obj.dates;
  if (!dates || !obj.t2m_max_num) return null;

  const records = dates.map((date, i) => ({
    date,
    tmax: toNum(obj.t2m_max_num[i]),
    tmin: toNum(obj.t2m_min_num[i]),
    precip: toNum(obj.precipitation[i]),
    humidity: toNum(obj.humidity_num[i]),
    wind: toNum(obj.wind_max_num[i]),
    sunshine: obj.sunshine_num ? toNum(obj.sunshine_num[i]) : null,
  }));

  return { title: obj.title || "", records };
}

// 计算覆盖 start~end 的所有 YYYY-MM（闭区间）
function monthsBetween(start, end) {
  const s = start ? new Date(start) : new Date();
  const e = end ? new Date(end) : new Date();
  const out = [];
  let y = s.getFullYear();
  let m = s.getMonth();
  const ey = e.getFullYear();
  const em = e.getMonth();
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

// 抓取单月并解析；任何失败都向上抛出（不再静默吞掉），便于定位
async function fetchMonth(id, ym) {
  const url = `${BASE}/wea_history/${encodeURIComponent(id)}/${ym}`;
  const res = await fetch(url, { headers: reqHeaders(false), redirect: "follow" });
  if (!res.ok) throw new Error("上游返回 HTTP " + res.status);
  const html = await res.text();
  const parsed = parseMonthHtml(html);
  if (!parsed) {
    // 诊断信息：帮助判断返回的是真实页面还是 WAF 挑战页 / 结构变化
    const head = html.slice(0, 600).replace(/\s+/g, " ");
    const diag =
      `htmlLen=${html.length}, type=${res.headers.get("content-type")}, ` +
      `hasT2m=${html.includes("t2m_max_num")}, hasIso=${html.includes("iso_dates")}, ` +
      `isChallenge=${/captcha|verify|challenge|uuwaf|access denied|just a moment|请输入|验证/i.test(html)}`;
    throw new Error(`页面解析失败（上游页面结构可能已变化） | ${diag} | 开头: ${head}`);
  }
  return parsed;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: "",
    };
  }

  const q = event.queryStringParameters || {};
  const id = (q.id || "").trim();
  if (!id) {
    return json(400, { error: "缺少参数 id（地区编号）" });
  }
  const start = (q.start || "").trim();
  const end = (q.end || "").trim();

  const months = monthsBetween(start || undefined, end || undefined);

  let records = [];
  let title = "";
  let okMonths = 0;
  let firstError = null;

  try {
    // allSettled：部分月份失败不影响其他月份；全部失败才报错
    const settled = await Promise.allSettled(months.map((ym) => fetchMonth(id, ym)));
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value && s.value.records.length) {
        records = records.concat(s.value.records);
        okMonths++;
        if (!title && s.value.title) title = s.value.title;
      } else if (s.status === "rejected" && !firstError) {
        firstError = s.reason;
      }
    }
  } catch (err) {
    firstError = err;
  }

  if (records.length === 0 && firstError) {
    return json(502, { error: "拉取历史数据失败：" + (firstError.message || firstError) + causeOf(firstError) });
  }

  // 按精确日期区间过滤（避免月度边界外溢）
  records = records.filter(
    (r) => (!start || r.date >= start) && (!end || r.date <= end)
  );
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return json(200, {
    id,
    start: start || null,
    end: end || null,
    title,
    months,
    monthsWithData: okMonths,
    count: records.length,
    records,
  });
};
