import test from "node:test";
import assert from "node:assert/strict";
import { isIos, isInAppBrowser, installRoute, iosBrowserName, iosShareHint } from "../src/lib/install";

/** Real user-agent strings, because this is entirely about telling devices apart. */
const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  ipadOS:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 331.0.0.37.90 (iPhone14,3)",
};

test("an iPhone is detected", () => {
  assert.equal(isIos({ userAgent: UA.iphoneSafari }), true);
  assert.equal(isIos({ userAgent: UA.iphoneChrome }), true);
});

test("a modern iPad is detected — it reports itself as a Mac", () => {
  // iPadOS 13+ sends a Macintosh UA. Testing /iPad/ alone misses every current
  // iPad, which is why iPad users were shown nothing at all.
  assert.equal(isIos({ userAgent: UA.ipadOS, maxTouchPoints: 5 }), true);
});

test("an actual Mac is not mistaken for an iPad", () => {
  assert.equal(isIos({ userAgent: UA.mac, maxTouchPoints: 0 }), false);
  assert.equal(isIos({ userAgent: UA.ipadOS, maxTouchPoints: 0 }), false);
});

test("Android is not iOS", () => {
  assert.equal(isIos({ userAgent: UA.androidChrome }), false);
});

test("in-app browsers are recognised", () => {
  assert.equal(isInAppBrowser(UA.instagram), true);
  assert.equal(isInAppBrowser(UA.iphoneSafari), false);
});

test("iPhone Safari is offered the manual Share route", () => {
  assert.equal(installRoute({ userAgent: UA.iphoneSafari }, false), "ios-share");
});

test("iPhone Chrome gets it too — it can add to the home screen", () => {
  // This used to be excluded, so Chrome-on-iPhone users were shown nothing.
  assert.equal(installRoute({ userAgent: UA.iphoneChrome }, false), "ios-share");
});

test("an in-app browser is told to open the site properly instead", () => {
  // "Tap Share" is useless in a webview that has no Share button.
  assert.equal(installRoute({ userAgent: UA.instagram }, false), "open-in-browser");
});

test("Android uses the real install prompt when one is available", () => {
  assert.equal(installRoute({ userAgent: UA.androidChrome }, true), "prompt");
  assert.equal(installRoute({ userAgent: UA.androidChrome }, false), "none");
});

test("nothing is offered once it's already installed", () => {
  assert.equal(installRoute({ userAgent: UA.iphoneSafari, standalone: true }, false), "none");
  assert.equal(installRoute({ userAgent: UA.androidChrome, displayModeStandalone: true }, true), "none");
});

test("the instructions name the browser and where its Share button is", () => {
  assert.equal(iosBrowserName(UA.iphoneSafari), "Safari");
  assert.equal(iosBrowserName(UA.iphoneChrome), "Chrome");
  assert.match(iosShareHint(UA.iphoneSafari), /bottom/);
  assert.match(iosShareHint(UA.iphoneChrome), /top right/);
});
