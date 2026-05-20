import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { BotIdClient } from "botid/client";
import { Bungee, Space_Mono, VT323 } from "next/font/google";
import "./globals.css";

const display = Bungee({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const body = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});
const hud = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-hud",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ReelQuotes",
  description: "Guess the movie from its quotes.",
};

const protectedRoutes = [{ path: "/api/leaderboard", method: "POST" }];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${hud.variable}`}
    >
      <head>
        <BotIdClient protect={protectedRoutes} />
      </head>
      <body className="font-body min-h-screen">
        <div className="tracking-strip" aria-hidden />
        <div className="vhs-vignette" aria-hidden />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
