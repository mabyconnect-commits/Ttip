"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { apiGet, apiPost } from "@/lib/client";
import { BackHeader, Segmented, GradientButton, Sheet } from "@/components/ui";
import { AssetIcon } from "@/components/AssetIcon";
import { QR } from "@/components/QR";
import { Receipt } from "@/components/Receipt";
import { Icon } from "@/components/Icon";
import { formatFiat } from "@/lib/format";
import { useRouter } from "next/navigation";

interface DepAsset {
  symbol: string;
  name: string;
  color: string;
  glyph: string;
  networks: { network: string; address: string }[];
}

interface DxChain { chainId: number; name: string }
interface DxToken { symbol: string; name: string }

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

  // On-demand (live) deposit flow: pick any chain → any token → get address.
  const [chains, setChains] = useState<DxChain[]>([]);
  const [tokens, setTokens] = useState<DxToken[]>([]);
  const [selChain, setSelChain] = useState<DxChain | null>(null);
  const [selToken, setSelToken] = useState<DxToken | null>(null);
  const [addr, setAddr] = useState<string | null>(null);
  const [addrLoading, setAddrLoading] = useState(false);
  const [chainSheet, setChainSheet] = useState(false);
  const [tokenSheet, setTokenSheet] = useState(false);
  const [chainQ, setChainQ] = useState("");
  const [tokenQ, setTokenQ] = useState("");

  useEffect(() => {
    apiGet<{ assets: DepAsset[]; live: boolean }>("/api/deposit")
      .then((d) => { setAssets(d.assets); setLive(!!d.live); })
      .catch(() => {});
    apiGet<{ chains: DxChain[] }>("/api/deposit/chains")
      .then((d) => setChains(d.chains ?? []))
      .catch(() => {});
  }, []);

  async function pickChain(c: DxChain) {
    setSelChain(c); setChainSheet(false); setChainQ("");
    setSelToken(null); setAddr(null); setTokens([]);
    try {
      const d = await apiGet<{ tokens: DxToken[] }>(`/api/deposit/tokens?chainId=${c.chainId}`);
      setTokens(d.tokens ?? []);
    } catch { setTokens([]); }
  }

  async function pickToken(t: DxToken) {
    if (!selChain) return;
    setSelToken(t); setTokenSheet(false); setTokenQ("");
    setAddr(null); setAddrLoading(true);
    try {
      const d = await apiPost<{ address: string }>("/api/deposit/address", { chainId: selChain.chainId, symbol: t.symbol, network: selChain.name });
      setAddr(d.address);
    } catch (e: any) {
      toast(e.message ?? "Couldn't get an address", "bad");
    } finally {
      setAddrLoading(false);
    }
  }

  const asset = assets.find((a) => a.symbol === sym);
  const net = asset?.networks[netIdx];
  const fiat = state.user.defaultFiat;
  // The simulator is a dev-only tool — never render it in production.
  const showDemo = process.env.NEXT_PUBLIC_SHOW_DEMO === "1";

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
        <div className="flex-1 overflow-y-auto no-scrollbar pt-4 pb-10">
          {showDemo ? (
            <>
              <div className="bg-surface border border-white/[.08] rounded-[22px] p-5">
                <div className="text-[12px] text-white/45 mb-3">Test funding account — demo only, not a real account</div>
                <Detail label="Bank" value="Providus Bank" onCopy={copy} />
                <Detail label="Account number" value="9901234567" onCopy={copy} />
                <Detail label="Account name" value={`Ttip / ${state.user.name}`} onCopy={copy} />
                <div className="mt-4 rounded-xl px-3.5 py-3 text-[12.5px]" style={{ background: "rgba(255,200,91,.08)", border: "1px solid rgba(255,200,91,.3)", color: "rgba(255,255,255,.75)" }}>
                  ⚠️ Demo account for testing only — do not send real money here.
                </div>
              </div>
              <button onClick={simulateNaira} disabled={loading} className="w-full mt-3 rounded-2xl border border-dashed border-good/40 text-good py-3.5 font-grotesk font-semibold text-[14px] active:scale-[.99] disabled:opacity-50">
                ▶ Simulate transfer +{fiat === "NGN" ? "₦50,000" : "50,000 " + fiat}
              </button>
            </>
          ) : (
            <div className="bg-surface border border-white/[.08] rounded-[22px] p-6 flex flex-col items-center text-center mt-1">
              <span className="w-12 h-12 rounded-full bg-surface2 flex items-center justify-center text-white/70"><Icon name="bank" size={22} /></span>
              <div className="font-grotesk font-semibold text-[16px] mt-3">Bank transfer coming soon</div>
              <p className="text-white/50 text-[13px] mt-1.5 leading-[1.6] max-w-[300px]">
                Funding your {fiat} balance by bank transfer isn&apos;t live yet. For now, add money with crypto — deposit any coin and it converts to {fiat} instantly.
              </p>
              <button onClick={() => setTab("crypto")} className="mt-4 bg-good text-ink h-11 px-6 rounded-xl font-grotesk font-semibold text-[14px]">
                Add with crypto
              </button>
            </div>
          )}
        </div>
      ) : live ? (
        <div className="flex-1 overflow-y-auto no-scrollbar pt-4 pb-10">
          {/* pick network + asset (any of Dextopus's supported chains/tokens) */}
          <button onClick={() => setChainSheet(true)} className="w-full flex items-center justify-between bg-surface border border-white/[.08] rounded-2xl px-4 h-[54px] active:scale-[.99]">
            <span className="text-[12px] text-white/40">Network</span>
            <span className="flex items-center gap-2 font-grotesk font-semibold text-[14px]">
              {selChain ? selChain.name : "Choose a chain"}
              <Icon name="chevronDown" size={15} className="text-white/50" />
            </span>
          </button>

          <button
            onClick={() => selChain && setTokenSheet(true)}
            disabled={!selChain}
            className="w-full flex items-center justify-between bg-surface border border-white/[.08] rounded-2xl px-4 h-[54px] mt-2.5 active:scale-[.99] disabled:opacity-40"
          >
            <span className="text-[12px] text-white/40">Asset</span>
            <span className="flex items-center gap-2 font-grotesk font-semibold text-[14px]">
              {selToken ? selToken.symbol : "Choose an asset"}
              <Icon name="chevronDown" size={15} className="text-white/50" />
            </span>
          </button>

          {addrLoading && (
            <div className="text-center text-white/45 text-[13px] py-10">Generating your {selToken?.symbol} address…</div>
          )}

          {addr && !addrLoading && (
            <>
              <div className="bg-surface border border-white/[.08] rounded-[22px] p-5 mt-3 flex flex-col items-center">
                <QR value={addr} size={172} />
                <div className="text-[11px] tracking-wide text-white/40 uppercase mt-4">{selChain?.name} · {selToken?.symbol}</div>
                <div className="font-grotesk text-[14px] break-all text-center mt-1.5 px-2">{addr}</div>
                <div className="flex gap-2.5 mt-4">
                  <button onClick={() => copy(addr)} className="rounded-full px-5 py-2.5 font-grotesk font-semibold text-[13px] bg-good text-ink">Copy address</button>
                  <button onClick={() => { if (navigator.share) navigator.share({ text: addr }).catch(() => {}); else copy(addr); }} className="rounded-full px-5 py-2.5 font-grotesk font-semibold text-[13px] border border-white/14">Share</button>
                </div>
              </div>
              <div className="mt-3 rounded-2xl px-4 py-3.5 text-[12.5px] leading-[1.55] flex gap-2.5" style={{ background: "rgba(255,200,91,.1)", border: "1px solid rgba(255,200,91,.35)", color: "rgba(255,255,255,.8)" }}>
                <span className="text-warn shrink-0">⚠</span>
                <span>
                  Send <b className="text-warn">only {selToken?.symbol}</b> on <b className="text-warn">{selChain?.name}</b> to this exact address.
                  Do <b className="text-warn">not</b> send any other coin — including the network&apos;s native coin
                  {selChain && [1, 10, 56, 137, 8453, 42161].includes(selChain.chainId) ? " (ETH)" : selChain?.name === "Tron" ? " (TRX)" : selChain?.name === "Solana" ? " (SOL)" : ""} —
                  it will be lost. It arrives as USDC in your wallet.
                </span>
              </div>
            </>
          )}

          {!selChain && (
            <div className="text-center text-white/40 text-[13px] py-10 leading-[1.6]">
              Deposit any coin from any of {chains.length || "70+"} chains.<br />Pick a network and asset to get your address.
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar pt-4 pb-10">
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

          {/* QR + address — only when a real address exists */}
          {net?.address ? (
            <>
              <div className="bg-surface border border-white/[.08] rounded-[22px] p-5 mt-3 flex flex-col items-center">
                <QR value={net.address} size={172} />
                <div className="text-[11px] tracking-wide text-white/40 uppercase mt-4">{net.network} Address</div>
                <div className="font-grotesk text-[14px] break-all text-center mt-1.5 px-2">{net.address}</div>
                <div className="flex gap-2.5 mt-4">
                  <button onClick={() => copy(net.address)} className="rounded-full px-5 py-2.5 font-grotesk font-semibold text-[13px] bg-good text-ink">
                    Copy address
                  </button>
                  <button
                    onClick={() => { if (navigator.share) navigator.share({ text: net.address }).catch(() => {}); else copy(net.address); }}
                    className="rounded-full px-5 py-2.5 font-grotesk font-semibold text-[13px] border border-white/14"
                  >
                    Share
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-xl px-3.5 py-3 text-[12.5px] flex gap-2" style={{ background: "rgba(255,200,91,.08)", border: "1px solid rgba(255,200,91,.3)", color: "rgba(255,255,255,.75)" }}>
                <span>⚠️</span>
                <span>
                  Only send <b className="text-warn">{asset?.name} ({sym})</b> on <b className="text-warn">{net.network}</b>. Other assets or networks will be lost.
                </span>
              </div>
            </>
          ) : (
            <div className="bg-surface border border-white/[.08] rounded-[22px] p-8 mt-3 flex flex-col items-center text-center">
              <div className="font-grotesk font-semibold text-[15px]">Deposit address unavailable</div>
              <div className="text-[13px] text-white/45 mt-1.5 leading-[1.5]">
                We&apos;re setting up your {sym} address. Pull to refresh in a moment, or pick another asset.
              </div>
            </div>
          )}

          {showDemo && (
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

      {/* Network picker */}
      <Sheet open={chainSheet} onClose={() => { setChainSheet(false); setChainQ(""); }} title="Choose a network">
        <input
          value={chainQ}
          onChange={(e) => setChainQ(e.target.value)}
          placeholder="Search 70+ chains"
          autoFocus
          className="w-full bg-surface border border-white/10 rounded-2xl px-4 h-[48px] outline-none text-[14px] focus:border-brand-cyan/50 mb-3"
        />
        <div className="flex flex-col gap-1 max-h-[55dvh] overflow-y-auto no-scrollbar">
          {chains
            .filter((c) => c.name.toLowerCase().includes(chainQ.toLowerCase()))
            .map((c) => (
              <button key={c.chainId} onClick={() => pickChain(c)} className="flex items-center justify-between px-4 py-3.5 rounded-2xl bg-surface border border-white/[.06] active:scale-[.99]">
                <span className="font-grotesk font-semibold text-[14px]">{c.name}</span>
                {selChain?.chainId === c.chainId && <Icon name="check" size={16} className="text-good" strokeWidth={2.6} />}
              </button>
            ))}
          {chains.length === 0 && <div className="text-center text-white/40 text-[13px] py-6">Loading chains…</div>}
        </div>
      </Sheet>

      {/* Asset picker */}
      <Sheet open={tokenSheet} onClose={() => { setTokenSheet(false); setTokenQ(""); }} title={`Choose an asset${selChain ? ` on ${selChain.name}` : ""}`}>
        <input
          value={tokenQ}
          onChange={(e) => setTokenQ(e.target.value)}
          placeholder="Search assets"
          autoFocus
          className="w-full bg-surface border border-white/10 rounded-2xl px-4 h-[48px] outline-none text-[14px] focus:border-brand-cyan/50 mb-3"
        />
        <div className="flex flex-col gap-1 max-h-[55dvh] overflow-y-auto no-scrollbar">
          {tokens
            .filter((t) => t.symbol.toLowerCase().includes(tokenQ.toLowerCase()) || t.name.toLowerCase().includes(tokenQ.toLowerCase()))
            .map((t) => (
              <button key={t.symbol} onClick={() => pickToken(t)} className="flex items-center justify-between px-4 py-3.5 rounded-2xl bg-surface border border-white/[.06] active:scale-[.99]">
                <span className="text-left">
                  <span className="font-grotesk font-semibold text-[14px] block">{t.symbol}</span>
                  <span className="text-[11.5px] text-white/40">{t.name}</span>
                </span>
                {selToken?.symbol === t.symbol && <Icon name="check" size={16} className="text-good" strokeWidth={2.6} />}
              </button>
            ))}
          {tokens.length === 0 && <div className="text-center text-white/40 text-[13px] py-6">No assets on this chain.</div>}
        </div>
      </Sheet>
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
