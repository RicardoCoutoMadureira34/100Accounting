import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Extratos em PDF podem ter alguns MB; o limite por omissão (1 MB)
      // é demasiado baixo para o upload dos dois ficheiros.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
