# DSHD design language: mobile remote interaction

[中文](design-language-mobile.md) | English

This is the full contract for the「Mobile remote interaction」section of [design-language.en.md](design-language.en.md); the token tables, mandatory rules and exceptions live in the parent document.

The page structure of remote Web and the Android bundled SPA follows the
Claude mobile app; colors, font stack and light/dark still come only from the
same-value token tables — no warm paper surface, serif type or second palette;
the desktop is unaffected. Canvas `--dsw-specific-sidebar-fill`, cards and the
floating composer card `--dsw-alias-bg-layer-1`, round buttons and pills
`--dsw-specific-sidebar-nav-item-hover`, selection and checks
`--dsw-alias-state-business-primary`, the user bubble stays
`--dsw-specific-bubble`, and the composer card only adds an `lv2` soft shadow.
The decision is in
[Mobile remote Claude-style structure](decisions/implemented/product/2026-09-24-mobile-remote-claude-structure.en.md).

Structure: a 48px top bar (menu / Git pill or session title / new chat); the
blank draft centers the whale mark, a time-of-day greeting and a workspace
chip; the resident composer is a floating card with 20px radius, its tool row a
32px round attach button, a「model · effort」pill, a plan pill, a round
permission button and a round send/stop button, with the running beam kept.
The drawer is 90% wide and holds the whale wordmark, sessions / workspace /
settings navigation,「Recent」single-line sessions (status-color dots for
running and pending approval), a first-character computer avatar (opening
connection details) and the「New session」primary pill; the full session list
is a full-screen task entered from「Sessions」. Settings is cards without
group labels (14px radius, 48px rows), topped by the computer card and the
workspace card, with「Disconnect this device」as its own card at the bottom.

Overlays: choices triggered from the composer (attachment source, model,
thinking effort, permission) use a bottom panel: 24px top radius, a 48px title
row and a carded list; the model panel's first page lists the current
provider's models, followed by「thinking effort / permission / more models」
drills that swap pages inside the panel with a way back. Menus triggered from
the top bar and list rows remain Menus anchored near the trigger
(`--dsw-specific-menu`, 20px radius), destructive confirmation remains a
centered Modal with 24px radius, and directory browsing and Git forms are
full-screen tasks.

Sizing: regular buttons 32px, full-row buttons 40px, list rows 40–54px; title
17/24, body 15/22, secondary 13/20, caption 12/18, editing controls 16/24;
icons 16 or 18px line icons. Web hit areas are at least 44 CSS px and Android
at least 48dp, made up with transparent expansion without enlarging visible
controls. Long model names may ellipsize but must not become only an arrow;
preserve zoom and selection, with code/table horizontal scrolling taking
priority over drawer gestures.

Screen, browser and Android Back share one navigation hierarchy. System Back
first dismisses an open keyboard. Restore focus without reopening the editor
keyboard, and make covered content inert. History contains no credentials or
draft text and never replays writes. Keep success and retryable errors in their
task; dismissing approval details is not a rejection. Reading may collapse a
long draft without losing its contents or selection. Use baseline transform and
opacity motion tokens, with no animation under reduced motion.

Android keeps the stable asset origin and shared Web sources. Native code owns
only navigation hosting, scanning/media capture, keyboard and lifecycle duties.
Web and Android have separate acceptance evidence; historical exclusions are not
passing results for the new delivery.
