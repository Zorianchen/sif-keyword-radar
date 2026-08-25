import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataRoot = await mkdtemp(join(tmpdir(), "sif-radar-auth-"));
const port = Number(process.env.AUTH_TEST_PORT || 42919);
const origin = `http://127.0.0.1:${port}`;
const username = "yusen";
const password = `auth-smoke-${randomBytes(16).toString("hex")}`;
const alphaUsername = "alpha.user";
const alphaPassword = `alpha-${randomBytes(16).toString("hex")}`;
const betaUsername = "beta_user";
const betaPassword = `beta-${randomBytes(16).toString("hex")}`;
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
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_DATA_DIR: dataRoot,
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
  const closed = new Promise((resolveClose) => child.once("close", resolveClose));
  child.kill();
  await Promise.race([closed, new Promise((resolveWait) => setTimeout(resolveWait, 3000))]);
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
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
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

function responseCookie(response) {
  return (response.headers.get("set-cookie") || "").split(";", 1)[0];
}

function userStorageId(account) {
  return createHash("sha256").update(`sif-radar-user:${account}`, "utf8").digest("hex");
}

function encryptedConfig(value) {
  const key = createHash("sha256").update(configSecret, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `aesgcm:v1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

async function writeUserConfig(account, filename, value) {
  const directory = join(dataRoot, "users", userStorageId(account));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, filename), encryptedConfig(value), "utf8");
}

async function run() {
  await writeFile(join(dataRoot, "sif-mcp.local.enc"), encryptedConfig({
    url: "https://mcp.sif.com/mcp",
    authorization: "Bearer legacy-admin-key"
  }), "utf8");
  startServer();
  await waitForServer();

  const health = await fetch(`${origin}/api/health`).then((response) => response.json());
  assert.deepEqual(health, {
    ok: true,
    authenticationConfigured: true,
    registrationEnabled: true,
    authenticated: false
  });

  const rootRedirect = await fetch(origin, { redirect: "manual" });
  assert.equal(rootRedirect.status, 302);
  assert.equal(rootRedirect.headers.get("location"), "/login");

  const loginPage = await fetch(`${origin}/login`);
  assert.equal(loginPage.status, 200);
  const loginHtml = await loginPage.text();
  assert.match(loginHtml, /id="login-form"/);
  assert.match(loginHtml, /data-auth-mode="register"/);

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

  const invalidUsername = await jsonRequest("/api/auth/register", { username: "x", password: alphaPassword });
  assert.equal(invalidUsername.status, 400);
  assert.equal((await invalidUsername.json()).code, "INVALID_USERNAME");

  const weakPassword = await jsonRequest("/api/auth/register", { username: "weak-user", password: "123" });
  assert.equal(weakPassword.status, 400);
  assert.equal((await weakPassword.json()).code, "INVALID_PASSWORD");

  const alphaRegistration = await jsonRequest("/api/auth/register", { username: alphaUsername, password: alphaPassword });
  assert.equal(alphaRegistration.status, 201);
  const alphaCookie = responseCookie(alphaRegistration);
  assert.match(alphaCookie, /sif_radar_session=/);

  const duplicateRegistration = await jsonRequest("/api/auth/register", { username: alphaUsername.toUpperCase(), password: alphaPassword });
  assert.equal(duplicateRegistration.status, 409);
  assert.equal((await duplicateRegistration.json()).code, "USERNAME_EXISTS");

  const betaRegistration = await jsonRequest("/api/auth/register", { username: betaUsername, password: betaPassword });
  assert.equal(betaRegistration.status, 201);
  const betaCookie = responseCookie(betaRegistration);

  const usersFile = await readFile(join(dataRoot, "users.local.json"), "utf8");
  assert.doesNotMatch(usersFile, new RegExp(alphaPassword));
  assert.doesNotMatch(usersFile, new RegExp(betaPassword));
  assert.match(usersFile, /passwordHash/);

  const alphaStatus = await fetch(`${origin}/api/auth/status`, { headers: { Cookie: alphaCookie } }).then((response) => response.json());
  assert.equal(alphaStatus.authenticated, true);
  assert.equal(alphaStatus.username, alphaUsername);

  const alphaConfigBefore = await fetch(`${origin}/api/config`, { headers: { Cookie: alphaCookie } }).then((response) => response.json());
  const betaConfigBefore = await fetch(`${origin}/api/config`, { headers: { Cookie: betaCookie } }).then((response) => response.json());
  assert.equal(alphaConfigBefore.configured, false);
  assert.equal(betaConfigBefore.configured, false);

  await writeUserConfig(alphaUsername, "sif-mcp.enc", {
    url: "https://mcp.sif.com/mcp",
    authorization: "Bearer alpha-only-key"
  });
  await writeUserConfig(alphaUsername, "ai-model.enc", {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-test",
    apiKey: "alpha-only-ai-key"
  });

  const alphaConfigAfter = await fetch(`${origin}/api/config`, { headers: { Cookie: alphaCookie } }).then((response) => response.json());
  const betaConfigAfter = await fetch(`${origin}/api/config`, { headers: { Cookie: betaCookie } }).then((response) => response.json());
  assert.equal(alphaConfigAfter.configured, true);
  assert.equal(alphaConfigAfter.keyStored, true);
  assert.equal(betaConfigAfter.configured, false);

  const alphaAiAfter = await fetch(`${origin}/api/ai-config`, { headers: { Cookie: alphaCookie } }).then((response) => response.json());
  const betaAiAfter = await fetch(`${origin}/api/ai-config`, { headers: { Cookie: betaCookie } }).then((response) => response.json());
  assert.equal(alphaAiAfter.configured, true);
  assert.equal(alphaAiAfter.model, "deepseek-test");
  assert.equal(betaAiAfter.configured, false);

  const wrongLogin = await jsonRequest("/api/auth/login", { username, password: "incorrect" }, { "X-Real-IP": "198.51.100.10" });
  assert.equal(wrongLogin.status, 401);

  const login = await jsonRequest("/api/auth/login", { username, password }, { "X-Real-IP": "198.51.100.11" });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie") || "";
  assert.match(setCookie, /sif_radar_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = responseCookie(login);

  const protectedPage = await fetch(origin, { headers: { Cookie: cookie } });
  assert.equal(protectedPage.status, 200);
  assert.match(await protectedPage.text(), /KEYWORD \/ RADAR/);

  const protectedApi = await fetch(`${origin}/api/config`, { headers: { Cookie: cookie } });
  assert.equal(protectedApi.status, 200);
  assert.equal((await protectedApi.json()).configured, true);
  await assert.rejects(readFile(join(dataRoot, "sif-mcp.local.enc"), "utf8"), { code: "ENOENT" });

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
  const persistedAlphaSession = await fetch(origin, { redirect: "manual", headers: { Cookie: alphaCookie } });
  assert.equal(persistedAlphaSession.status, 200);

  const alphaLogin = await jsonRequest("/api/auth/login", { username: alphaUsername, password: alphaPassword });
  assert.equal(alphaLogin.status, 200);

  const logout = await fetch(`${origin}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: alphaCookie }
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/i);

  const logoutNavigation = await fetch(`${origin}/logout`, {
    redirect: "manual",
    headers: { Cookie: alphaCookie }
  });
  assert.equal(logoutNavigation.status, 303);
  assert.equal(logoutNavigation.headers.get("location"), "/login");
  assert.match(logoutNavigation.headers.get("set-cookie") || "", /Max-Age=0/i);

  console.log("Authentication and multi-user isolation smoke test passed.");
}

try {
  await run();
} finally {
  await stopServer();
  await rm(dataRoot, { recursive: true, force: true });
}
