# Decision: Stabilize the draft entry hold and composite its glide

Status: implemented

[中文](2026-09-23-composer-enter-hold.md) | English

## Problem

On first send, the composer stays at its draft position until the conversation structure settles, then glides to the footer. The `--dsh-composer-enter-offset` used to counter layout drift is written inside the observed region. Its `MutationObserver` treated that style write as external structural churn and restarted the 80ms quiet timer. Repeated layout changes could delay the glide until the 450ms cap. The subsequent relative `top` animation also requires main-thread layout on every frame. A headed browser run showed 33/52/100ms frame gaps near the end of the glide and a final jump of about 40px.

## Decision

The composer continues to observe conversation structure and size changes to hold its draft position and defer the glide. The observer ignores changes to the composer stack’s own `style` attribute. Real child or external layout changes still extend the quiet period. Once released, only the first-send composer stack animates with `transform: translateY()`, allowing the compositor to advance it independently. Completion or cancellation clears the transform. Built-in fixed overlays mount in page portals, while the static Hero layout uses no transform; reduced motion settles immediately.

## Alternatives considered

- **Remove the post-send hold** — rejected: mounting the transcript and running controls would still compete with the position animation on the main thread and cause a jump during the glide.
- **Always wait the full 450ms** — rejected: sends without structural changes would also incur the maximum delay and feel unresponsive.
- **Keep `top` and extend the quiet period** — rejected: reply startup and later projections can still occur during the glide; a layout animation cannot avoid that main-thread work.

## Consequences

The pin style no longer delays the glide. Real layout changes may still use up to 450ms to settle. Composite motion reduces interruptions from main-thread work. During animation the stack briefly becomes a containing block for fixed descendants, so built-in fixed overlays must remain in page portals. A focused test writes the offset style late in the quiet period; browser checks cover the glide, overlays, and reduced motion.
