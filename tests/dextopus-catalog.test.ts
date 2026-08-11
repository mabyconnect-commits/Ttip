import test from "node:test";
import assert from "node:assert/strict";

/**
 * Solana and Bitcoin deposits produced no address at all. Three reasons, all
 * about the shape of the Dextopus catalog:
 *
 *   - the catalog is ONE call — `GET /deposit/tokens` with no parameters —
 *     returning `{ chains: [...] }` with each chain's tokens inline;
 *   - the depositable tokens are in `solverCurrencies`, not `featuredTokens`;
 *   - addresses are minted per FAMILY through a canonical origin, not per
 *     (chain, token), which is what the non-EVM families reject.
 *
 * These run against a stub server serving the real response shape, so a
 * regression in the parsing shows up here rather than as "not available for
 * deposit right now" on someone's phone.
 */

process.env.DEXTOPUS_API_KEY = "test-key";
// DEXTOPUS_BASE_URL is set in start(), once the stub server has a port.
process.env.DEXTOPUS_SETTLEMENT_CHAIN_ID = "8453";
process.env.DEXTOPUS_SETTLEMENT_ASSET = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
process.env.DEXTOPUS_SETTLEMENT_ADDRESS = "0x1111111111111111111111111111111111111111";

const SOLANA = 792703809;
const BITCOIN = 8253038;
const TRON = 728126428;

/** The catalog shape Dextopus actually returns. */
const CATALOG = {
  chains: [
    {
      chainId: 1,
      name: "ethereum",
      supportsStaticAddress: true,
      featuredTokens: [{ symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", metadata: { logoURI: "x" } }],
      solverCurrencies: [
        { symbol: "ETH", name: "Ether", address: "0x0000000000000000000000000000000000000000", decimals: 18 },
        { symbol: "USDC", name: "USD Coin", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
      ],
    },
    {
      chainId: 8453,
      name: "base",
      supportsStaticAddress: true,
      solverCurrencies: [{ symbol: "USDC", name: "USD Coin", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 }],
    },
    {
      chainId: SOLANA,
      name: "solana",
      supportsStaticAddress: true,
      // The list we were NOT reading — and the only one that matters.
      solverCurrencies: [
        { symbol: "SOL", name: "Solana", address: "11111111111111111111111111111111", decimals: 9 },
        { symbol: "USDC", name: "USD Coin", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
      ],
    },
    {
      chainId: BITCOIN,
      name: "bitcoin",
      supportsStaticAddress: true,
      solverCurrencies: [{ symbol: "BTC", name: "Bitcoin", address: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8", decimals: 8 }],
    },
    {
      chainId: TRON,
      name: "tron",
      supportsStaticAddress: true,
      solverCurrencies: [{ symbol: "USDT", name: "Tether", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 }],
    },
    // Present in the catalog but switched off — must never be offered.
    {
      chainId: 999999,
      name: "retired-chain",
      disabled: true,
      solverCurrencies: [{ symbol: "OLD", name: "Old", address: "0x2222222222222222222222222222222222222222" }],
    },
  ],
};

interface Minted {
  userId: string;
  originChainId: number;
  originAsset: string;
  settlementChainId: number;
  settlementAsset: string;
  settlementAddress: string;
  refundTo?: string;
  metadata?: { family?: string };
}

const minted: Minted[] = [];
let catalogHits = 0;
let server: import("node:http").Server;

async function start() {
  const http = await import("node:http");
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = req.url ?? "";
      if (url.startsWith("/api/deposit/tokens")) {
        catalogHits += 1;
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify(CATALOG));
      }
      if (url.startsWith("/api/deposit/static/addresses") && req.method === "GET") {
        const existing = minted.map((m, i) => ({ ...m, id: `id-${i}`, depositAddress: addressFor(m) }));
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ success: true, data: existing }));
      }
      if (url.startsWith("/api/deposit/static/addresses") && req.method === "POST") {
        const payload = JSON.parse(body) as Minted;
        minted.push(payload);
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ success: true, data: { id: "new", depositAddress: addressFor(payload) } }));
      }
      res.writeHead(404).end("{}");
    });
  });
  // Port 0 — the OS picks a free one. A fixed port collides with a stray
  // process from an earlier run and fails the suite for reasons that have
  // nothing to do with the code under test.
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  // Never let the stub hold the event loop open — otherwise the run finishes
  // its assertions and then hangs forever waiting on a socket.
  server.unref();
  const addr = server.address();
  process.env.DEXTOPUS_BASE_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api`;
}

/** A distinct address per origin, so tests can tell families apart. */
function addressFor(m: { originChainId: number }): string {
  if (m.originChainId === SOLANA) return "So1anaDepositAddr1111111111111111111111111";
  if (m.originChainId === BITCOIN) return "bc1qdepositaddressforbitcoin00000000000000";
  if (m.originChainId === TRON) return "TDepositAddressForTron000000000000";
  return "0xEvmDepositAddress00000000000000000000000";
}

test("dextopus catalog + address generation", async (t) => {
  await start();
  const dx = await import("../src/lib/settlement/dextopus");

  await t.test("chains come from the single catalog call", async () => {
    const chains = await dx.listChains();
    const ids = chains.map((c) => c.chainId);
    assert.ok(ids.includes(SOLANA), "Solana missing from the catalog");
    assert.ok(ids.includes(BITCOIN), "Bitcoin missing from the catalog");
    assert.ok(ids.includes(TRON), "Tron missing from the catalog");
    assert.ok(ids.includes(1) && ids.includes(8453));
  });

  await t.test("a disabled chain is never offered", async () => {
    const chains = await dx.listChains();
    assert.ok(!chains.some((c) => c.chainId === 999999), "a disabled chain was offered");
  });

  await t.test("tokens come from solverCurrencies", async () => {
    assert.deepEqual((await dx.listTokens(SOLANA)).map((x) => x.symbol).sort(), ["SOL", "USDC"]);
    assert.deepEqual((await dx.listTokens(BITCOIN)).map((x) => x.symbol), ["BTC"]);
  });

  await t.test("SOL and BTC resolve to a token address — the bug that broke both", async () => {
    const cfg = { apiKey: "x" } as never;
    assert.equal(await dx.resolveTokenAddress(cfg, SOLANA, "SOL"), "11111111111111111111111111111111");
    assert.equal(await dx.resolveTokenAddress(cfg, BITCOIN, "BTC"), "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8");
    assert.equal(await dx.resolveTokenAddress(cfg, SOLANA, "usdc"), "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  await t.test("a settlement asset given as a contract address is used as-is", async () => {
    // Configured as an address, not a ticker. Treating it as a symbol failed to
    // resolve and disabled every deposit.
    const cfg = { apiKey: "x" } as never;
    const addr = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    assert.equal(await dx.resolveTokenAddress(cfg, 8453, addr), addr);
  });

  await t.test("families are classified correctly", () => {
    assert.equal(dx.chainFamily(SOLANA, "solana"), "solana");
    assert.equal(dx.chainFamily(BITCOIN, "bitcoin"), "bitcoin");
    assert.equal(dx.chainFamily(TRON, "tron"), "tron");
    assert.equal(dx.chainFamily(1, "ethereum"), "evm");
    assert.equal(dx.chainFamily(8453, "base"), "evm");
    // Unknown id, known name — a new network shouldn't need a code change.
    assert.equal(dx.chainFamily(123456, "solana-devnet"), "solana");
  });

  await t.test("a Solana deposit mints through the Solana canonical origin", async () => {
    minted.length = 0;
    const res = await dx.createDepositAddress("user-1", SOLANA, "SOL");
    assert.ok(res, "no address returned for SOL");
    assert.equal(res!.address, "So1anaDepositAddr1111111111111111111111111");
    assert.equal(minted[0].originChainId, SOLANA);
    assert.equal(minted[0].originAsset, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    assert.equal(minted[0].metadata?.family, "solana");
  });

  await t.test("a Bitcoin deposit mints through the Bitcoin canonical origin", async () => {
    minted.length = 0;
    const res = await dx.createDepositAddress("user-2", BITCOIN, "BTC");
    assert.ok(res, "no address returned for BTC");
    assert.equal(res!.address, "bc1qdepositaddressforbitcoin00000000000000");
    assert.equal(minted[0].originChainId, BITCOIN);
    assert.equal(minted[0].metadata?.family, "bitcoin");
  });

  await t.test("the settlement target is passed through resolved", async () => {
    minted.length = 0;
    await dx.createDepositAddress("user-3", 1, "ETH");
    assert.equal(minted[0].settlementChainId, 8453);
    assert.equal(minted[0].settlementAsset, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    assert.equal(minted[0].settlementAddress, "0x1111111111111111111111111111111111111111");
  });

  await t.test("an existing address is reused instead of minting a second", async () => {
    minted.length = 0;
    const first = await dx.createDepositAddress("user-4", SOLANA, "SOL");
    const mintedAfterFirst = minted.length;
    // A different chain+token in the SAME family must return the same address
    // without a second POST.
    const second = await dx.createDepositAddress("user-4", SOLANA, "USDC");
    assert.equal(minted.length, mintedAfterFirst, "minted a duplicate address");
    assert.equal(second!.address, first!.address);
  });

  await t.test("every EVM chain shares one address", async () => {
    minted.length = 0;
    const eth = await dx.createDepositAddress("user-5", 1, "ETH");
    const base = await dx.createDepositAddress("user-5", 8453, "USDC");
    assert.equal(base!.address, eth!.address);
    assert.equal(minted.length, 1, "EVM chains minted more than one address");
  });

  await t.test("the catalog is fetched once, not per lookup", () => {
    assert.ok(catalogHits <= 2, `catalog fetched ${catalogHits} times — caching is broken`);
  });

  // Keep-alive sockets from fetch hold the event loop open and the whole
  // suite hangs after the last assertion, so drop them explicitly.
  server.closeAllConnections?.();
  server.close();
});
