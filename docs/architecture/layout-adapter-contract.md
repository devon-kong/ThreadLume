# Native layout adapter contract

## Purpose and scope

Keep the current native focal post and comments visible in a two-column reader without cloning X's live DOM or replacing its account interactions. The adapter runs in MAIN at document start and affects only the currently owned native detail view.

## Admission

- Require a supported X detail route, an unambiguous focal cell and a recognizable native virtual-list owner.
- Reject quoted/nested content as the focal owner unless independently identified as the current detail route.
- Feature-detect the exact supported virtualizer shape. Unknown or changed internals must degrade to X's native view.
- Do not expand the adapter to unrelated lists, private HTTP APIs, credential access or general React mutation.

## Ownership

- Retain native node identity for posts, videos, controls and comments.
- Keep any virtualizer wrapping reversible and bounded to the active session. Restore only properties and functions still owned by that session; do not overwrite a newer X assignment.
- Height leases, anchor records and positional adjustments carry generation/ownership identity. Recycled nodes and replaced native owners cannot inherit an old lease.
- Explicit left-side release must resolve before native click handling continues. A stale or replaced cell must fail closed rather than guessing another owner.
- Extension chrome owns its geometry and background drawing. It must not capture wheel events outside its intended column, synthesize account writes or interfere with media overlays.

## Exit and recovery

- Explicit Back uses a proven safe same-site history entry when available; otherwise release to native view in place.
- Native-view and route-change exits release wrappers, layout markers, observers, temporary geometry and extension-owned controls.
- Preserve the original timeline anchor. Restoration is a bounded correction after native layout stabilizes, not continuous scroll enforcement.
- When a deep Article position has no trustworthy restoration path, use the documented native-view degradation rather than inventing an anchor.
- Cleanup is idempotent after partial mounting, cancellation, route changes, source replacement and recycled nodes.

## Invariants and validation

There is no duplicated native comment tree, no active X API bridge, no new authentication capability and no AI dependency in MAIN. UI preferences cannot change the scope of the adapter.

The Native suite covers lifecycle ownership, source replacement, synchronous release, stale lease rejection, anchor restoration, native media identity and fail-closed fallback. Real-browser scrolling and X compatibility still require separate verification because fixture virtualizers cannot establish live React behavior.
