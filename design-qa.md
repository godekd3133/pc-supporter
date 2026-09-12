# PC Supporter design QA

## Comparison target

- Source visual truth: [시연 영상](https://www.youtube.com/watch?v=qsnywlcjPlw), captured at 1:00 in the video.
- Source capture: `artifacts/source-video-failure.png`.
- Implementation: `http://127.0.0.1:5173/result`, rendered from the working PC Supporter app.
- Implementation capture: `artifacts/implementation-result.png`.
- State: a populated build with multiple compatibility conflicts. The source demonstrates a RAM/M.2 failure state; the implementation demonstrates a CPU socket, board power, memory, storage, GPU, case, and PSU failure state. Both states intentionally exercise the same core interaction: show multiple findings and help the user fix them.

## Capture normalization

- Source capture pixels: 1337 x 752, cropped to the YouTube player region.
- Implementation capture pixels: 1270 x 577, default connected-browser viewport.
- CSS viewport: default desktop browser viewport for the implementation.
- Density: both captures were produced at the browser's default screenshot density; no density conversion was applied.
- The source is an embedded recording of the original prototype and includes its browser chrome inside the recording. The implementation is a standalone redesigned service, so this is an information-hierarchy comparison rather than a pixel-identical clone.

## Full-view comparison evidence

The source establishes the core visual language and flow: a very light page, a compact chip logo, a strong compatibility status heading, and a vertically stacked detailed-message list. The implementation keeps the light canvas, compact technical labeling, explicit compatibility status, and vertically stacked findings, while adding a persistent build summary, severity metrics, actionable fixes, and replacement candidates needed for the requested complete service.

The implementation's first viewport puts the result status, blocker/warning/unknown counts, resource telemetry entry point, detailed-message entry point, and selected-build summary above the fold. This makes the source behavior more legible without changing the underlying task.

The result route now adds a compact quick-jump strip immediately below the status hero. It exposes final purchase judgment, prioritized actions, detailed findings, purchase checklist, and purchase list, so the long evidence page has a visible navigation spine without changing the result decision.

The blocker, warning, and unknown metric cards are also actionable filters. Selecting a non-empty metric moves focus to the detailed findings list and preserves the selected severity in the filter controls, making the summary row a usable entry point rather than a passive status display.

Shared saved-build results also expose a compact saved-versus-current recheck panel. It keeps the comparison above the long evidence stack and separates decision, risk, price, and reference changes before the reader enters detailed findings.

## Focused-region comparison evidence

The top result region and first finding were reviewed at readable scale. The source uses a single “호환이 불가능합니다” heading followed by plain cards. The implementation uses the same status decision but adds severity color, current-versus-expected facts, affected part names, replacement actions, candidate parts, price deltas, and a resource telemetry panel. The extra regions are intentional product extensions, not accidental drift.

## Required fidelity surfaces

- Fonts and typography: the implementation uses Noto Sans KR with a technical mono label treatment, distinct status hierarchy, readable Korean body copy, and responsive wrapping. No text is baked into an image.
- Spacing and layout rhythm: cards, finding groups, metrics, and the build summary use consistent spacing and a clear vertical rhythm. The route transition was corrected to reset scroll to the top so the result hero is visible after a check.
- Colors and tokens: the implementation preserves the source's neutral white/light canvas and semantic red/yellow/green states, then adds teal and purple only for actionable success and unknown-data states.
- Image quality and asset fidelity: the source's chip mark and component imagery are represented with a maintained icon library rather than low-fidelity CSS drawings or placeholder image boxes. Live catalog items retain their source image URL when available.
- Copy and content: result copy is Korean, explains causes and remedies, and explicitly distinguishes blockers, warnings, and incomplete data.

## Enhancement QA

- Catalog data expanded from the initial 31-record runtime snapshot to 67 records: 45 Danawa-origin records plus 22 project records.
- All 67 catalog records have a parsed price value after the detail-page lowest-price fallback was added.
- The picker now supports quality filters and price/name/update sorting and displays live-data badges and source images when available.
- The result view now displays power headroom, memory usage, M.2 usage, and GPU clearance from the same engine metrics used by the findings.
- Saved-build navigation now exposes a history view and can re-run a saved build.
- The catalog cache reloads when the persisted catalog modification time changes, so a separate crawl process becomes visible to the running API without a restart.
- Server startup now triggers a five-products-per-category refresh by default and continues on the configured interval; `DANAWA_CRAWL_ON_START=false` remains available for offline runs.
- PostgreSQL is available through the repository adapter and the local file store remains an explicit fallback; the fallback path was verified with an unavailable database endpoint.
- Admin authentication is available through an HttpOnly signed session when `ADMIN_PASSWORD` is configured; unauthenticated crawl requests were rejected with 401 in the HTTP smoke test.
- Crawl lock ownership and stale-running recovery were added so concurrent processes do not overwrite each other silently.

## Interaction and runtime evidence

- Loaded the app at the local development URL.
- Loaded the demonstration build and confirmed all required component cards were populated.
- Opened the CPU picker, searched for `14700`, and confirmed one filtered result.
- Selected the Intel CPU and confirmed the selection persisted after the picker closed.
- Ran the compatibility check and confirmed multiple findings rendered in the result view.
- Confirmed replacement suggestions were present for applicable findings.
- Saved a build and confirmed the share link was copied.
- Reopened the saved `/share/:id` route and confirmed the result was reconstructed.
- Opened the catalog control center and confirmed the nine-category crawl status and catalog counts rendered.
- Tested the responsive breakpoint at a narrow mobile viewport, found horizontal overflow caused by fixed content sizing, removed the fixed body minimum width and tightened component flex sizing, then rechecked that document scroll width equaled the viewport client width.
- Browser console errors and warnings: none reported by the connected browser.
- The connected in-app browser rechecked the result route after the quick-jump addition: all five controls rendered, the detailed-findings target received focus immediately, and the lazy purchase-list target received focus after its panel became available.

## Findings

No actionable P0, P1, or P2 visual findings remain for the requested redesign. The implementation is deliberately more capable than the source prototype, but the primary state, hierarchy, and result workflow remain recognizable.

## Follow-up polish

- Confirm the thumbnail crop per category; live Danawa cards and detail views now expose explicit `원문`/`원문 열기` actions and broken thumbnails fall back to the product icon.
- Crawl status, crawl manifests, and accessory coverage now share the same `requireAdmin` boundary as crawl mutations. Authenticated sessions expose deployment-readiness diagnostics, the admin UI warns when local auth is disabled or production secrets are incomplete, and expired protected requests return to login; production deployment still must set `ADMIN_PASSWORD` and a non-default `ADMIN_SESSION_SECRET`.
- The connected-browser regression lane covers the keyboard modal path: initial focus, Tab containment, Esc close, and focus restoration to the triggering action after close.

## 2026-09-10 mobile product pass

- Visual target: the latest mobile-native refinement of the warm ivory / cobalt direction, generated at 390 x 844 and retained at `/Users/kimminkyu/.codex/generated_images/01a089d3-763d-7330-938e-5dcf5f11911b/exec-39cf2e95-5a6d-4085-b766-9c0f7ff308f6.png`.
- Implementation surface: the existing React/Vite + Capacitor app, with the current data and route contracts preserved.
- Mobile shell: compact sticky app bar, visible service state, 4-item bottom navigation (`검사`, `카탈로그`, `저장`, `더보기`), safe-area spacing, and a real bottom-sheet menu for secondary tools.
- Mobile home: current-build health summary, part-level states, one dominant compatibility CTA, resume action, quick-start actions, and accessible demo controls moved below the primary flow.
- Mobile editor: a dedicated compact surface replaces the long desktop card stack at handset widths, exposing required-progress, import/export/reset tools, tappable component rows, collapsed advanced settings, and one bottom-aligned compatibility action.
- Mobile picker: the existing component picker opens as a full-width bottom sheet and now sits above the mobile tab bar so the modal never leaves navigation controls on top of the selection surface.
- Mobile flows checked in the connected in-app browser: home, 390px editor, compatibility result, catalog, bottom-sheet menu, compatibility request loading, result rendering, and home/catalog navigation.
- Current-run measurements: viewport `390 x 844`, body/document scroll width `390`, fixed bottom navigation bounds `x=0..390`, `y=770..844`; no mobile horizontal overflow observed.
- Accessibility checks: the mobile navigation exposes page state through `aria-current`; the more sheet exposes dialog labeling and close controls; demo actions remain real buttons rather than aria-hidden interactive elements.
- Verification boundary: `npm run typecheck`, `npm test` (241 files / 1,230 tests), `npm run build`, and `git diff --check` passed. The broad browser smoke reached the existing admin/candidate-preview paths but timed out while evaluating large DOM / async preview state; this is reported separately and is not claimed as a full smoke pass.

## 2026-09-10 mobile route recheck

- The connected in-app browser rechecked the primary handset routes at `390 x 844`: `/home`, `/build`, `/result`, `/catalog`, `/recommend?profile=gaming`, `/watchlist`, `/history`, `/accessories`, and `/admin`. Each route rendered its expected heading without the recovery boundary; `body.scrollWidth` and `document.documentElement.scrollWidth` stayed at `390` and the fixed bottom navigation occupied `x=0..390`, `y=770..844`.
- The same viewport check covered the shared route error states without fabricating a public share ID: `/compare/mobile-qa-missing`, `/budget-ladder/mobile-qa-missing`, `/version-comparison/mobile-qa-missing`, and `/watchlist/mobile-qa-missing`. Each preserved the mobile shell, rendered a read-only missing-snapshot state, and reported no non-scroll-container overflow. Valid shared snapshots remain an external-data-dependent lane and were not claimed from invented fixtures.
- Core mobile interaction recheck passed: the home `더보기` bottom sheet opened as a labeled dialog above the bottom navigation and closed cleanly; the catalog `메인보드` chip updated both the selected chip and the existing category URL/select contract to `category=motherboard`.
- A result-page regression was found by measuring every rendered element rather than relying only on document width. Purchase-row metadata inherited the desktop `nowrap` flex contract, so price-evidence, catalog-detail, and price-watch actions were laid out beyond their 230px content column. A handset-only wrap/width rule now keeps those actions inside each purchase card; the result route was rechecked at 390px and 320px. The only remaining measured overflow is the intentional horizontally scrollable comparison table.
- A fresh browser tab recorded no warning/error entries after the recheck. An earlier tab briefly entered the app recovery boundary during HMR while the web server was being restarted; a fresh tab loaded normally after the server was started on the configured 5173/4174 pair.
- Latest production build passed after the purchase-row fix: entry `537,079` bytes against the `540,000` byte gate, with the client bundle verifier passing. `npm run typecheck` also passed through the build command; the full Vitest suite remained `241` files / `1,230` tests passed, and `git diff --check` passed after the CSS change.

## 2026-09-11 continuous polish pass

- The cross-tab draft notice now attaches the dynamic build summary to a stable Korean noun (`변경된 내용(...)`) instead of appending a fixed object particle directly to a summary that can end in `범주`; the notice remains read-only until the user explicitly chooses to import the other tab's state.
- The lazy `AppHeader` boundary now has an app-shell loading fallback that preserves the compact brand bar and the four-item mobile navigation while the header chunk is pending. This prevents a short route-transition layout jump without making the fallback interactive or changing navigation, storage, or API contracts.
- Fresh connected-browser evidence at `390 x 844` covered home → error demo → build → compatibility result. The demo hydrated named catalog records, showed `7 / 7` required components ready, produced 10 findings, and left the result route at body/document width `390` with no captured console errors in the probe buffer.
- A route timing probe found that the header's lazy chunk could leave the real bottom navigation absent at roughly `900ms`; after the fallback change, the loading boundary retains the same shell silhouette. A separate forced `AppHeader` chunk-failure probe now stays in the app shell with the fallback header, mobile navigation, `내 견적` content, and `390px` body width instead of escalating to the whole-app recovery boundary.
- A full history-page hit-area probe found compact alert, priority, purchase-progress, compare, and purchase-list actions below the intended mobile target width. History-specific mobile rules now keep those controls at least `44 x 44`; the only remaining sub-44 element is the native 13px checkbox inside its labeled notification control.
- Static and browser verification after this pass: `npm run typecheck` passed, the latest completed `npm test` passed with `241` files / `1,231` tests, `npm run build` passed with entry `539,361` bytes against the `540,000` byte gate, `git diff --check` passed, and `npm run test:browser` completed successfully. The browser run executed every listed flow and all six route-history manifest IDs; its mobile checks reported `innerWidth=390` with body/document width `375` (scrollbar-adjusted) for the tested mobile routes, with no assertion failure.

## Final result

passed
