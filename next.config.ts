import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    staticGenerationMaxConcurrency: 1,
  },
};

export default nextConfig;
