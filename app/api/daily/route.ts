import { NextResponse } from "next/server";
import { getDailyMovie } from "@/lib/daily";

export const runtime = "nodejs";

export async function GET() {
  const daily = getDailyMovie();
  if (!daily) {
    return NextResponse.json({ error: "No quote available" }, { status: 503 });
  }
  return NextResponse.json(daily, {
    headers: {
      // Same response all day; let Vercel's CDN cache it.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
