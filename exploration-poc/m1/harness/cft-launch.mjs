// M1 verification Chrome launcher: spawns the local Chrome for Testing binary
// with --remote-debugging-pipe (fd3/fd4 NUL-delimited JSON CDP transport —
// the mechanism Playwright uses; avoids the port-binding flakiness of
// --remote-debugging-port in this environment). Real MV3 extension load via
// --load-extension (supported on Chrome for Testing, unlike branded Chrome).
// Exposes: connect() -> { cdp, sessionIdOf(pageUrl?), closeAll() }.
import { spawn } from "node:child_process";

const CHROME_FOR_TESTING = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export async function launchChromeForTesting({ userDataDir, extensions = [], url = "about:blank", windowSize = "1440,900", headless = false }) {
  const args = [
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-pipe",
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${windowSize}`,
    ...(extensions.length ? extensions.map((e) => `--load-extension=${e}`) : []),
    ...(headless ? ["--headless=new"] : []),
    url,
  ];
  const child = spawn(CHROME_FOR_TESTING, args, {
    stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"], // 3=chrome→client, 4=client→chrome
  });

  const pending = new Map();
  const listeners = new Map();
  let seq = 1;
  let bufIn = "";

  // Chromium pipe protocol (same as Playwright's PipeTransport): the client
  // WRITES commands to stdio[3] and READS responses/events from stdio[4];
  // messages are NUL-delimited JSON.
  const dispatchOut = (msg) => {
    const id = seq++;
    child.stdio[3].write(JSON.stringify({ id, ...msg }) + "\0");
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP pipe timeout: ${msg.method ?? "reply"}`)); }
      }, 60_000);
    });
  };

  const handleMessage = (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}${msg.error.data ? `: ${msg.error.data}` : ""}`));
      else resolve(msg.result ?? {});
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params ?? {}, msg.sessionId);
    }
  };

  child.stdio[4].setEncoding("utf8");
  child.stdio[4].on("data", (chunk) => {
    bufIn += chunk;
    let idx;
    while ((idx = bufIn.indexOf("\0")) >= 0) {
      handleMessage(bufIn.slice(0, idx));
      bufIn = bufIn.slice(idx + 1);
    }
  });

  const cdp = {
    send: (method, params = {}, sessionId) => {
      const msg = { method, params };
      if (sessionId) msg.sessionId = sessionId;
      return dispatchOut(msg);
    },
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    close: () => child.kill("SIGTERM"),
    child,
  };

  // wait for the browser to accept the first command
  await cdp.send("Browser.getVersion");
  return cdp;
}

export async function attachToPage(cdp, { urlIncludes = "" } = {}) {
  const { targetInfos } = await cdp.send("Target.getTargets");
  const page = targetInfos.find((t) => t.type === "page" && t.url.includes(urlIncludes));
  if (!page) throw new Error(`no page target matching "${urlIncludes}": ${targetInfos.map((t) => t.type + ":" + t.url.slice(0, 60)).join(", ")}`);
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  return { sessionId, targetId: page.targetId, url: page.url };
}

export async function evalIn(cdp, sessionId, expression, { awaitPromise = false } = {}) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, sessionId);
  if (r.exceptionDetails) throw new Error(`page eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}
