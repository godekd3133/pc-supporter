# Project Context

## Domain

PC Supporter — PC 부품 카탈로그, 호환성 검사, 가격·원문·성능 근거를 함께 보여주는 React/Vite + Express 서비스.

## Role

근거 기반으로 producer→consumer 흐름과 데이터 계약을 먼저 확인하고, 범위를 좁혀 구현·검증하는 개발 협업자.

## Codebase

- `src/`: React 화면과 브라우저 상태·URL 동기화.
- `server/`: Express/tsx API, 카탈로그 검색·정렬·수집·검수 로직.
- `server/catalog-snapshot.ts`: catalog/accessory 배열과 snapshot timestamp·revision을 함께 확보하는 공유 snapshot Seam.
- `server/build-validation.ts`: parsed build의 부품·주변 부품 ID와 SSD/허브/RGB 관계를 한 번에 판정하는 build selection validation Module.
- `server/saved-build-presentation.ts`: 저장 견적 public projection과 최신 catalog/accessory summary를 한 Interface로 조립하는 presentation Module.
- `server/build-share.ts`: public bearer-link mutation의 owner-token/admin fallback을 판정하는 owner access Seam; admin auth 비활성화 시에도 owner token은 계속 필요하다.
- `server/index.ts`의 `ownedSavedBuildForRequest()`: saved-build mutation의 존재·만료·owner access 판정을 공통으로 수행하고, 각 route의 기존 오류 메시지는 호출자가 보존한다.
- public share surfaces (candidate comparison, version comparison, budget ladder, watchlist)는 read를 공개하되 revoke/mutation은 `shareOwnerOrEnabledAdminCanManage()`로 owner access를 확인한다. 만료된 share는 read에서 차단하고 revoke는 허용한다.
- public share surface의 build/watchlist revoke/delete도 각각 `buildShareRateLimit`·`watchlistShareRateLimit`을 사용해 공개 share 조회와 동일한 IP 보호 경계를 유지한다.
- `server/index.ts`의 `jsonBodyErrorHandler()`: JSON parser의 malformed/oversized body를 stack이 없는 구조화된 `INVALID_JSON`/`REQUEST_BODY_TOO_LARGE` 응답으로 정규화한다.
- 핵심·주변 부품 batch 조회는 한 요청 최대 100개 ID 계약을 유지하고, `server/catalog-batch.ts`는 Set 기반 중복 추적으로 oversized 입력도 선형 시간에 정규화한다.
- 저장 견적 monitor 요청은 최대 20개 ID 계약을 유지하고, `server/build-monitor.ts`도 Set 기반 중복 추적으로 oversized 입력의 중복 검사를 선형화한다.
- 저장 견적 구매 진행률·가격 이력의 persisted `history` 배열은 현재 revision과 별도로 최대 20개까지만 허용하며, 서버 parser가 이력 정규화 전에 초과 배열을 fail-closed 한다.
- build/compatibility 입력의 반복 선택 목록(`memory`·`ssd`·`hdd`·`accessories`)은 각 최대 100개로 서버에서 먼저 제한해 oversized body가 엔진 평가까지 도달하지 않게 한다.
- build/compatibility의 part/accessory/target ID는 최대 160자로 서버에서 먼저 제한하며, M.2 slot selection의 SSD ID와 RGB target ID도 같은 경계를 공유한다.
- 브라우저 견적 JSON 가져오기도 `shared/build-input-limits.ts`의 같은 목록 100개·ID 160자·M.2 8슬롯 계약을 먼저 적용해 서버와 로컬 import가 서로 다른 입력을 확장하지 않게 한다.
- 구매 전 체크리스트 JSON 가져오기는 완료 상태(`checkedIds`)를 로컬 저장과 같은 최대 100개로 제한하고, `itemIds`는 현재 checklist 길이까지만 허용해 자체 export 왕복을 보존하면서 과대 입력을 현재 목록 필터링 전에 차단한다.
- 구매 목록 진행률 JSON도 완료 상태를 최대 100개로 export/import하고, `rowKeys`는 현재 행 수까지 허용해 대형 자체 export 왕복을 보존하면서 현재 목록보다 큰 입력을 정규화 전에 차단한다.
- 가격 추적 목록의 JSON/CSV import는 기존 저장 한도 50개를 raw 배열·CSV 행 파싱 전에 적용하고, URL 공유 hash도 기존 12개 payload 한도를 먼저 적용한다.
- 구매 목록 브라우저 가격 이력도 최대 100행·행당 20샘플 계약을 localStorage parser 단계에서 먼저 적용해 oversized raw history를 전부 정규화하지 않는다.
- `AccessoryRecommendationPanel`의 후보 비교 배열은 `useMemo`로 안정화해 `AccessoryRecommendationComparison`의 가격 이력 effect가 매 렌더마다 `/api/price-history`를 재호출하지 않게 한다. 이 반복 호출이 candidate preview·accessory action smoke timeout의 실제 producer였다.
- browser smoke는 후보 비교가 안정화된 뒤 750ms 동안 `/api/price-history` 추가 호출이 없는지 직접 assertion해 이 identity loop 회귀를 잡는다.
- App의 브라우저 알림 사용 설정과 HistoryView의 저장 견적 자동 점검 활성/주기는 같은 localStorage key의 cross-tab storage 이벤트를 소비해 현재 탭 상태도 갱신한다. 자동 점검을 외부 탭에서 켜면 현재 탭은 즉시 한 번 점검을 시작한다.
- `src/api.ts`는 StrictMode effect 재실행으로 생기는 동일한 abort-free saved-build detail/check-cause GET/HEAD read를 요청 옵션·owner credential까지 포함해 in-flight coalesce하며, owner monitor/metadata refresh와 catalog/list read는 최신 context를 위해 독립 요청 seam을 유지한다.
- App의 브라우저 알림 delivered-ID ledger도 cross-tab storage event로 `deliveredBrowserNotificationIdsRef`를 갱신해 같은 alert를 여러 탭에서 중복 Notification으로 보내지 않는다.
- `npm run test:browser:history-settings`는 실제 저장 견적을 History에 로드한 뒤 브라우저 알림·자동 점검 활성·주기 storage event가 현재 탭 UI에 반영되는지 독립적으로 검증한다.
- PriceWatchlistView도 가격 모니터 alert·자동 확인 활성/주기·alert policy·가격 이력 기간 storage event를 소비하며, 외부 탭에서 자동 확인을 켜면 현재 탭이 즉시 한 번 가격을 확인한다.
- `npm run test:browser:price-watch-settings`는 `/watchlist`에서 가격 모니터 설정 storage event가 활성/주기·이력 기간·알림 정책 UI에 반영되는지 독립적으로 검증한다.
- PriceWatchlist의 price baseline ref도 cross-tab baseline storage event를 소비해 다음 가격 refresh가 최신 탭의 기준으로 alert를 계산한다.
- PriceWatchlist saved-link metadata sync는 이전 link의 늦은 404/만료 응답이 새 link context의 owner-token storage를 삭제하지 않도록 cancellation을 먼저 판정하며, `npm run test:browser:price-watchlist-link-context`가 old/new token 보존을 검증한다.
- `SharedSavedBuildVersionView`의 현재 기준 재검사는 route 이탈 시 공유 AbortController로 build 목록·compatibility 요청을 취소하며, `npm run test:browser:shared-version-recheck-route`가 실제 `abortedCalls`를 검증한다.
- `SharedWatchlistView`의 snapshot GET도 route 이탈 시 AbortController로 취소하며, `npm run test:browser:shared-watchlist-route-abort`가 실제 shared watchlist 요청 취소를 검증한다.
- `SharedWatchlistView`의 사용자 현재가 재조회 detail requests도 route 이탈 시 AbortController로 취소하며, `npm run test:browser:shared-watchlist-live-price-abort`가 price request abort를 검증한다.
- `SharedAlternativeComparisonView`의 snapshot GET도 route 이탈 시 AbortController로 취소하며, `npm run test:browser:shared-comparison-route-abort`가 실제 비교 snapshot 요청 취소를 검증한다.
- `SharedAlternativeComparisonView`의 현재 메타 freshness GET도 route 이탈 시 AbortController로 취소하며, 같은 comparison route probe가 `metaCalls`·`metaAbortedCalls`와 snapshot abort를 함께 검증한다.
- `SharedAlternativeComparisonView`의 현재 후보 `/api/parts/batch` 재확인도 route 이탈 시 AbortController로 취소하며, `npm run test:browser:shared-comparison-live-check-abort`가 batch abort를 검증한다.
- `SharedBudgetLadderView`의 snapshot·lineage GET도 route 이탈 시 공유 AbortController로 취소하며, `npm run test:browser:shared-budget-ladder-route-abort`가 실제 ladder 요청 취소를 검증한다.
- `SharedBudgetLadderVersionComparison`의 lineage 이전 snapshot GET도 effect-local AbortController signal을 전달하고 cleanup에서 abort하며, `npm run test:browser:shared-budget-ladder-version-comparison-abort`가 `versionCalls:1`·`abortedCalls:1`과 Home 복귀를 검증한다.
- `SharedBudgetLadderView`의 현재 카탈로그 재생성도 refresh-local AbortController로 세 `/api/builds/recommend` POST와 `/api/meta`를 함께 취소하며, `npm run test:browser:shared-budget-ladder-refresh-route-abort`가 signal을 가진 producer의 `recommendAbortedCalls:3`·`metaAbortedCalls:1`과 Home 복귀를 검증한다.
- `SharedBudgetLadderView`의 version apply `/api/builds/recommend`도 전용 AbortController로 route cleanup에서 취소하며, `npm run test:browser:shared-budget-ladder-version-apply-route-abort`가 `recommendSignalCalls:1`·`abortedCalls:1`, 실제 shared-page unmount와 Home 복귀를 검증한다.
- `SharedBudgetLadderView`의 최신 snapshot 저장 POST도 전용 AbortController로 route cleanup에서 취소하며, `npm run test:browser:shared-budget-ladder-save-route-abort`가 `saveSignalCalls:1`·`abortedCalls:1`, 다음 snapshot mount와 stale preview 부재를 검증한다.
- `SharedBudgetLadderView`의 snapshot revoke DELETE도 같은 route-scoped mutation AbortController로 취소하며, `npm run test:browser:shared-budget-ladder-revoke-route-abort`가 `deleteSignalCalls:1`·`abortedCalls:1`, 다음 snapshot mount와 stale preview 부재를 검증한다.
- `SharedBudgetLadderPartialMergePanel`의 preview `/api/compatibility/check`도 child-local AbortController signal을 parent callback까지 전달하며, `npm run test:browser:shared-budget-ladder-partial-preview-route-abort`가 `checkSignalCalls:1`·`abortedCalls:1`과 다음 partial-merge mount를 검증한다.
- `shared/build-selection-hydration.ts`는 App의 핵심·주변 부품 batch hydration producer를 `build-input` manual chunk로 분리하고 optional signal을 전달한다. partial-merge·generator apply·checkBuild route는 App route transition에서 controller를 abort하며, `npm run test:browser:build-selection-hydration-route-abort`, `npm run test:browser:generator-apply-route`, `npm run test:browser:check-hydration-route-abort`가 parts/accessories 또는 batch producer의 signal·abort를 검증한다.
- History에서 저장 견적을 여는 경로도 `openSavedBuild()` 전용 controller로 batch hydration과 compatibility POST를 묶고, `build` 변경으로 시작되는 전역 hydration effect는 별도 route-owned controller로 관리한다. History -> Home 이탈은 두 producer와 route-transient toast를 모두 정리하며 `npm run test:browser:saved-build-open-hydration-route-abort`가 parts/accessories 중복 hydration과 compatibility 요청의 signal·abort, stale toast 부재, Home 복귀를 검증한다.
- 관리자 3DMark 검수 작업 패키지는 cross-tab progress storage 이벤트가 같은 offset을 재전송해도 새 request generation을 만들어 패키지를 다시 읽고, `workPackage`를 비운 채 로딩이 끝나는 상태를 허용하지 않는다.
- browser file import surfaces use the shared `LOCAL_IMPORT_MAX_BYTES = 1MB` guard before `file.text()`, matching the API JSON body boundary and preventing oversized raw files from reaching parsers.
- browser catalog picker/accessory cache parsers reject raw arrays or envelope item arrays above their persisted 600-item contracts before record normalization.
- local share history and generator preset parsers reject raw arrays above their own persisted limits before per-entry normalization; price-alert and watchlist-link parsers intentionally retain their existing filtering behavior.
- saved-build monitor alert storage now rejects raw arrays above the persisted 50-alert limit before per-alert normalization; malformed entries within the valid bound continue to be filtered as before.
- saved-build monitor alert finding context arrays now reject more than four raw IDs/titles before per-item filtering, matching the emitted alert contract.
- saved-build check persisted snapshots reject raw core/accessory finding arrays above their compact 32-item contracts before per-finding normalization.
- App saved-build history/ID/owner-token local state now rejects arrays or token maps above the persisted 20-entry limit before filtering, while write paths use the same shared local limit.
- Price monitor baseline storage now enforces a 50-entry persisted object-map limit before key normalization and caps writes to the same limit.
- BuildActionCenter now shares the purchase checklist 100 checked-state limit on its localStorage read/write seam instead of maintaining a separate literal.
- checklist/progress localStorage readers now reject raw arrays above their persisted limits before filtering and Set expansion.
- server catalog-spec/source-check history readers now reject raw history arrays above their persisted 100/1,000-entry limits before normalization.
- checklist checked-state persistence uses the single `shared/checklist-storage-limits.ts` contract across the detailed checklist, action center, and action-link helper.
- 예산 ladder 공유 snapshot도 M.2 slot selection을 실제 물리 슬롯 계약인 최대 8개로 검증하며, 기존 공유 payload의 다른 bounded 배열·ID 계약은 유지한다.
- `/api/parts` 스펙 필터 diagnostics는 결과 정렬이 필요 없으므로 `filterParts()` unsorted seam을 사용해 진단용 전체 정렬을 피하고, 결과 목록만 `searchParts()`로 정렬한다.
- `server/index.ts`의 API not-found handler: SPA fallback은 유지하면서 미등록 `/api/*` 경로를 구조화된 `API_NOT_FOUND` 404로 응답한다.
- `/api/admin/login`은 `admin-login` IP rate-limit(분당 10회)을 적용해 반복 인증 실패를 제한한다.
- `/api/admin/crawl`과 `/api/admin/accessories/crawl`은 각각 독립된 IP rate-limit(분당 10회)을 적용해 외부 원문 수집 trigger 반복을 제한한다. 기존 category validation과 running-lock은 그대로 유지한다.
- `/api/admin/crawl/retry-page`는 IP 분당 10회, `/api/admin/crawl/retry-failed-pages`는 IP 분당 5회의 독립 bucket으로 실패 페이지 외부 재수집 trigger 반복을 제한한다. cancel endpoint는 시작 trigger가 아니므로 이 limiter 대상이 아니다.
- `/api/admin/build-versions/migrate`와 `/api/admin/build-versions/rollback`은 각각 IP 분당 5회 limiter를 사용한다. fingerprint·confirmation·file/DB lease에 더해 반복적인 destructive mutation 시도를 제한한다.
- 관리자 core/accessory crawler 입력은 서버에서 pages·batch·delay 상한을 다시 검증한다. core `all:true`의 legacy `limitPerCategory: 0` sentinel만 예외적으로 허용하며, 모든 실제 범위는 bounded integer로 정규화한다.
- GPU 물리·benchmark 개별 source-check는 partId별 in-flight job map으로 중복 외부 호출을 409로 막고, 완료 후 15초 cooldown을 `Retry-After` 429로 적용한다.
- catalog-spec·GPU 물리·benchmark 개별 source-check는 각각 IP 분당 30회 bucket도 적용해 partId 순회로 cooldown을 우회하는 반복 외부 조회를 제한한다.
- GPU 물리·benchmark source-check batch는 각각 독립된 IP rate-limit(분당 5회)을 적용하며, batch 크기·동시성·persist 계약은 기존과 같다.
- `server/index.ts`의 `isApiPath()`는 `/api` 루트와 `/api/` 하위 경로를 같은 API 경계로 판정해 SPA fallback이 API 루트를 삼키지 않게 한다.
- `GET /api/builds?ids=...`는 `buildListRateLimit`(분당 120회)을 사용해 detail/mutation의 `buildShareRateLimit`과 budget을 분리하며, `limit`은 유한한 정수로 정규화하고 잘못된 비유한 입력은 기본값 20으로 처리한다.
- `AssemblyVerificationPanel`의 서버 기록은 React StrictMode effect 재실행 뒤에도 mounted 상태를 복구한 뒤 성공 메시지·compact snapshot callback을 소비한다.
- 저장 견적을 이력에서 열어 `/result*`로 이동할 때는 owner/share 컨텍스트를 결과 화면까지 유지하고, 결과 밖으로 나갈 때만 지운다. 그래야 구매 진행률·조립 검증 owner mutation UI가 익명 read-only로 축소되지 않는다.
- 핵심·주변 부품 원문 재확인 endpoint는 `catalogRefreshRateLimit`(두 surface 공유, IP 기준 분당 30회)와 항목별 15초 cooldown을 함께 사용한다.
- `catalog-change-log.json`은 mtime-keyed snapshot + in-flight dedupe로 공개 가격 이력·watchlist alert·admin change-log read가 같은 파일을 동시 재파싱하지 않게 하며, append와 외부 파일 변경 시 snapshot을 갱신한다.
- 웹 build는 `dist/`, native `build:mobile`은 `dist-mobile/`을 사용하며 Capacitor `webDir`과 bundle verifier도 같은 output directory를 읽어 두 producer가 산출물을 덮어쓰지 않게 한다.
- Express `trust proxy`는 same-host Caddy의 loopback 주소(`127.0.0.1`, `::1`, IPv4-mapped loopback)만 신뢰해 rate-limit IP key를 외부 사용자별로 복원하고, 직접 접근자의 spoofed `X-Forwarded-For`는 신뢰하지 않는다.
- `shared/`: 서버·클라이언트가 공유하는 타입과 도메인 판정.
- `server/*.test.ts`, `shared/*.test.ts`, `src/*.test.ts`: Vitest 회귀 테스트.
- `scripts/`: build 검증과 브라우저 smoke/수집 보조 도구.
- 실제 Git root는 이 디렉터리이며, 이미 존재하는 dirty 변경은 사용자 작업으로 간주해 보존한다. 광범위한 reset/clean/stage/commit/push는 지시 없이는 하지 않는다.

## Tools

- `npm run typecheck`: TypeScript 정적 검증.
- `npm test`: 단일 worker 전체 Vitest 회귀 검증.
- `npm run build`: typecheck + Vite bundle + client bundle size gate.
- `npm run test:browser`: 실행 중인 API/웹을 대상으로 브라우저 smoke.
- `npm run test:browser`: 기본 wait 120초·CDP evaluate 30초로 긴 lazy DOM/route flow의 관찰 timeout을 고정하며 환경변수로 override 가능하다.
- `/result`에 검사 결과가 준비되면 `BuildChangeDecisionDialog` lazy chunk를 background preload해 첫 대체 후보 클릭이 chunk load 관찰 지연에 걸리지 않게 한다.
- `AdminView`의 `DeferredAdminPanel`은 lazy child를 유지하면서 운영 deep-link·focus·브라우저 검증이 같은 anchor를 사용하도록 주요 보강 패널에 안정적인 `anchorId`를 제공한다. 현재 고정 anchor는 `admin-catalog-change-log`, `admin-catalog-spec-review`, `admin-benchmark-review`, `admin-m2-mapping`, `admin-gpu-physical`, `admin-case-rgb-load`, `admin-cooling-fan-load`다.
- `npm run test:browser:picker-cache-storage`는 저장소 전용 picker sentinel 삭제를 검증하며, 같은 세션의 App `partMap`이 제공하는 탐색용 fallback 목록은 남을 수 있다는 계약을 분리한다.
- `npm run test:browser:purchase-list-context`는 지연된 현재가 조회 중 견적 `inputFingerprint`가 바뀌면 새 구매 목록 버튼이 다시 활성화되는지 검증한다.
- `npm run test:browser:clipboard-route-ownership`는 Accessory·Generator·Result candidate comparison·Purchase checklist의 지연 clipboard 결과가 route 이탈 뒤 toast를 쓰지 않는지 검증한다.
- cross-tab `storage` consumer는 `storageArea` 객체 identity를 비교하지 않고 key와 payload를 기준으로 동기화한다. 서로 다른 탭의 동등한 Storage 객체를 identity로 거부하지 않으며, Admin catalog watchlist·PriceWatch settings focused smoke가 `storageArea` 없는 이벤트도 검증한다.
- `npm run test:browser:persistence`: 격리 API/Vite/Chrome의 장시간 두 탭 persistence smoke이며, 기본 wait 120초·CDP evaluate 30초(환경변수로 override 가능)다.
- browser smoke의 Chrome은 detached process group으로 시작하고 assertion 실패·정상 종료 모두 process group과 direct child에 TERM→KILL cleanup을 수행해 helper/profile orphan을 남기지 않는다. 강제 1ms observation 실패에서도 owned Chrome/profile residue가 없어야 한다.
- GitHub Actions 성공 run은 commit된 remote SHA의 증거이며, 현재 dirty/uncommitted `.github/workflows/ci.yml` 변경과 로컬 browser/container 결과를 remote CI green으로 혼합해 주장하지 않는다.
- PC Supporter preview/API runtime은 작업 전 포트와 프로세스를 확인하고, Rescue Meal 등 다른 서비스는 중단하지 않는다.
- Android release 서명은 gitignored `android/key.properties` + `pc-supporter-upload.jks`(전용 업로드 키)로 wire되어 있고, `./gradlew bundleRelease`는 wrapper Gradle 8.14.3으로 성공한다(AGP 8.13.0 요구 충족).
- App Store Connect API 키는 `~/.config/kbo-fans/secrets/appstoreconnect/kbo-fans-testflight.env`의 `ASC_ISSUER_ID`/`ASC_KEY_ID`/`ASC_KEY_PATH`를 사용하며, IPA 업로드는 `xcrun altool --upload-app`으로 가능하다. 재업로드 전에는 `CURRENT_PROJECT_VERSION`을 올려야 한다.
- Lightsail 배포는 `aws lightsail get-instance-access-details --instance-name kbo-fans-api-lightsail --protocol ssh --region ap-northeast-2`로 임시 SSH 키/인증서를 받은 뒤 `./scripts/lightsail-deploy.sh --host ubuntu@3.39.79.1 --domain pc-supporter.3-39-79-1.sslip.io --ssh-key <key> --ssh-certificate <cert> --preserve-env`로 실행한다.
- TestFlight 배포 상태(2026-09-14): build `App 1.0 (4)` 업로드 완료(altool, Delivery UUID `5da36348-73af-42b7-99cd-13c1e609b211`) — PWA 아이콘·skip link·more-sheet 접근성 포함. build 2·3 모두 VALID + `usesNonExemptEncryption=false` 선언 완료. 외부 그룹 `Internal Testers`(id `a703b89d-...`)에 build 2·3 모두 배정되고 godekd3133@naver.com 테스터 등록 + 베타 리뷰 제출됨(build 2 기준 `WAITING_FOR_REVIEW`). build 3은 네이티브 셸 플러그인(haptics·keyboard·splash·status bar·back button)을 포함한다. 이 앱에는 API로 생성 불가한 internal beta group이 아직 없어서, App Store Connect 웹의 TestFlight 탭을 한 번 열면 자동 생성되며 그 후 리뷰 없이 즉시 배포 가능하다.
- 운영 웹 재배포(2026-09-14 17:08 UTC, release `20260913170811`): 최신 프로덕션 번들(`index-CsyMKqtU.js` + `index-WOYcVMZS.css`)을 Lightsail에 배포 완료. `--preserve-env` 사용, 원격 npm install + 서비스 재시작 + 내부/외부 health 모두 `{"ok":true,"engineVersion":"2.58.0"}` 확인. 이번 배포로 모바일 UX 개선(inputMode, iOS 자동줌 방지, safe-area, reduced-motion)이 라이브 반영됐다.
- iOS archive 시 `DEVELOPMENT_TEAM`이 pbxproj에 없으므로 `xcodebuild ... -allowProvisioningUpdates DEVELOPMENT_TEAM=A23ZPKGMW9 archive`처럼 CLI로 팀 ID를 넘겨야 한다.
- ASC API JWT는 ES256 raw 서명이 필요 — Node `createSign`은 기본 DER이므로 `sign({key,dsaEncoding:'ieee-p1363'})` 필수(누락 시 401).
- Lightsail 임시 SSH 크레덴셜 주의: `get-instance-access-details`의 `certKey`는 OpenSSH 사용자 인증서로 반드시 반환된 `privateKey`와 쌍으로 써야 한다. 인증서 파일은 `<key파일>-cert.pub` 명명 규칙 또는 `-o CertificateFile=`로 지정하고 끝에 newline을 포함해야 한다(누락 시 `Load key invalid format`). 유효기간이 ~13분으로 짧으므로 배포 직전에 새로 발급한다.
- CI browser-smoke job은 job-level `NODE_ENV=test`를 쓰므로 `Build production preview` 스텝에만 `NODE_ENV=production`을 지정한다(누락 시 비압축 ~948kB entry로 번들 예산 실패). `seed-only-smoke.mjs`는 `npm run start` 서버를 detached process group으로 띄워 그룹 킬한다(직접 자식만 죽이면 손자 프로세스가 stdio 파이프를 잡고 step이 hang).
- TestFlight build 5 업로드 완료(2026-09-15 12:26 KST, Delivery UUID `503e1ee5-c303-4755-ac74-aae6e74dcbfc`): `api()`에 per-attempt 타임아웃(기본 20s, 재시도 대상) 추가 — 실기기에서 요청이 멈추면 무한 스피너가 되던 문제를 명시적 에러로 전환. 더보기 시트에 "서버 연결 확인" 셀프 진단 추가(health + /api/parts GET 결과·소요시간 표시). 카탈로그/피커 빈 결과에 검색어 에코 추가. build 4에서 보고된 "앱 내 부품 검색 결과가 안 뜨는" 문제는 시뮬레이터에서 동일 번들 end-to-end 정상 확인됨(fetch GET/POST·렌더링 모두 통과) — build 5가 실기기에서 보여주는 에러 문구가 원인 확정 근거가 된다.
- 실기기 검증(2026-09-15 16:2x KST): Minkyu's iPhone(iPhone 15 Pro Max, iOS 27.0, Developer Mode ON)에 `DEVELOPMENT_TEAM=A23ZPKGMW9` Debug 빌드를 devicectl로 설치·실행 — 잠금 상태에서는 launch가 "Locked"로 거부되므로 unlock 감시 루프 필요. 진단 오버레이 결과 `health 200`, `parts GET 200 total=10`, `compat POST 200 total=14`, 카탈로그 탭→"라이젠" 검색→`afterSearch items=10` 정상 렌더(devicectl `device capture screenshot`으로 화면 확보 가능 — 원격 스크린샷 지원됨). 즉 실기기에서도 네트워크·검색·렌더 전부 정상 → 이전 "검색 안 됨"은 요청 정지+무한로딩(구버전 타임아웃 부재) 또는 일시 네트워크 상태로 추정. build 5는 Internal 그룹에 자동 포함 확인(`Internal` builds=[5,4,3,2]). ios_webkit_debug_proxy는 CoreDevice(네트워크 페어링) 디바이스를 인식 못함 — 실기기 JS 콘솔 대신 진단 오버레이+스크린샷이 현실적 대안.
- Toss 리디자인 확정·커밋(2026-09-15, `7a85da9`): 라이트 블루+뉴트럴 팔레트(primary #3182f6, ink #191f28, canvas #f9fafb), 다크 패널 2곳 라이트 카드화, 민트 잔재 정리, 사용자 문구 해요체·평이한 용어로 정리, theme/splash/Capacitor 배경색 갱신. 같은 커밋에서 관리자 `데이터 센터` 메뉴를 데스크톱 nav와 모바일 더보기 시트에서 제거(제품 정책 결정) — `/admin` 직접 URL 접근과 `importSavedWatchlist`의 /admin 이동은 유지되며 `AppHeader`의 `onAdmin` prop은 삭제됨. typecheck·1260 tests·build(엔트리 540.5KB/545KB)·실행 중 dev 서버 브라우저 검증(nav·더보기 시트에 데이터 센터 없음, /admin 정상 로드) 완료.
- TestFlight build 6 업로드 완료(2026-09-15 17:23 KST, Delivery UUID `fd1588c2-9da8-4636-8f94-4fde1f4958a0`): `APPLE_TEAM_ID=A23ZPKGMW9 VITE_API_BASE_URL=https://pc-supporter.3-39-79-1.sslip.io node scripts/build-ios-archive.mjs`로 dist-mobile 재빌드+archive+IPA export 후 `xcrun altool --upload-app`. ASC API 확인 결과 즉시 `VALID`, Internal 그룹 `builds=[6,5,4,3,2]` 자동 포함 — 내부 테스터는 리뷰 없이 설치 가능. 외부 그룹 `Internal Testers`는 builds=[4,3,2]로 build 5·6 모두 미배정(수동 정책).
- 웹 프로덕션 배포 보류(2026-09-15): Toss+메뉴 숨김이 포함된 `dist/`는 빌드 완료(`index-DzZOZKyi.js`)지만 `aws login` 세션 만료로 Lightsail 임시 SSH 크레덴셜 발급이 불가 — 사용자 재인증 후 `lightsail-deploy.sh --preserve-env`로 배포 필요.
- 병행 작업 주의: 별도 프로세스가 동시에 `server/engine.ts`·`shared/catalog-spec-coverage.ts`·`src/App.tsx`·`scripts/browser-smoke.mjs`를 수정 중(missing-field 한글 라벨 매핑 + smoke 조건화). 17:23 이후 등장한 미커밋 변경으로 build 6 IPA(17:21 생성)에는 미포함 — 해당 작업의 커밋·배포는 그 프로세스의 몫.
