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

然后打开 <http://127.0.0.1:4188>。

项目无第三方运行依赖，只使用 Node.js 内置模块。

## SIF MCP 配置

网站服务端会自动读取 Codex 已有的 `~/.codex/config.toml`：

```toml
[mcp_servers.sif_mcp]
enabled = true
url = "https://mcp.sif.com/mcp"
```

认证头仍保留在 Codex 配置中，服务端只在请求 SIF 时读取，不会通过 API 下发给浏览器，也不会复制到项目文件。默认 ASIN 组合直接使用最近一次已验证快照；输入其他 ASIN 时调用 SIF MCP 实时反查。

也可以点击页面右上角的「MCP 配置」，直接输入 SIF MCP Key。官方服务地址固定为 `https://mcp.sif.com/mcp`，网站会先验证连接，再加密保存到 `data/sif-mcp.local.enc`。Windows 默认使用当前用户的 DPAPI；Linux 首次保存时会自动生成 `data/config-secret.local`，并用 AES-256-GCM 加密。API 不会回显 Key，这两个本机文件均已加入 `.gitignore`。

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

配置时会进行一次最小模型调用，验证成功后使用与 SIF 配置相同的系统加密方式保存到 `data/ai-model.local.enc`。Key 不会由配置查询接口回显。生成 Listing 时只发送当前查询的商品参数、已验证关键词、趋势数据与竞品标题。

AI 成稿包含目标站点语言标题、五点、产品描述和后台 Search Terms。服务端会复核指定的高相关流量词；缺失时先要求模型修正，仍缺失的词会补入后台 Search Terms。前端会高亮所有命中的流量词并显示搜索量和嵌入位置。

Google Trends 官方 API 目前处于申请制 Alpha。网站暂以 SIF 周搜索趋势作为 AI 趋势依据，并在趋势模块保留官方申请入口，不接入不稳定的非官方爬虫。

## 宝塔面板部署

建议使用宝塔「Node 项目」管理器和 Nginx 反向代理：

1. 服务器安装 Node.js 20 或更高版本，并在 `/www/wwwroot` 克隆本仓库。
2. 添加 Node 项目时，项目目录设为 `/www/wwwroot/sif-keyword-radar`。宝塔会读取 `package.json`，启动选项直接选择自动出现的 `start: node server.mjs`。
3. Node 版本选择已安装的 v22，运行用户选择 `www`，包管理器选择 `npm`。项目没有第三方依赖，可以勾选“不安装 node_modules”。
4. 项目内部端口填写 `4188`（避开你服务器上已经使用过的 4173、4174 和 4317）。普通单机部署无需填写任何环境变量；应用会在首次保存 SIF 或 AI Key 时自动创建本机加密密钥。
5. 确保 `www` 用户对 `data/` 目录有写权限，然后启动项目。首次打开网站后，在右上角「MCP 配置」中只需输入 SIF Key。
6. 对外访问端口不要与内部端口重复。例如让 Nginx 监听 `119.29.247.91:8088`，反向代理到 `http://127.0.0.1:4188`，访问地址就是 `http://119.29.247.91:8088`。腾讯云安全组只需放行 `8088`，不要放行内部端口 `4188`。
7. 生产环境建议使用域名、SSL 和 HTTPS。该网站可以调用付费 AI/SIF 接口，必须在宝塔中为站点配置访问密码或其他身份验证，不能直接匿名公开。

`data/config-secret.local` 与两个 `.enc` 文件是一套，迁移或重装时要一起备份；丢失本机密钥后，已保存的 SIF/AI Key 无法解密，只能重新输入。高级用户仍可通过至少 32 字符的 `SIF_CONFIG_SECRET` 固定主密钥，但普通宝塔部署不需要设置。`.env.example` 只提供变量名称，不包含任何真实密钥。
