"use client";

export function Receipt({
  title,
  emoji,
  lines,
  onDone,
  cta = "Tap anywhere to continue",
}: {
  title: string;
  emoji: string;
  lines: string[];
  onDone: () => void;
  cta?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 px-8 text-center"
      style={{ background: "radial-gradient(120% 60% at 50% 30%,#10233A 0%,#07080D 60%)" }}
      onClick={onDone}
    >
      <div className="w-[120px] h-[120px] rounded-full flex items-center justify-center text-[52px] animate-pop grad-bg-135 shadow-[0_20px_60px_rgba(42,200,255,.35)]">
        {emoji}
      </div>
      <div className="animate-rise">
        <h2 className="font-grotesk font-bold text-[26px] tracking-[-0.5px]">{title}</h2>
        <div className="mt-3 flex flex-col gap-1">
          {lines.map((l, i) => (
            <p key={i} className="font-sans text-[14px] text-white/60 leading-[1.5]">
              {l}
            </p>
          ))}
        </div>
      </div>
      <button className="mt-2 border border-good/50 rounded-full px-6 py-3 font-grotesk font-semibold text-good animate-rise">
        {cta}
      </button>
    </div>
  );
}
