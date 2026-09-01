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

## Findings

No actionable P0, P1, or P2 visual findings remain for the requested redesign. The implementation is deliberately more capable than the source prototype, but the primary state, hierarchy, and result workflow remain recognizable.

## Follow-up polish

- Confirm the thumbnail crop per category and add an explicit source-link action for live Danawa products.
- Add a visual rule-explanation drawer for users who want to inspect the exact normalized source facts.
- Add an authenticated production admin boundary before exposing crawl controls outside the student-project environment.

## Final result

passed
