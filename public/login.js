const form = document.querySelector("#login-form");
const username = document.querySelector("#username");
const password = document.querySelector("#password");
const confirmPassword = document.querySelector("#confirm-password");
const confirmField = document.querySelector("#confirm-password-field");
const submit = document.querySelector("#login-submit");
const submitLabel = document.querySelector("#auth-submit-label");
const message = document.querySelector("#login-message");
const toggle = document.querySelector("#password-toggle");
const title = document.querySelector("#auth-title");
const eyebrow = document.querySelector("#auth-eyebrow");
const modeButtons = [...document.querySelectorAll("[data-auth-mode]")];
let mode = "login";

function setMessage(text, tone = "normal") {
  message.textContent = text;
  message.classList.toggle("error", tone === "error");
  message.classList.toggle("success", tone === "success");
}

function switchMode(nextMode) {
  mode = nextMode === "register" ? "register" : "login";
  const registering = mode === "register";
  modeButtons.forEach((button) => {
    const active = button.dataset.authMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  confirmField.hidden = !registering;
  confirmPassword.required = registering;
  confirmPassword.value = "";
  password.value = "";
  password.autocomplete = registering ? "new-password" : "current-password";
  title.textContent = registering ? "创建新账号" : "登录工作台";
  eyebrow.textContent = registering ? "CREATE WORKSPACE" : "WELCOME BACK";
  submitLabel.textContent = registering ? "注册并进入" : "进入工作台";
  setMessage(registering
    ? "注册后将获得独立的 MCP、AI 配置和查询历史。"
    : "请输入账号和密码。");
  (username.value.trim() ? password : username).focus();
}

modeButtons.forEach((button) => button.addEventListener("click", () => switchMode(button.dataset.authMode)));

toggle.addEventListener("click", () => {
  const visible = password.type === "text";
  password.type = visible ? "password" : "text";
  toggle.textContent = visible ? "显示" : "隐藏";
  toggle.setAttribute("aria-label", visible ? "显示密码" : "隐藏密码");
  password.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const account = username.value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(account)) {
    setMessage("账号需为 3–32 位，只能使用字母、数字、点、下划线或短横线。", "error");
    username.focus();
    return;
  }
  if (password.value.length < 8) {
    setMessage("密码至少需要 8 个字符。", "error");
    password.focus();
    return;
  }
  if (mode === "register" && password.value !== confirmPassword.value) {
    setMessage("两次输入的密码不一致。", "error");
    confirmPassword.focus();
    return;
  }

  submit.disabled = true;
  submitLabel.textContent = mode === "register" ? "正在创建…" : "正在验证…";
  setMessage(mode === "register" ? "正在创建独立工作区…" : "正在验证账号…");
  try {
    const response = await fetch(mode === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: account, password: password.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || (mode === "register" ? "注册失败，请稍后重试。" : "登录失败，请稍后重试。"));
    password.value = "";
    confirmPassword.value = "";
    setMessage(mode === "register" ? "注册成功，正在创建你的工作台…" : "登录成功，正在进入工作台…", "success");
    window.location.replace("/");
  } catch (error) {
    setMessage(error.message, "error");
    (mode === "register" && error.message.includes("存在") ? username : password).focus();
  } finally {
    submit.disabled = false;
    submitLabel.textContent = mode === "register" ? "注册并进入" : "进入工作台";
  }
});

try {
  const status = await fetch("/api/auth/status").then((response) => response.json());
  if (status.authenticated) window.location.replace("/");
  else username.focus();
} catch {
  setMessage("暂时无法连接服务器，请稍后刷新页面。", "error");
}
