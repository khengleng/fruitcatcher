const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const test = require("node:test");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return response.json();
      }
    } catch (error) {
      // Server is still starting.
    }
    await wait(100);
  }

  throw new Error("Gateway did not become healthy");
}

test("gateway exposes public health/config and protects admin origins", async (t) => {
  const port = 3700 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["apps/gateway/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_TOKEN: "test-admin-token",
      ADMIN_ALLOWED_ORIGINS: "https://admintv.cambobia.com,http://localhost:3002"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  t.after(() => {
    child.kill();
  });

  const health = await waitForHealth(baseUrl);
  assert.equal(health.ok, true);
  assert.equal(health.adminConfigured, true);

  const configResponse = await fetch(`${baseUrl}/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.ok(config.supportedQuestionSources.includes("question_bank_openai"));

  const blockedAdminResponse = await fetch(`${baseUrl}/admin/config`, {
    headers: {
      Origin: "https://evil.example",
      Authorization: "Bearer test-admin-token"
    }
  });
  assert.equal(blockedAdminResponse.status, 403);

  const allowedAdminResponse = await fetch(`${baseUrl}/admin/config`, {
    headers: {
      Origin: "https://admintv.cambobia.com",
      Authorization: "Bearer test-admin-token"
    }
  });
  assert.equal(allowedAdminResponse.status, 200, logs);
  assert.equal(allowedAdminResponse.headers.get("access-control-allow-origin"), "https://admintv.cambobia.com");
  assert.ok(allowedAdminResponse.headers.get("x-ratelimit-limit"));

  const presetsWithoutDbResponse = await fetch(`${baseUrl}/admin/presets`, {
    headers: {
      Origin: "https://admintv.cambobia.com",
      Authorization: "Bearer test-admin-token"
    }
  });
  assert.equal(presetsWithoutDbResponse.status, 503);
});
