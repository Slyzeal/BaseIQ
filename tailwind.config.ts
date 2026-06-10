// tailwind.config.ts

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        amber: {
          DEFAULT: "#f5a623",
          dim: "#c97d10",
        },
        phosphor: "#e8d5a3",
        bg: {
          DEFAULT: "#0a0a08",
          card: "#111109",
          elevated: "#1a1a14",
        },
      },
      fontFamily: {
        mono: ["var(--font-mono)", "Courier New", "monospace"],
        geist: ["var(--font-geist)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
