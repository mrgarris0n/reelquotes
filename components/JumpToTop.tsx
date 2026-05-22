"use client";

import { useEffect, useState } from "react";

const SHOW_AFTER_PX = 400;

export function JumpToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="Jump to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={
        "press-btn tape-border-pink shadow-vhs-pink fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center bg-neon-pink font-display text-2xl uppercase leading-none text-ink-deep transition-opacity duration-200 sm:hidden " +
        (visible ? "opacity-90" : "pointer-events-none opacity-0")
      }
    >
      ▲
    </button>
  );
}
