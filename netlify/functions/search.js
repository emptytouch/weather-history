// Netlify Function: 地区搜索代理
// 源站搜索接口本身带 CORS(*)，但为统一走同源 /api 并隐藏上游细节，这里做一层服务端代理。
const BASE = "https://mirror-earth.com";
// 完整 Chrome UA + 浏览器化请求头，降低被上游 WAF 按"裸 UA"拦截的概率
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function reqHeaders(json) {
  return {
    "User-Agent": UA,
    "Accept": json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  };
}

function causeOf(err) {
  const c = err && err.cause;
  if (!c) return "";
  return " (" + (c.code || c.message || String(c)) + ")";
}

function json(statusCode, body, extraHeaders = {}) {
  // 成功响应可缓存；错误响应禁止缓存（避免把 502 缓存住误导用户）
  const cache = statusCode === 200 ? "public, max-age=3600" : "no-store";
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

// 处理 CORS 预检
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
  const text = (q.text || "").trim();
  if (!text) {
    return json(400, { error: "缺少参数 text（地区名称）" });
  }

  try {
    const url = `${BASE}/api/region/search?text=${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: reqHeaders(true), redirect: "follow" });
    if (!res.ok) {
      return json(502, { error: `上游返回 HTTP ${res.status}` });
    }
    const data = await res.json();
    return json(200, data);
  } catch (err) {
    return json(502, { error: "请求上游失败：" + (err && err.message ? err.message : String(err)) + causeOf(err) });
  }
};
