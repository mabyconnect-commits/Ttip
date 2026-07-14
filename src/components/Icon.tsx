"use client";

// Crisp, consistent stroke icons (currentColor) used across the app chrome,
// replacing fragile unicode glyphs that render differently on each device.

export type IconName =
  | "home" | "swap" | "zap" | "activity" | "card" | "bills"
  | "bell" | "gift" | "arrowDown" | "arrowUp" | "back" | "settings"
  | "plus" | "check" | "snowflake" | "scan" | "copy" | "share"
  | "chevronRight" | "grid" | "swapVertical" | "sun" | "search";

const P: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />,
  swap: (
    <>
      <path d="M7 4 3 8l4 4" />
      <path d="M3 8h13" />
      <path d="m17 20 4-4-4-4" />
      <path d="M21 16H8" />
    </>
  ),
  swapVertical: (
    <>
      <path d="M8 3v18" />
      <path d="m4 7 4-4 4 4" />
      <path d="M16 21V3" />
      <path d="m20 17-4 4-4-4" />
    </>
  ),
  zap: <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z" />,
  activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 9.5h19" />
    </>
  ),
  bills: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  bell: <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.5 21a1.8 1.8 0 0 1-3 0" />,
  gift: (
    <>
      <path d="M19.5 12v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8" />
      <rect x="3" y="7.5" width="18" height="4.5" rx="1" />
      <path d="M12 7.5V21" />
      <path d="M12 7.5C12 7.5 10.5 3 8 4.3 6.2 5.2 7.5 7.5 12 7.5Z" />
      <path d="M12 7.5C12 7.5 13.5 3 16 4.3 17.8 5.2 16.5 7.5 12 7.5Z" />
    </>
  ),
  arrowDown: <path d="M12 4v14m0 0-6-6m6 6 6-6" />,
  arrowUp: <path d="M12 20V6m0 0-6 6m6-6 6 6" />,
  back: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  settings: (
    <>
      <path d="M4 6h9M18 6h2M4 12h2M11 12h9M4 18h6M15 18h5" />
      <circle cx="15" cy="6" r="2.2" />
      <circle cx="8" cy="12" r="2.2" />
      <circle cx="12.5" cy="18" r="2.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12 5 5 9-11" />,
  snowflake: <path d="M12 2v20M4 6l16 12M20 6 4 18M2 12h20" />,
  scan: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M3 12h18" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  share: <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  sun: <path d="M12 4V2M12 22v-2M6 6 4.5 4.5M19.5 19.5 18 18M4 12H2M22 12h-2M6 18l-1.5 1.5M19.5 4.5 18 6M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 22,
  className = "",
  strokeWidth = 2,
  fill,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  fill?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ?? "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  );
}
