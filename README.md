# SIF Keyword Radar

一个面向 Amazon 卖家的 ASIN 关键词与竞品联查网站。当前内置了本次通过 `sif-mcp` 抓取的意大利站真实数据快照：

- 品名：吸音板搁板-白-2PC
- 站点：IT
- ASIN：B0GXZZBYLS、B0GWD3D5ZN、B0GWL49C3T、B0GLH4YMRB
- 数据更新至：2026-08-19

## 启动

```powershell
$env:APP_USERNAME = "yusen"
$env:APP_PASSWORD = "replace-with-a-private-password"
npm start
```

然后打开 <http://127.0.0.1:4188>，未登录时会自动跳转到 `/login`。

项目无第三方运行依赖，只使用 Node.js 内置模块。

## 登录保护

主页面、静态资源和业务 API 默认全部需要登录，只有 `/login`、`/api/auth/*` 与 `/api/health` 可匿名访问。账号由 `APP_USERNAME` 设置，密码由 `APP_PASSWORD` 设置；密码不会写入项目、浏览器存储或 GitHub。登录成功后服务端签发 12 小时有效的签名 HttpOnly Cookie，连续失败 8 次会限制该 IP 15 分钟。

`APP_PASSWORD` 未设置时应用保持锁定，任何人都无法进入主页面。会话签名密钥与 SIF/AI 加密配置共用服务器本机的 `data/config-secret.local`，迁移服务器时需要一起备份。

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
4. 项目内部端口填写 `4188`（避开你服务器上已经使用过的 4173、4174 和 4317）。在宝塔项目环境变量中设置 `APP_USERNAME` 和 `APP_PASSWORD`；不要把真实密码写入 `.env.example` 或代码。
5. 确保 `www` 用户对 `data/` 目录有写权限，然后启动项目。首次登录后，在右上角「MCP 配置」和「AI 模型」中自行输入 Key，服务器会自动创建本机加密密钥。
6. 如需直接使用公网 IP 根地址，让 Nginx 监听 `119.29.247.91:80`，反向代理到 `http://127.0.0.1:4188`。访问地址为 `http://119.29.247.91/`，腾讯云安全组放行 TCP 80，不要放行内部端口 4188。端口 80 只能由一个默认站点占用，已有站点时需先调整冲突。
7. Nginx 代理必须传递 `Host`、`X-Real-IP`、`X-Forwarded-For` 和 `X-Forwarded-Proto`。生产环境强烈建议绑定域名并启用 SSL/HTTPS；HTTP 会明文传输登录密码和 SIF/AI Key，不适合长期使用。

公网 IP 的 Nginx 核心配置示例：

```nginx
server {
    listen 80;
    server_name 119.29.247.91;

    location / {
        proxy_pass http://127.0.0.1:4188;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`data/config-secret.local` 与两个 `.enc` 文件是一套，迁移或重装时要一起备份；丢失本机密钥后，已保存的 SIF/AI Key 无法解密，只能重新输入。高级用户仍可通过至少 32 字符的 `SIF_CONFIG_SECRET` 固定主密钥，但普通宝塔部署不需要设置。`.env.example` 只提供变量名称，不包含任何真实密钥。
