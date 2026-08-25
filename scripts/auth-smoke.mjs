import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.AUTH_TEST_PORT || 42919);
const origin = `http://127.0.0.1:${port}`;
const username = "yusen";
const password = `auth-smoke-${randomBytes(16).toString("hex")}`;
const configSecret = randomBytes(48).toString("base64url");
let child;
let childOutput = "";

function startServer() {
  childOutput = "";
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      APP_USERNAME: username,
      APP_PASSWORD: password,
      SIF_CONFIG_SECRET: configSecret
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { childOutput += chunk; });
  child.stderr.on("data", (chunk) => { childOutput += chunk; });
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.kill();
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child?.exitCode !== null) throw new Error(`测试服务器提前退出：\n${childOutput}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // The process may still be binding the local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待测试服务器启动超时：\n${childOutput}`);
}

function jsonRequest(path, payload, headers = {}) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload)
  });
}

async function run() {
  startServer();
  await waitForServer();

  const health = await fetch(`${origin}/api/health`).then((response) => response.json());
  assert.deepEqual(health, { ok: true, authenticationConfigured: true, authenticated: false });

  const rootRedirect = await fetch(origin, { redirect: "manual" });
  assert.equal(rootRedirect.status, 302);
  assert.equal(rootRedirect.headers.get("location"), "/login");

  const loginPage = await fetch(`${origin}/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /id="login-form"/);

  const unauthorizedApi = await fetch(`${origin}/api/config`);
  assert.equal(unauthorizedApi.status, 401);
  assert.equal((await unauthorizedApi.json()).code, "AUTH_REQUIRED");

  const invalidJson = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).code, "INVALID_JSON");

  const wrongLogin = await jsonRequest("/api/auth/login", { username, password: "incorrect" }, { "X-Real-IP": "198.51.100.10" });
  assert.equal(wrongLogin.status, 401);

  const login = await jsonRequest("/api/auth/login", { username, password }, { "X-Real-IP": "198.51.100.11" });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie") || "";
  assert.match(setCookie, /sif_radar_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(";", 1)[0];

  const protectedPage = await fetch(origin, { headers: { Cookie: cookie } });
  assert.equal(protectedPage.status, 200);
  assert.match(await protectedPage.text(), /KEYWORD \/ RADAR/);

  const missingStatic = await fetch(`${origin}/favicon.ico`, { headers: { Cookie: cookie } });
  assert.equal(missingStatic.status, 404);
  const healthAfterMissingStatic = await fetch(`${origin}/api/health`);
  assert.equal(healthAfterMissingStatic.status, 200);

  const protectedApi = await fetch(`${origin}/api/config`, { headers: { Cookie: cookie } });
  assert.equal(protectedApi.status, 200);

  const secureLogin = await jsonRequest("/api/auth/login", { username, password }, {
    "X-Forwarded-Proto": "https",
    "X-Real-IP": "198.51.100.12"
  });
  assert.match(secureLogin.headers.get("set-cookie") || "", /Secure/i);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const failed = await jsonRequest("/api/auth/login", { username, password: "incorrect" }, { "X-Real-IP": "198.51.100.13" });
    assert.equal(failed.status, 401);
  }
  const limited = await jsonRequest("/api/auth/login", { username, password: "incorrect" }, { "X-Real-IP": "198.51.100.13" });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, "LOGIN_RATE_LIMITED");

  await stopServer();
  startServer();
  await waitForServer();
  const persistedSession = await fetch(origin, { redirect: "manual", headers: { Cookie: cookie } });
  assert.equal(persistedSession.status, 200);

  const logout = await fetch(`${origin}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie }
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/i);

  console.log("Authentication smoke test passed.");
}

try {
  await run();
} finally {
  await stopServer();
}
