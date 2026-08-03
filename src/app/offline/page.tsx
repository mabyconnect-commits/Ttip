/**
 * Shown by the service worker when a navigation is attempted with no network.
 *
 * Deliberately shows NO balances or figures — the point of this page is that we
 * couldn't reach the server, so any number on it would be a guess. It just says
 * so and offers a retry.
 */
export const metadata = { title: "Offline — Ttip" };

export default function OfflinePage() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 min-h-[80vh] px-8 text-center">
      <div className="w-16 h-16 rounded-full bg-surface2 flex items-center justify-center text-[28px]">📡</div>
      <h1 className="font-grotesk font-bold text-[20px] mt-4">You&apos;re offline</h1>
      <p className="text-white/50 text-[13.5px] mt-2 leading-[1.55]">
        Ttip needs a connection to show your balance and move money. Your funds are safe — reconnect and pull down to
        refresh.
      </p>
      <a
        href="/home"
        className="mt-6 h-[50px] px-6 rounded-2xl bg-good text-ink flex items-center justify-center font-grotesk font-semibold text-[14.5px]"
      >
        Try again
      </a>
    </div>
  );
}
