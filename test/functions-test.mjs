// 端到端测试（数据层）：真实请求源站，校验搜索代理与历史解析/合并。
// 说明：Excel 导出逻辑在浏览器中通过 <script> 全局 XLSX 执行（标准用法），
// 已在独立 round-trip 中用官方 xlsx 包验证过写/读正确性，故此处不再涉及文件写入。
import { handler as searchHandler } from "../netlify/functions/search.js";
import { handler as historyHandler } from "../netlify/functions/history.js";

const ev = (params) => ({ httpMethod: "GET", queryStringParameters: params });

function assert(cond, msg) {
  if (!cond) { console.error("❌ FAIL:", msg); process.exitCode = 1; }
  else console.log("✅", msg);
}

// 1) 搜索
const sRes = await searchHandler(ev({ text: "犍为" }));
const sBody = JSON.parse(sRes.body);
assert(Array.isArray(sBody.data) && sBody.data.length > 0, `搜索「犍为」返回 ${sBody.data?.length} 条`);
const qianwei = sBody.data.find((d) => d.name === "犍为县");
assert(qianwei && qianwei.id, `找到 犍为县 id=${qianwei?.id}`);

// 2) 历史：整月 2026-09（应完整 30 天）
const hRes = await historyHandler(ev({ id: String(qianwei.id), start: "2026-09-01", end: "2026-09-30" }));
const hBody = JSON.parse(hRes.body);
assert(hBody.count === 30, `2026-09 整月解析出 ${hBody.count} 天（期望 30）`);
const r0 = hBody.records[0];
assert(r0 && typeof r0.tmax === "number" && typeof r0.precip === "number", `首条记录字段正常: ${JSON.stringify(r0)}`);

// 3) 跨月合并：2026-09-24 ~ 2026-10-23（覆盖两月，各月数据都参与）
const crossRes = await historyHandler(ev({ id: String(qianwei.id), start: "2026-09-24", end: "2026-10-23" }));
const cross = JSON.parse(crossRes.body);
assert(cross.months.length === 2, `跨月请求覆盖 ${cross.months.length} 个月: ${cross.months.join(",")}`);
assert(cross.count > 0 && cross.count <= 30, `跨月实际有数据 ${cross.count} 天`);
assert(cross.records[0].date.startsWith("2026-09") && cross.records[cross.records.length - 1].date.startsWith("2026-10"), "记录跨越两个月份");

console.log("\n数据层端到端测试完成。");
