import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // sqlite-vec resolves and loads a native SQLite extension at runtime.
  serverExternalPackages: ["sqlite-vec"],
};

export default nextConfig;
