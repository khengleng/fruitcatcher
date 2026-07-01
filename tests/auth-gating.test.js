const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const test = require("node:test");

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitForHealth(baseUrl) {
  for (let i = 0; i < 40; i += 1) {
    try { const r = await fetch(`${baseUrl}/health`); if (r.ok) return r.json(); } catch (e) { /* starting */ }
    await wait(100);
  }
  throw new Error("Gateway did not become healthy");
}

test("protected routes reject unauthenticated requests; public routes work", async (t) => {
  const port = 3700 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["apps/gateway/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), ADMIN_TOKEN: "test-admin-token", DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (c) => { logs += c; });
  child.stderr.on("data", (c) => { logs += c; });
  t.after(() => child.kill());
  await waitForHealth(baseUrl);

  // Student/parent routes without a token must be 401.
  const studentGets = ["/student/progress", "/student/tasks", "/student/mistakes", "/parent/children"];
  for (const path of studentGets) {
    const r = await fetch(`${baseUrl}${path}`);
    assert.equal(r.status, 401, `${path} should be 401 (got ${r.status})`);
  }
  const authedPosts = ["/student/telegram/code", "/parent/telegram/code", "/student/link-code"];
  for (const path of authedPosts) {
    const r = await fetch(`${baseUrl}${path}`, { method: "POST" });
    assert.equal(r.status, 401, `${path} should be 401 (got ${r.status})`);
  }

  // Admin routes without auth -> 401 or 403.
  for (const path of ["/admin/errors", "/admin/analytics/mastery", "/admin/questions/pending"]) {
    const r = await fetch(`${baseUrl}${path}`, { headers: { Origin: "https://admintv.cambobia.com" } });
    assert.ok([401, 403].includes(r.status), `${path} should be 401/403 (got ${r.status})`);
  }

  // Bot route without the shared secret -> 401 or 503 (secret unset in test).
  const bot = await fetch(`${baseUrl}/bot/config`);
  assert.ok([401, 503].includes(bot.status), `bot config got ${bot.status}`);

  // Public endpoint works.
  const solo = await fetch(`${baseUrl}/solo/options`);
  assert.equal(solo.status, 200, logs);
});
