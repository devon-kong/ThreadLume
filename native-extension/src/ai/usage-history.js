import {
  cleanUsageRecord,
  USAGE_BUSY,
  USAGE_TTL,
  USAGE_LIMIT,
} from "./usage.js";
const KEY = "aiUsageHistoryV1";

export function createUsageHistory({
  storage,
  now = Date.now,
  onChange = () => {},
} = {}) {
  let records = [],
    epoch = 0,
    revision = 0,
    persisted = 0,
    persistence = "ready",
    pending = null,
    loading = null,
    writable = false;
  function prune() {
    const time = now();
    records = records
      .filter((r) => r.startedAt <= time && time - r.startedAt <= USAGE_TTL)
      .sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
      .slice(0, USAGE_LIMIT);
  }
  function schedule() {
    if (!writable) {
      persistence = "unavailable";
      return;
    }
    revision++;
    if (pending) return;
    pending = Promise.resolve()
      .then(async () => {
        while (persisted !== revision) {
          const version = revision;
          prune();
          try {
            await storage.set({
              [KEY]: { schema: 1, records: records.map(cleanUsageRecord) },
            });
            persistence = "ready";
          } catch {
            persistence = "unavailable";
            persisted = version;
            if (revision === version) return;
            continue;
          }
          persisted = version;
        }
      })
      .finally(() => {
        pending = null;
        onChange();
        if (persisted !== revision) schedule();
      });
  }
  return {
    init() {
      return (loading ??= (async () => {
        const at = epoch;
        try {
          const value = (await storage.get(KEY))[KEY];
          writable = true;
          if (
            epoch !== at ||
            value?.schema !== 1 ||
            !Array.isArray(value.records)
          )
            return;
          records = value.records
            .slice(0, USAGE_LIMIT)
            .map(cleanUsageRecord)
            .filter(Boolean);
          let changed = records.length !== value.records.length;
          for (const row of records)
            if (USAGE_BUSY.has(row.status)) {
              row.status = "interrupted";
              for (const request of row.requests)
                if (USAGE_BUSY.has(request.status)) {
                  request.status = "interrupted";
                  request.outputComplete = false;
                }
              changed = true;
            }
          const before = records.length;
          prune();
          if (changed || before !== records.length) schedule();
        } catch {
          persistence = "unavailable";
        }
      })());
    },
    ticket: () => epoch,
    current: (ticket) => ticket === epoch,
    state: () => persistence,
    write(value, ticket) {
      if (ticket !== epoch) return;
      const record = cleanUsageRecord(value);
      if (!record) return;
      records = records.filter((r) => r.id !== record.id);
      records.push(record);
      prune();
      schedule();
    },
    snapshot() {
      const before = records.length;
      prune();
      if (before !== records.length) schedule();
      return { schema: 1, persistence, records: records.map(cleanUsageRecord) };
    },
    find(id) {
      return this.snapshot().records.find((r) => r.id === id) || null;
    },
    async clear() {
      epoch++;
      records = [];
      writable = true;
      schedule();
      await this.flush();
      return this.snapshot();
    },
    async flush() {
      while (pending) await pending;
    },
  };
}
