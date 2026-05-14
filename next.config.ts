import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // data/ is read at runtime via fs.readFileSync — Next.js can't trace that
  // automatically, so include it explicitly in the API routes' bundle.
  outputFileTracingIncludes: {
    "/api/round/**": ["./data/**/*"],
    "/api/daily/**": ["./data/**/*"],
    "/api/titles/**": ["./data/**/*"],
  },
  // Surface Vercel build metadata to the client bundle so the footer can show
  // the deployed commit. Both vars are populated automatically on Vercel.
  env: {
    COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF ?? "",
  },
};

export default withBotId(nextConfig);
