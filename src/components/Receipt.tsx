"use client";

export function Receipt({
  title,
  lines,
  onDone,
  cta = "Tap anywhere to continue",
}: {
  title: string;
  /** Optional — legacy callers may still pass an emoji; it is intentionally ignored. */
  emoji?: string;
  lines: (string | null | undefined | false)[];
  onDone: () => void;
  cta?: string;
}) {
  const detail = lines.filter(Boolean) as string[];
  const [primary, ...meta] = detail;

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center bg-ink text-center"
      style={{
        background:
          "radial-gradient(90% 55% at 50% 34%, rgba(61,245,176,0.06), transparent 70%), #07080D",
      }}
      onClick={onDone}
    >
      <div className="flex-1 flex flex-col items-center justify-center px-10 w-full">
        {/* Success mark — a sharp checkmark, not an emoji orb */}
        <div className="animate-ringIn">
          <svg width="76" height="76" viewBox="0 0 76 76" fill="none" aria-hidden>
            <circle cx="38" cy="38" r="37" fill="rgba(61,245,176,0.05)" stroke="rgba(61,245,176,0.28)" strokeWidth="1.25" />
            <path
              d="M24 39.5 L34 49.5 L53 27.5"
              stroke="#3DF5B0"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-draw"
              style={{ strokeDasharray: 48 }}
            />
          </svg>
        </div>

        <h2 className="mt-8 font-grotesk font-bold text-[38px] leading-none tracking-[-1px] text-white animate-rise">
          {title}
        </h2>

        {primary && (
          <p className="mt-3.5 font-sans text-[15px] text-white/70 animate-rise">{primary}</p>
        )}

        {meta.length > 0 && (
          <div className="mt-5 flex items-center gap-2.5 text-[12.5px] text-white/40 animate-rise">
            {meta.map((l, i) => (
              <span key={i} className="flex items-center gap-2.5">
                {i > 0 && <span className="w-[3px] h-[3px] rounded-full bg-white/25" />}
                {l}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="pb-12 animate-rise">
        <span className="font-grotesk text-[11px] font-semibold tracking-[2px] uppercase text-white/35">
          {cta}
        </span>
      </div>
    </div>
  );
}
