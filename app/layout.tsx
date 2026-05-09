import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReelQuotes",
  description: "Guess the movie from its quotes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
