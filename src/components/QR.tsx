"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QR({ value, size = 160, className = "" }: { value: string; size?: number; className?: string }) {
  const [url, setUrl] = useState<string>("");
  useEffect(() => {
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: "#07080D", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then(setUrl)
      .catch(() => {});
  }, [value, size]);

  return (
    <div className={`bg-white rounded-2xl p-2 relative ${className}`} style={{ width: size, height: size }}>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="QR code" width={size - 16} height={size - 16} className="rounded" />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ttip-logo.png" alt="" className="rounded-lg" style={{ width: size * 0.18, height: size * 0.18 }} />
      </div>
    </div>
  );
}
