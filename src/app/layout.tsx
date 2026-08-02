import type { Metadata, Viewport } from "next";
import { Space_Grotesk, DM_Sans } from "next/font/google";
import "./globals.css";
import { NativeBridge } from "@/components/NativeBridge";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-grotesk",
  display: "swap",
});

const dm = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ttip — Crypto in. Cash out. Tip anyone.",
  description:
    "Swap BTC, ETH & USDT to Naira, Cedis, Shillings or Rand in seconds — and tip friends, family and your crew instantly.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Ttip" },
  icons: { icon: "/ttip-logo.png", apple: "/ttip-logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#07080D",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${dm.variable}`}>
      <body className="font-sans">
        <NativeBridge />
        {children}
      </body>
    </html>
  );
}
