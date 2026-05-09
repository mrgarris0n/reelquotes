import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // data/ is read at runtime via fs.readFileSync — Next.js can't trace that
  // automatically, so include it explicitly in the API routes' bundle.
  outputFileTracingIncludes: {
    "/api/round/**": ["./data/**/*"],
  },
};

export default nextConfig;
