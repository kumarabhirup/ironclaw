import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow long-running API routes for agent streaming
  serverExternalPackages: [],

  // Transpile ESM-only packages so webpack can bundle them
  transpilePackages: ["react-markdown", "remark-gfm"],

  // Ensure Node.js built-ins work correctly
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Don't attempt to bundle Node.js built-ins
      config.externals = config.externals || [];
      config.externals.push({
        "node:child_process": "commonjs node:child_process",
        "node:path": "commonjs node:path",
        "node:readline": "commonjs node:readline",
      });
    }
    return config;
  },
};

export default nextConfig;
