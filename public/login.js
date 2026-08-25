const form = document.querySelector("#login-form");
const username = document.querySelector("#username");
const password = document.querySelector("#password");
const submit = document.querySelector("#login-submit");
const message = document.querySelector("#login-message");
const toggle = document.querySelector("#password-toggle");

function setMessage(text, tone = "normal") {
  message.textContent = text;
  message.classList.toggle("error", tone === "error");
  message.classList.toggle("success", tone === "success");
}

toggle.addEventListener("click", () => {
  const visible = password.type === "text";
  password.type = visible ? "password" : "text";
  toggle.textContent = visible ? "显示" : "隐藏";
  toggle.setAttribute("aria-label", visible ? "显示密码" : "隐藏密码");
  password.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!username.value.trim() || !password.value) {
    setMessage("请输入账号和密码。", "error");
    return;
  }
  submit.disabled = true;
  submit.querySelector("span").textContent = "正在验证…";
  setMessage("正在验证服务器账号…");
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.value.trim(), password: password.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "登录失败，请稍后重试。");
    password.value = "";
    setMessage("登录成功，正在进入工作台…", "success");
    window.location.replace("/");
  } catch (error) {
    setMessage(error.message, "error");
    password.focus();
    password.select();
  } finally {
    submit.disabled = false;
    submit.querySelector("span").textContent = "进入工作台";
  }
});

try {
  const status = await fetch("/api/auth/status").then((response) => response.json());
  if (status.authenticated) {
    window.location.replace("/");
  } else if (!status.configured) {
    setMessage("服务器尚未设置登录密码，请先在宝塔环境变量中配置 APP_PASSWORD。", "error");
    submit.disabled = true;
  } else {
    password.focus();
  }
} catch {
  setMessage("暂时无法连接服务器，请稍后刷新页面。", "error");
}
