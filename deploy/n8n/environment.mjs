import { randomBytes } from "node:crypto";
export function n8nEnvironment(
  input,
  caPath = "/opt/reelready/supabase-prod-ca-2021.crt",
) {
  const env = { ...input };
  const origin = new URL(
    env.N8N_WEBHOOK_URL || env.WEBHOOK_URL || env.N8N_EDITOR_BASE_URL,
  );
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("Hosted n8n requires its public HTTPS origin.");
  env.N8N_HOST = origin.hostname;
  env.N8N_WEBHOOK_URL = origin.origin + "/";
  env.N8N_EDITOR_BASE_URL = origin.origin;
  env.N8N_PROTOCOL = "https";
  delete env.WEBHOOK_URL;
  env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
  env.DB_POSTGRESDB_SSL_ENABLED = "true";
  env.DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED = "true";
  env.DB_POSTGRESDB_SSL_CA_FILE = caPath;
  const defaults = {
    DB_POSTGRESDB_POOL_SIZE: "5",
    DB_POSTGRESDB_CONNECTION_TIMEOUT: "10000",
    DB_PING_TIMEOUT_MS: "15000",
    DB_PING_INTERVAL_SECONDS: "15",
    DB_POSTGRESDB_MAX_CONNECTION_LIFETIME_MS: "300000",
    DB_POSTGRESDB_KEEP_ALIVE_INITIAL_DELAY_MS: "5000",
    DB_CONNECTION_ACQUISITION_TIMEOUT_MS: "15000",
    N8N_RUNNERS_TASK_TIMEOUT: "300",
  };
  for (const [key, value] of Object.entries(defaults)) {
    env[key] ||= value;
    if (!/^\d+$/.test(env[key]) || Number(env[key]) <= 0)
      throw new Error(`Invalid ${key}.`);
  }
  if (
    Number(env.DB_POSTGRESDB_CONNECTION_TIMEOUT) >=
    Number(env.DB_PING_TIMEOUT_MS)
  )
    throw new Error(
      "Database acquisition timeout must be below its ping timeout.",
    );
  env.DB_POSTGRESDB_KEEP_ALIVE = "true";
  env.N8N_RUNNERS_MODE = "external";
  env.N8N_RUNNERS_BROKER_LISTEN_ADDRESS = "127.0.0.1";
  env.N8N_RUNNERS_AUTH_TOKEN ||= randomBytes(32).toString("hex");
  env.N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES ||= "2147483648";
  env.N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES ||= "5000";
  return env;
}
export function runnerEnvironment(env) {
  // A different OS user runs workflow code. Never inherit database, encryption,
  // provider or administrative credentials into the task-runner process.
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/home/reelready-runner",
    NODE_ENV: "production",
    GENERIC_TIMEZONE: env.GENERIC_TIMEZONE || "Asia/Kolkata",
    TZ: env.TZ || "Asia/Kolkata",
    N8N_RUNNERS_AUTH_TOKEN: env.N8N_RUNNERS_AUTH_TOKEN,
    N8N_RUNNERS_TASK_BROKER_URI: "http://127.0.0.1:5679",
    N8N_RUNNERS_TASK_TIMEOUT: env.N8N_RUNNERS_TASK_TIMEOUT,
    N8N_RUNNERS_AUTO_SHUTDOWN_TIMEOUT: "0",
    N8N_RUNNERS_MAX_CONCURRENCY: "5",
  };
}
