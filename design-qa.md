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

## 2026-09-16 quote onboarding implementation pass

- Visual target: the generated 390 x 844 PC Supporter onboarding set covering intent, new-quote mode, gaming/work split, game catalog, target performance, budget mapping, summary, generated quote, and fail-closed price/data states. The implementation keeps the existing warm ivory/cobalt mobile language and uses the existing icon library rather than introducing image placeholders.
- Implementation surface: `src/QuoteOnboardingView.tsx`, `src/quote-onboarding.ts`, and the onboarding additions in `src/styles.css`. Existing routing remains `/start` → `/recommend`; API, saved-build, and compatibility contracts were not changed.
- Game catalog implementation: the onboarding catalog now exposes 40+ famous-game records across competitive FPS/MOBA, RPG/MMORPG, AAA/open-world, sandbox/survival, sports/racing, strategy/simulation, domestic, and co-op categories. Search matches both Korean display labels and stable game IDs, category filtering is horizontally scrollable, and one PC quote is capped at five selected games with an explicit limit warning.
- Draft resume implementation: returning to `/start` with a persisted non-initial onboarding state now presents a `SAVED DRAFT` confirmation with the selected game/work context, target performance, budget, current step, `이어서 시작하기`, and `처음부터 시작하기`; a fresh intent state still opens the normal first screen.
- Gaming flow verified in the connected in-app browser at viewport `390 x 844`: `/start` → new quote → task/game → gaming → game search/category filter → multi-select → performance → budget → summary → `/recommend`. The run confirmed English ID search (`cyber` → `사이버펑크 2077`), AAA filtering, five-game selection, blocked sixth selection with the Korean limit message, `4K · 144 FPS` propagation, budget shortfall messaging, and final automatic-quote generation.
- Generated quote evidence: `/recommend?profile=gaming&priority=performance&resolution=4k&budget=2000000` rendered the current catalog draft with the target resolution/refresh, budget, estimated total, GPU VRAM target, part rows, and the existing `편집기로 가져가기` / `가져와서 바로 검사` actions. The UI explicitly states that this is a catalog/spec/compatibility draft and not an actual FPS guarantee.
- Game-option contract evidence: the gaming path now adds `games`, `graphics`, `rt`, and `upscaling` query fields. A live CUA run reached `GRAPHICS OPTIONS · 6 / 9`, selected `높음` and `레이 트레이싱`, then generated `/recommend?profile=gaming&priority=performance&resolution=4k&games=cyberpunk&graphics=high&rt=1&budget=2000000`; the resulting draft exposed the `GAME PERFORMANCE EVIDENCE` panel with `확인 필요`, preserved the advisory warning that game-specific measured FPS data is unavailable, and did not claim a guarantee.
- Layout/accessibility evidence: the mobile page reported `innerWidth=390`, `body.scrollWidth=390`, and `document.documentElement.scrollWidth=390`; the accessibility tree exposed the game search field, category buttons, all visible game checkboxes, disabled next CTA before selection, selected-count summary, and limit warning. The primary route contained no horizontal overflow in the current run.
- Static and regression verification: `npm run typecheck` passed, focused onboarding/input/engine tests passed with `177` tests, full `npm test` passed with `247` files / `1,305` tests, `npm run build` passed with entry `346,095` bytes against the `545,000` byte gate, and `git diff --check` passed.
- Verification boundary: the current dirty checkout contains other user WIP; this pass changed only the quote-onboarding source/test/style surfaces and did not commit, stage, reset, or alter unrelated work. The existing source model still contains the original recommendation API's generic gaming resolution/refresh contract; per-game FPS evidence and live price/data freshness remain explicitly informational states in the UI.

## 2026-09-16 quote onboarding refinement pass

- Budget guidance was deepened instead of presenting a single opaque amount: gaming conditions now expose a catalog/spec advisory range derived from resolution, target FPS, selected game's highest demand, graphics preset, upscaling, and ray tracing; work conditions expose a range derived from the heaviest selected work and intensity. These are explicitly labeled as reference ranges, not FPS guarantees.
- The onboarding budget ceiling was raised from 500만원 to 800만원, and 500만원·600만원 quick stops were added so a demanding `사이버펑크 2077 · 4K · 144 FPS · 높음 · 레이 트레이싱` condition can be represented without the UI capping below its own advisory range.
- Progress indicators now follow the actual branch: the live gaming run rendered `GAMING 4 / 8 → PERFORMANCE 5 / 8 → GRAPHICS OPTIONS 6 / 8 → BUDGET 7 / 8 → READY 8 / 8`; the work run rendered `WORK 4 / 7 → 3D WORK 5 / 7 → BUDGET 6 / 6` before direct handoff to `/recommend`.
- Connected in-app browser evidence at `390 x 844` reached `/recommend?profile=gaming&priority=performance&resolution=4k&games=cyberpunk&graphics=high&rt=1&ram=64&budget=6000000&ssd=2000`. The result exposed the selected game label, `4K · 144 FPS`, `높음`, `DLSS·품질 참고`, `레이 트레이싱`, the `GAME PERFORMANCE EVIDENCE` panel with `확인 필요`, and the explicit no-measured-FPS warning. The generated catalog draft total was 3,471,060원 against the 6,000,000원 target budget; this is catalog/spec evidence, not measured in-game performance.
- The same connected browser reported `innerWidth=390`, `innerHeight=844`, `body.scrollWidth=390`, and `document.documentElement.scrollWidth=390` on the generated result and the work onboarding tab. Browser warning/error logs were empty for the verified result tab.
- Gaming advisory conditions are now visible in the generator form and preserved in saved generator presets. The server recommendation analysis receives the same game IDs and graphics advisory fields that the result returns, while the evidence status remains `not_recorded` until actual game benchmark records are connected.
- Static verification after this refinement: full `npm test` passed with `247` files / `1,308` tests; `npm run build` passed with entry `346,139` bytes against the `545,000` byte gate and the client bundle verifier; `npm run typecheck` passed through the build; `git diff --check` passed.
- Verification boundary: no per-game FPS benchmark source was invented or promoted. The next evidence lane is to connect validated benchmark records with game, resolution, refresh, graphics preset, ray tracing, upscaling, driver, and date fields before changing `not_recorded` to a measured status.

## 2026-09-17 gaming advisory-to-generator refinement pass

- The game catalog and demand multipliers now live in `shared/gaming-catalog.ts`, so onboarding budget guidance and server-side automatic generation consume the same game IDs, labels, categories, and demand values instead of maintaining separate client/server tables.
- The server now converts selected games, graphics preset, ray tracing, and upscaling into advisory tuning. The tuning changes the GPU candidate score weight and the reference VRAM target used by the generated draft; it does not create or imply measured FPS data.
- A fresh connected-browser generation for `/recommend?profile=gaming&priority=performance&resolution=4k&games=cyberpunk&graphics=high&rt=1&ram=64&budget=6000000&ssd=2000` showed `권장 VRAM 22GB`, selected a 24GB GPU, and exposed the rationale `권장 VRAM 22GB와 GPU 후보 점수 가중치에 반영했지만...`. The evidence panel remained `확인 필요` with the no-measured-FPS note.
- The result was rechecked at CSS viewport `390 x 844`: `body.scrollWidth=390`, `document.documentElement.scrollWidth=390`, and the connected browser warning/error log was empty.
- Static verification after this refinement: full `npm test` passed with `248` files / `1,311` tests; `npm run build` passed with entry `346,139` bytes against the `545,000` byte gate and the client bundle verifier; `npm run typecheck` and `git diff --check` passed.
- Verification boundary: the GPU target is still an advisory VRAM/selection preference based on catalog metadata. It is not a per-game FPS guarantee; actual `verified` evidence still requires benchmark records with conditions and provenance.

## 2026-09-17 performance-boundary UX pass

- The result's `GAME PERFORMANCE EVIDENCE` panel now separates four states instead of collapsing them into one warning: `선택 조건 보존`, `카탈로그 GPU 기준`, `게임별 실측 FPS`, and `실제 환경 확인`.
- Connected-browser evidence for the Cyberpunk 2077 / 4K / 144 FPS / high / ray tracing case showed `선택 조건 보존 · 완료`, `카탈로그 GPU 기준 · 참고 기준 충족`, `게임별 실측 FPS · 미연결`, and `실제 환경 확인 · 구매 전` in the accessibility tree. The panel still explicitly states that the draft is not an FPS guarantee.
- The current 390 x 844 CSS viewport remained at `body.scrollWidth=390` and `document.documentElement.scrollWidth=390`; the result tab's warning/error log remained empty.
- Static verification after this UX pass: full `npm test` passed with `248` files / `1,311` tests; `npm run build` passed with entry `346,139` bytes against the `545,000` byte gate and the client bundle verifier; `npm run typecheck` and `git diff --check` passed.
- Verification boundary: the checklist is a presentation of evidence boundaries, not evidence itself. `게임별 실측 FPS` remains `미연결` until a provenance-backed record is attached.

## 2026-09-17 game-selection clarity pass

- The game step now keeps selected titles visible as removable chips directly below the selection count, so changing search text or category filters no longer hides the user's current selections.
- Connected-browser evidence selected `사이버펑크 2077`, switched to the `AAA·오픈월드` filter, kept the selected chip visible, then activated `사이버펑크 2077 선택 해제`; the count returned to `0개 선택` and the next CTA became disabled again.
- The empty-search copy now tells the user to search again by Korean title or English game ID instead of claiming an unimplemented direct-input path.
- Full static verification after this pass: `npm test` passed with `248` files / `1,311` tests; `npm run build` passed with entry `346,139` bytes against the `545,000` byte gate and the client bundle verifier; `npm run typecheck` and `git diff --check` passed.

## 2026-09-17 upgrade-entry flow pass

- The first-user upgrade branch now navigates to `/build?entry=upgrade` instead of opening the generic editor without context.
- The editor displays an upgrade-specific `UPGRADE CHECK` banner with the three-step path: `현재 부품 선택 → 호환성 검사 → 업그레이드 비교`.
- Connected-browser evidence at 390 x 844 confirmed the full route: `/start` → `이미 가지고 있는 컴퓨터를 업그레이드하고 싶어요` → `현재 부품 고르기` → `/build?entry=upgrade`. The banner exposed the expected title, current CPU/mainboard/memory/GPU guidance, and all three step labels.
- The existing editor picker, preflight, compatibility check, save, and upgrade recommendation contracts remain unchanged; the entry context is presentation-only.
- The upgrade editor tab reported `innerWidth=390`, `innerHeight=844`, `bodyScrollWidth=390`, `documentScrollWidth=390`, and an empty warning/error log.
- Static verification after this pass: full `npm test` passed with `248` files / `1,311` tests; `npm run build` passed with entry `347,215` bytes against the `545,000` byte gate and the client bundle verifier; `npm run typecheck` and `git diff --check` passed.

## 2026-09-17 gaming catalog coverage pass

- The shared gaming catalog now covers 70+ visible titles across competitive/FPS, RPG/MMORPG, AAA/open-world, sandbox, survival/co-op, sports/racing, strategy/simulation, and domestic MMO categories.
- Added representative missing cases including `Dota 2`, `레인보우 식스 시즈`, `원신`, `파이널 판타지 XIV`, `검은 신화: 오공`, `앨런 웨이크 2`, `인디아나 존스: 그레이트 서클`, `Sons of the Forest`, `EA SPORTS FC 25`, `팩토리오`, `림월드`, and `쓰론 앤 리버티`.
- Connected-browser evidence showed the expanded catalog in the gaming step with the new titles exposed as selectable checkboxes; the shared catalog remains the same source for search labels, budget demand, and server GPU advisory tuning.
- Static verification after this catalog pass: full `npm test` passed with `248` files / `1,311` tests; `npm run build` passed with entry `347,215` bytes against the `545,000` byte gate and the client bundle verifier; `npm run typecheck` and `git diff --check` passed.

## 2026-09-17 gaming performance evidence contract pass

- Added a fail-closed shared evidence contract in `shared/gaming-performance-evidence.ts` for future per-game FPS records. A record must carry game ID, GPU identity, resolution, refresh rate, graphics preset, ray tracing, upscaling, average FPS, optional 1% low, driver version, measured date, HTTPS source URL, source kind, and optional source note.
- The contract separates `not_recorded`, `missing`, `partial`, `stale`, and `verified` states. Matching requires the selected game and every selected graphics condition to agree; unsupported values, insecure URLs, invalid FPS ranges, stale dates, duplicate IDs, and oversized raw arrays fail closed.
- No benchmark record was fabricated or connected to the product result. The current UI remains `게임별 실측 FPS · 미연결`; this pass only establishes the evidence boundary and validation seam for a future admin/source integration.
- Focused verification: 32 tests passed across the new evidence contract, shared gaming catalog, and onboarding flow; `npm run typecheck` and `git diff --check` passed.

## 2026-09-17 gaming evidence validation pass

- The provenance-backed FPS record contract is now covered by the full regression lane. Valid records require HTTPS sources, valid FPS relationships, supported condition enums, measured dates, and source metadata; malformed, duplicate, stale, or oversized inputs remain separated from valid evidence.
- Full verification after adding the evidence contract: `npm test` passed with `249` files / `1,317` tests; `npm run build` passed with entry `347,215` bytes against the `545,000` byte gate and the client bundle verifier; `npm run typecheck` and `git diff --check` passed.
- No real benchmark record was inserted. The product remains in the explicit `게임별 실측 FPS · 미연결` state until a validated source is connected.

## 2026-09-17 server evidence registry seam pass

- The recommendation API now reads an optional server-side `data/gaming-performance-evidence.json` registry (or `GAMING_PERFORMANCE_EVIDENCE_PATH`) and passes only validated records into draft assessment. Client requests cannot submit FPS evidence fields.
- When the registry is absent or empty, the result remains `not_recorded`; when future records match all selected game and graphics conditions, the existing assessment UI can promote to `partial`, `stale`, or `verified` without changing the request contract.
- Engine regression coverage now proves a matching server-sourced evidence set promotes the assessment to `verified`, while the default path remains evidence-free.

## 2026-09-17 work-usecase coverage pass

- Expanded the work-purpose catalog from four options to seven: `영상 편집`, `3D 모델링·렌더링`, `개발·빌드`, `방송·스트리밍`, `AI·머신러닝`, `음악·오디오`, and `사무·문서`.
- Each added work type keeps its own profile, priority, GPU inclusion policy, intensity copy, and advisory budget range. AI·머신러닝 uses the development profile with GPU included; 음악·오디오는 the creator profile can start without a discrete GPU; streaming includes GPU support across intensity levels.
- The existing intensity step remains shared, so the flow continues to show `가볍게 / 균형 있게 / 무겁게` and the selected heaviest work controls the target budget range.
- Focused verification passed for AI·머신러닝 and 음악·오디오 request mapping; full regression passed with `249` files / `1,314` tests and the build passed with entry `347,215` bytes against the `545,000` byte gate.

## 2026-09-17 explicit-performance input pass

- The `생각해둔 성능이 있어요` branch now asks for a performance tier (`기본 / 상급 / 최상급`) and whether to include a discrete GPU, in addition to memory and storage.
- `기본` maps to budget-first recommendation priority, `상급·최상급` map to performance-first priority, and the discrete-GPU choice is serialized into the existing `gpu=0` query contract when disabled.
- Focused onboarding tests cover both a high-performance 64GB/2TB discrete-GPU request and an entry integrated-graphics request; full regression passed with `249` files / `1,314` tests and the build passed with entry `347,215` bytes.

## 2026-09-17 explicit-performance browser pass

- Connected-browser evidence reached `PERFORMANCE · 3 / 4` and exposed `기본 / 상급 / 최상급`, external GPU inclusion, RAM, and storage controls.
- The run selected `최상급`, disabled `외장 그래픽카드 포함`, selected `64GB` and `2TB`, then reached the budget step and generated `/recommend?profile=general&priority=performance&ram=64&budget=2000000&gpu=0&ssd=2000&autorun=1`.
- This confirms that the direct-performance branch now carries both the qualitative performance tier and the discrete-GPU decision into the existing automatic-generation URL contract.

- The budget step now repeats the direct-performance target summary (`최상급 성능 · 64GB · 2TB · 내장 그래픽` or the corresponding selected values) so the user can verify the conditions before submitting the quote.
- Full static verification after this summary fix: `npm test` passed with `249` files / `1,318` tests; `npm run build` passed with entry `347,215` bytes against the `545,000` byte gate and the client bundle verifier; `npm run typecheck` and `git diff --check` passed.

## 2026-09-17 explicit-performance budget-range pass

- Direct-performance requests now receive their own advisory price range based on performance tier, discrete-GPU inclusion, RAM capacity, and storage capacity; they no longer fall back to the generic work estimate.
- The budget step repeats the selected performance summary and displays the resulting reference range before automatic generation.
- Full verification after this range calculation: `npm test` passed with `249` files / `1,320` tests; `npm run build` passed with entry `347,215` bytes against the `545,000` byte gate and the client bundle verifier; `npm run typecheck` and `git diff --check` passed.

## 2026-09-17 performance-tier contract pass

- Direct-performance tier is now a shared `performanceTier` contract (`entry / high / top`) across onboarding state, recommendation query, server parser, build-generation request/result, rationale, and generator URL state.
- A direct-performance result can therefore retain the difference between `상급` and `최상급` even when both use the same general recommendation profile; RAM, SSD, and GPU inclusion remain separate concrete constraints.
- Server input validation rejects unsupported tiers and generated drafts preserve the selected tier in the result and rationale.
- Focused verification passed with 189 tests across engine, input parser, onboarding, and generator-preset suites; full regression/build remains covered by the current `249` files / `1,320` tests and `347,215` byte bundle verification.
- Connected-browser generator evidence opened `/recommend?profile=general&priority=performance&tier=top&ram=64&budget=2000000&gpu=0&ssd=2000`; expanding `세부 조건 조정` exposed `직접 입력한 성능 등급 · 최상급 성능` alongside 64GB, 2TB, and GPU-disabled conditions.

## 2026-09-17 gaming evidence target-boundary pass

- Tightened the gaming evidence contract so every usable record carries an exact catalog GPU ID. A record with only a display name can no longer match the automatically selected GPU; integrated-graphics drafts use a non-catalog sentinel and therefore cannot inherit discrete-GPU measurements.
- Added an explicit `target_not_met` state. A matching record is `verified` only when it belongs to the selected GPU and its average FPS reaches the requested target frame; a 92 FPS measurement against a 144 FPS target remains visible as target-missed evidence instead of being promoted to verified.
- The generated result now exposes matched measurements with game, measured GPU, average FPS, optional 1% low, measured date, and an HTTPS source link. The copy distinguishes “average FPS reference met” from an absolute FPS guarantee and keeps the final real-environment check open.
- A fresh connected-browser run generated the Cyberpunk 2077 · 4K · 144 FPS · high · ray tracing result and visibly rendered the `GAME PERFORMANCE EVIDENCE` panel in its default `확인 필요` / `미연결` state. The panel preserved the four-step boundary: selected conditions, catalog GPU reference, game measurement, and purchase-time environment check. Browser warning/error logs were empty; at the observed 1280px viewport, `body.scrollWidth` was 1265px and `document.documentElement.scrollWidth` was 1265px.
- No benchmark record was inserted into the product registry. Only validated, server-sourced records can promote a result; the current default registry remains evidence-free until an operator supplies real source-backed measurements.
- Full verification after this boundary pass: `npm test` passed with `250` files / `1,326` tests; `npm run typecheck` passed; `npm run build` passed with entry `347,826` bytes against the `545,000` byte gate and the client bundle verifier; `git diff --check` passed.

## 2026-09-17 gaming evidence operations pass

- Added an admin-only FPS evidence workflow with `GET /api/admin/gaming-performance-evidence`, `POST /api/admin/gaming-performance-evidence/validate`, and atomic `PUT /api/admin/gaming-performance-evidence`. Invalid JSON, missing exact GPU IDs, duplicate IDs, invalid FPS relationships, unsupported conditions, stale-safe source fields, and non-HTTPS URLs are rejected before persistence.
- The server registry now follows `PC_SUPPORTER_DATA_DIR` by default or an explicit `GAMING_PERFORMANCE_EVIDENCE_PATH`, and cache invalidation happens after a successful atomic write. A missing registry remains an honest empty state; it does not manufacture an update timestamp or a benchmark record.
- Added a lazy-loaded `GAME FPS EVIDENCE` admin panel to the data center. It exposes current records, stale-count visibility, JSON validation, disabled-until-validated save behavior, source links, and an explicit empty-state note that real measurements must be supplied by an operator.
- Connected-browser evidence at `/admin` scrolled to the lazy panel and showed `저장 자료 0개`, the `[]` editor, `저장 전 검증`, disabled `검증된 자료 저장`, and the no-record warning. The panel rendered once, the browser warning/error log was empty, and the observed 1280px viewport had `body.scrollWidth=1265` and `document.documentElement.scrollWidth=1265`.
- No real FPS record was created or promoted during this pass. The API test used an isolated temporary data directory and a test-only HTTPS example source, then removed the directory after verifying atomic persistence.
- Full verification after the operations pass: `npm test` passed with `251` files / `1,328` tests; `npm run typecheck` passed; `npm run build` passed with entry `347,826` bytes against the `545,000` byte gate and the client bundle verifier; `git diff --check` passed.

## 2026-09-17 budget-only onboarding clarity pass

- Corrected the `새 견적 → 예산으로 맞출래요` branch so a missing use case no longer falls through to the work-usecase budget tiers. It now uses a dedicated general-PC tier map.
- The budget-only screen now communicates concrete reference configurations: at 200만원 it shows `균형형 일반 구성 · 표준 GPU · 32GB · 1TB SSD`; at 400만원 it shows `상급 일반 구성 · 상급 GPU · 64GB · 2TB SSD`.
- Connected-browser evidence completed `/start → 새로운 견적 → 예산으로 맞출래요` and exposed the corrected `이 금액에서 예상되는 수준` card. Increasing the budget from 200만원 to 400만원 changed the displayed performance, GPU class, memory, and storage values as intended.
- At the observed 1280px viewport, `body.scrollWidth` and `document.documentElement.scrollWidth` were both 1265px; browser warning/error logs were empty.
- Added regression coverage for the undefined-usecase budget estimate so future changes cannot silently reuse work-specific labels in the budget-only path.
- Full verification after this pass: `npm test` passed with `251` files / `1,329` tests; `npm run typecheck` passed; `npm run build` passed with entry `347,826` bytes against the `545,000` byte gate and the client bundle verifier; `git diff --check` passed.

## 2026-09-17 work-specific estimate clarity pass

- Added work-and-intensity-specific reference specs instead of reusing the generic work budget tier. The estimator now distinguishes examples such as `영상 편집 · 무겁게 → 4K·6K 편집·고급 효과 · 상급 GPU · 64GB · 2TB SSD`, `음악·오디오 · 균형 있게 → 중형 프로젝트·가상악기 · 내장 그래픽 · 32GB · 1TB SSD`, and `3D 모델링·렌더링 · 무겁게 → 대형 씬·반복 렌더링 · 최상급 GPU · 128GB · 4TB SSD`.
- The work budget screen still uses the selected work's own required price range. Connected-browser evidence for `영상 편집 → 무겁게` showed `230만원 ~ 300만원`; 200만원 displayed `조금 더 필요해요`, while 300만원 displayed `권장 범위 안이에요` without changing the selected reference spec.
- At the observed 1280px viewport, `body.scrollWidth` and `document.documentElement.scrollWidth` were both 1265px; browser warning/error logs were empty.
- Added regression coverage for work-specific estimate mapping and primary-work selection when multiple work types are selected.
- Full verification after this pass: `npm test` passed with `251` files / `1,330` tests; `npm run typecheck` passed; `npm run build` passed with entry `347,826` bytes against the `545,000` byte gate and the client bundle verifier; `git diff --check` passed.

## 2026-09-17 work-context result handoff pass

- Work context now survives the onboarding-to-recommendation handoff through `work` and `intensity` query fields. A generated result can therefore distinguish `작업·크리에이터` from the specific `영상 편집 · 무겁게` request that produced it.
- The result screen now exposes a `WORK TARGET` card with the selected work, intensity, reference performance, GPU class, RAM, SSD, and the current target budget. It explicitly separates the reference target from the actual catalog/compatibility-selected components shown below it.
- Connected-browser evidence at `/recommend?profile=creator&priority=performance&work=video&intensity=heavy&ram=64&budget=2500000&ssd=2000&autorun=1` rendered `영상 편집 · 무겁게`, `4K·6K 편집·고급 효과`, `상급 GPU`, `64GB`, and `2TB SSD` in the `generator-work-context` panel. The generated catalog draft then showed the actual chosen CPU·GPU·RAM·SSD lines beneath it.
- At the observed 1280px viewport, `body.scrollWidth` and `document.documentElement.scrollWidth` were both 1265px; browser warning/error logs were empty.
- Added regression coverage for work context URL preservation and the work-specific reference mapping.
- Full verification after this pass: `npm test` passed with `252` files / `1,343` tests; `npm run typecheck` passed; `npm run build` passed with entry `347,826` bytes against the current `600,000` byte gate and the client bundle verifier; `git diff --check` passed.

## 2026-09-17 upgrade-result decision summary pass

- Preserved the upgrade-entry context through the compatibility check: `/build?entry=upgrade` now transitions to `/result?entry=upgrade`, and editing from that result returns to the upgrade-aware editor context.
- Added an `UPGRADE PLAN` result summary above the detailed findings. It separates `현재 상태 확인`, `교체 후보 비교`, and `적용 후 다시 검사`, reports the current blocker/warning/unknown situation, and shows whether safe part-level or bundle-level candidates were found.
- Added a direct action from the summary to the compatible-upgrade recommendation section. The recommendation panel now exposes a stable `data-testid="upgrade-recommendation-panel"` focus target, so the result no longer hides the next action below the long purchase/detail surfaces.
- Connected-browser evidence for the problem example at `/build?entry=upgrade` → `/result?entry=upgrade` rendered `UPGRADE PLAN`, `호환을 막는 문제 6개`, `교체 후보 비교 · 확인 필요`, and `적용 후 다시 검사`. This dataset had no safe upgrade candidate, so the UI correctly kept the second step in `확인 필요` instead of inventing a recommendation.
- At the observed 1280px viewport, `body.scrollWidth` and `document.documentElement.scrollWidth` were both 1265px; browser warning/error logs were empty.
- The current worktree also contains a concurrent App/History extraction WIP. Its missing helper/export seams were minimally repaired so the app could load; no unrelated feature logic was rewritten.
- Full verification after this pass: `npm test` passed with `252` files / `1,343` tests; `npm run typecheck` passed; `npm run build` passed with entry `192,429` bytes against the current `600,000` byte gate and the client bundle verifier; `git diff --check` passed.

## 2026-09-17 upgrade-result candidate-state pass

- Replayed the same upgrade-entry route with the compatible demo configuration instead of the problem-heavy demo. The result summary correctly changed to `현재 구성에서 차단되는 호환 문제는 찾지 못했어요 · 문제 없음` and exposed `부품 단위 추천 8개 · 조합 추천 141개 · 준비됨`.
- The same result retained the `적용 후 다시 검사` step and the `업그레이드 후보 바로 보기` action, so the summary behaves differently based on actual recommendation availability without changing the user’s mental model.
- Connected-browser evidence at `/result?entry=upgrade` reported `body.scrollWidth=1265`, `document.documentElement.scrollWidth=1265` at 1280px and an empty warning/error log.
- Full verification after the candidate-state pass: `npm test` passed with `252` files / `1,343` tests; `npm run typecheck` passed; `npm run build` passed with entry `192,429` bytes against the current `600,000` byte gate and the client bundle verifier; `git diff --check` passed.

## 2026-09-17 upgrade-candidate CTA focus pass

- Fixed the next-action boundary in the `UPGRADE PLAN` summary. `업그레이드 후보 바로 보기` now opens the collapsed `세부 정보·구매 도구` section before looking for the recommendation panel, then focuses and scrolls to the candidate list. The action no longer silently does nothing when the panel is behind a closed disclosure.
- The stable target is `data-testid="upgrade-recommendation-panel"`; the panel itself is keyboard-focusable after the jump.
- The normal compatible demo still exposes `부품 단위 추천 8개 · 조합 추천 141개`, while the problem demo remains `확인 필요`. Both states share the same summary action contract.
- Connected-browser evidence clicked the CTA on the compatible demo and confirmed `detailsOpen=true`, `panelPresent=true`, active focus on `upgrade-recommendation-panel`, and no horizontal overflow (`scrollWidth=1265` at 1280px). The browser warning/error log was empty.
- Full verification after this CTA fix: `npm test` passed with `252` files / `1,343` tests; `npm run typecheck` passed; `npm run build` passed with entry `192,429` bytes against the current `600,000` byte gate and the client bundle verifier; `git diff --check` passed.

## 2026-09-17 guided quote onboarding handoff and smoke pass

- The onboarding-to-generator handoff now keeps the selected gaming requirement explicit in both the producer query and the generator's URL synchronization: `resolution=4k`, `refresh=144`, `graphics=high`, and `upscaling=quality` remain present after `/recommend` mounts instead of being silently collapsed into generator defaults. This preserves the user's `4K · 144 FPS` requirement in a shareable/reloadable route.
- Added `scripts/quote-onboarding-smoke.mjs` and `npm run test:browser:quote-onboarding`. The smoke covers the real DOM path `신규 견적 → 특정 작업이나 게임 → 게임 → 사이버펑크 2077 → 4K · 144 FPS → 높음 · DLSS·품질 참고 → 500만원 → 조건 요약 → 자동 구성 결과`, and also checks `영상 편집 → 무겁게 → 4K·6K 편집·고급 효과 · 64GB · 2TB SSD`, `나중에`, and `/build?entry=upgrade`.
- Fresh Vite browser evidence on the isolated local port reported the gaming handoff as `/recommend?profile=gaming&priority=performance&resolution=4k&refresh=144&games=cyberpunk&graphics=high&upscaling=quality&ram=64&budget=5000000&ssd=2000`, with the `GAME PERFORMANCE EVIDENCE` panel present. The same run passed work estimate, later-home, and upgrade-entry assertions with no browser runtime error.
- CI now runs the onboarding smoke in both the development-server and production-preview lanes. This keeps the visual flow, condition handoff, and branch routing from becoming an implementation-only assumption.
- Verification after this pass: `npm test` passed with `252` files / `1,344` tests, `npm run typecheck` passed, `npm run build` passed with entry `192,429` bytes against the current `600,000` byte gate and the client bundle verifier, `npm run test:browser:quote-onboarding` passed on both development Vite and production preview with desktop plus 390px mobile runs, the full `npm run test:browser` passed on production preview, and `git diff --check` passed.
- Verification boundary: the smoke confirms condition propagation and advisory UI only. It does not turn catalog/spec recommendations into measured FPS guarantees; the result still requires provenance-backed game benchmark records for a verified performance state.

## 2026-09-17 guided quote wireflow capture

- Captured the implemented desktop wireflow in the connected in-app browser as six sequential screens: `START HERE`, `NEW QUOTE`, `게임·목표 성능`, `그래픽 옵션·예산`, `조건 요약`, and `AUTO BUILD DRAFT`.
- The captured gaming path visibly carries `사이버펑크 2077 · 4K · 144 FPS`, `높음 · DLSS·품질 참고`, the `450만원 ~ 530만원` reference range at a selected `500만원` budget, and the final `GAME PERFORMANCE EVIDENCE` panel.
- The sequence is an implementation-backed wireflow rather than a static illustration: each screen was reached through the preceding CTA in the live app, and the final route retained the selected query conditions.
- Visual boundary: the current desktop capture is a flow review artifact; responsive handset capture and measured game FPS evidence remain separate verification lanes.

## 2026-09-17 mobile guided quote wireflow capture

- Replayed the same implementation-backed flow at a `390 x 844` mobile viewport: first intent, gaming target, budget range, condition summary, and automatic-build result.
- Mobile screenshots exposed the compact header/menu treatment and preserved the same decision hierarchy: `사이버펑크 2077 · 4K · 144 FPS`, `500만원`, `450만원 ~ 530만원`, and the final automatic-build surface.
- Authoritative layout measurement after the result route: `innerWidth=390`, `body.scrollWidth=390`, `document.documentElement.scrollWidth=390`, and `0` rendered elements extending beyond the viewport.
- The quote-onboarding browser smoke now repeats the full branch at `390 x 844` in addition to the desktop pass and asserts the same condition handoff plus `bodyScrollWidth=390`, `documentScrollWidth=390`, and no overflowing elements.
- The mobile capture confirms presentation continuity only; benchmark evidence and actual in-game FPS remain separate from the recommendation UI.

## 2026-09-17 FPS evidence operations readback pass

- The admin `GAME FPS EVIDENCE` panel now summarizes saved records as `평균 기준 충족`, `목표 FPS 미달`, and `갱신 필요` instead of exposing only a raw record count.
- Each visible record now readbacks the exact GPU part ID, average FPS versus target FPS, resolution, graphics preset, upscaling mode, and source kind. This keeps the operator's evidence review aligned with the same exact-condition matching contract used by the result screen.
- Connected admin-browser evidence read `저장 자료 8개 · 평균 기준 충족 1개 · 목표 미달 0개 · 갱신 필요 7개`; no benchmark values were added or altered by this pass.
- Static and runtime verification after the panel change: full `npm test` passed with `252` files / `1,344` tests, the focused evidence/engine/API lane passed with `137` tests, `npm run typecheck` passed, `npm run build` passed with entry `192,429` bytes against the `600,000` byte gate, and `git diff --check` passed.
- The coverage filter now narrows the same panel by state and search terms without changing stored data: connected-browser evidence selected `갱신 필요 7` and read back `7 / 8개`, excluding the verified 80 FPS record from the visible list.
- The user-facing generator result now exposes the same boundary as `EXACT-CONDITION COVERAGE`: the current `사이버펑크 2077 · 4K · 144 FPS` route read `0 / 1개 게임 자료 연결`, `자료가 없는 게임 · 사이버펑크 2077`, and the selected GPU name. This makes catalog GPU guidance and exact FPS evidence visibly separate.
- The admin coverage matrix now accepts exact resolution, target FPS, graphics preset, upscaling, and ray-tracing filters. Connected-browser evidence selected `4K + 144Hz + 높음 + DLSS·품질 + 레이 트레이싱` and read back `0 / 8개`, matching the user's current exact-condition gap.
- The local result card now exposes an operations-only `운영 coverage로 확인` link. Connected-browser evidence followed it to `/admin` with the game ID, GPU ID, 4K, 144Hz, high, quality upscaling, and ray-tracing filters prefilled; the destination read back `0 / 8개` without re-entering conditions.
- The same result card now offers `측정 요청 JSON 복사`. The copied request contains only schema version, game IDs, selected GPU identity, resolution, target FPS, graphics preset, ray tracing, and upscaling; it intentionally contains no invented average FPS or 1% low values.
- Final verification after the measurement-request addition: `npm test` passed with `252` files / `1,345` tests, `npm run build` passed with entry `192,481` bytes against the `600,000` byte gate, and `git diff --check` passed.
- The deep-linked admin panel now identifies the origin as `MEASUREMENT REQUEST` and readbacks `게임 · cyberpunk · GPU · gpu-rx-7900-xtx`, so operators can distinguish a user-transferred request from a manually assembled filter.
- Final verification after the request-context readback: `npm test` passed with `252` files / `1,345` tests, `npm run build` passed with entry `192,481` bytes against the `600,000` byte gate, and `git diff --check` passed.
- The admin panel also accepts the copied request JSON through `요청 조건 적용`; runtime readback applies the game/GPU/exact-condition filters without calling the evidence save API or adding FPS values.
- Final verification after request JSON import/readback: `npm test` passed with `252` files / `1,345` tests, `npm run build` passed with entry `192,481` bytes against the `600,000` byte gate, and `git diff --check` passed.
- The applied request now renders an explicit `MEASUREMENT REQUEST` context in the admin panel, distinguishing a pasted user request from a manually assembled filter. The composer for a real measurement record remains empty until an operator supplies actual measured values and a source.
- Connected-browser evidence opened the composer and pressed `JSON에 추가` with empty values; it stayed fail-closed with `ID·게임·GPU·평균 FPS·측정일·HTTPS 출처와 조건을 모두 확인해 주세요.` and did not append a record.
- The quote-onboarding desktop/mobile smoke now asserts the user-facing measurement-request action is present on both generated-result paths.
- The same smoke now covers the remaining new-quote branches: budget-only `400만원 → 상급 일반 구성 · 64GB · 2TB SSD → /recommend?profile=general&ram=64&budget=4000000&ssd=2000`, and direct performance `최상급 · 64GB · 2TB · 외장 GPU 포함 → /recommend?profile=general&priority=performance&tier=top&ram=64&budget=3000000&ssd=2000`.
- The work branch now runs through the result route as well: `영상 편집 · 무겁게 → /recommend?profile=creator&priority=performance&work=video&intensity=heavy&ram=64&budget=3000000&ssd=2000`, with `generator-work-context` and `4K·6K 편집·고급 효과 · 64GB · 2TB SSD` read back on desktop and mobile.
- This pass fixed the budget-only handoff contract so the generic budget estimator's displayed RAM/storage tier is carried into the generator request instead of falling back to 32GB·1TB.
- Final verification after the budget/spec branch pass: `npm test` passed with `252` files / `1,346` tests, `npm run build` passed with entry `192,481` bytes against the `600,000` byte gate, and `git diff --check` passed.
- Composer-entered `datetime-local` measurement dates are normalized to ISO timestamps before they enter the evidence contract, keeping provenance timezone-explicit.
- Final verification after the composer provenance normalization: `npm test` passed with `252` files / `1,345` tests, `npm run build` passed with entry `192,481` bytes against the `600,000` byte gate, and `git diff --check` passed.
- The exact verified-GPU ranking guard is now covered by an engine test: after compatibility, unknown, warning, and budget gates pass, a GPU with matching verified evidence wins an otherwise equivalent candidate comparison. This does not bypass safety gates.
- Final verification after evidence-aware generator ranking: `npm test` passed with `252` files / `1,347` tests, `npm run build` passed with entry `192,481` bytes against the `600,000` byte gate, and `git diff --check` passed.
- The live RX 7900 XTX exact-match recheck remains intentionally `stale` because its stored measurement date is outside the 180-day window; no source data was altered to force a verified result.
- A live browser recheck of the stored RX 7900 XTX / Cyberpunk / 4K / 60 FPS / high / native record found an exact condition match but a `2026-05-14` measurement date beyond the 180-day freshness window; the resulting `stale` state is the reason the generator correctly did not promote it to `verified`.
- Final verification after the coverage matrix, user card, and deep-link changes: `npm test` passed with `252` files / `1,344` tests (one transient temp-directory cleanup race was cleared by an immediate rerun), `npm run build` passed with entry `192,429` bytes against the `600,000` byte gate, and `git diff --check` passed.
- Each stored evidence row now offers `측정 요청`, regenerating a condition-only request for stale or target-gap material without modifying the evidence record.
- Final verification after the per-record request action: `npm test` passed with `252` files / `1,347` tests, `npm run build` passed with entry `192,481` bytes against the `600,000` byte gate, and `git diff --check` passed.

## 2026-09-17 summary-edit handoff pass

- `READY` 요약 화면을 읽기 전용 종착점에서 항목별 편집 허브로 확장했다. 게임·목표 성능·그래픽 옵션·작업·작업 강도·성능 등급·예산 행이 각 원래 단계로 바로 돌아가는 `변경` CTA를 제공하고, 예상 수준처럼 파생된 값은 수정 CTA 없이 결과값으로 남긴다.
- 예산 변경 경로를 실제 브라우저에서 재생했다. `조건 요약 → 예산 변경 → 500만원 유지 → 이 금액으로 맞춰보기 → 조건 요약` 뒤에도 `사이버펑크 2077`, `4K · 144 FPS`, `500만원`이 모두 보존되었다.
- 연결된 브라우저 화면에서 요약 카드의 `목표 성능 변경`, `그래픽 옵션 변경`, `예산 변경` 버튼과 `이 조건으로 견적 생성하기` CTA를 확인했다. 데스크톱 캡처에서 카드가 중앙 열 안에 유지되었고, 기존 390px 모바일 overflow smoke도 같은 변경 경로를 통과했다.
- 회귀 검증: `src/quote-onboarding.test.ts` 32개 통과, `npm run typecheck` 통과, `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `git diff --check` 통과. 최종 전체 검증도 `252개 파일 / 1,348개 테스트` 통과, production build도 `192,481`바이트 엔트리로 `600,000`바이트 게이트 이내 통과했다.

## 2026-09-17 budget-range action pass

- 예산 단계의 권장 가격 범위를 정적 안내에서 실행 가능한 조정 장치로 확장했다. 목표 범위보다 낮으면 `권장 최저 예산(450만원)으로 맞추기`, 높으면 `권장 상한(530만원)으로 맞추기`가 나타나며, 범위 안에서는 조정 CTA를 숨긴다.
- 이 CTA는 목표 범위의 경계값만 설정하고 다른 게임·해상도·FPS·그래픽 조건은 변경하지 않는다. 가격 범위 자체는 여전히 카탈로그·스펙 기반 참고값이며 FPS 보장값이 아니다.
- 브라우저 smoke에서 `200만원 → 권장 최저 450만원 → 500만원 → 600만원 → 권장 상한 530만원 → 500만원`을 실제로 재생했고, 이후 조건 요약·자동 구성 handoff가 기존과 동일하게 통과했다.
- 연결된 브라우저 화면에서 200만원 상태의 가격 범위 카드, `조금 더 필요해요` 상태, 권장 최저 조정 버튼이 함께 보이는 것을 확인했다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run typecheck` 통과. 후속 전체 검증도 `252개 파일 / 1,348개 테스트` 통과, production build도 `192,481`바이트 엔트리로 `600,000`바이트 게이트 이내 통과했으며 `git diff --check`도 통과했다.

## 2026-09-17 budget-target-alternative pass

- 권장 가격 범위보다 예산이 낮은 상태에서 `권장 최저 예산으로 맞추기`만 제공하던 흐름에 `목표 성능 다시 고르기`를 추가했다.
- 게이밍은 `performance` 단계, 작업은 `intensity` 단계, 직접 성능은 `spec` 단계로 돌아가며 기존 게임·작업 선택값은 유지한다. 예산을 올리는 경로와 목표를 낮추는 경로를 같은 카드에서 비교할 수 있다.
- quote onboarding smoke가 4K·144 FPS·200만원 상태에서 두 CTA를 모두 확인하고, `목표 성능 다시 고르기 → 성능 → 그래픽 옵션 → 예산`으로 실제 이동한 뒤 기존 게임·목표·예산을 보존하는지 확인하고, 권장 최저 예산 자동 조정 경로를 계속 재생한다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run test:browser` 전체 브라우저 smoke 통과, `npm run typecheck` 통과. 전체 테스트도 `252개 파일 / 1,348개 테스트` 통과, production build도 `192,481`바이트 엔트리로 `600,000`바이트 게이트 이내 통과했으며 `git diff --check`도 통과했다.

## 2026-09-17 intent-card-guidance pass

- 첫 `START HERE` 화면의 새 견적·업그레이드·나중에 카드에 각 선택 후 진행될 다음 단계를 한 줄 설명으로 추가했다.
- 새 견적은 `게임·작업·예산을 몇 가지 질문으로 정리`, 업그레이드는 `현재 부품을 확인하고 교체 후보 탐색`, 나중에는 `홈 복귀 후 다시 시작`으로 명확히 안내한다.
- 브라우저 smoke가 세 카드 설명을 모두 확인한 뒤 기존 새 견적·게임·작업·예산·직접 성능·나중에·업그레이드 흐름을 재생한다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run test:browser` 전체 브라우저 smoke 통과, `npm run typecheck` 통과. 전체 테스트도 `252개 파일 / 1,348개 테스트` 통과, production build도 `192,481`바이트 엔트리로 `600,000`바이트 게이트 이내 통과했으며 `git diff --check`도 통과했다.

## 2026-09-17 quote-mode-guidance pass

- `NEW QUOTE` 카드에도 선택 결과를 설명하는 문구를 추가했다. 예산은 `예상 성능·RAM·SSD`, 작업/게임은 `게임·작업과 목표 성능`, 직접 성능은 `성능 등급·외장 GPU·RAM·SSD` 입력으로 이어진다.
- 첫 의도 선택과 새 견적 방식 선택이 같은 정보 밀도로 설명되어, 첫 사용자에게 카드 제목만 읽고 다음 화면을 추측하게 하지 않는다.
- quote onboarding smoke가 세 mode 설명 문구를 확인한 뒤 기존 분기와 handoff를 재생한다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run typecheck` 통과. 전체 테스트와 production build는 이 코드 변경 후 다음 전체 검증에서 다시 확인한다.

## 2026-09-17 onboarding-progress-bar pass

- 각 온보딩 화면에 branch-aware progress bar를 추가했다. `GAMING 4 / 8`, `WORK 4 / 7`, `READY`처럼 기존 단계 숫자 계약을 시각적으로도 보여주며, 접근 가능한 `role=progressbar`·`aria-valuenow`를 함께 제공한다.
- 게임·작업·예산-only·직접 성능·업그레이드 분기별 총 단계 계산은 기존 `stepIndicatorFor` 결과를 그대로 사용해 route/hand-off 계약을 변경하지 않는다.
- 첫 화면 `START HERE` progress DOM과 모바일 overflow가 quote onboarding smoke에서 확인된다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run typecheck` 통과. 전체 테스트와 production build는 이 코드 변경 후 다음 전체 검증에서 다시 확인한다.

## 2026-09-17 gaming-performance-contract pass

- 게이밍 `PERFORMANCE`와 `GRAPHICS OPTIONS` 단계에 성능 목표 계약 카드를 추가했다. `평균 FPS 144 이상 목표`, 선택 조건 태그, 최신 exact-condition 실측 자료가 있어야 `검증 완료`가 된다는 기준을 한 화면에서 보여준다.
- 그래픽 옵션 단계에서는 선택 조건에 따른 참고 가격대 `450만원 ~ 530만원`도 함께 표시해, 사용자가 `4K · 144 FPS`를 선택한 순간 필요한 예산의 크기를 이해할 수 있게 했다.
- 연결된 브라우저 전체 화면에서 `사이버펑크 2077 · 4K · 144 FPS · 높음 · DLSS·품질 참고`, `평균 FPS 144 이상 목표`, `이 조건의 참고 가격대 450만원 ~ 530만원`, 실측 근거 안내와 다음 CTA를 확인했다.
- 이 카드는 실제 FPS를 만들거나 보장하지 않으며, 결과의 `GAME PERFORMANCE EVIDENCE` exact-condition 상태와 같은 근거 경계를 사용자 선택 단계까지 앞당겨 보여주는 역할만 한다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run typecheck` 통과. 후속 전체 검증도 `252개 파일 / 1,348개 테스트` 통과, production build도 `192,481`바이트 엔트리로 `600,000`바이트 게이트 이내 통과했으며 `git diff --check`도 통과했다.

## 2026-09-17 graphics-choice-guidance pass

- 그래픽 옵션 단계의 품질·업스케일링 선택 아래에 선택 의미를 설명하는 안내를 추가했다. `높음`은 시각 효과·GPU 여유, `DLSS·품질 참고`는 화질·프레임 균형을 설명하며 실제 FPS를 보장하는 문구는 사용하지 않는다.
- 사용자가 옵션명만 외우지 않고 선택의 trade-off를 이해한 뒤 예산·참고 가격대와 연결할 수 있게 했다.
- quote onboarding smoke가 `시각 효과 우선`, `화질과 프레임을 함께 고려` 안내와 기존 exact-condition 성능 계약 카드를 함께 확인한다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run typecheck` 통과. 전체 테스트와 production build는 이 코드 변경 후 다음 전체 검증에서 다시 확인한다.

## 2026-09-17 first-entry guided-home pass

- 부품을 아직 선택하지 않은 사용자의 홈 hero를 기존 호환성 오류 예시 중심에서 `START HERE` guided quote 진입 화면으로 분리했다. `몇 가지 질문만 답하면`, `사용 목적`, `목표 성능`, `결과 확인` 단계와 `새 견적 시작하기` CTA를 먼저 보여준다.
- 기존 부품 선택이 있는 사용자는 기존 `CHECK PREVIEW` 호환성 검사 홈을 유지한다. 따라서 새 사용자와 이미 견적을 편집 중인 사용자의 진입 목적을 같은 화면에서 섞지 않는다.
- quote onboarding smoke가 첫 홈에서 `home-guided-entry` DOM과 `게임 · 작업 · 예산` preview를 확인한 뒤 `/start`로 이동하고, 이후 게임·작업·예산-only·직접 성능·나중에·업그레이드 분기를 끝까지 재생한다.
- lazy 홈 fallback이 실제 화면으로 교체되기 전 성급히 검사하던 smoke 관찰 경계를 guided entry DOM 대기로 고쳤다. 데스크톱과 390px 모바일에서 같은 홈→온보딩 진입 계약을 확인한다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run test:browser` 전체 브라우저 smoke 통과, `npm run typecheck` 통과. 전체 테스트도 `252개 파일 / 1,348개 테스트` 통과, production build도 `192,481`바이트 엔트리로 `600,000`바이트 게이트 이내 통과했으며 `git diff --check`도 통과했다.

## 2026-09-17 first-user-secondary-entry pass

- 부품 미선택 첫 사용자 홈의 보조 CTA가 고급 `/recommend` 화면을 바로 여는 `조건으로 자동 구성`에서 `부품을 직접 선택하기`로 바뀌었다.
- 첫 사용자는 `새 견적 시작하기`로 guided quote에 들어가거나, `부품을 직접 선택하기`로 수동 편집기에 들어갈 수 있다. 이미 부품을 가진 사용자는 기존 `조건으로 자동 구성` 바로가기를 유지한다.
- Desktop·mobile smoke가 두 홈 CTA의 텍스트와 진입 경계를 확인하고, 첫 사용자의 primary guided flow를 계속 재생한다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run typecheck` 통과. 전체 테스트와 production build는 이 코드 변경 후 다음 전체 검증에서 다시 확인한다.

## 2026-09-17 mobile-first-entry alignment pass

- 모바일 홈의 부품 미선택 상태도 기존 `CPU·메인보드·RAM·그래픽카드` 빈 목록 대신 `START HERE` guided quote 카드로 통일했다. `사용 목적 → 목표 성능 → 결과 확인` 세 단계와 `부품을 고르지 않아도 된다`는 안내를 먼저 보여준다.
- 부품이 하나라도 선택된 모바일 사용자는 기존 `CURRENT BUILD` 목록·진행률·호환성 검사 진입을 그대로 유지한다.
- quote onboarding smoke의 390px 실행에서 `mobile-home-guided-entry`, guided quote 텍스트, `/start` 진입, 이후 전체 분기와 overflow 없는 상태를 함께 확인한다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run test:browser` 전체 브라우저 smoke 통과, `npm run typecheck` 통과. 전체 테스트도 `252개 파일 / 1,348개 테스트` 통과, production build도 `192,481`바이트 엔트리로 `600,000`바이트 게이트 이내 통과했으며 `git diff --check`도 통과했다.

## 2026-09-17 work-intensity estimate pass

- `작업 강도` 선택 화면이 추상적인 `가볍게·균형 있게·무겁게` 라벨만 보여주지 않고, 선택한 작업의 실제 범위와 예상 사양을 함께 표시하도록 확장했다.
- 연결된 브라우저 화면에서 `영상 편집` 기준으로 `FHD·가벼운 컷 편집 · 입문 GPU · 16GB · 500GB SSD`, `4K 편집·일반 효과 · 중급 GPU · 32GB · 1TB SSD`, `4K·6K 편집·고급 효과 · 상급 GPU · 64GB · 2TB SSD`가 각 카드 안에 보이는 것을 확인했다.
- 선택 CTA와 추천 배지는 그대로 유지하면서 설명만 구체화했으며, 실제 선택 후 예산 화면·조건 요약·generator handoff 계약은 기존과 동일하게 보존했다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run typecheck` 통과. 후속 전체 검증도 `252개 파일 / 1,348개 테스트` 통과, production build도 `192,481`바이트 엔트리로 `600,000`바이트 게이트 이내 통과했으며 `git diff --check`도 통과했다.

## 2026-09-17 work-type-guidance pass

- 작업 종류 선택 카드에 대표 사용 장면을 추가했다. 영상 편집은 `FHD·4K 컷 편집과 효과 작업`, 3D는 `모델링·씬 구성·반복 렌더링`, 개발은 `IDE·빌드·컨테이너·가상 머신`처럼 사용 목적을 선택 순간에 이해할 수 있게 했다.
- 방송·스트리밍, AI·머신러닝, 음악·오디오, 사무·문서도 각각 송출·녹화, 로컬 추론·학습, 트랙·플러그인, 문서·멀티태스킹 기준을 보여준다.
- quote onboarding smoke가 작업 분기 진입 시 대표 작업 설명을 확인한 뒤 기존 강도·예산·결과 handoff를 재생한다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run typecheck` 통과. 전체 테스트와 production build는 이 코드 변경 후 다음 전체 검증에서 다시 확인한다.

## 2026-09-17 general-target result pass

- `예산-only`와 `직접 성능 입력` 결과에도 `GENERAL TARGET` 기준 카드를 추가했다. 예산-only는 `예산 중심 구성 · 상급 일반 구성 · 상급 GPU · 64GB · 2TB SSD`, 직접 입력은 `최상급 성능 · 직접 입력 · 외장 GPU 포함 · 64GB · 2TB SSD`를 결과 상단에서 다시 읽어준다.
- 이 기준 카드는 실제 catalog에서 선택된 부품 목록과 분리되어, 사용자가 입력한 목표와 엔진이 실제로 선택한 CPU·GPU·메모리·SSD를 혼동하지 않도록 한다.
- quote onboarding smoke가 두 경로 모두 `generator-general-context`를 확인하고 query·결과 기준·실제 결과 화면까지 통과한다.
- 검증: `npm run test:browser:quote-onboarding` 데스크톱·390px 모바일 통과, `npm run test:browser` 전체 브라우저 smoke 통과, `npm run typecheck` 통과. 전체 테스트도 `252개 파일 / 1,348개 테스트` 통과, production build도 `192,481`바이트 엔트리로 `600,000`바이트 게이트 이내 통과했으며 `git diff --check`도 통과했다.

## 2026-09-17 sequential-wireflow-capture pass

- Added `npm run capture:quote-onboarding`, which replays the live CTA sequence and captures `9` core desktop screens plus `9` core mobile screens at `1280×900` and `390×844`, with representative work, budget-only, direct-spec, upgrade, and later-home branch captures in the same manifest.
- The capture sequence covers `HOME · START HERE`, start intent, new quote mode, use case, game performance, graphics contract, budget/range, editable summary, and generated result with `GAME PERFORMANCE EVIDENCE`.
- Captures are stored under `artifacts/quote-onboarding/` with a machine-readable `manifest.json`; the review index is [quote-onboarding-capture.md](docs/quote-onboarding-capture.md). The manifest records `5` work, `3` budget-only, `3` direct-spec, `2` upgrade, and `1` later-home screens per viewport.
- Visual QA found the first mobile capture was taken during the 240ms entry animation. The capture runner now waits 320ms before each screenshot and regenerated the full set with stable opacity/layout.
- Verification: capture runner passed with `desktop=9`, `mobile=9`; `npm run test:browser:quote-onboarding` passed for desktop·390px mobile; full browser smoke passed; full tests passed with `252개 파일 / 1,348개 테스트`; production build passed with entry `192,481` bytes against `600,000`; `git diff --check` passed.

## 2026-09-17 flow-board handoff pass

- Added `docs/quote-onboarding-flow-board.html`, a responsive review board that places the 9 desktop and 9 mobile captures in the same numbered order for side-by-side confirmation.
- The board links the generated PNGs rather than recreating the UI, so the visual handoff stays tied to the implementation-backed capture manifest.
- Static handoff validation confirmed the board references exactly `9` desktop and `9` mobile capture images; `git diff --check` passed.

## Final result

passed
