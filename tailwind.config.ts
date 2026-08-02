import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#07080D",
        surface: "#0D0F17",
        surface2: "#12141D",
        line: "rgba(255,255,255,0.08)",
        brand: {
          indigo: "#6D5BFF",
          cyan: "#2AC8FF",
          mint: "#3DF5B0",
          purple: "#B45BFF",
        },
        good: "#3DF5B0",
        bad: "#FF7A8A",
        warn: "#FFC85B",
      },
      fontFamily: {
        grotesk: ["var(--font-grotesk)", "Space Grotesk", "sans-serif"],
        sans: ["var(--font-dm)", "DM Sans", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "brand-grad": "linear-gradient(90deg,#6D5BFF,#2AC8FF 55%,#3DF5B0)",
        "brand-grad-135": "linear-gradient(135deg,#6D5BFF,#2AC8FF 60%,#3DF5B0)",
      },
      boxShadow: {
        glow: "0 12px 32px rgba(42,200,255,.3)",
      },
      keyframes: {
        ticker: { "0%": { transform: "translateX(0)" }, "100%": { transform: "translateX(-50%)" } },
        pop: { "0%": { transform: "scale(.6)", opacity: "0" }, "60%": { transform: "scale(1.06)" }, "100%": { transform: "scale(1)", opacity: "1" } },
        rise: { "0%": { transform: "translateY(14px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
        toast: { "0%": { transform: "translate(-50%,20px)", opacity: "0" }, "100%": { transform: "translate(-50%,0)", opacity: "1" } },
        sheet: { "0%": { transform: "translateY(100%)" }, "100%": { transform: "translateY(0)" } },
        draw: { "0%": { strokeDashoffset: "48" }, "100%": { strokeDashoffset: "0" } },
        ringIn: { "0%": { transform: "scale(.8)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
      },
      animation: {
        ticker: "ticker 18s linear infinite",
        pop: "pop .4s ease",
        rise: "rise .35s ease",
        toast: "toast .3s ease",
        sheet: "sheet .3s cubic-bezier(.2,.8,.2,1)",
        draw: "draw .45s cubic-bezier(.65,0,.35,1) .18s both",
        ringIn: "ringIn .4s cubic-bezier(.2,.8,.2,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
