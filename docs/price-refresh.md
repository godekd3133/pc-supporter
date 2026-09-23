# 가격 자동 갱신

API 프로세스가 `server/price-refresh.ts`의 원문 가격 갱신 작업을 실행합니다. 운영에서는 `PRICE_REFRESH_SCHEDULER_ENABLED`를 생략하면 켜지고, 프로세스 시작 5초 뒤 첫 작업을 시작한 다음 기본 3시간 간격으로 반복합니다. `false`로 끄거나 개발 환경에서 `true`로 켤 수 있습니다. 작업은 프로세스 내부 중복 실행을 막고 서비스의 파일 lock도 사용합니다.

기본 작업 제한은 핵심 부품 100개, 주변 부품 500개, 요청 간 1,200ms 대기입니다. 현재 서비스 상한은 핵심 부품 100개, 주변 부품 1,000개입니다. 로컬 저장소의 4,097개 Danawa 주변 부품은 대략 9회 실행(약 27시간)에 걸쳐 오래 확인한 항목부터 순환합니다. 한 회차는 최대 600건으로 약 12분 이상 걸릴 수 있고 실제 원문 응답 지연에 따라 더 걸립니다. `PRICE_REFRESH_CORE_LIMIT`, `PRICE_REFRESH_ACCESSORY_LIMIT`, `PRICE_REFRESH_DELAY_MS`, `PRICE_REFRESH_INTERVAL_HOURS`로 조절합니다.

관리자 인증이 필요한 API:

- `GET /api/admin/prices/refresh/status`: 마지막 실행 상태와 예약 사용 여부
- `POST /api/admin/prices/refresh`: 현재 설정으로 즉시 실행. `{ "dryRun": true }`는 서비스가 지원하는 미리보기 실행

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
  -v pc-supporter-data:/app/data \
  pc-supporter-api
```

API 이미지에서도 `NODE_ENV=production`이라 가격 스케줄러가 기본 활성화됩니다. 이미지 빌드에는 로컬 `data/*.json`이 포함되지 않습니다. 새 빈 `pc-supporter-data` 볼륨은 starter seed 데이터만 만들어지므로 Danawa 원문이 연결된 갱신 대상이 0개일 수 있습니다. 운영에서 가격을 갱신하려면 기존 비공개 데이터 볼륨을 `/app/data`에 연결하거나, 별도 절차로 기존 카탈로그와 주변 부품 데이터를 먼저 import해야 합니다. 시작 후 관리자 상태 API에서 `attempted`가 0인지 확인하고, 0이면 데이터 볼륨 연결/import를 먼저 점검하세요.

실제 분리는 컨테이너 실행 경계까지 마련된 상태이며, 독립 저장소/패키지, 배포 파이프라인, 운영 인스턴스 이전은 아직 별도 작업입니다.
