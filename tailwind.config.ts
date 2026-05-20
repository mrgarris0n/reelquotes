import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        body: ["var(--font-body)", "ui-monospace", "SFMono-Regular", "monospace"],
        hud: ["var(--font-hud)", "ui-monospace", "monospace"],
      },
      colors: {
        // VHS-repertory palette. Don't use neutral grays directly — go through
        // these tokens so the theme stays cohesive.
        ink: {
          DEFAULT: "#0a0823", // base midnight
          deep: "#070518",
          veil: "#16113f",
        },
        cream: {
          DEFAULT: "#f5e9d2",
          dim: "#c2b6a0",
          smoke: "#8a7e6a",
        },
        neon: {
          pink: "#ff3b8b",
          orange: "#ffa44a",
          teal: "#3dd8ce",
          red: "#ff5160",
        },
      },
      boxShadow: {
        "vhs-pink": "0 0 0 1px #ff3b8b, 4px 4px 0 #ff3b8b",
        "vhs-orange": "0 0 0 1px #ffa44a, 4px 4px 0 #ffa44a",
        "vhs-press": "2px 2px 0 #ff3b8b",
      },
      keyframes: {
        crtFlicker: {
          "0%, 100%": { opacity: "1" },
          "47%": { opacity: "0.96" },
          "48%": { opacity: "0.7" },
          "49%": { opacity: "1" },
          "92%": { opacity: "0.93" },
          "93%": { opacity: "1" },
        },
        tracking: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        vhsJitter: {
          "0%, 100%": { transform: "translate(0,0)" },
          "20%": { transform: "translate(-1px, 1px)" },
          "40%": { transform: "translate(1px, -1px)" },
          "60%": { transform: "translate(-1px, 0)" },
          "80%": { transform: "translate(1px, 1px)" },
        },
      },
      animation: {
        crt: "crtFlicker 6s infinite",
        tracking: "tracking 2.4s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
