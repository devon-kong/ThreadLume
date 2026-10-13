# M2-B0 throwaway probes (NO-GO)

Not a product mode. Not included in either extension build. No private requests,
React internals, native DOM cloning or reparenting. Keep the M1-R base unchanged.

- `probe.mjs`: standalone functions accepted by EgoBrowser page.evaluate.
- `probe.test.mjs`: identity/events/removal/route-cleanup semantics in jsdom.
- `run-layout.mjs`: fixed three-viewports and one inner-scroll repair.
- `run-b.mjs`: same native media + exact M1-R copy; inherited eviction failure.
- `run-samples.mjs`: public content structure inventory, not full media acceptance.
- `perf-diagnostic.mjs`: original fixed 12 windows, invalid T2 detector retained.
- `perf-highreply-repair.mjs`: one instrumentation correction and six fixed
  diagnostic windows; does not replace the original dataset or old M2-A FAIL.

These run scripts record this session's explicit workspace path and TaskSpace 19.
Do not blindly rerun: establish an authorized visible EgoBrowser task space,
update paths/space ID, disable conflicting Peek through the browser UI, and
restore its original enabled state when done. No new hidden data tabs.

Run offline: `node --test exploration-poc/m2-b0/probe.test.mjs`.
Browser scripts use `ego-browser nodejs < ...`; helper functions require a
hydrated detail with its own time permalink and composer in the focal cell.
`window.__m2b0.undo()` restores owned styles/attributes/listeners; reload fully
clears test references. Undo cannot undo X's already-completed media unmount.

See `docs/m2-b0/architecture-gate.md` for findings and explicit untested scope.
