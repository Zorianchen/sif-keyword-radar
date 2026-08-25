const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  data: null,
  filter: "recommended",
  search: "",
  sort: { key: "relevance", direction: "desc" },
  selected: new Set(),
  expanded: null,
  competitorScope: "seed",
  aiConfig: null,
  aiListing: null,
  activeHistoryId: null
};

const tagLabels = {
  precise: "精准购买词",
  high: "高流量词",
  core: "配件类目词",
  context: "安装对象词",
  longtail: "跨语产品词",
  exclude: "建议排除"
};

const marketLabels = {
  IT: "意大利", DE: "德国", FR: "法国", ES: "西班牙", NL: "荷兰", PL: "波兰",
  SE: "瑞典", BE: "比利时", US: "美国", UK: "英国", CA: "加拿大"
};
const marketConfig = {
  IT: { domain: "amazon.it", currency: "EUR" },
  DE: { domain: "amazon.de", currency: "EUR" },
  FR: { domain: "amazon.fr", currency: "EUR" },
  ES: { domain: "amazon.es", currency: "EUR" },
  NL: { domain: "amazon.nl", currency: "EUR" },
  PL: { domain: "amazon.pl", currency: "PLN" },
  SE: { domain: "amazon.se", currency: "SEK" },
  BE: { domain: "amazon.com.be", currency: "EUR" },
  US: { domain: "amazon.com", currency: "USD" },
  UK: { domain: "amazon.co.uk", currency: "GBP" },
  CA: { domain: "amazon.ca", currency: "CAD" }
};
const configSourceLabels = {
  "manual-encrypted": "手动 Key · Windows 已加密",
  "codex-config": "Codex 配置 · 已连接",
  environment: "环境变量 · 已连接",
  null: "尚未配置"
};
const historyStorageKey = "sif-query-history-v1";
const nonTranslationLabels = new Set(["标题核心词", "五点长尾词", "产品相关词", "语义补充词", "品牌或低相关词"]);
const listingTemplatePolicies = {
  operator: { label: "运营现行模板", title: 200, bullet: 500, description: 2000, searchTermChars: 500 },
  strict: { label: "Amazon 严格模板", title: 200, bullet: 255, description: 2000, searchTermBytes: 249 }
};

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayTranslation(item) {
  const value = String(item?.translation || "").trim();
  return !value || nonTranslationLabels.has(value) ? "待翻译" : value;
}

function displayTranslationSource(item) {
  if (item?.translationSource) return item.translationSource;
  return displayTranslation(item) === "待翻译" ? "未返回" : "已校对快照";
}

function updateHeroMarket() {
  $("#hero-market").textContent = `Amazon ${$("#country").value || "DE"}`;
}

function parseAsins() {
  const matches = $("#asin-input").value.toUpperCase().match(/B0[A-Z0-9]{8}/g) || [];
  return [...new Set(matches)];
}

function updateAsinCount() {
  const count = parseAsins().length;
  $("#asin-count").textContent = `${count} 个 ASIN`;
}

function formatNumber(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatCompact(value) {
  if (value === null || value === undefined) return "—";
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function pct(value, digits = 0) {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function validMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const currentMonth = isoDate(new Date()).slice(0, 7);
  return value >= "2020-01" && value <= currentMonth;
}

function resolvedPeriod() {
  if ($("#period-mode").value === "lately:30") return "lately:30";
  const month = $("#period-month").value.trim();
  if (!validMonth(month)) return null;
  return `month:${month}-01`;
}

function periodDetail(value) {
  if (value === "lately:30") {
    const end = state.data?.meta?.dataUpdatedThrough || isoDate(new Date());
    return { label: "最近 30 天", start: addDays(end, -29), end };
  }
  if (String(value).startsWith("month:")) {
    const start = String(value).slice(6);
    const date = new Date(`${start}T00:00:00Z`);
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    return { label: `${date.getUTCFullYear()}年${String(date.getUTCMonth() + 1).padStart(2, "0")}月`, start, end: isoDate(end) };
  }
  return { label: "所选周期", start: "—", end: "—" };
}

function renderPeriodControl() {
  const custom = $("#period-mode").value === "custom-month";
  $("#custom-month-panel").hidden = !custom;
  const input = $("#period-month");
  const month = input.value.trim();
  const valid = validMonth(month);
  input.setAttribute("aria-invalid", String(custom && !valid));
  $("#custom-month-panel").classList.toggle("invalid", custom && !valid);
  $("#period-summary").textContent = custom
    ? valid ? `查询 ${month.slice(0, 4)} 年 ${month.slice(5)} 月完整月份数据` : "请输入有效月份：yyyy-mm"
    : "查询最近 30 天流量数据";
}

function renderTemplatePolicy() {
  const input = $("#listing-template");
  if (input) input.value = "operator";
}

function amazonUrl(asin) {
  const domain = marketConfig[state.data?.query?.country]?.domain || "amazon.com";
  return `https://www.${domain}/dp/${encodeURIComponent(asin)}`;
}

function priceText(value) {
  if (value === null || value === undefined) return "—";
  const currency = marketConfig[state.data?.query?.country]?.currency || "EUR";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(value);
}

function uniqueWords(words = []) {
  return [...new Set(words.filter(Boolean))];
}

function fallbackListingBrief() {
  const products = state.data?.products || [];
  const keywords = state.data?.keywords || [];
  const eligible = keywords.filter((item) => item.bucket !== "exclude");
  const gate = state.data?.intentGate;
  const titleKeywords = eligible.filter((item) => item.bucket === "precise" || item.bucket === "core").slice(0, 6).map((item) => item.keyword);
  const titleSet = new Set(titleKeywords);
  const bulletKeywords = uniqueWords([
    ...eligible.filter((item) => item.bucket === "longtail").map((item) => item.keyword),
    ...eligible.filter((item) => (item.bucket === "precise" || item.bucket === "core") && !titleSet.has(item.keyword)).map((item) => item.keyword),
    ...eligible.filter((item) => item.bucket === "context").map((item) => item.keyword)
  ]).slice(0, 16);
  return {
    sourceTitle: products[0]?.title || state.data?.query?.productName || "",
    anchors: uniqueWords([...(gate?.leftTerms || []), ...(gate?.rightTerms || [])]).slice(0, 10),
    trafficAvailable: keywords.length > 0,
    titleKeywords,
    bulletKeywords,
    backendKeywords: eligible.slice(0, 28).map((item) => item.keyword),
    excludedKeywords: keywords.filter((item) => item.bucket === "exclude").slice(0, 8).map((item) => item.keyword)
  };
}

function currentListingBrief() {
  return state.data?.listingBrief || fallbackListingBrief();
}

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(historyStorageKey) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function historyIdentity(entry) {
  return JSON.stringify([entry.productName || "", entry.productDetails || "", entry.listingTemplate || "operator", entry.ownBrand || "", entry.forbiddenTerms || "", entry.country, entry.period, entry.asins]);
}

function saveHistory(request, result) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    productName: request.productName,
    productDetails: request.productDetails || "",
    listingTemplate: request.listingTemplate || "operator",
    ownBrand: request.ownBrand || "",
    forbiddenTerms: request.forbiddenTerms || "",
    country: request.country,
    period: request.period,
    asins: request.asins,
    resultCount: result.keywords.length,
    mode: result.mode,
    result
  };
  const identity = historyIdentity(entry);
  const history = [entry, ...readHistory().filter((item) => historyIdentity(item) !== identity)].slice(0, 20);
  for (let length = history.length; length > 0; length -= 1) {
    try {
      localStorage.setItem(historyStorageKey, JSON.stringify(history.slice(0, length)));
      break;
    } catch {
      // 浏览器存储空间不足时，优先保留最近的完整结果。
    }
  }
  renderHistory();
  return entry.id;
}

function historyPeriodLabel(value) {
  if (value === "lately:30") return "最近 30 天";
  if (String(value).startsWith("month:")) return `${String(value).slice(6, 13)} 自然月`;
  return value || "默认周期";
}

function historyTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}

function renderHistory() {
  const history = readHistory();
  $("#history-count").textContent = history.length;
  $("#history-clear").disabled = history.length === 0;
  $("#history-list").innerHTML = history.length ? history.map((item) => `
    <article class="history-item" data-history-id="${escapeHTML(item.id)}" tabindex="0" role="button" aria-label="${item.result ? "回看" : "重新查询"} ${escapeHTML(item.productName || item.asins?.[0] || "历史记录")}">
      <div>
        <time>${escapeHTML(historyTime(item.createdAt))} · ${escapeHTML(item.country)} · ${escapeHTML(historyPeriodLabel(item.period))}</time>
        <h3>${escapeHTML(item.productName || item.asins?.[0] || "未填写品名")}</h3>
        <p>${escapeHTML((item.asins || []).join(" · "))}<br>${formatNumber(item.resultCount || 0)} 个关键词 · ${escapeHTML(item.mode || "query")}${item.aiListing ? " · 已含 Listing" : ""}</p>
      </div>
      <button type="button" tabindex="-1">${item.aiListing ? "查看 Listing" : item.result ? "查看结果" : "重新查询"}</button>
    </article>
  `).join("") : `<div class="history-empty">完成一次查询后，记录会保存在这里。</div>`;
}

function openHistory() {
  renderHistory();
  $("#history-modal").hidden = false;
  document.body.classList.add("history-open");
  $("#history-close").focus();
}

function closeHistory() {
  $("#history-modal").hidden = true;
  document.body.classList.remove("history-open");
  $("#history-open").focus();
}

function restoreHistoryParameters(item) {
  $("#product-name").value = item.productName || "";
  $("#product-details").value = item.productDetails || item.result?.query?.productDetails || "";
  $("#listing-template").value = "operator";
  $("#own-brand").value = item.ownBrand || item.result?.query?.ownBrand || "";
  $("#forbidden-terms").value = item.forbiddenTerms || item.result?.query?.forbiddenTerms || "";
  $("#country").value = item.country;
  $("#asin-input").value = (item.asins || []).join("\n");
  if (String(item.period).startsWith("month:")) {
    $("#period-mode").value = "custom-month";
    $("#period-month").value = String(item.period).slice(6, 13);
  } else {
    $("#period-mode").value = "lately:30";
  }
  renderPeriodControl();
  renderTemplatePolicy();
  updateAsinCount();
  updateHeroMarket();
}

function openHistoryResult(id) {
  const item = readHistory().find((entry) => entry.id === id);
  if (!item) return showToast("这条历史记录已不存在。", "error");
  restoreHistoryParameters(item);
  if (!item.result) {
    closeHistory();
    runQuery();
    return;
  }

  state.data = item.result;
  state.filter = "recommended";
  state.search = "";
  state.sort = { key: "relevance", direction: "desc" };
  state.selected = new Set(item.result.keywords.filter((keyword) => keyword.bucket === "precise" || keyword.bucket === "core").map((keyword) => keyword.keyword));
  state.expanded = null;
  state.competitorScope = item.result.competitors?.length ? "traffic" : "seed";
  state.aiListing = item.aiListing || null;
  state.activeHistoryId = item.id;
  $("#keyword-search").value = "";
  $("#loading-stage").hidden = true;
  $("#results").hidden = false;
  renderAll();
  $("#form-status").textContent = `历史回看 · ${historyTime(item.createdAt)} · 未重新调用 SIF`;
  $("#connection-label").textContent = "历史结果快照";
  closeHistory();
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  showToast(item.aiListing ? "已恢复当次查询及 Listing。未重新请求 SIF 或 AI。" : "已恢复当次查询结果。未重新请求 SIF。");
}

function showToast(message, tone = "normal") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", tone === "error");
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setConfigMessage(message, tone = "normal") {
  const element = $("#config-message");
  element.textContent = message;
  element.classList.toggle("error", tone === "error");
  element.classList.toggle("success", tone === "success");
}

async function refreshConfigStatus() {
  const config = await fetch("/api/config").then((response) => response.json());
  $("#mcp-url").value = config.url || "https://mcp.sif.com/mcp";
  $("#config-state").innerHTML = `<i></i>${escapeHTML(configSourceLabels[config.source] || "已连接")}`;
  $("#config-state").classList.toggle("offline", !config.configured);
  $("#config-reset").hidden = !config.keyStored;
  $("#connection-label").textContent = config.configured
    ? config.source === "manual-encrypted" ? "SIF MCP 手动配置" : "SIF MCP 已配置"
    : "MCP 快照已就绪";
  return config;
}

async function openConfig() {
  const modal = $("#config-modal");
  modal.hidden = false;
  document.body.classList.add("config-open");
  setConfigMessage("保存前会先连接 SIF 验证 Key。");
  try {
    await refreshConfigStatus();
  } catch {
    setConfigMessage("无法读取当前配置状态。", "error");
  }
  $("#mcp-key").focus();
}

function closeConfig() {
  $("#config-modal").hidden = true;
  document.body.classList.remove("config-open");
  $("#mcp-key").value = "";
  $("#mcp-key").type = "password";
  $("#key-visibility").textContent = "显示";
  $("#config-open").focus();
}

async function saveConfig(event) {
  event.preventDefault();
  const button = $("#config-save");
  const apiKey = $("#mcp-key").value.trim();
  if (!apiKey) return setConfigMessage("请输入 SIF MCP Key。", "error");
  button.disabled = true;
  button.querySelector("span").textContent = "正在验证…";
  setConfigMessage("正在连接 SIF MCP，验证 Key 是否可用…");
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: $("#mcp-url").value.trim(), apiKey })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "配置保存失败。");
    $("#mcp-key").value = "";
    setConfigMessage(`连接成功 · ${result.server} · Key 已加密保存。`, "success");
    await refreshConfigStatus();
    showToast("SIF MCP 配置已验证并保存");
  } catch (error) {
    setConfigMessage(error.message, "error");
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "测试并保存";
  }
}

async function resetConfig() {
  const button = $("#config-reset");
  button.disabled = true;
  try {
    const response = await fetch("/api/config", { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "恢复失败。");
    await refreshConfigStatus();
    setConfigMessage("已清除手动 Key，恢复使用 Codex 中的 SIF MCP 配置。", "success");
    showToast("已恢复 Codex 配置");
  } catch (error) {
    setConfigMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function setAiConfigMessage(message, tone = "normal") {
  const element = $("#ai-config-message");
  element.textContent = message;
  element.classList.toggle("error", tone === "error");
  element.classList.toggle("success", tone === "success");
  element.classList.toggle("warning", tone === "warning");
}

function applyAiPreset(provider, { force = false } = {}) {
  const preset = state.aiConfig?.presets?.[provider];
  if (!preset) return;
  if (force || provider !== "custom") {
    $("#ai-base-url").value = preset.baseUrl || "";
    $("#ai-model").value = preset.model || "";
  }
}

async function refreshAiConfigStatus() {
  const config = await fetch("/api/ai-config").then((response) => response.json());
  state.aiConfig = config;
  $("#ai-provider").value = config.provider || "deepseek";
  $("#ai-base-url").value = config.baseUrl || "https://api.deepseek.com";
  $("#ai-model").value = config.model || "deepseek-v4-flash";
  $("#ai-config-state").innerHTML = `<i></i>${config.configured ? `${escapeHTML(config.providerLabel)} · ${escapeHTML(config.model)}` : "尚未配置"}`;
  $("#ai-config-state").classList.toggle("offline", !config.configured);
  $("#ai-config-reset").hidden = !config.keyStored;
  $("#ai-nav-state").textContent = config.configured ? config.model : "未配置";
  $("#ai-nav-state").classList.toggle("ready", config.configured);
  if ($("#ai-writer-model")) {
    $("#ai-writer-model").textContent = config.configured ? `${config.providerLabel} / ${config.model}` : "AI 尚未配置";
  }
  return config;
}

async function openAiConfig() {
  $("#ai-config-modal").hidden = false;
  document.body.classList.add("config-open");
  setAiConfigMessage("Key 会先在本机加密保存，再进行一次最小模型调用验证，可能产生极少量 Token 费用。");
  try {
    await refreshAiConfigStatus();
  } catch {
    setAiConfigMessage("无法读取当前 AI 配置。", "error");
  }
  $("#ai-api-key").focus();
}

function closeAiConfig() {
  $("#ai-config-modal").hidden = true;
  document.body.classList.remove("config-open");
  $("#ai-api-key").value = "";
  $("#ai-api-key").type = "password";
  $("#ai-key-visibility").textContent = "显示";
  $("#ai-config-open").focus();
}

async function saveAiConfig(event) {
  event.preventDefault();
  const button = $("#ai-config-save");
  const apiKey = $("#ai-api-key").value.trim();
  if (!apiKey && !state.aiConfig?.keyStored) return setAiConfigMessage("请输入当前模型的 API Key。", "error");
  button.disabled = true;
  button.querySelector("span").textContent = "正在保存并测试…";
  setAiConfigMessage("正在本机加密保存 Key，并测试 Chat Completions 连接…");
  try {
    const response = await fetch("/api/ai-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: $("#ai-provider").value,
        baseUrl: $("#ai-base-url").value.trim(),
        model: $("#ai-model").value.trim(),
        apiKey
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "AI 配置保存失败。");
    $("#ai-api-key").value = "";
    await refreshAiConfigStatus();
    renderAiWriter();
    if (result.tested) {
      setAiConfigMessage(`连接成功 · ${result.providerLabel} · ${result.model} · Key 已加密保存。`, "success");
      showToast("AI 模型已保存并通过连接测试");
    } else {
      setAiConfigMessage(`Key 与模型已保存，但连接测试失败：${result.testMessage || "请检查网络、模型名称或额度。"}`, "warning");
      showToast("AI 配置已保存，连接测试未通过", "error");
    }
  } catch (error) {
    const message = error instanceof TypeError
      ? "无法连接本地配置服务，请确认网页服务正在运行后重试。"
      : error.message;
    setAiConfigMessage(message, "error");
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "保存并测试连接";
  }
}

async function resetAiConfig() {
  const button = $("#ai-config-reset");
  button.disabled = true;
  try {
    const response = await fetch("/api/ai-config", { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "清除失败。");
    await refreshAiConfigStatus();
    renderAiWriter();
    setAiConfigMessage("AI Key 与模型配置已从本机清除。", "success");
    showToast("AI 配置已清除");
  } catch (error) {
    setAiConfigMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadingSequence(request) {
  const steps = [
    ["01 / 04", "正在反查输入 ASIN...", `读取 ${request.asins.length} 个 ASIN 的自然与广告流量词`, "18%"],
    ["02 / 04", "正在发现 3–5 个竞品...", "用高相关产品词定位真实同词竞品", "43%"],
    ["03 / 04", "正在联查竞品关键词...", "合并竞品词并读取 SIF 中文翻译", "71%"],
    ["04 / 04", "正在分配 Listing 词位...", "区分标题核心词、五点高相关/长尾词与后台 Search Terms", "94%"]
  ];
  for (const [index, title, detail, progress] of steps) {
    $("#loading-step").textContent = index;
    $("#loading-title").textContent = title;
    $("#loading-detail").textContent = detail;
    $("#loading-progress").style.width = progress;
    await wait(260);
  }
}

async function runQuery({ scroll = true } = {}) {
  const period = resolvedPeriod();
  if (!period) {
    showToast("请输入有效月份，格式为 yyyy-mm。", "error");
    $("#period-month").focus();
    return;
  }
  const request = {
    productName: $("#product-name").value.trim(),
    productDetails: $("#product-details").value.trim(),
    listingTemplate: "operator",
    ownBrand: $("#own-brand").value.trim(),
    forbiddenTerms: $("#forbidden-terms").value.trim(),
    country: $("#country").value,
    period,
    asins: parseAsins()
  };

  if (!request.asins.length) {
    showToast("请至少输入 1 个有效 ASIN。", "error");
    $("#asin-input").focus();
    return;
  }

  state.data = null;
  state.filter = "recommended";
  state.search = "";
  state.selected = new Set();
  state.expanded = null;
  state.competitorScope = "seed";
  state.aiListing = null;
  state.activeHistoryId = null;
  $("#quick-export").disabled = true;
  $("#results").hidden = true;
  $("#keyword-body").innerHTML = "";
  $("#insight-strip").innerHTML = "";
  $("#loading-stage").hidden = false;
  $("#form-status").textContent = "正在调用 SIF 查询链路...";
  if (scroll) $("#loading-stage").scrollIntoView({ behavior: "smooth", block: "center" });

  try {
    const fetchPromise = fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    const [, response] = await Promise.all([loadingSequence(request), fetchPromise]);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "查询失败");

    state.data = result;
    state.activeHistoryId = saveHistory(request, result);
    state.filter = "recommended";
    state.search = "";
    state.sort = { key: "relevance", direction: "desc" };
    state.selected = new Set(result.keywords.filter((item) => item.bucket === "precise" || item.bucket === "core").map((item) => item.keyword));
    state.expanded = null;
    state.competitorScope = result.competitors?.length ? "traffic" : "seed";
    $("#keyword-search").value = "";
    $("#loading-progress").style.width = "100%";
    renderAll();
    await wait(180);
    $("#loading-stage").hidden = true;
    $("#results").hidden = false;
    $("#form-status").textContent = result.mode === "live-empty"
      ? "查询完成 · ASIN 有效，但暂无可反查流量词"
      : result.mode === "live" ? "查询完成 · MCP 实时数据" : "查询完成 · SIF 真实数据快照";
    $("#connection-label").textContent = result.mode === "live" || result.mode === "live-empty" ? "SIF MCP 实时连接" : result.mcpConfigured ? "SIF MCP 已配置 · 快照" : "MCP 快照已就绪";
    if (scroll) $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#loading-stage").hidden = true;
    $("#form-status").textContent = "查询未完成";
    showToast(error.message, "error");
  }
}

function renderAll() {
  $("#quick-export").disabled = false;
  renderHeader();
  renderMetrics();
  renderInsights();
  renderKeywordTaxonomy();
  renderKeywords();
  renderListingBrief();
  renderAiWriter();
  renderCompetitors();
  syncTrendSelect();
  renderTrend();
  renderSources();
}

function renderHeader() {
  const { data } = state;
  const period = periodDetail(data.query.period || resolvedPeriod());
  $("#result-market").textContent = `${data.query.country} · 查询周期 ${period.start}—${period.end}`;
  $("#data-date").textContent = `数据更新 ${data.meta.dataUpdatedThrough} · T+1`;
  $("#result-count").textContent = data.keywords.length;
}

function renderMetrics() {
  const { summary, keywords, competitors } = state.data;
  const precise = keywords.filter((item) => item.bucket === "precise" || item.bucket === "core").length;
  const semantic = keywords.filter((item) => item.bucket === "context" || item.bucket === "longtail").length;
  const period = periodDetail(state.data.query.period);
  const metrics = state.data.analysisProfile === "listing" ? [
    ["输入 ASIN", `${summary.seedAsins}`, `其中 ${summary.seedAsinsWithData} 个在 ${period.label} 有流量词`],
    ["标题候选词", `${precise}`, "高相关词优先进入标题前 80 字符"],
    ["五点高相关/长尾词", `${semantic}`, "高相关长尾优先分配到五点，承接属性、场景与购买意图"],
    ["自动竞品", `${competitors.length}`, "高相关产品词发现，并已联查竞品流量词"]
  ] : [
    ["输入 ASIN", `${summary.seedAsins}`, `其中 ${summary.seedAsinsWithData} 个有近 30 天数据`],
    ["精准产品词", `${precise}`, "同时包含搁板功能词与吸音板对象词"],
    ["安装对象词", `${semantic}`, "保留语义价值，但不进入广告推荐"],
    ["自动竞品", `${competitors.length}`, "高相关产品词发现，并已联查竞品流量词"]
  ];
  $("#metric-grid").innerHTML = metrics.map((item, index) => `
    <article class="metric" data-index="0${index + 1}">
      <small>${escapeHTML(item[0])}</small>
      <strong>${escapeHTML(item[1])}<em> 个</em></strong>
      <p>${escapeHTML(item[2])}</p>
    </article>
  `).join("");
}

function keywordTagLabel(item) {
  if (state.data?.analysisProfile !== "listing") return tagLabels[item.bucket] || item.bucket;
  return {
    precise: "标题核心词",
    core: "产品相关词",
    context: "语义补充词",
    longtail: "五点长尾词",
    exclude: "品牌/低相关词"
  }[item.bucket] || item.bucket;
}

function renderKeywordTaxonomy() {
  const listing = state.data.analysisProfile === "listing";
  $("#keyword-pool-copy").textContent = listing
    ? "先验证商品语义，再按 Listing 词位比较流量、相关性和搜索量。"
    : "先用产品功能词做硬门槛，再在同一意图层内比较流量。";
  $("#legend-precise").textContent = listing ? "标题核心词" : "产品词";
  $("#legend-context").textContent = listing ? "语义补充词" : "安装对象";
  $("#legend-tail").textContent = listing ? "五点长尾词" : "跨语长尾";
  const tabText = listing
    ? { precise: "标题词", context: "语义补充词", high: "高流量", longtail: "五点长尾", exclude: "排除词", all: "全部" }
    : { precise: "产品词", context: "安装对象词", high: "高流量", longtail: "跨语长尾", exclude: "排除词", all: "全部" };
  Object.entries(tabText).forEach(([filter, label]) => {
    const button = $(`#keyword-tabs [data-filter='${filter}']`);
    if (button) button.textContent = label;
  });
  const gate = state.data.intentGate || {
    label: "精准硬门槛",
    leftTitle: "搁板功能词",
    leftTerms: ["mensola", "mensole", "scaffale", "shelf"],
    rightTitle: "吸音板对象词",
    rightTerms: ["pannello acustico", "fonoassorbente"],
    result: "产品词"
  };
  $("#gate-label").textContent = gate.label;
  $("#gate-left-title").textContent = gate.leftTitle;
  $("#gate-left-terms").textContent = (gate.leftTerms || []).join(" · ") || "等待商品档案";
  $("#gate-right-title").textContent = gate.rightTitle;
  $("#gate-right-terms").textContent = (gate.rightTerms || []).join(" · ");
  $("#gate-result").textContent = gate.result;
}

function renderInsights() {
  $("#insight-strip").innerHTML = state.data.insights.map((insight) => `
    <article class="insight ${escapeHTML(insight.tone)}">
      <i aria-hidden="true"></i>
      <div><strong>${escapeHTML(insight.title)}</strong><p>${escapeHTML(insight.body)}</p></div>
    </article>
  `).join("");
}

function matchesFilter(item) {
  const filter = state.filter;
  if (filter === "all") return true;
  if (filter === "recommended") return item.bucket === "precise" || item.bucket === "core";
  if (filter === "precise") return item.bucket === "precise" || item.bucket === "core";
  if (filter === "context") return item.bucket === "context";
  if (filter === "high") {
    if (state.data.analysisProfile === "listing") return item.volume >= 4000 && item.bucket !== "exclude";
    return item.volume >= 4000 && item.bucket === "context";
  }
  if (filter === "longtail") return item.bucket === "longtail";
  return item.bucket === filter;
}

function visibleKeywords() {
  const needle = state.search.trim().toLowerCase();
  const items = state.data.keywords.filter((item) => matchesFilter(item) && (!needle || `${item.keyword} ${item.translation}`.toLowerCase().includes(needle)));
  const { key, direction } = state.sort;
  const sign = direction === "asc" ? 1 : -1;
  return items.sort((a, b) => {
    const values = {
      keyword: [a.keyword, b.keyword],
      volume: [a.volume || 0, b.volume || 0],
      relevance: [a.relevance, b.relevance],
      coverage: [a.competitorCoverage, b.competitorCoverage]
    }[key];
    if (typeof values[0] === "string") return values[0].localeCompare(values[1]) * sign;
    return (values[0] - values[1]) * sign;
  });
}

function sourceChips(item) {
  const sources = item.competitorAsins || item.sourceAsins || [];
  if (!sources.length) return `<span class="coverage-empty">—</span>`;
  const asins = sources.slice(0, 3);
  const chips = asins.map((asin) => `<i title="${escapeHTML(asin)}">${escapeHTML(asin.slice(-2))}</i>`).join("");
  const remaining = sources.length - asins.length;
  return `<div class="coverage-chips">${chips}${remaining > 0 ? `<span>+${remaining}</span>` : ""}</div>`;
}

function renderKeywords() {
  const items = visibleKeywords();
  const body = $("#keyword-body");
  $("#recommended-count").textContent = state.data.keywords.filter((item) => item.bucket === "precise" || item.bucket === "core").length;
  $$("#keyword-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.filter === state.filter));

  if (!items.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-state">${escapeHTML(state.data.emptyReason || "没有匹配的关键词，试试切换分类或清空搜索。")}</td></tr>`;
  } else {
    body.innerHTML = items.map((item) => {
      const isExpanded = state.expanded === item.keyword;
      const scoreClass = item.relevance >= 85 ? "high-score" : item.relevance < 45 ? "low-score" : "";
      const currentNote = item.currentWeeklyVolume ? `当前 ${formatNumber(item.currentWeeklyVolume)}/周` : item.volumePeriod;
      return `
        <tr data-keyword="${encodeURIComponent(item.keyword)}">
          <td class="select-cell"><input class="row-check" type="checkbox" aria-label="选择 ${escapeHTML(item.keyword)}" ${state.selected.has(item.keyword) ? "checked" : ""}></td>
          <td class="keyword-cell">
            <div class="keyword-main"><strong>${escapeHTML(item.keyword)}</strong><span class="tag ${escapeHTML(item.bucket)}">${escapeHTML(keywordTagLabel(item))}</span></div>
            <div class="keyword-translation ${displayTranslation(item) === "待翻译" ? "missing" : ""}"><b title="翻译来源：${escapeHTML(displayTranslationSource(item))}">中译</b><span>${escapeHTML(displayTranslation(item))}</span></div>
            <small>${escapeHTML(item.intent)}</small>
          </td>
          <td class="volume"><strong>${formatNumber(item.volume)}</strong><small class="${item.volume >= 4000 ? "hot" : ""}">${escapeHTML(currentNote)}</small></td>
          <td class="relevance"><div class="relevance-line"><div class="relevance-track ${scoreClass}"><i style="width:${item.relevance}%"></i></div><b>${item.relevance}</b></div></td>
          <td>${sourceChips(item)}</td>
          <td>${pct(item.naturalRatio)}</td>
          <td class="action-text">${escapeHTML(item.recommendation)}</td>
          <td><button class="row-detail" type="button" aria-label="查看依据" aria-expanded="${isExpanded}">${isExpanded ? "−" : "+"}</button></td>
        </tr>
        ${isExpanded ? `
          <tr class="detail-row"><td colspan="8"><div class="detail-content">
            <p><strong>判定依据：</strong>${escapeHTML(item.reason)}<br><strong>趋势：</strong>${escapeHTML(item.trend)}${item.trendRate === null || item.trendRate === undefined ? "" : `（${item.trendRate > 0 ? "+" : ""}${pct(item.trendRate)}）`}${item.cpc ? ` · <strong>参考 CPC：</strong>${escapeHTML(priceText(item.cpc))}` : ""}${item.organicEvidence?.length ? `<br><strong>竞品自然位：</strong>${item.organicEvidence.map((evidence) => `${escapeHTML(evidence.asin)} #${evidence.rank}/${evidence.total}`).join(" · ")}` : ""}</p>
            <div class="detail-asins">${item.sourceAsins.map((asin) => `<a href="${escapeHTML(amazonUrl(asin))}" target="_blank" rel="noreferrer">${escapeHTML(asin)}</a>`).join("")}</div>
          </div></td></tr>
        ` : ""}
      `;
    }).join("");
  }

  $("#table-caption").textContent = `显示 ${items.length} 个关键词 · 已选 ${state.selected.size} 个`;
  $("#select-all").checked = items.length > 0 && items.every((item) => state.selected.has(item.keyword));
  $("#select-all").indeterminate = items.some((item) => state.selected.has(item.keyword)) && !items.every((item) => state.selected.has(item.keyword));
}

function listingChipMarkup(words, emptyCopy) {
  return words.length
    ? words.map((word) => `<span>${escapeHTML(word)}</span>`).join("")
    : `<em class="listing-empty">${escapeHTML(emptyCopy)}</em>`;
}

function renderListingBrief() {
  const brief = currentListingBrief();
  const hasTraffic = Boolean(brief.trafficAvailable && state.data.keywords.length);
  const titleWords = uniqueWords(brief.titleKeywords);
  const bulletWords = uniqueWords(brief.bulletKeywords);
  const backendWords = uniqueWords(brief.backendKeywords).filter((word) => !titleWords.includes(word));
  const anchors = uniqueWords(brief.anchors);
  const status = $("#listing-status");

  status.textContent = hasTraffic ? "SIF TRAFFIC VERIFIED" : "FACTS ONLY · 非流量词";
  status.classList.toggle("facts-only", !hasTraffic);
  $("#listing-title-keywords").innerHTML = listingChipMarkup(titleWords, "暂无可验证的标题流量词");
  $("#listing-bullet-keywords").innerHTML = listingChipMarkup(bulletWords, "暂无可验证的五点流量词");
  $("#listing-backend-keywords").innerHTML = listingChipMarkup(backendWords, "暂无可验证的后台流量词");
  $("#listing-source-title").textContent = brief.sourceTitle || "SIF 暂未返回商品标题";
  $("#listing-anchors").innerHTML = listingChipMarkup(anchors, "暂无商品语义锚点");
  $("#listing-note").textContent = hasTraffic
    ? "词位建议来自 SIF 真实流量信号；下方事实锚点只用于理解商品，不计作流量词。"
    : "当前只有商品档案事实，没有可验证的流量词；这些锚点可辅助写作，但不能标成高流量关键词。";
  $("#copy-title-keywords").disabled = titleWords.length === 0;
  $("#copy-backend-keywords").disabled = backendWords.length === 0;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightedCopy(value, audit = []) {
  const text = String(value || "");
  const keywords = audit.filter((item) => item.used && item.keyword).sort((a, b) => b.keyword.length - a.keyword.length);
  if (!keywords.length || !text) return escapeHTML(text);
  const byKeyword = new Map(keywords.map((item) => [item.keyword.toLocaleLowerCase(), item]));
  const pattern = new RegExp(keywords.map((item) => escapeRegExp(item.keyword)).join("|"), "giu");
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    html += escapeHTML(text.slice(cursor, match.index));
    const meta = byKeyword.get(match[0].toLocaleLowerCase());
    html += `<mark title="高相关流量词 · 搜索量 ${escapeHTML(formatNumber(meta?.volume))} · ${escapeHTML(meta?.placement || "已嵌入")}">${escapeHTML(match[0])}</mark>`;
    cursor = match.index + match[0].length;
  }
  return html + escapeHTML(text.slice(cursor));
}

function formattedDescriptionCopy(value, audit = []) {
  return String(value || "").split(/(<br\s*\/?>|<\/?b>)/giu).map((token) => {
    if (/^<br\s*\/?>$/iu.test(token)) return "<br>";
    if (/^<b>$/iu.test(token)) return "<b>";
    if (/^<\/b>$/iu.test(token)) return "</b>";
    return highlightedCopy(token, audit);
  }).join("");
}

function translatedOrPlaceholder(value) {
  return String(value || "").trim() || "当前结果暂无中文翻译，请点击“重新生成 Listing”补齐。";
}

function characterCount(value) {
  return Array.from(String(value || "")).length;
}

function utf8ByteCount(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

function countTone(value, limit) {
  if (value > limit) return "over";
  if (value >= Math.floor(limit * .9)) return "near";
  return "";
}

function setCount(selector, label, value, limit) {
  const node = $(selector);
  node.textContent = label;
  node.classList.remove("near", "over");
  const tone = countTone(value, limit);
  if (tone) node.classList.add(tone);
}

function renderAiWriter() {
  const config = state.aiConfig;
  const result = state.aiListing;
  const button = $("#generate-listing");
  $("#ai-writer-model").textContent = config?.configured ? `${config.providerLabel} / ${config.model}` : "AI 尚未配置";
  button.disabled = !state.data || !state.data.keywords?.length;
  $("#ai-writer-empty").hidden = Boolean(result);
  $("#ai-listing-output").hidden = !result;
  if (!result) return;

  const { listing, keywordAudit = [] } = result;
  const translations = listing.translations || {};
  const compliance = result.compliance || {};
  const mode = result.templateMode || compliance.templateMode
    || (compliance.limits?.searchTermBytes ? "strict" : state.data?.query?.listingTemplate)
    || "operator";
  const policy = { ...listingTemplatePolicies[mode], ...(compliance.limits || {}) };
  $("#ai-strategy-copy").textContent = listing.analysis?.strategy || "AI 已根据关键词与竞品结构生成文案。";
  const notes = [
    ...(listing.analysis?.keywordRationale || []).map((text) => ({ label: "关键词", text })),
    ...(listing.analysis?.competitorInsights || []).map((text) => ({ label: "竞品", text })),
    ...(listing.analysis?.warnings || []).map((text) => ({ label: "风险", text, warning: true }))
  ];
  $("#ai-analysis-list").innerHTML = notes.map((item) => `<p class="${item.warning ? "warning" : ""}"><b>${escapeHTML(item.label)}</b>${escapeHTML(item.text)}</p>`).join("");
  $("#ai-title-copy").innerHTML = highlightedCopy(listing.title, keywordAudit);
  $("#ai-title-translation").textContent = translatedOrPlaceholder(translations.title);
  $("#ai-bullets-copy").innerHTML = listing.bullets.map((bullet, index) => {
    const count = characterCount(bullet);
    return `<li><div class="ai-bullet-source">${highlightedCopy(bullet, keywordAudit)}</div><div class="ai-bullet-translation"><span>中文</span><p>${escapeHTML(translatedOrPlaceholder(translations.bullets?.[index]))}</p></div><em class="ai-bullet-count ${countTone(count, policy.bullet)}">${count} / ${policy.bullet}</em></li>`;
  }).join("");
  $("#ai-description-copy").innerHTML = formattedDescriptionCopy(listing.description, keywordAudit);
  $("#ai-description-translation").innerHTML = formattedDescriptionCopy(translatedOrPlaceholder(translations.description));
  $("#ai-search-terms-copy").innerHTML = highlightedCopy(listing.searchTerms, keywordAudit);
  $("#ai-search-translation").textContent = translatedOrPlaceholder(translations.searchTerms);
  const titleCount = characterCount(listing.title);
  const descriptionCount = characterCount(listing.description);
  const searchCharacters = characterCount(listing.searchTerms);
  const searchBytes = utf8ByteCount(listing.searchTerms);
  $("#ai-bullet-limit").textContent = `每点 ≤ ${policy.bullet}`;
  setCount("#ai-title-count", `${titleCount} / ${policy.title}`, titleCount, policy.title);
  setCount("#ai-description-count", `${descriptionCount} / ${policy.description}`, descriptionCount, policy.description);
  if (mode === "operator") {
    setCount("#ai-search-count", `${searchCharacters} / ${policy.searchTermChars} 字符 · ${searchBytes} bytes`, searchCharacters, policy.searchTermChars);
  } else {
    setCount("#ai-search-count", `${searchCharacters} 字符 · ${searchBytes} / ${policy.searchTermBytes} bytes`, searchBytes, policy.searchTermBytes);
  }
  const issues = Array.isArray(compliance.issues) ? compliance.issues : [];
  const blocked = Array.isArray(compliance.blockedKeywords) ? compliance.blockedKeywords : [];
  const removedTerms = Array.isArray(compliance.removedTerms) ? compliance.removedTerms : [];
  const operatorBulletFormat = listing.bullets.every((item) => /^\s*\p{Extended_Pictographic}/u.test(item) && /【[^】]{2,}】/u.test(item));
  const strictBulletFormat = listing.bullets.every((item) => !/[\[\]【】]/u.test(item) && !/\p{Extended_Pictographic}/u.test(item));
  const checks = [
    { ok: titleCount <= policy.title, text: `标题 ${titleCount}/${policy.title}` },
    { ok: listing.bullets.length === 5 && listing.bullets.every((item) => characterCount(item) <= policy.bullet), text: `五点 ${listing.bullets.length}/5，每点 ≤${policy.bullet}` },
    { ok: descriptionCount <= policy.description, text: `描述 ${descriptionCount}/${policy.description}` },
    { ok: mode === "operator" ? searchCharacters <= policy.searchTermChars : searchBytes <= policy.searchTermBytes, text: mode === "operator" ? `后台词 ${searchCharacters}/${policy.searchTermChars} 字符` : `后台词 ${searchBytes}/${policy.searchTermBytes} bytes` },
    { ok: !issues.some((item) => item.code === "forbidden-term"), text: "竞品品牌与禁用词已过滤" },
    { ok: mode === "operator" ? operatorBulletFormat : strictBulletFormat, text: mode === "operator" ? "五点包含 Emoji＋【短标题】" : "五点无 Emoji / 装饰括号" },
    { ok: mode === "operator" ? /<b>.*<\/b>/iu.test(listing.description) && /<br\s*\/?>/iu.test(listing.description) : !/<[^>]+>/u.test(listing.description), text: mode === "operator" ? "长描述保留 <b>/<br> 模板" : "长描述不含 HTML" }
  ];
  const bulletTargets = keywordAudit.filter((item) => String(item.targetPlacement || "").includes("五点"));
  const bulletTargetsUsed = bulletTargets.filter((item) => Array.isArray(item.placements) ? item.placements.includes("五点") : item.placement === "五点");
  if (bulletTargets.length) checks.splice(2, 0, {
    ok: bulletTargetsUsed.length === bulletTargets.length,
    text: `五点流量词 ${bulletTargetsUsed.length}/${bulletTargets.length} 已嵌入`
  });
  const passed = compliance.passed !== false && checks.every((item) => item.ok);
  $("#ai-compliance-state").textContent = passed ? `${policy.label}检查通过` : `${issues.length || checks.filter((item) => !item.ok).length} 项需检查`;
  $("#ai-compliance-state").classList.toggle("failed", !passed);
  $("#ai-compliance-list").innerHTML = [
    ...checks.map((item) => `<span class="${item.ok ? "" : "issue"}">${escapeHTML(item.text)}</span>`),
    ...issues.map((item) => `<span class="issue">${escapeHTML(item.message || String(item))}</span>`),
    ...(removedTerms.length ? [`<span>已从成稿移除：${escapeHTML(removedTerms.join("、"))}</span>`] : []),
    ...(blocked.length ? [`<span>已隔离 ${blocked.length} 个含品牌/风险词的流量词</span>`] : [])
  ].join("");
  const used = keywordAudit.filter((item) => item.used).length;
  $("#ai-keyword-score").textContent = `${used} / ${keywordAudit.length}`;
  $("#ai-keyword-audit-list").innerHTML = keywordAudit.map((item) => `
    <span class="${item.used ? "used" : "missing"}" title="${escapeHTML(item.translation || "")} · ${escapeHTML(item.recommendation || "")}">
      <i>${item.used ? "✓" : "!"}</i><b>${escapeHTML(item.keyword)}</b><em>${escapeHTML(formatNumber(item.volume))}/周 · 实际 ${escapeHTML(item.placement || "未使用")} · 目标 ${escapeHTML(item.targetPlacement || "前台")}${item.systemRepaired ? " · 自动补齐" : ""}</em>
    </span>
  `).join("");
  $("#ai-writer-model").textContent = `${result.providerLabel} / ${result.model} · ${result.language}`;
}

function persistAiListing(result) {
  const history = readHistory();
  const query = state.data?.query || {};
  let index = history.findIndex((item) => item.id === state.activeHistoryId);
  if (index < 0) {
    const identity = historyIdentity({
      productName: query.productName || "",
      productDetails: query.productDetails || "",
      listingTemplate: query.listingTemplate || "operator",
      ownBrand: query.ownBrand || "",
      forbiddenTerms: query.forbiddenTerms || "",
      country: query.country,
      period: query.period,
      asins: query.asins || []
    });
    index = history.findIndex((item) => historyIdentity(item) === identity);
  }
  if (index < 0) return false;

  const existing = history[index];
  history[index] = {
    ...existing,
    productName: query.productName || existing.productName || "",
    productDetails: query.productDetails || "",
    listingTemplate: query.listingTemplate || "operator",
    ownBrand: query.ownBrand || "",
    forbiddenTerms: query.forbiddenTerms || "",
    listingUpdatedAt: result.createdAt || new Date().toISOString(),
    result: {
      ...existing.result,
      query: { ...(existing.result?.query || {}), ...query }
    },
    aiListing: result
  };
  try {
    localStorage.setItem(historyStorageKey, JSON.stringify(history));
    state.activeHistoryId = history[index].id;
    renderHistory();
    return true;
  } catch {
    // 文案较长时仍保留当前页面结果，不影响使用。
    return false;
  }
}

async function generateListing() {
  if (!state.data?.keywords?.length) return showToast("请先完成一次关键词联查。", "error");
  if (!state.aiConfig?.configured) {
    showToast("请先配置 AI 模型。", "error");
    await openAiConfig();
    return;
  }
  const button = $("#generate-listing");
  const label = button.querySelector("span");
  button.disabled = true;
  button.classList.add("loading");
  label.textContent = "AI 正在生成…";
  $("#ai-writer-model").textContent = `正在调用 ${state.aiConfig.model} · 校验高流量词`;
  try {
    const productDetails = $("#product-details").value.trim();
    const listingTemplate = "operator";
    const ownBrand = $("#own-brand").value.trim();
    const forbiddenTerms = $("#forbidden-terms").value.trim();
    state.data.query.productDetails = productDetails;
    state.data.query.listingTemplate = listingTemplate;
    state.data.query.ownBrand = ownBrand;
    state.data.query.forbiddenTerms = forbiddenTerms;
    const response = await fetch("/api/ai-generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: state.data.query,
        productDetails,
        listingTemplate,
        ownBrand,
        forbiddenTerms,
        products: state.data.products,
        competitors: state.data.competitors,
        keywords: state.data.keywords,
        trends: state.data.trends,
        listingBrief: state.data.listingBrief
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "AI Listing 生成失败。");
    state.aiListing = result;
    const historySaved = persistAiListing(result);
    renderAiWriter();
    $("#ai-listing-output").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(historySaved
      ? `Listing 已生成 · ${result.keywordAudit.filter((item) => item.used).length} 个流量词已核验 · 已存入查询历史`
      : `Listing 已生成 · ${result.keywordAudit.filter((item) => item.used).length} 个流量词已核验，但历史存储空间不足`, historySaved ? "normal" : "error");
  } catch (error) {
    $("#ai-writer-model").textContent = `${state.aiConfig.providerLabel} / ${state.aiConfig.model}`;
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
    label.textContent = "重新生成 Listing";
  }
}

function aiCopyValue(field) {
  const listing = state.aiListing?.listing;
  if (!listing) return "";
  if (field === "bullets") return listing.bullets.join("\n");
  return listing[field] || "";
}

async function copyAiField(field) {
  const labels = { title: "标题", bullets: "五点", description: "产品描述", searchTerms: "后台搜索词" };
  const value = aiCopyValue(field);
  if (!value) return showToast("当前没有可复制的 AI 文案。", "error");
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  showToast(`${labels[field] || "文案"}已复制。`);
}

async function copyFullAiListing() {
  const value = [
    `TITLE\n${aiCopyValue("title")}`,
    `BULLETS\n${aiCopyValue("bullets")}`,
    `DESCRIPTION\n${aiCopyValue("description")}`,
    `SEARCH TERMS\n${aiCopyValue("searchTerms")}`
  ].join("\n\n");
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    return copyAiField("title");
  }
  showToast("完整 Listing 已复制。");
}

function renderCompetitors() {
  const seedCount = state.data.products.length;
  const trafficCount = state.data.competitors.length;
  $("#competitor-switch [data-scope='seed'] b").textContent = seedCount;
  $("#competitor-switch [data-scope='traffic'] b").textContent = trafficCount;
  $$("#competitor-switch button").forEach((button) => button.classList.toggle("active", button.dataset.scope === state.competitorScope));
  if (state.competitorScope === "seed") {
    $("#competitor-grid").innerHTML = state.data.products.map((product, index) => `
      <article class="competitor-card" data-rank="${String(index + 1).padStart(2, "0")}">
        <div class="competitor-top">
          <a href="${escapeHTML(amazonUrl(product.asin))}" target="_blank" rel="noreferrer">${escapeHTML(product.asin)} ↗</a>
          <span class="status-pill ${product.status === "no-data" ? "no-data" : ""}">${product.status === "no-data" ? "暂无数据" : escapeHTML(product.brand || "已识别")}</span>
        </div>
        <h4>${escapeHTML(product.title)}</h4>
        <div class="comp-stats">
          <div><strong>${escapeHTML(priceText(product.price))}</strong><small>当前价格</small></div>
          <div><strong>${product.rating === null ? "—" : product.rating.toFixed(1)}</strong><small>评分 / ${product.reviews ?? "—"}评</small></div>
          <div><strong>${product.keywordCount}</strong><small>所选周期词数</small></div>
        </div>
      </article>
    `).join("");
    if (state.data.mode === "live-empty") {
      const product = state.data.products[0];
      $("#competitor-note").innerHTML = `<strong>零流量诊断：</strong>${escapeHTML(product?.asin || "当前 ASIN")} 商品档案正常，但所选周期没有可见的自然或广告关键词，因此不生成虚假的竞品词池。`;
    } else if (state.data.mode === "live") {
      const withData = state.data.products.filter((item) => item.keywordCount > 0).length;
      $("#competitor-note").innerHTML = `<strong>实时口径：</strong>本组 ${state.data.products.length} 个输入 ASIN 已通过 SIF MCP 查询，其中 ${withData} 个在所选周期内返回关键词。输入样本与自动竞品始终分开统计。`;
    } else {
      $("#competitor-note").innerHTML = `<strong>同款判断：</strong>这 4 个 ASIN 均来自你的输入，其中 3 个商品标题明确是免打孔吸音板搁板；${escapeHTML(state.data.products.find((item) => item.status === "no-data")?.asin || "1 个 ASIN")} 当前缺数据，不用其他商品强行替代。`;
    }
  } else {
    $("#competitor-grid").innerHTML = state.data.competitors.length ? state.data.competitors.map((competitor, index) => `
      <article class="competitor-card" data-rank="${String(index + 1).padStart(2, "0")}">
        <div class="competitor-top">
          <a href="${escapeHTML(amazonUrl(competitor.asin))}" target="_blank" rel="noreferrer">${escapeHTML(competitor.asin)} ↗</a>
          <span class="status-pill">${escapeHTML(competitor.kind)}</span>
        </div>
        <h4>${escapeHTML(competitor.title || "SIF 已识别竞品")}</h4>
        <p class="competitor-discovery">
          <span>发现词</span>
          <strong>${escapeHTML(competitor.discoveryKeyword || "—")}</strong>
          <small><b title="翻译来源：${escapeHTML(competitor.translationSource || "未返回")}">中译</b>${escapeHTML(competitor.discoveryTranslation || "待翻译")}</small>
        </p>
        <div class="comp-stats">
          <div><strong>${pct(competitor.trafficShare, 1)}</strong><small>目标词流量份额</small></div>
          <div><strong>${pct(competitor.naturalShare, 1)}</strong><small>自然位份额</small></div>
          <div><strong>${competitor.keywordCount ?? 0}</strong><small>已联查流量词</small></div>
        </div>
      </article>
    `).join("") : `<div class="competitor-empty">当前没有可用的高相关竞品。</div>`;
    $("#competitor-note").innerHTML = state.data.competitors.length
      ? `<strong>自动联查完成：</strong>用“${escapeHTML(state.data.competitors[0].discoveryKeyword)}”发现 ${state.data.competitors.length} 个高相关竞品，并把竞品流量词合并到关键词池；中文优先采用 SIF 官方翻译。`
      : `<strong>未生成竞品：</strong>当前 ASIN 没有足够的高相关产品词，系统不会用宽泛类目商品强行补满 3–5 个。`;
  }
}

function renderTrend() {
  const keyword = $("#trend-select").value;
  const series = state.data.trends[keyword];
  const item = state.data.keywords.find((entry) => entry.keyword === keyword);
  if (!series || !item) {
    $("#trend-select").disabled = true;
    $("#chart-summary").innerHTML = `<div class="no-trend"><strong>暂无趋势</strong><small>${escapeHTML(state.data.emptyReason || "当前筛选下没有可绘制的数据点。")}</small></div>`;
    $("#trend-chart").innerHTML = "";
    return;
  }
  $("#trend-select").disabled = false;

  const latest = series.at(-1).value;
  const peak = Math.max(...series.map((point) => point.value));
  const first = series[0].value;
  const delta = first ? (latest - first) / first : 0;
  const startDate = series[0].date || series[0].label;
  const endDate = series.at(-1).date || series.at(-1).label;
  $("#chart-summary").innerHTML = `
    <div><strong>${formatNumber(latest)}</strong><small>当前周搜索量 · ${escapeHTML(endDate)}</small></div>
    <div><strong>${formatNumber(peak)}</strong><small>区间峰值 · ${escapeHTML(startDate)}—${escapeHTML(endDate)}</small></div>
    <div><strong>${delta >= 0 ? "+" : ""}${pct(delta)}</strong><small>区间变化 · ${series.length} 个周数据点</small></div>
    <p>${escapeHTML(item.reason)} 当前判断：<strong>${escapeHTML(item.trend)}</strong>。</p>
  `;
  drawChart(series);
}

function syncTrendSelect() {
  const select = $("#trend-select");
  const keys = Object.keys(state.data.trends || {}).filter((key) => state.data.trends[key]?.length);
  if (!keys.length) {
    select.innerHTML = `<option>暂无关键词趋势</option>`;
    select.disabled = true;
    return;
  }
  const current = keys.includes(select.value) ? select.value : keys[0];
  select.innerHTML = keys.map((key) => `<option value="${escapeHTML(key)}">${escapeHTML(key)}</option>`).join("");
  select.value = current;
}

function drawChart(series) {
  const svg = $("#trend-chart");
  const width = 900;
  const height = 300;
  const pad = { top: 25, right: 24, bottom: 40, left: 52 };
  const max = Math.max(...series.map((item) => item.value)) * 1.08;
  const x = (index) => pad.left + index * ((width - pad.left - pad.right) / (series.length - 1));
  const y = (value) => pad.top + (max - value) * ((height - pad.top - pad.bottom) / max);
  const line = series.map((item, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(item.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(series.length - 1)},${height - pad.bottom} L${x(0)},${height - pad.bottom} Z`;
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const yy = pad.top + ratio * (height - pad.top - pad.bottom);
    const value = Math.round(max * (1 - ratio));
    return `<line class="grid" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}"/><text class="axis-label" x="${pad.left - 9}" y="${yy + 3}" text-anchor="end">${escapeHTML(formatCompact(value))}</text>`;
  }).join("");
  const labels = series.map((item, index) => series.length <= 8 || index % 2 === 0 || index === series.length - 1 ? `<text class="axis-label" x="${x(index)}" y="${height - 14}" text-anchor="middle">${escapeHTML(item.label)}</text>` : "").join("");
  const points = series.map((item, index) => `<circle class="point" cx="${x(index)}" cy="${y(item.value)}" r="${index === series.length - 1 ? 5 : 3}"><title>${escapeHTML(item.date || item.label)} · ${formatNumber(item.value)}/周</title></circle>`).join("");
  svg.innerHTML = `${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${points}${labels}`;
}

function renderSources() {
  $("#source-links").innerHTML = state.data.verificationLinks.map((link) => `<a href="${escapeHTML(link.url)}" target="_blank" rel="noreferrer">${escapeHTML(link.label)} ↗</a>`).join("");
}

function csvValue(value) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadCsv(rows, filename) {
  const csv = "\ufeff" + rows.map((row) => row.map(csvValue).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportCsv() {
  if (!state.data) return showToast("请先完成一次查询。", "error");
  const headers = ["关键词", "中文释义", "翻译来源", "分类", "搜索量", "周期", "相关性", "输入ASIN覆盖", "自动竞品覆盖", "自然流量占比", "CPC", "趋势", "建议动作", "入选依据"];
  const rows = state.data.keywords.map((item) => [
    item.keyword, displayTranslation(item), displayTranslationSource(item), keywordTagLabel(item), item.volume, item.volumePeriod,
    item.relevance, item.seedCoverage, item.competitorCoverage, pct(item.naturalRatio), item.cpc,
    item.trend, item.recommendation, item.reason
  ]);
  downloadCsv([headers, ...rows], `SIF-keywords-${state.data.query.country}-${state.data.meta.dataUpdatedThrough}.csv`);
  showToast("CSV 已导出。包含关键词、搜索量、相关性与建议动作。 ");
}

function xmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xlsxColumnName(index) {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function xlsxCellXml(reference, value, style, numeric = false) {
  const styleAttribute = style === null || style === undefined ? "" : ` s="${style}"`;
  if (numeric && Number.isFinite(Number(value))) {
    return `<c r="${reference}"${styleAttribute}><v>${Number(value)}</v></c>`;
  }
  return `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function setXlsxCell(sheetXml, reference, value, { numeric = false, style = null } = {}) {
  const cellPattern = new RegExp(`<c\\b(?=[^>]*\\br="${reference}")[^>]*?(?:\\s*\\/>|>[\\s\\S]*?<\\/c>)`, "u");
  const existing = sheetXml.match(cellPattern)?.[0] || "";
  const existingStyle = existing.match(/\bs="(\d+)"/u)?.[1];
  const cell = xlsxCellXml(reference, value, existingStyle ?? style, numeric);
  if (existing) return sheetXml.replace(cellPattern, cell);

  const rowNumber = reference.match(/\d+$/u)?.[0];
  if (!rowNumber) return sheetXml;
  const rowPattern = new RegExp(`(<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>)([\\s\\S]*?)(<\\/row>)`, "u");
  if (rowPattern.test(sheetXml)) return sheetXml.replace(rowPattern, `$1$2${cell}$3`);
  return sheetXml.replace("</sheetData>", `<row r="${rowNumber}">${cell}</row></sheetData>`);
}

function normalizeXlsxTarget(target = "") {
  const value = String(target).replaceAll("\\", "/").replace(/^\/+/, "");
  return value.startsWith("xl/") ? value : `xl/${value}`;
}

async function workbookSheetInfo(zip) {
  const workbookPath = "xl/workbook.xml";
  const relationsPath = "xl/_rels/workbook.xml.rels";
  const [workbookXml, relationsXml] = await Promise.all([
    zip.file(workbookPath).async("string"),
    zip.file(relationsPath).async("string")
  ]);
  const parser = new DOMParser();
  const workbookDocument = parser.parseFromString(workbookXml, "application/xml");
  const relationsDocument = parser.parseFromString(relationsXml, "application/xml");
  const relationTargets = new Map([...relationsDocument.getElementsByTagNameNS("*", "Relationship")]
    .map((item) => [item.getAttribute("Id"), normalizeXlsxTarget(item.getAttribute("Target"))]));
  const sheets = new Map([...workbookDocument.getElementsByTagNameNS("*", "sheet")].map((item) => {
    const relationId = item.getAttribute("r:id") || item.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    return [item.getAttribute("name"), {
      relationId,
      sheetId: Number(item.getAttribute("sheetId")) || 0,
      path: relationTargets.get(relationId)
    }];
  }));
  return { workbookPath, relationsPath, workbookXml, relationsXml, sheets };
}

async function ensureXlsxSheet(zip, sheetName, { cloneFrom = null, content = null } = {}) {
  const info = await workbookSheetInfo(zip);
  if (info.sheets.has(sheetName)) return info.sheets.get(sheetName).path;

  const usedPaths = new Set([...info.sheets.values()].map((item) => item.path));
  let sheetNumber = 1;
  while (usedPaths.has(`xl/worksheets/sheet${sheetNumber}.xml`)) sheetNumber += 1;
  const sheetPath = `xl/worksheets/sheet${sheetNumber}.xml`;
  const maxSheetId = Math.max(0, ...[...info.sheets.values()].map((item) => item.sheetId));
  const relationNumbers = [...info.relationsXml.matchAll(/\bId="rId(\d+)"/gu)].map((match) => Number(match[1]));
  const relationId = `rId${Math.max(0, ...relationNumbers) + 1}`;
  const sourcePath = cloneFrom ? info.sheets.get(cloneFrom)?.path : null;
  const sheetContent = content || (sourcePath ? await zip.file(sourcePath).async("string") : keywordWorksheetXml([], {}, sheetName.split("-")[0]));

  const workbookXml = info.workbookXml.replace("</sheets>", `<sheet name="${xmlEscape(sheetName)}" sheetId="${maxSheetId + 1}" r:id="${relationId}"/></sheets>`);
  const relationsXml = info.relationsXml.replace("</Relationships>", `<Relationship Id="${relationId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNumber}.xml"/></Relationships>`);
  const contentTypesPath = "[Content_Types].xml";
  const contentTypesXml = (await zip.file(contentTypesPath).async("string")).replace("</Types>", `<Override PartName="/xl/worksheets/sheet${sheetNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);

  zip.file(info.workbookPath, workbookXml);
  zip.file(info.relationsPath, relationsXml);
  zip.file(contentTypesPath, contentTypesXml);
  zip.file(sheetPath, sheetContent);
  return sheetPath;
}

function descriptionBlocksForTemplate(value) {
  const normalized = String(value || "")
    .replace(/<br\s*\/?>(?:\s|&nbsp;)*<br\s*\/?>/giu, "\n\n")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/\r\n?/gu, "\n");
  return normalized.split(/\n\s*\n/gu).map((block) => block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean))
    .filter((block) => block.length);
}

function stripTrailingDescriptionBreaks(value) {
  return String(value || "").replace(/(?:\s*<br\s*\/?>)+\s*$/giu, "").trim();
}

function excelDescriptionParagraph(value) {
  const content = stripTrailingDescriptionBreaks(value);
  return content ? `${content}<br><br>` : "";
}

function excelDescriptionLine(value, { heading = false, last = false } = {}) {
  let content = stripTrailingDescriptionBreaks(value);
  if (!content) return "";
  if (heading) {
    const marked = content.match(/^<b>([\s\S]*?)<\/b>$/iu);
    content = `<b>${marked ? marked[1] : content.replace(/^<b>|<\/b>$/giu, "")}</b>`;
  }
  return `${content}${last ? "<br><br>" : "<br>"}`;
}

function descriptionRowsForTemplate(source, translation) {
  const sourceBlocks = descriptionBlocksForTemplate(source);
  const translationBlocks = descriptionBlocksForTemplate(translation);
  const rows = [0, 1, 2].map((index) => ({
    row: 30 + index * 2,
    source: excelDescriptionParagraph((sourceBlocks[index] || []).join("<br>")),
    translation: excelDescriptionParagraph((translationBlocks[index] || []).join("<br>")),
    paragraph: true
  }));
  let row = 36;
  const structuredCount = Math.max(sourceBlocks.length, translationBlocks.length);
  for (let blockIndex = 3; blockIndex < structuredCount; blockIndex += 1) {
    if (blockIndex > 3) row += 1;
    const sourceLines = sourceBlocks[blockIndex] || [];
    const translationLines = translationBlocks[blockIndex] || [];
    const lineCount = Math.max(sourceLines.length, translationLines.length);
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      rows.push({
        row,
        source: excelDescriptionLine(sourceLines[lineIndex], { heading: lineIndex === 0, last: lineIndex === sourceLines.length - 1 }),
        translation: excelDescriptionLine(translationLines[lineIndex], { heading: lineIndex === 0, last: lineIndex === translationLines.length - 1 }),
        paragraph: false
      });
      row += 1;
    }
  }
  return rows;
}

function setXlsxRowHeight(sheetXml, row, height) {
  const rowPattern = new RegExp(`<row\\b(?=[^>]*\\br="${row}")[^>]*>`, "u");
  const current = sheetXml.match(rowPattern)?.[0];
  if (!current) return sheetXml;
  const resized = current
    .replace(/\sht="[^"]*"/gu, "")
    .replace(/\scustomHeight="[^"]*"/gu, "")
    .replace(/>$/u, ` ht="${height}" customHeight="1">`);
  return sheetXml.replace(rowPattern, resized);
}

function descriptionExcelRowHeight(source, translation, paragraph) {
  const longest = Math.max(characterCount(source), characterCount(translation));
  if (paragraph) return Math.min(180, Math.max(54, Math.ceil(longest / 58) * 18 + 12));
  return Math.min(72, Math.max(20, Math.ceil(longest / 65) * 18 + 2));
}

function fillListingTemplateSheet(sheetXml, result, query) {
  const listing = result.listing;
  const translations = listing.translations || {};
  const competitorText = (state.data?.competitors || []).slice(0, 5).map((item) => item.asin).filter(Boolean).join(" · ");
  const descriptionRows = descriptionRowsForTemplate(listing.description, translations.description);
  const values = [
    ["D1", (query.asins || []).join(" · "), { style: 5 }],
    ["B2", query.productName || "", { style: 5 }],
    ["B6", competitorText, { style: 8 }],
    ["C9", "中文翻译", { style: 11 }],
    ["A10", characterCount(listing.title), { numeric: true, style: 9 }],
    ["B10", listing.title, { style: 12 }],
    ["C10", translations.title || "", { style: 12 }],
    ["C12", "中文翻译", { style: 11 }],
    ["C15", "中文翻译", { style: 11 }],
    ["A16", characterCount(listing.searchTerms), { numeric: true, style: 9 }],
    ["B16", listing.searchTerms, { style: 12 }],
    ["C16", translations.searchTerms || "", { style: 12 }],
    ["C18", "中文翻译", { style: 11 }],
    ["C29", "中文翻译", { style: 11 }]
  ];
  listing.bullets.slice(0, 5).forEach((bullet, index) => {
    const row = 19 + index * 2;
    values.push([`A${row}`, characterCount(bullet), { numeric: true, style: 9 }]);
    values.push([`B${row}`, bullet, { style: 12 }]);
    values.push([`C${row}`, translations.bullets?.[index] || "", { style: 12 }]);
  });
  descriptionRows.forEach((item) => {
    if (item.paragraph) values.push([`A${item.row}`, characterCount(item.source), { numeric: true, style: 9 }]);
    values.push([`B${item.row}`, item.source, { style: 12 }]);
    values.push([`C${item.row}`, item.translation, { style: 12 }]);
  });
  let output = values.reduce((xml, [reference, value, options]) => setXlsxCell(xml, reference, value, options), sheetXml);
  descriptionRows.forEach((item) => {
    output = setXlsxRowHeight(output, item.row, descriptionExcelRowHeight(item.source, item.translation, item.paragraph));
  });
  const finalRow = Math.max(50, ...descriptionRows.map((item) => item.row));
  return output.replace(/<dimension\b[^>]*\bref="[^"]*"\s*\/>/u, `<dimension ref="A1:I${finalRow}"/>`);
}

function keywordWorksheetXml(keywords, query, country, result = null) {
  const audit = new Map((result?.keywordAudit || []).map((item) => [String(item.keyword || "").toLocaleLowerCase(), item]));
  const headers = ["关键词", "中文翻译", "词层", "搜索量", "搜索量周期", "产品相关性", "输入 ASIN 覆盖", "竞品覆盖", "自然流量占比", "CPC", "趋势", "Listing 嵌入位置", "建议动作", "来源 ASIN", "入选依据"];
  const rows = keywords.map((item) => {
    const keywordAudit = audit.get(String(item.keyword || "").toLocaleLowerCase());
    return [
      item.keyword,
      displayTranslation(item),
      keywordTagLabel(item),
      item.volume,
      item.volumePeriod,
      item.relevance,
      item.seedCoverage,
      item.competitorCoverage,
      pct(item.naturalRatio),
      item.cpc,
      item.trend,
      keywordAudit ? `${keywordAudit.used ? "已嵌入" : "未嵌入"} · ${keywordAudit.placement || "未使用"}` : "未生成 Listing",
      item.recommendation,
      (item.sourceAsins || []).join(" · "),
      item.reason
    ];
  });
  const metadata = [
    [`${country} 站流量词库`, query.productName || "未填写品名", "数据来源：SIF MCP"],
    ["查询 ASIN", (query.asins || []).join(" · "), `查询周期：${historyPeriodLabel(query.period)}`],
    ["导出时间", new Date().toLocaleString("zh-CN", { hour12: false }), `关键词数量：${keywords.length}`]
  ];
  const rowXml = [];
  metadata.forEach((row, rowIndex) => {
    rowXml.push(`<row r="${rowIndex + 1}" ht="22" customHeight="1">${row.map((value, columnIndex) => xlsxCellXml(`${xlsxColumnName(columnIndex + 1)}${rowIndex + 1}`, value, rowIndex === 0 ? 10 : 12)).join("")}</row>`);
  });
  rowXml.push(`<row r="4" ht="24" customHeight="1">${headers.map((value, index) => xlsxCellXml(`${xlsxColumnName(index + 1)}4`, value, 11)).join("")}</row>`);
  rows.forEach((row, index) => {
    const rowNumber = index + 5;
    rowXml.push(`<row r="${rowNumber}" ht="38" customHeight="1">${row.map((value, columnIndex) => xlsxCellXml(`${xlsxColumnName(columnIndex + 1)}${rowNumber}`, value ?? "", 12, [3, 5, 6, 7, 9].includes(columnIndex) && Number.isFinite(Number(value)))).join("")}</row>`);
  });
  const widths = [30, 22, 17, 14, 16, 14, 16, 14, 16, 12, 14, 28, 32, 32, 42];
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const lastRow = Math.max(4, rows.length + 4);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:O${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${rowXml.join("")}</sheetData><autoFilter ref="A4:O${lastRow}"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportAiListingXlsx() {
  const result = state.aiListing;
  const listing = result?.listing;
  if (!listing) return showToast("请先生成 Listing。", "error");
  if (!window.JSZip) return showToast("Excel 导出组件未加载，请刷新页面后重试。", "error");
  const query = state.data?.query || {};
  const country = query.country || "DE";
  const button = $("#export-ai-listing");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "正在生成 Excel…";
  try {
    const response = await fetch("/templates/listing-template.xlsx");
    if (!response.ok) throw new Error("无法读取文案生成模板。");
    const zip = await window.JSZip.loadAsync(await response.arrayBuffer());
    const copySheetName = `${country}-文案`;
    const copySheetPath = await ensureXlsxSheet(zip, copySheetName, { cloneFrom: "DE-文案" });
    const copySheetXml = await zip.file(copySheetPath).async("string");
    zip.file(copySheetPath, fillListingTemplateSheet(copySheetXml, result, query));

    const keywordSheetName = `${country}-词库`;
    const keywordXml = keywordWorksheetXml(state.data?.keywords || [], query, country, result);
    const keywordSheetPath = await ensureXlsxSheet(zip, keywordSheetName, { content: keywordXml });
    zip.file(keywordSheetPath, keywordXml);

    const blob = await zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });
  const base = String(query.productName || query.asins?.[0] || "Listing")
    .replace(/[^\p{L}\p{N}\-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60) || "Listing";
  const date = String(result.createdAt || new Date().toISOString()).slice(0, 10);
    downloadBlob(blob, `Amazon-Listing-${country}-${base}-${date}.xlsx`);
    showToast(`Excel 已按模板导出 · ${copySheetName} + ${keywordSheetName}`);
  } catch (error) {
    showToast(error.message || "Excel 导出失败。", "error");
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function copySelected() {
  const words = [...state.selected];
  if (!words.length) return showToast("请先勾选关键词。", "error");
  const text = words.join("\n");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  showToast(`已复制 ${words.length} 个关键词。`);
}

async function copyText(words, successMessage) {
  if (!words.length) return showToast("当前没有可复制的真实流量词。", "error");
  const value = words.join(" ");
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  showToast(successMessage);
}

function bindEvents() {
  $("#query-form").addEventListener("submit", (event) => {
    event.preventDefault();
    runQuery();
  });
  $("#history-open").addEventListener("click", openHistory);
  $("#history-close").addEventListener("click", closeHistory);
  $("#history-clear").addEventListener("click", () => {
    localStorage.removeItem(historyStorageKey);
    renderHistory();
    showToast("查询历史已清空。");
  });
  $("#history-list").addEventListener("click", (event) => {
    const item = event.target.closest("[data-history-id]");
    if (item) openHistoryResult(item.dataset.historyId);
  });
  $("#history-list").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest("[data-history-id]");
    if (!item) return;
    event.preventDefault();
    openHistoryResult(item.dataset.historyId);
  });
  $("#history-modal").addEventListener("click", (event) => {
    if (event.target === $("#history-modal")) closeHistory();
  });
  $("#asin-input").addEventListener("input", updateAsinCount);
  $("#country").addEventListener("change", updateHeroMarket);
  $("#period-mode").addEventListener("change", () => {
    renderPeriodControl();
    if ($("#period-mode").value === "custom-month") $("#period-month").focus();
  });
  $("#period-month").addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/[^\d-]/g, "").slice(0, 7);
    renderPeriodControl();
  });
  $("#clear-asins").addEventListener("click", () => {
    $("#asin-input").value = "";
    updateAsinCount();
    $("#asin-input").focus();
  });
  $("#keyword-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    state.expanded = null;
    renderKeywords();
  });
  $("#keyword-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    state.expanded = null;
    renderKeywords();
  });
  $(".keyword-table thead").addEventListener("click", (event) => {
    const header = event.target.closest("th[data-sort]");
    if (!header) return;
    const key = header.dataset.sort;
    state.sort = state.sort.key === key ? { key, direction: state.sort.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" };
    renderKeywords();
  });
  $("#keyword-body").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-keyword]");
    if (!row) return;
    const keyword = decodeURIComponent(row.dataset.keyword);
    if (event.target.matches(".row-check")) {
      event.target.checked ? state.selected.add(keyword) : state.selected.delete(keyword);
      $("#table-caption").textContent = `显示 ${visibleKeywords().length} 个关键词 · 已选 ${state.selected.size} 个`;
      return;
    }
    if (event.target.closest(".row-detail")) {
      state.expanded = state.expanded === keyword ? null : keyword;
      renderKeywords();
    }
  });
  $("#select-all").addEventListener("change", (event) => {
    visibleKeywords().forEach((item) => event.target.checked ? state.selected.add(item.keyword) : state.selected.delete(item.keyword));
    renderKeywords();
  });
  $("#competitor-switch").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-scope]");
    if (!button) return;
    state.competitorScope = button.dataset.scope;
    renderCompetitors();
  });
  $("#trend-select").addEventListener("change", renderTrend);
  $("#copy-selected").addEventListener("click", copySelected);
  $("#quick-export").addEventListener("click", exportCsv);
  $("#copy-title-keywords").addEventListener("click", () => copyText(uniqueWords(currentListingBrief().titleKeywords), "标题核心词已复制。"));
  $("#copy-backend-keywords").addEventListener("click", () => {
    const brief = currentListingBrief();
    const titleWords = new Set(uniqueWords(brief.titleKeywords));
    copyText(uniqueWords(brief.backendKeywords).filter((word) => !titleWords.has(word)), "后台 Search Terms 已复制。");
  });
  $("#generate-listing").addEventListener("click", generateListing);
  $("#ai-listing-output").addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-ai]");
    if (button) copyAiField(button.dataset.copyAi);
  });
  $("#copy-ai-listing").addEventListener("click", copyFullAiListing);
  $("#export-ai-listing").addEventListener("click", exportAiListingXlsx);
  $("#export-csv").addEventListener("click", exportCsv);
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("sif-theme", next);
    if (state.data) renderTrend();
  });
  $("#config-open").addEventListener("click", openConfig);
  $("#config-close").addEventListener("click", closeConfig);
  $("#config-form").addEventListener("submit", saveConfig);
  $("#config-reset").addEventListener("click", resetConfig);
  $("#key-visibility").addEventListener("click", () => {
    const input = $("#mcp-key");
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    $("#key-visibility").textContent = visible ? "显示" : "隐藏";
    $("#key-visibility").setAttribute("aria-label", visible ? "显示 Key" : "隐藏 Key");
  });
  $("#config-modal").addEventListener("click", (event) => {
    if (event.target === $("#config-modal")) closeConfig();
  });
  $("#ai-config-open").addEventListener("click", openAiConfig);
  $("#ai-config-close").addEventListener("click", closeAiConfig);
  $("#ai-config-form").addEventListener("submit", saveAiConfig);
  $("#ai-config-reset").addEventListener("click", resetAiConfig);
  $("#ai-provider").addEventListener("change", (event) => applyAiPreset(event.target.value, { force: true }));
  $("#ai-key-visibility").addEventListener("click", () => {
    const input = $("#ai-api-key");
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    $("#ai-key-visibility").textContent = visible ? "显示" : "隐藏";
    $("#ai-key-visibility").setAttribute("aria-label", visible ? "显示 AI Key" : "隐藏 AI Key");
  });
  $("#ai-config-modal").addEventListener("click", (event) => {
    if (event.target === $("#ai-config-modal")) closeAiConfig();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#config-modal").hidden) closeConfig();
    if (event.key === "Escape" && !$("#history-modal").hidden) closeHistory();
    if (event.key === "Escape" && !$("#ai-config-modal").hidden) closeAiConfig();
  });
}

function bindSectionObserver() {
  const links = $$(".workspace-nav a");
  const sections = links.map((link) => $(link.getAttribute("href"))).filter(Boolean);
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    links.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`));
  }, { rootMargin: "-20% 0px -65%", threshold: [0, .2, .6] });
  sections.forEach((section) => observer.observe(section));
}

async function init() {
  document.documentElement.dataset.theme = localStorage.getItem("sif-theme") || "light";
  const currentMonth = isoDate(new Date()).slice(0, 7);
  $("#period-month").value = currentMonth;
  $("#period-mode").value = "lately:30";
  renderPeriodControl();
  renderTemplatePolicy();
  renderHistory();
  updateHeroMarket();
  bindEvents();
  bindSectionObserver();
  updateAsinCount();
  const [mcpStatus, aiStatus] = await Promise.allSettled([refreshConfigStatus(), refreshAiConfigStatus()]);
  if (mcpStatus.status === "rejected") $("#connection-label").textContent = "本地模式";
  if (aiStatus.status === "rejected") $("#ai-nav-state").textContent = "状态未知";
}

init();
