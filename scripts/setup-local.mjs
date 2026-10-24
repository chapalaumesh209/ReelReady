import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const cli = [
  fileURLToPath(
    new URL("../node_modules/supabase/dist/supabase.js", import.meta.url),
  ),
];
mkdirSync(".sites-runtime", { recursive: true });
try {
  execFileSync("docker", ["info"], { stdio: "ignore" });
} catch {
  throw new Error("Start Docker Desktop, then run npm run setup:local again.");
}
console.log("Starting the separate local Supabase stack…");
try {
  execFileSync(
    process.execPath,
    [
      ...cli,
      "start",
      "--exclude",
      "realtime,imgproxy,studio,edge-runtime,logflare,vector,supavisor,mailpit",
    ],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 600000 },
  );
  execFileSync(process.execPath, [...cli, "migration", "up", "--local"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  });
} catch (e) {
  writeFileSync(
    ".sites-runtime/setup-local.log",
    String(e.stdout || "") + "\n" + String(e.stderr || ""),
    { mode: 0o600 },
  );
  throw new Error(
    "Local Supabase did not finish starting. Check Docker Desktop; details are in the ignored .sites-runtime/setup-local.log.",
  );
}
const state = JSON.parse(
  execFileSync(process.execPath, [...cli, "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(state.API_URL))
  throw new Error("Local setup refuses a non-local Supabase URL.");
let signing = randomBytes(48).toString("base64url");
if (existsSync(".env.development.local")) {
  const prior = readFileSync(".env.development.local", "utf8").match(
    /^SESSION_SECRET=(.+)$/m,
  );
  if (prior) signing = prior[1];
}
const values = {
  SUPABASE_URL: state.API_URL,
  SUPABASE_PUBLISHABLE_KEY: state.PUBLISHABLE_KEY || state.ANON_KEY,
  SUPABASE_SECRET_KEY: state.SECRET_KEY || state.SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: state.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: state.PUBLISHABLE_KEY || state.ANON_KEY,
  SUPABASE_JWKS_URL: state.API_URL + "/auth/v1/.well-known/jwks.json",
  APP_URL: "http://127.0.0.1:3000",
  DEMO_MODE: "true",
  LLM_PROVIDER: "demo",
  SESSION_SECRET: signing,
};
for (const file of [".env.development.local", ".env.test.local"]) {
  let source = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    if (!value)
      throw new Error(
        "Local Supabase is missing a required configuration value.",
      );
    const pattern = new RegExp("^" + key + "=.*$", "m");
    source = pattern.test(source)
      ? source.replace(pattern, key + "=" + value)
      : source.trimEnd() + "\n" + key + "=" + value;
  }
  writeFileSync(file, source.trimStart() + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}
console.log(
  "Local Auth, database and private storage are ready. Demo mode is enabled. Original .env.local was preserved. Run npm run dev.",
);
