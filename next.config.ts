import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.REELREADY_BUILD_DIR || ".next",
  turbopack: { root: process.cwd() },
  devIndicators: false,
  // OAuth callbacks and signed media URLs must not be printed by dev access logs.
  logging: { incomingRequests: false },
};
export default config;
