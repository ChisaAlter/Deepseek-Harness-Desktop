# Pet theme transparency verification — 2026-09-29

- Regression before fix: `node --test --test-name-pattern='theme changes preserve' src/main/desktop-live2d.test.js` failed because dark theme changed the pet backing from `#00000000` to `#151517`.
- Focused tests: 99 passed (desktop-live2d, pet-live2d, chrome-theme).
- Full `npm test`: 2811 passed, 2 skipped, 0 failed.
- Real Electron 43.4.0: the actual pet manager created hidden native windows and loaded the bundled renderer. Dark/light/system/dark was applied before and after recreation (8 checks). Empty-corner capture pixels remained alpha 0, html/body remained transparent, and an opaque control window repainted normally. See [electron-theme.json](electron-theme.json). This verifies native backing and pixels; it does not claim a visible-desktop interaction review.
- Source application restarted through `npm start`; prestart completed and the repo Electron process remained running.
- `npm run check:governance`: 6/6 passed.
- `npm run doc-sync`: 7/8 passed. Existing design-language word budget failure: 14497 words before this fix versus the 14400 ceiling; 14542 afterward. No budget rule was changed.