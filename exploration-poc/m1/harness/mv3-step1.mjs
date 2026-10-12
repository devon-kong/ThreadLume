// M1-C checklist step 1: confirm the real MV3 native extension is loaded in
// the verification Chrome instance, then open X explore and confirm the
// content script is alive (real extension — no CDP injection anywhere).
import { Cdp } from "./cdp.mjs";

const PORT = 9333;
const cdp = await Cdp.connect(PORT);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tab = list.find((t) => t.type === "page");
const sessionId = await cdp.attach(tab.id);

const evalIn = async (expression, awaitPromise = false) => {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, sessionId);
  if (r.exceptionDetails) throw new Error(`page eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
};

// extension state (this is the verification profile's own chrome.developerPrivate — WebUI only;
// from a normal page we use chrome.runtime instead)
const targets = await cdp.send("Target.getTargets");
const extTargets = targets.targetInfos.filter((t) => t.type === "service_worker" || t.url.includes("chrome-extension://"));
console.log("extension-related targets:", extTargets.map((t) => `${t.type}:${t.url.slice(0, 80)}`));

await cdp.send("Page.enable", {}, sessionId);
await cdp.send("Runtime.enable", {}, sessionId);

// network recording for the whole checklist run (read-only census)
const netRecords = [];
cdp.on("Network.requestWillBeSent", (p) => {
  if (p.sessionId && p.sessionId !== sessionId) return;
  netRecords.push({ t: Date.now(), url: p.request.url, method: p.request.method, type: p.type, initiator: p.initiator?.type });
});
await cdp.send("Network.enable", {}, sessionId);

await cdp.send("Page.navigate", { url: "https://x.com/explore" }, sessionId);
await new Promise((r) => setTimeout(r, 8000));
const state1 = await evalIn(`(() => ({
  url: location.href,
  title: document.title,
  loggedIn: Boolean(document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')),
  cells: document.querySelectorAll('[data-testid="cellInnerDiv"]').length,
  htmlAttrs: [...document.documentElement.attributes].map(a => a.name).filter(n => n.startsWith("data-peek")),
}))()`);
console.log("explore:", JSON.stringify(state1, null, 2));

// real extension probe: content script world state via chrome.runtime injection check.
// The pane only exists on detail pages; here we verify the script installed its
// DOM listeners by checking the extension's isolated world is running —
// indirect but sufficient: navigate to a status page and look for the pane.
const samples = await evalIn(`(() => {
  const links = [...document.querySelectorAll('a[href*="/status/"]')]
    .map(a => new URL(a.href).pathname)
    .filter(p => /\\/status\\/\\d+$/.test(p));
  return [...new Set(links)].slice(0, 5);
})()`);
console.log("sample status links:", samples);

console.log("net records so far:", netRecords.length);

process.exit(0);
