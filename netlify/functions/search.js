// Netlify Function: 地区搜索代理
// 源站搜索接口本身带 CORS(*)，但为统一走同源 /api 并隐藏上游细节，这里做一层服务端代理。
const BASE = "https://mirror-earth.com";
const UA = "Mozilla/5.0";

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
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
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      return json(502, { error: `上游返回 ${res.status}` });
    }
    const data = await res.json();
    return json(200, data);
  } catch (err) {
    return json(502, { error: "请求上游失败：" + (err && err.message ? err.message : String(err)) });
  }
};
