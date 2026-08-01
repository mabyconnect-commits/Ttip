"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { apiGet } from "@/lib/client";
import { BackHeader, Segmented, GradientButton } from "@/components/ui";
import { AssetIcon } from "@/components/AssetIcon";
import { QR } from "@/components/QR";
import { Receipt } from "@/components/Receipt";
import { formatFiat } from "@/lib/format";
import { useRouter } from "next/navigation";

interface DepAsset {
  symbol: string;
  name: string;
  color: string;
  glyph: string;
  networks: { network: string; address: string }[];
}

export default function DepositPage() {
  const { state, action, toast } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState<"crypto" | "naira">("crypto");
  const [assets, setAssets] = useState<DepAsset[]>([]);
  const [sym, setSym] = useState("USDT");
  const [netIdx, setNetIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);

  useEffect(() => {
    apiGet<{ assets: DepAsset[]; live: boolean }>("/api/deposit")
      .then((d) => { setAssets(d.assets); setLive(!!d.live); })
      .catch(() => {});
  }, []);

  const asset = assets.find((a) => a.symbol === sym);
  const net = asset?.networks[netIdx];
  const fiat = state.user.defaultFiat;

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    toast("Copied to clipboard", "good");
  }

  async function simulate() {
    setLoading(true);
    try {
      const res: any = await action("/api/deposit", { symbol: sym, amount: sym === "BTC" ? 0.005 : sym === "ETH" ? 0.1 : 200, network: net?.network });
      setReceipt(res.receipt);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  async function simulateNaira() {
    setLoading(true);
    try {
      const res: any = await action("/api/deposit", { symbol: fiat, amount: 50000 });
      setReceipt(res.receipt);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Add money" />
      <div className="mt-1">
        <Segmented value={tab} onChange={setTab} options={[{ value: "naira", label: fiat }, { value: "crypto", label: "Crypto" }]} />
      </div>

      {tab === "naira" ? (
        <div className="flex-1 overflow-y-auto no-scrollbar pt-4">
          <div className="bg-surface border border-white/[.08] rounded-[22px] p-5">
            <div className="text-[12px] text-white/45 mb-3">Fund your {fiat} balance via bank transfer</div>
            <Detail label="Bank" value="Providus Bank" onCopy={copy} />
            <Detail label="Account number" value="9901234567" onCopy={copy} />
            <Detail label="Account name" value={`Ttip / ${state.user.name}`} onCopy={copy} />
            <div className="mt-4 rounded-xl px-3.5 py-3 text-[12.5px]" style={{ background: "rgba(255,200,91,.08)", border: "1px solid rgba(255,200,91,.3)", color: "rgba(255,255,255,.75)" }}>
              ⚠️ Transfers reflect in seconds. This is a dedicated account for your wallet.
            </div>
          </div>
          {!live && (
            <button onClick={simulateNaira} disabled={loading} className="w-full mt-3 rounded-2xl border border-dashed border-good/40 text-good py-3.5 font-grotesk font-semibold text-[14px] active:scale-[.99] disabled:opacity-50">
              ▶ Simulate transfer +{fiat === "NGN" ? "₦50,000" : "50,000 " + fiat}
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar pt-4">
          {/* asset tabs */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {assets.map((a) => (
              <button
                key={a.symbol}
                onClick={() => { setSym(a.symbol); setNetIdx(0); }}
                className={`h-11 px-4 rounded-[22px] flex items-center gap-2 shrink-0 border transition ${sym === a.symbol ? "bg-white text-[#07080D] border-white" : "border-white/12 text-white/70"}`}
              >
                <span className="font-grotesk font-bold text-[13px]">{a.symbol}</span>
              </button>
            ))}
          </div>

          {/* network selector */}
          {asset && asset.networks.length > 1 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {asset.networks.map((n, i) => (
                <button key={n.network} onClick={() => setNetIdx(i)} className={`text-[11px] rounded-xl px-3 py-1.5 border ${netIdx === i ? "border-brand-cyan text-brand-cyan bg-brand-cyan/10" : "border-white/12 text-white/55"}`}>
                  {n.network}
                </button>
              ))}
            </div>
          )}

          {/* QR + address */}
          <div className="bg-surface border border-white/[.08] rounded-[22px] p-5 mt-3 flex flex-col items-center">
            {net && <QR value={net.address} size={172} />}
            <div className="text-[11px] tracking-wide text-white/40 uppercase mt-4">{net?.network} Address</div>
            <div className="font-grotesk text-[14px] break-all text-center mt-1.5 px-2">{net?.address}</div>
            <div className="flex gap-2.5 mt-4">
              <button onClick={() => net && copy(net.address)} className="grad-bg rounded-full px-5 py-2.5 font-grotesk font-semibold text-[13px] text-[#04121A]">
                Copy address
              </button>
              <button
                onClick={() => { if (net && navigator.share) navigator.share({ text: net.address }).catch(() => {}); else net && copy(net.address); }}
                className="rounded-full px-5 py-2.5 font-grotesk font-semibold text-[13px] border border-white/14"
              >
                Share
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-xl px-3.5 py-3 text-[12.5px] flex gap-2" style={{ background: "rgba(255,200,91,.08)", border: "1px solid rgba(255,200,91,.3)", color: "rgba(255,255,255,.75)" }}>
            <span>⚠️</span>
            <span>
              Only send <b className="text-warn">{asset?.name} ({sym})</b> on <b className="text-warn">{net?.network}</b>. Other assets or networks will be lost.
            </span>
          </div>

          {!live && (
            <button onClick={simulate} disabled={loading} className="w-full mt-3 mb-6 rounded-2xl border border-dashed border-good/40 text-good py-3.5 font-grotesk font-semibold text-[14px] active:scale-[.99] disabled:opacity-50">
              ▶ Simulate incoming {sym === "BTC" ? "+0.005 BTC" : sym === "ETH" ? "+0.1 ETH" : "+200 " + sym}
            </button>
          )}
        </div>
      )}

      {receipt && (
        <Receipt
          onDone={() => { setReceipt(null); router.push("/home"); }}
          emoji="📥"
          title={`${receipt.symbol === fiat ? formatFiat(receipt.amount, fiat, { decimals: 0 }) : receipt.amount + " " + receipt.symbol} received`}
          lines={[`Credited to your wallet`, receipt.network ? `via ${receipt.network}` : receipt.symbol === fiat ? "Bank transfer confirmed" : "Confirmed on-chain"]}
        />
      )}
    </div>
  );
}

function Detail({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[.06] last:border-0">
      <div>
        <div className="text-[11px] text-white/40">{label}</div>
        <div className="font-grotesk font-semibold text-[14px] mt-0.5">{value}</div>
      </div>
      <button onClick={() => onCopy(value)} className="text-brand-cyan text-[12px] font-semibold">Copy</button>
    </div>
  );
}
