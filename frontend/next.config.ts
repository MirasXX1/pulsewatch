import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  return {
    // Building while `next dev` runs must not overwrite its manifests and chunks.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next" : ".next-build",
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: `${process.env.BACKEND_URL || "http://127.0.0.1:8080"}/api/:path*`,
        },
      ];
    },
  };
}
