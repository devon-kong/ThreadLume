// Minimal raw-CDP driver for the M1 verification Chrome instance.
// Node ≥21 built-in WebSocket; no external dependencies. Uses the same
// command/result correlation protocol as puppeteer but only what the M1
// checks need: targets, page eval, input dispatch, network records.
export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 1;
    this.pending = new Map();
    this.listeners = new Map(); // event name -> Set<fn>
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}${msg.error.data ? `: ${msg.error.data}` : ""}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
  }

  static async connect(port) {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const info = await res.json();
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("ws connect failed")), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, sessionId) {
    const id = this.seq++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  async attach(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    return sessionId;
  }
}

export async function findOrCreateTab(port, url, { existing } = {}) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = existing ?? list.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
  if (!page) throw new Error("no page target");
  const cdp = await Cdp.connect(port);
  return { cdp, targetId: page.id };
}
