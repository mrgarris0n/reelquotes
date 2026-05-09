import { NextResponse } from "next/server";
import { listTitles } from "@/lib/pool";

export const runtime = "nodejs";

export async function GET() {
  const titles = listTitles();
  return NextResponse.json(
    { titles },
    {
      headers: {
        // Pool changes only when we run `npm run refresh` and redeploy,
        // so the response is safe to cache aggressively.
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    },
  );
}
