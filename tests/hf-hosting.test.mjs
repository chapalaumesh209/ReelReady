import { test } from "node:test";
import assert from "node:assert/strict";
import {
  n8nEnvironment,
  runnerEnvironment,
} from "../deploy/n8n/environment.mjs";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
test("hosted n8n keeps its database and encryption identity while correcting proxy URLs, TLS and pool timing", () => {
  const env = n8nEnvironment({
    WEBHOOK_URL: "https://Umeshchapala-n8n.hf.space",
    N8N_HOST: "https://Umeshchapala-n8n.hf.space",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    DB_POSTGRESDB_PASSWORD: "private-fixture",
    N8N_ENCRYPTION_KEY: "stable-fixture",
  });
  assert.equal(env.N8N_HOST, "umeshchapala-n8n.hf.space");
  assert.equal(env.N8N_WEBHOOK_URL, "https://umeshchapala-n8n.hf.space/");
  assert.equal(env.WEBHOOK_URL, undefined);
  assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, "1");
  assert.equal(env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED, "true");
  assert.ok(env.DB_POSTGRESDB_SSL_CA_FILE.endsWith(".crt"));
  assert.equal(env.DB_POSTGRESDB_PASSWORD, "private-fixture");
  assert.equal(env.N8N_ENCRYPTION_KEY, "stable-fixture");
  assert.equal(env.N8N_RUNNERS_MODE, "external");
  assert.ok(Number(env.DB_POSTGRESDB_POOL_SIZE) > 2);
  assert.ok(
    Number(env.DB_POSTGRESDB_CONNECTION_TIMEOUT) <
      Number(env.DB_PING_TIMEOUT_MS),
  );
  assert.throws(
    () => n8nEnvironment({ WEBHOOK_URL: "http://bad.example" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      n8nEnvironment({
        WEBHOOK_URL: "https://example.com",
        DB_POSTGRESDB_CONNECTION_TIMEOUT: "30000",
      }),
    /below/,
  );
});
test("workflow runner cannot inherit database, provider or administrator secrets", () => {
  const env = n8nEnvironment({
    WEBHOOK_URL: "https://example.com",
    DB_POSTGRESDB_PASSWORD: "fixture",
    N8N_ENCRYPTION_KEY: "fixture",
    GEMINI_API_KEY: "fixture",
    HF_TOKEN: "fixture",
  });
  const runner = runnerEnvironment(env);
  for (const k of [
    "DB_POSTGRESDB_PASSWORD",
    "N8N_ENCRYPTION_KEY",
    "GEMINI_API_KEY",
    "HF_TOKEN",
  ])
    assert.equal(runner[k], undefined);
  assert.equal(runner.N8N_RUNNERS_AUTH_TOKEN, env.N8N_RUNNERS_AUTH_TOKEN);
  assert.equal(runner.N8N_RUNNERS_TASK_BROKER_URI, "http://127.0.0.1:5679");
  const config = JSON.parse(
    readFileSync("deploy/n8n/task-runners.json", "utf8"),
  );
  assert.equal(config["task-runners"].length, 1);
  assert.equal(config["task-runners"][0]["runner-type"], "javascript");
});
test("database CA is the pinned public Supabase root, not a disabled verification workaround", () => {
  const cert = new X509Certificate(
    readFileSync("deploy/n8n/supabase-prod-ca-2021.crt"),
  );
  assert.equal(
    cert.fingerprint256.replaceAll(":", "").toLowerCase(),
    "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa",
  );
});
