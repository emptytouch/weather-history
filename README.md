# 历史天气查询系统

一个静态网站 + Netlify Functions，用于拉取 [镜像地球](https://mirror-earth.com/wea_history) 的历史天气数据，
支持**地区搜索、时间段筛选（7/15/30 天、本月、上月、自定义）、表格查看、温度趋势图、导出 Excel**。

## 为什么需要 Netlify Functions

源站提供两类接口：

| 接口 | 说明 | CORS |
| --- | --- | --- |
| `/api/region/search?text=<地名>` | 地区搜索（返回 `id`） | ✅ `Access-Control-Allow-Origin: *` |
| `/wea_history/<id>/<YYYY-MM>` | 月度历史天气（HTML 内嵌数据） | ❌ 无 CORS 头 |

月度数据以「并行数组」形式内嵌在页面 HTML 的 RSC 流中（字段：`iso_dates` / `t2m_max_num` / `t2m_min_num` /
`precipitation` / `humidity_num` / `wind_max_num` / `sunshine_num`）。由于该页面不带 CORS 头，
**浏览器无法直接跨域抓取**，因此用 Netlify Functions 在服务端抓取并解析为干净 JSON 返回，前端只消费 JSON。

> 搜索接口本身带 CORS，但为统一路径与隐藏上游细节，同样走了函数代理。

## 目录结构

```
weather-history/
├── index.html              # 前端页面
├── styles.css              # 样式
├── app.js                  # 前端逻辑（搜索/时间段/表格/图表/导出）
├── vendor/
│   └── xlsx.full.min.js    # 本地化的 SheetJS（Excel 导出，离线可用）
├── netlify/
│   └── functions/
│       ├── search.js       # 地区搜索代理
│       └── history.js      # 月度历史抓取 + 解析 + 合并
├── netlify.toml            # 发布目录 / 函数目录 / /api 重定向
├── package.json
└── test/
    └── functions-test.mjs  # 本地端到端测试（真实拉取 + 解析校验）
```

## 本地开发

```bash
# 1) 安装 Netlify CLI（仅需一次）
npm install -g netlify-cli

# 2) 启动本地服务（自动托管静态文件并运行 Functions）
netlify dev
# 打开 http://localhost:8888
```

仅做数据层验证（不启本地服务）也可：

```bash
npm test        # 真实请求源站并校验解析结果
```

## 部署到 Netlify

**方式一（推荐）：连接 Git 仓库**
1. 把本目录推到 GitHub/GitLab。
2. 在 Netlify 新建站点 → 关联该仓库。
3. 构建设置保持默认即可（`publish = "."`，Functions 目录已配置）。
4. 部署完成后访问分配的域名。

**方式二：Netlify CLI**
```bash
netlify deploy --prod --dir=.
```

> ⚠️ 直接「拖拽文件夹」到 Netlify 只能发布静态文件，**不会包含 Functions**，
> 网站会因 `/api/*` 无法解析而无法查询。请使用上述 Git 连接或 CLI 方式。

## 使用说明

1. 在「选择地区」输入**中文**地名（如 `犍为`、`北京`、`乐山`），点击搜索。
   - 源站搜索按中文匹配，拼音（如 `qianwei`）无效。
2. 从结果列表中选择具体地区（同名地区会标注所属上级，如 `四川省 / 乐山市`）。
3. 在「选择时间段」点击预设（最近 7/15/30 天、本月、上月）或自定义起止日期。
4. 选中地区后会自动查询；也可手动点「查询」。
5. 查看汇总统计、温度趋势图与明细表格，点击「导出 Excel」下载 `.xlsx`。

## 已知限制

- 源站历史数据存在延迟（通常非当月或当月下旬才完整），若所选月份返回空，界面会提示缺失。
- 月度数据为数值型指标，源站未提供逐日「天气状况（晴/多云/雨）」文字字段，故导出列均为数值指标。
- 数据版权归镜像地球所有，本工具仅用于学习与研究。
