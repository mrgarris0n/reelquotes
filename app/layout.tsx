import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { BotIdClient } from "botid/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReelQuotes",
  description: "Guess the movie from its quotes.",
};

const protectedRoutes = [{ path: "/api/leaderboard", method: "POST" }];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <BotIdClient protect={protectedRoutes} />
      </head>
      <body className="min-h-screen">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
