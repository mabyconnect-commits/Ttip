"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { apiGet, apiPost } from "@/lib/client";
import { BackHeader, GradientButton, Segmented, Sheet, Spinner } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { PinPrompt } from "@/components/PinPrompt";
import { formatFiat } from "@/lib/format";

/**
 * Buying gift cards.
 *
 * Two screens behind one tab switch, because they answer two different
 * questions: "what can I buy" and "where is the card I already bought".
 *
 * Every price on this screen comes from the server already converted — the
 * client never multiplies a rate. Two places computing a price is how someone
 * taps ₦38,000 and gets charged ₦39,200.
 */

interface Option { face: number; cost: number }
interface Product { id: string; brand: string; currency: string; logo?: string; options: Option[] }
interface Catalogue { fiat: string; live: boolean; spendable: number; products: Product[] }

interface Card {
  id: string;
  brand: string;
  faceValue: number;
  faceCurrency: string;
  costFiat: number;
  fiat: string;
  status: string;
  hint: string | null;
  hasCode: boolean;
  revealedAt: string | null;
  error: string | null;
  createdAt: string;
}

export default function GiftCardsPage() {
  const { action, toast } = useApp();
  const [tab, setTab] = useState<"buy" | "mine">("buy");

  const [cat, setCat] = useState<Catalogue | null>(null);
  const [loadingCat, setLoadingCat] = useState(true);
  const [q, setQ] = useState("");

  const [product, setProduct] = useState<Product | null>(null);
  const [option, setOption] = useState<Option | null>(null);
  const [buying, setBuying] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState(false);

  const [cards, setCards] = useState<Card[] | null>(null);
  const [revealed, setRevealed] = useState<{ brand: string; code: string; pin?: string | null } | null>(null);
  const [revealing, setRevealing] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setCat(await apiGet<Catalogue>("/api/giftcards"));
      } catch (e: any) {
        toast(e.message || "Couldn't load gift cards", "bad");
      } finally {
        setLoadingCat(false);
      }
    })();
    // Loaded once — the catalogue doesn't change between taps of the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCards() {
    try {
      const r = await apiGet<{ cards: Card[] }>("/api/giftcards/mine");
      setCards(r.cards);
    } catch (e: any) {
      setCards([]);
      toast(e.message || "Couldn't load your cards", "bad");
    }
  }

  useEffect(() => {
    if (tab === "mine") loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function pick(p: Product) {
    setProduct(p);
    setOption(p.options[0] ?? null);
  }

  async function buy(pin: string) {
    if (!product || !option || buying) return;
    setBuying(true);
    try {
      const res: any = await action("/api/giftcards/buy", {
        productId: product.id,
        brand: product.brand,
        country: "US",
        faceValue: option.face,
        faceCurrency: product.currency,
        pin,
      });
      setPinOpen(false);
      setProduct(null);
      toast(res.order?.message ?? `${product.brand} card bought`, "good");
      setTab("mine");
      loadCards();
    } catch (e: any) {
      if (/pin/i.test(e.message ?? "")) {
        setPinError(true);
        setPinOpen(true);
      } else {
        setPinOpen(false);
      }
      toast(e.message, "bad");
    } finally {
      setBuying(false);
    }
  }

  async function reveal(card: Card) {
    setRevealing(card.id);
    try {
      const r = await apiPost<{ brand: string; code: string; pin?: string | null }>("/api/giftcards/mine", {
        id: card.id,
      });
      setRevealed({ brand: r.brand, code: r.code, pin: r.pin });
      loadCards();
    } catch (e: any) {
      toast(e.message || "Couldn't open that card", "bad");
    } finally {
      setRevealing(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard?.writeText(text);
      toast("Copied", "good");
    } catch {
      toast("Couldn't copy — select it by hand", "bad");
    }
  }

  const fiat = cat?.fiat ?? "NGN";
  const filtered = (cat?.products ?? []).filter((p) => p.brand.toLowerCase().includes(q.toLowerCase().trim()));
  const affordable = (cost: number) => !cat || cat.spendable <= 0 || cost <= cat.spendable;

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Gift cards" />

      <div className="pt-1 pb-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "buy", label: "Buy" },
            { value: "mine", label: "My cards" },
          ]}
        />
      </div>

      {tab === "buy" ? (
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {loadingCat ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : !cat || cat.products.length === 0 ? (
            <div className="text-center text-white/40 text-[13px] py-12">
              No gift cards available right now. Please try again later.
            </div>
          ) : (
            <>
              {/* Nobody should find out a card was fake AFTER paying for it. */}
              {!cat.live && (
                <div
                  className="rounded-2xl px-4 py-3 text-[12.5px] text-white/70 flex gap-2.5 mb-3"
                  style={{ background: "rgba(255,196,61,.07)", border: "1px solid rgba(255,196,61,.25)" }}
                >
                  <span className="shrink-0 text-[#FFC43D]">
                    <Icon name="flag" size={15} />
                  </span>
                  <span>Test mode — these are demo cards and the codes won&apos;t redeem anywhere.</span>
                </div>
              )}

              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search brands…"
                className="w-full bg-surface border border-white/[.08] rounded-2xl px-4 h-[46px] outline-none text-[14px] focus:border-brand-cyan/50 mb-3"
              />

              <div className="grid grid-cols-2 gap-2.5 pb-6">
                {filtered.map((p) => {
                  const from = Math.min(...p.options.map((o) => o.cost).filter((c) => c > 0));
                  return (
                    <button
                      key={p.id}
                      onClick={() => pick(p)}
                      className="bg-surface border border-white/[.06] rounded-[18px] p-3.5 flex flex-col gap-2 text-left active:scale-[.98] transition"
                    >
                      <div className="h-9 flex items-center">
                        {p.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.logo} alt="" className="h-9 max-w-[70%] object-contain rounded-md" />
                        ) : (
                          <span className="w-9 h-9 rounded-xl bg-white/[.06] flex items-center justify-center text-white/70">
                            <Icon name="gift" size={17} />
                          </span>
                        )}
                      </div>
                      <span className="font-sans font-medium text-[13px] text-white/85 leading-snug line-clamp-2">
                        {p.brand}
                      </span>
                      <span className="font-grotesk text-[11.5px] text-white/45">
                        from {formatFiat(from, fiat, { decimals: 0 })}
                      </span>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="col-span-2 text-center text-white/40 text-[13px] py-8">No brand matches “{q}”.</div>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
          {cards === null ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : cards.length === 0 ? (
            <div className="text-center text-white/40 text-[13px] py-12">
              No cards yet.{" "}
              <button onClick={() => setTab("buy")} className="text-good">
                Buy one
              </button>
              .
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {cards.map((c) => (
                <div key={c.id} className="bg-surface border border-white/[.06] rounded-2xl px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-xl bg-white/[.06] flex items-center justify-center text-white/70 shrink-0">
                      <Icon name="gift" size={17} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-sans font-semibold text-[14px] truncate">{c.brand}</div>
                      <div className="font-sans text-[11.5px] text-white/40">
                        {c.faceCurrency} {c.faceValue} · {formatFiat(c.costFiat, c.fiat, { decimals: 0 })}
                      </div>
                    </div>
                    <StatusChip status={c.status} />
                  </div>

                  {c.status === "delivered" && (
                    <div className="flex items-center gap-2 mt-3">
                      <span className="flex-1 font-grotesk text-[13px] text-white/55 tracking-[1px]">
                        {c.hint ?? "••••"}
                      </span>
                      <button
                        onClick={() => reveal(c)}
                        disabled={revealing === c.id}
                        className="h-9 px-4 rounded-full border border-white/14 font-grotesk font-semibold text-[12.5px] text-white/85 active:scale-95 disabled:opacity-50"
                      >
                        {revealing === c.id ? "Opening…" : "Show code"}
                      </button>
                    </div>
                  )}
                  {c.status === "pending" && (
                    <div className="mt-2 text-[12px] text-white/45">
                      Still with the provider — this usually lands within a minute.
                    </div>
                  )}
                  {c.status === "failed" && (
                    <div className="mt-2 text-[12px] text-bad">
                      {c.error ?? "That purchase didn't go through"} — you were refunded.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* denominations */}
      <Sheet open={!!product} onClose={() => setProduct(null)} title={product?.brand ?? "Gift card"}>
        <div className="grid grid-cols-3 gap-2">
          {product?.options.map((o) => {
            const active = option?.face === o.face;
            const can = affordable(o.cost);
            return (
              <button
                key={o.face}
                onClick={() => can && setOption(o)}
                disabled={!can}
                className={`rounded-2xl px-2 py-3 border flex flex-col items-center gap-1 ${
                  active ? "bg-brand-cyan/[.12] border-brand-cyan" : "bg-surface2 border-white/[.08]"
                } ${can ? "active:scale-[.98]" : "opacity-40"}`}
              >
                <span className={`font-grotesk font-bold text-[15px] ${active ? "text-brand-cyan" : "text-white"}`}>
                  {product.currency} {o.face}
                </span>
                <span className="font-sans text-[11px] text-white/45">{formatFiat(o.cost, fiat, { decimals: 0 })}</span>
              </button>
            );
          })}
        </div>

        {option && (
          <div className="flex justify-between mt-4 px-1 text-[13px] text-white/55">
            <span>You pay</span>
            <b className="text-white font-grotesk">{formatFiat(option.cost, fiat, { decimals: 0 })}</b>
          </div>
        )}

        <div className="mt-4">
          <GradientButton
            onClick={() => {
              if (!option) return;
              setPinError(false);
              setPinOpen(true);
            }}
            loading={buying}
            disabled={!option || !affordable(option.cost)}
          >
            {option ? `Buy for ${formatFiat(option.cost, fiat, { decimals: 0 })}` : "Choose an amount"}
          </GradientButton>
        </div>
        <p className="text-[11.5px] text-white/35 mt-3 text-center leading-relaxed">
          A gift card code can&apos;t be cancelled or refunded once it&apos;s shown.
        </p>
      </Sheet>

      <PinPrompt
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onPin={buy}
        error={pinError}
        busy={buying}
        above
        subtitle={
          product && option
            ? `${product.brand} · ${product.currency} ${option.face} · ${formatFiat(option.cost, fiat, { decimals: 0 })}`
            : undefined
        }
      />

      {/* the code itself */}
      <Sheet open={!!revealed} onClose={() => setRevealed(null)} title={revealed?.brand ?? "Your card"}>
        <div className="bg-surface2 border border-white/[.08] rounded-2xl px-4 py-5 text-center">
          <div className="font-grotesk font-bold text-[19px] tracking-[1.5px] break-all select-all">
            {revealed?.code}
          </div>
          {revealed?.pin && (
            <div className="mt-3 text-[13px] text-white/55">
              PIN <b className="text-white font-grotesk tracking-[1px] select-all">{revealed.pin}</b>
            </div>
          )}
        </div>
        <div className="mt-3">
          <GradientButton onClick={() => revealed && copy(revealed.code)}>Copy code</GradientButton>
        </div>
        <p className="text-[11.5px] text-white/35 mt-3 text-center leading-relaxed">
          Keep this to yourself — anyone who sees the code can spend it.
        </p>
      </Sheet>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    delivered: { label: "Ready", color: "#3DF5B0" },
    pending: { label: "Processing", color: "#FFC43D" },
    failed: { label: "Refunded", color: "#FF7A8A" },
  };
  const s = map[status] ?? { label: status, color: "rgba(255,255,255,.5)" };
  return (
    <span
      className="text-[10.5px] font-grotesk font-semibold uppercase tracking-wide rounded-full px-2.5 py-[4px] shrink-0"
      style={{ color: s.color, border: `1px solid ${s.color}40` }}
    >
      {s.label}
    </span>
  );
}
