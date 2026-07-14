"use client";

export function AssetIcon({ color, glyph, size = 38, isFiat }: { color: string; glyph: string; size?: number; isFiat?: boolean }) {
  return (
    <div
      className="flex items-center justify-center font-grotesk font-bold text-white shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: isFiat ? "#151827" : color,
        fontSize: isFiat ? size * 0.5 : size * 0.42,
      }}
    >
      {glyph}
    </div>
  );
}
