/**
 * Banks as people actually say them.
 *
 * The official list says "Moniepoint Microfinance Bank". Nobody says that. They
 * say "Moniepoint", and when it arrives through a voice note the transcriber
 * writes "Money point" — two words, wrong spelling, and no match at all. That
 * one gap is why Ada asked "which bank is 9136214038?" about a message that had
 * already told her, and it is the difference between a transfer that takes one
 * sentence and one that takes five.
 *
 * Two cheap tricks cover most of it:
 *
 *  1. A table of the forms people say and mis-transcribe, mapped to a fragment
 *     of the real name.
 *  2. Matching with the spaces taken out, so "o pay", "palm pay" and "gt bank"
 *     find opay, palmpay and gtbank without needing their own entries.
 *
 * Dependency-free so it can be unit-tested.
 */

/** Spoken form → a distinctive fragment of the official name. */
const SPOKEN: [RegExp, string][] = [
  // The fintechs, which is where nearly all of this traffic goes.
  [/\bmon(?:ie|ey|i)\s*-?\s*points?\b/, "moniepoint"],
  [/\bo\s*-?\s*pay\b|\bpaycom\b/, "opay"],
  [/\bpalm\s*-?\s*pay\b/, "palmpay"],
  [/\bkuda\b/, "kuda"],
  [/\bfair\s*-?\s*money\b/, "fairmoney"],
  [/\bcarbon\b/, "carbon"],
  [/\bsparkle\b/, "sparkle"],
  [/\brubies\b/, "rubies"],
  [/\beyowo\b/, "eyowo"],
  [/\bgo\s*-?\s*money\b/, "gomoney"],
  [/\bv\s*f\s*d\b/, "vfd"],
  [/\b9\s*(?:psb|payment)\b/, "9 payment"],

  // The big banks, by the names on the street.
  [/\b(?:gt\s*-?\s*bank|gtb|gt)\b|\bguarant(?:y|ee)\s*trust\b/, "guaranty trust"],
  [/\bfirst\s*-?\s*bank\b|\bfbn\b/, "first bank of nigeria"],
  [/\buba\b|\bunited\s*bank\s*for\s*africa\b/, "united bank for africa"],
  [/\bfcmb\b|\bfirst\s*city\s*monument\b/, "first city monument"],
  [/\bzenith\b/, "zenith"],
  [/\baccess\s*bank\b/, "access bank"],
  [/\bfidelity\b/, "fidelity"],
  [/\bsterling\b/, "sterling"],
  [/\bunion\s*bank\b/, "union bank"],
  [/\bunity\s*bank\b/, "unity"],
  [/\bpolaris\b/, "polaris"],
  [/\bkeystone\b/, "keystone"],
  [/\bwema\b/, "wema"],
  [/\balat\b/, "alat"],
  [/\bstanbic\b|\bibtc\b/, "stanbic"],
  [/\beco\s*-?\s*bank\b/, "ecobank"],
  [/\bprovidus\b/, "providus"],
  [/\bjaiz\b/, "jaiz"],
  [/\bheritage\b/, "heritage"],
  [/\bglobus\b/, "globus"],
  [/\btitan\b/, "titan"],
  [/\bsun\s*-?\s*trust\b/, "suntrust"],
  [/\btaj\b/, "taj"],
  [/\blotus\b/, "lotus"],
  [/\boptimus\b/, "optimus"],
  [/\bparallex\b/, "parallex"],
  [/\bpremium\s*-?\s*trust\b/, "premiumtrust"],
  [/\bstandard\s*chartered\b/, "standard chartered"],
  [/\bciti\s*-?\s*bank\b/, "citibank"],
];

const clean = (s: string) =>
  (s ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** The same, with the spaces closed up: "o pay" → "opay". */
const squash = (s: string) => clean(s).replace(/ /g, "");

/**
 * The bank named in a message, allowing for how it was said or transcribed.
 *
 * Returns a name from `banks` — never an invented one — or undefined when
 * nothing matched, because "I'm not sure which bank" has to become a question.
 */
export function spokenBank(text: string, banks: readonly string[]): string | undefined {
  const q = clean(text);
  if (!q) return undefined;

  for (const [pattern, fragment] of SPOKEN) {
    if (!pattern.test(q)) continue;
    const hit = banks.find((b) => clean(b).includes(fragment));
    if (hit) return hit;
  }

  // Spaces closed up, longest name first so "Access Bank" beats "Access".
  const squashed = squash(text);
  const sorted = [...banks].sort((a, b) => b.length - a.length);
  for (const b of sorted) {
    const key = squash(
      b.replace(/\(.*?\)/g, " ").replace(/\b(bank|plc|limited|ltd|mfb|microfinance|nigeria)\b/gi, " "),
    );
    // Four characters minimum: shorter keys match inside ordinary words once
    // the spaces are gone, and a wrongly guessed bank sends money nowhere good.
    if (key.length >= 4 && squashed.includes(key)) return b;
  }
  return undefined;
}
