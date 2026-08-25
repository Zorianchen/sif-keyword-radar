# SIF Keyword Radar

一个面向 Amazon 卖家的 ASIN 关键词与竞品联查网站。当前内置了本次通过 `sif-mcp` 抓取的意大利站真实数据快照：

- 品名：吸音板搁板-白-2PC
- 站点：IT
- ASIN：B0GXZZBYLS、B0GWD3D5ZN、B0GWL49C3T、B0GLH4YMRB
- 数据更新至：2026-08-19

## 启动

```powershell
npm start
```

然后打开 <http://127.0.0.1:4173>。

项目无第三方运行依赖，只使用 Node.js 内置模块。

## SIF MCP 配置

网站服务端会自动读取 Codex 已有的 `~/.codex/config.toml`：

```toml
[mcp_servers.sif_mcp]
enabled = true
url = "https://mcp.sif.com/mcp"
```

认证头仍保留在 Codex 配置中，服务端只在请求 SIF 时读取，不会通过 API 下发给浏览器，也不会复制到项目文件。默认 ASIN 组合直接使用最近一次已验证快照；输入其他 ASIN 时调用 SIF MCP 实时反查。

也可以点击页面右上角的「MCP 配置」，手动输入 SIF MCP Key。网站会先验证连接，再通过 Windows DPAPI 以当前用户身份加密保存到 `data/sif-mcp.local.enc`；API 不会回显 Key，该文件也已加入 `.gitignore`。

如需改用自建 HTTP Bridge，可用环境变量覆盖：

```powershell
$env:SIF_MCP_BRIDGE_URL = "https://your-server.example.com/sif/query"
$env:SIF_MCP_BRIDGE_TOKEN = "your-server-side-token"
npm start
```

网站会向该地址发送：

```json
{
  "productName": "吸音板搁板-白-2PC",
  "country": "IT",
  "period": "lately:30",
  "asins": ["B0GXZZBYLS"],
  "workflow": "asin-keywords-and-competitors"
}
```

Bridge 应返回与 `data/live-snapshot.json` 同结构的数据。密钥只放在服务端环境变量中，不会暴露给浏览器。

## 查询链路

1. 输入 ASIN 关键词信号：近 7/30 天或指定月份。
2. 精准词根发现同款/流量竞品。
3. 对竞品批量反查关键词。
4. 使用双实体硬门槛：关键词必须同时包含搁板功能词与吸音板对象词，才可进入精准产品池。
5. 输出精准词、高流量词、长尾词、排除词和 CSV。

对于“吸音板搁板”这类配件，`pannelli fonoassorbenti` 只表示安装对象。它可以用于 Listing 语义，但不能因为搜索量大就进入广告推荐；需要 `mensola / mensole / scaffale / shelf` 等功能词共同出现。

## AI Listing 配置

右上角「AI 模型」支持以下 OpenAI Chat Completions 兼容预设：

- DeepSeek：`https://api.deepseek.com` / `deepseek-v4-flash`
- 智谱 GLM：`https://open.bigmodel.cn/api/paas/v4` / `glm-5.2`
- Kimi：`https://api.moonshot.cn/v1` / `kimi-k3`
- 自定义：任意可信的公网 HTTPS Base URL 和模型名称

配置时会进行一次最小模型调用，验证成功后使用 Windows DPAPI 加密保存到 `data/ai-model.local.enc`。Key 不会由配置查询接口回显。生成 Listing 时只发送当前查询的商品参数、已验证关键词、趋势数据与竞品标题。

AI 成稿包含目标站点语言标题、五点、产品描述和后台 Search Terms。服务端会复核指定的高相关流量词；缺失时先要求模型修正，仍缺失的词会补入后台 Search Terms。前端会高亮所有命中的流量词并显示搜索量和嵌入位置。

Google Trends 官方 API 目前处于申请制 Alpha。网站暂以 SIF 周搜索趋势作为 AI 趋势依据，并在趋势模块保留官方申请入口，不接入不稳定的非官方爬虫。
