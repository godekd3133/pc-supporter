# 가격 자동 갱신

`PC_SUPPORTER_PROCESS_ROLE`은 `combined`(기본값), `api`, `worker` 중 하나입니다. `npm run start`는 기존 단일 프로세스 동작을 유지합니다. API role은 HTTP만 제공하고 애플리케이션 scheduler나 queue polling을 시작하지 않습니다. Worker role은 public HTTP listener를 열지 않고 예약 작업과 background work를 실행합니다. API/worker split role은 `DATABASE_URL`이 필수이며 설정이 빠지면 시작하지 않습니다. 파일 기반 상태와 여러 writer의 안전한 공유 트랜잭션은 제공되지 않으므로 파일 모드에서는 `combined` 단일 프로세스를 사용합니다. PostgreSQL worker는 `price-refresh` job만 claim합니다. `npm run worker`는 worker role 진입점입니다.

PostgreSQL mode에서는 manual refresh와 예약 refresh가 `background_jobs`에 저장됩니다. API는 `POST /api/admin/prices/refresh`에서 `202`와 `jobId`, status URL을 반환하고, worker가 lease를 얻은 뒤 기존 `runPriceRefreshJob` handler를 `catalog-ingestion` advisory lease 안에서 실행합니다. `GET /api/admin/prices/refresh/status?jobId=<uuid>`는 상태, 시도 횟수, 제한된 진행률, 요약 결과, 구조화된 오류 코드만 반환합니다. Queue payload, idempotency key, lease owner/token, source HTML/URL은 반환하지 않습니다. job result에는 `attempted`, `succeeded`, `changed`, `failed`, `dryRun`, 실행 시각 또는 안전한 `STALE_SCHEDULE_SLOT` skip code만 보관합니다.

요청은 API와 worker가 같은 `DATABASE_URL`을 사용해야 합니다. `background_jobs` claim은 `FOR UPDATE SKIP LOCKED`와 kind filter를 사용합니다. 60초 lease는 20초마다 heartbeat하며 heartbeat/진행/완료/실패 쓰기는 현재 owner와 token, lease 만료 여부를 다시 검사합니다. Heartbeat나 fenced write가 실패하면 worker는 더 이상 해당 작업을 변경하지 않고, 만료된 lease는 다음 claim 시 재시도 또는 시도 한도 초과 실패로 회수됩니다. 실패는 payload나 예외 본문 없이 구조화 코드로 저장하고 5초부터 시작하는 지수 backoff(최대 10분)를 적용합니다. 완료·실패 기록은 90일 보관하고 worker가 한 번에 최대 250건을 정리합니다.

예약 key는 interval identity와 UTC epoch slot으로 계산합니다. 여러 worker가 같은 slot을 예약해도 `UNIQUE(kind, idempotency_key)`가 한 job으로 합칩니다. Worker 재시작 뒤에는 가장 최근 slot을 enqueue해 놓친 모든 interval을 새로 등록하지 않고, queue backlog에 남은 오래된 예약도 upstream 요청 전에 `STALE_SCHEDULE_SLOT` 결과로 건너뜁니다. Manual 요청에는 stale-slot skip을 적용하지 않습니다. `Idempotency-Key`는 선택 사항이며 1–128자의 제한된 ASCII 값만 허용합니다. 저장할 때는 SHA-256 hash를 씁니다. 같은 key와 같은 options는 기존 job을 돌려주고, 같은 key를 다른 options에 재사용하면 `409 IDEMPOTENCY_KEY_REUSED`입니다. Header 없는 manual 요청은 advisory transaction lock 아래에서 active job을 확인해 options가 같으면 기존 job ID를 반환하고, 다르면 `409 PRICE_REFRESH_ALREADY_ACTIVE`와 안전한 현재 상태를 반환합니다. 완료 뒤 새 Header 없는 요청은 새 작업을 만들 수 있습니다.

`price_refresh_attempts`는 PostgreSQL mode에서 부품/주변 부품별 마지막 시도 시각을 공유합니다. JSON `price-refresh-attempts.json`과 `price-refresh-state.json`은 file mode 전용이며, durable PostgreSQL run은 per-instance status JSON으로 낮추지 않습니다. Core/accessory crawl·retry, 수동 catalog refresh/import는 여전히 기존 route와 `catalog-ingestion` advisory lease를 씁니다. Saved-build monitor와 legacy crawl도 아직 background queue에 들어가지 않았으며 status/checkpoint/manifest는 기존 저장 경로를 유지합니다.

Compose는 API (`app`)와 worker를 분리하고 모두 같은 Postgres 및 `pc-supporter-data` volume에 연결합니다. 가격 갱신 스케줄은 기본 비활성입니다. PostgreSQL password, `RATE_LIMIT_HMAC_SECRET`, 관리자 비밀값은 Compose 실행 전에 제공해야 하며, 공개 기본 비밀번호가 없습니다. PostgreSQL host port는 loopback에만 바인딩됩니다. CI 전용 `container-smoke` profile은 별도 API replica를 추가해 두 API context의 queue status 조회를 확인합니다. Worker healthcheck는 공유 data directory 안의 마지막 성공 DB poll/heartbeat 시각이 45초보다 오래되면 unhealthy로 표시합니다. Lightsail 배포 스크립트는 PostgreSQL이 구성된 경우 `pc-supporter-api`와 `pc-supporter-worker` systemd unit을 분리하고, JSON 파일 모드일 때는 API와 파일 writer를 하나의 `combined` process로 유지합니다. Caddy는 4174 API만 바라봅니다. CI recovery smoke는 실제 `startPriceRefreshQueueWorker` loop를 child process로 시작하고 synthetic handler에서 강제 종료한 뒤 expired lease reclaim과 stale-token fencing을 확인합니다. 이는 real price handler replay나 container restart를 증명하지 않습니다. 이 환경에서는 Docker/PostgreSQL을 실행하지 않았으므로 실제 multi-connection 실행은 CI에서 확인해야 합니다.

기본 작업 제한은 핵심 부품 100개, 주변 부품 500개, 요청 간 1,200ms 대기입니다. 현재 서비스 상한은 핵심 부품 100개, 주변 부품 1,000개입니다. 로컬 저장소의 4,097개 Danawa 주변 부품은 대략 9회 실행(약 27시간)에 걸쳐 오래 확인한 항목부터 순환합니다. 한 회차는 최대 600건으로 약 12분 이상 걸릴 수 있고 실제 원문 응답 지연에 따라 더 걸립니다. `PRICE_REFRESH_CORE_LIMIT`, `PRICE_REFRESH_ACCESSORY_LIMIT`, `PRICE_REFRESH_DELAY_MS`, `PRICE_REFRESH_INTERVAL_HOURS`로 조절합니다.

관리자 인증이 필요한 API:

- `GET /api/admin/prices/refresh/status`: file mode는 기존 파일 상태 contract를 반환합니다. PostgreSQL mode는 가장 최근 durable job을 반환하며, `?jobId=<uuid>`를 붙이면 해당 job을 조회합니다.
- `POST /api/admin/prices/refresh`: 기본값으로 즉시 실행을 예약합니다. `{ "dryRun": true }`도 mode에 따라 file 실행 또는 durable queue job으로 등록됩니다. `coreLimit`, `accessoryLimit`, `delayMs`는 관리자 요청에서 설정할 수 있으며, 0은 dry-run에서만 허용됩니다.

새 자동 가격 갱신과 기존 광범위 카탈로그 크롤러는 함께 예약하지 않습니다. 레거시 크롤러는 `DANAWA_CRAWL_SCHEDULER_ENABLED=true`일 때만 예약되며 가격 갱신 스케줄러가 켜져 있으면 건너뜁니다. 기존의 `DANAWA_CRAWL_ON_START`는 `true`로 명시한 경우에만 시작 실행을 허용합니다. 이 크롤러의 수동 관리자 API는 계속 별도 작업입니다.

`seed-catalog-starter`에 있는 기준/샘플 가격은 외부 쇼핑몰의 실시간 원문 가격으로 간주하면 안 됩니다. 자동 작업은 현재 카탈로그와 주변 부품 저장소에 존재하는 항목을 대상으로 가격 근거를 갱신합니다. 새 배포 뒤 상태 API의 `attempted`, `changed`, `failed`, `failures`와 각 항목의 가격·갱신 시각을 확인해야 합니다.

현재 공개 운영 API의 관측 데이터는 로컬 데이터와 다를 수 있습니다. 구현 또는 설정 파일 변경만으로 운영 데이터가 이미 갱신됐다고 볼 수 없습니다. 이 문서는 배포나 실제 운영 실행을 주장하지 않습니다.

## API 분리 실행

저장소에는 아직 별도 backend package나 별도 타입 패키지가 없습니다. API는 현재 저장소의 `server/` 코드와 `shared/` 계약을 함께 사용하며, `shared/`가 클라이언트와 API 사이의 공용 타입 소스입니다. `Dockerfile.api`는 이 두 디렉터리와 Node 의존성만 이미지에 넣고 프런트 소스 및 `dist/`를 포함하지 않습니다.

```sh
docker build -f Dockerfile.api -t pc-supporter-api .
docker run --rm -p 4174:4174 \
  -e ADMIN_PASSWORD='...' \
  -e ADMIN_SESSION_SECRET='...' \
  -e RATE_LIMIT_HMAC_SECRET='...' \
  -e DATABASE_URL='postgresql://...' \
  -v pc-supporter-data:/app/data \
  pc-supporter-api
```

`DATABASE_URL`을 설정하면 모든 API replica에 같은 `RATE_LIMIT_HMAC_SECRET`을 넣어야 합니다. key는 32자 이상이어야 하고 로그나 공개 응답에 넣지 않습니다. rate-limit bucket key는 route scope와 HMAC한 client IP로 계산되며, key를 바꾸면 기존 bucket과 분리되어 활성 한도가 초기화됩니다. 파일 저장 단일 인스턴스 실행에서는 이 key가 사용되지 않습니다. Compose는 rate-limit key, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`이 모두 지정되기 전에는 시작되지 않으며 public 환경용 비밀 기본값을 제공하지 않습니다. 로컬 Compose 개발도 `.env.example`을 복사한 `.env`에 사용할 임시 비밀값을 직접 정하고, 해당 파일을 공유하거나 commit하지 마세요.

API image는 기본 `api` role이므로 `NODE_ENV=production`이어도 자체 scheduler를 시작하지 않습니다. Background refresh에는 별도 worker process가 필요합니다. Docker Compose worker가 같은 DB와 `/app/data` 볼륨에서 이를 담당합니다. 이미지 빌드에는 로컬 `data/*.json`이 포함되지 않습니다. 새 빈 volume은 starter seed 데이터만 만들 수 있으므로 Danawa 원문이 연결된 갱신 대상이 0개일 수 있습니다. 실제 갱신을 시작하기 전 private catalog snapshot import를 승인된 경로로 수행하고, status에서 `attempted`와 결과 요약을 확인하세요.

실제 분리는 컨테이너 실행 경계까지 마련된 상태이며, 독립 저장소/패키지, 배포 파이프라인, 운영 인스턴스 이전은 아직 별도 작업입니다.
