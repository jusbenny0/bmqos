import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["localhost", "127.0.0.1", ...(process.env.CREW_DEV_ORIGINS?.split(",").filter(Boolean) ?? [])],
};
export default config;
