# ThreadLume: engineering a focused reading experience

## The problem

Reading long X posts and their conversations requires frequent navigation and context switching. Adding AI introduces another set of problems: waiting for a full response, losing useful output when switching views, handling unreliable provider responses and keeping native video and comments working.

## Engineering work

**Native reading architecture.** Implemented an isolated reader controller and a bounded MAIN-world layout adapter. The design retains the original media and comment nodes, with explicit ownership and reversible layout changes. This makes native interaction continuity a core acceptance condition.

**AI integration.** Implemented configurable Chat Completions services with versioned keys, atomic binding, narrowly requested permissions and explicit recovery. Service setup validates compatibility before replacing a working configuration. Generation does not silently select a different provider or resend a failed request.

**Progressive visualization.** Implemented streamed summaries and validated partial mind maps, separate result caches, readable initial branch depth, pan/zoom, outline copying and source search. Unfinished content remains distinguishable from a complete result.

**Reliability.** Added document-scoped request ownership, cancellation, stale-response rejection, worker restoration and regression coverage for interrupted saves and bindings. Successful content is preserved while unrelated views recover from errors.

**Product polish.** Created the ThreadLume brand assets, English-first bilingual controls, independent remembered output language, direct service onboarding and actionable error states.

## Tradeoffs

- Native content preserves interaction fidelity but depends on X's changing DOM and internal virtualizer. The adapter has a narrow contract and degrades when ownership cannot be proven.
- On-demand generation reduces unnecessary work; opening an uncached second view still requires another request.
- Streaming improves when content becomes readable, but does not guarantee faster model completion.
- A configurable provider keeps control with the user, at the cost of initial API setup.
- The unstable Doubao bridge was retired; compatible API services are the supported AI path.

## Evidence

The repository includes the implementation, behavioral regressions, isolation checks and a reproducible build. [Validation](validation.md) separates automated results from actual browser/service observations. It makes no claim of user adoption, client revenue or universal model compatibility.

A combined portfolio video will be produced separately. This case study focuses on implementation and observable behavior.
