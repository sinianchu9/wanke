import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "proxy-agent", "pac-resolver", "ali-oss"],
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
