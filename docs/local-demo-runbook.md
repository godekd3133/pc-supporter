# PC Supporter 로컬 시연 실행 안내

이 안내는 현재 저장소의 프로덕션 번들을 **내 컴퓨터에서만** 시연하는 절차입니다. 서버는 `127.0.0.1`에만 엽니다. 애플리케이션 저장소는 PostgreSQL 전용이므로 시연도 별도 PostgreSQL을 준비한 뒤 private snapshot을 import합니다. 배포, 결제, 실제 주문은 포함하지 않습니다.

현재 checkout의 로컬 snapshot은 코어 5,648개(필수 사양 확인 4,115개·부분 확인 1,533개), 주변 부품 4,181개입니다. 주변 부품 품질은 `live` 4,018개·`incomplete` 121개·seed 42개, 정규화 사양 프로파일은 완전 3,003개·부분 301개·미평가 877개입니다. 가격 값은 4,172개, `priceCheckedAt`은 3,903개에 있으며 상세 보강은 429개 성공·실패 0건입니다. Danawa 상품 이미지 URL 4,139개를 확인했고, 이미지가 없는 42개는 fallback icon을 사용합니다. 팬 PCode 31078118은 CUA 화면에서 34,200원, 120mm·25mm·3개 구성으로 확인했습니다. 표기 가격은 참고값이며 구매 시점 금액을 보장하지 않습니다.

Danawa 기본 주변 부품 목록은 3,463/3,647개입니다. 정렬 보완을 포함한 고유 코드 증거는 3,911개로 선언 수보다 264개 많고, 쿨링팬은 2,427/2,163개입니다. 불일치 이유는 확인되지 않아 source list는 `partial`로 유지합니다. 아래 수치는 checkout 원본 기준입니다. 최근 변경을 포함한 `dist/` 및 실행 중 preview는 fresh build·재시작·`/api/meta` 확인 전까지 같은 데이터라고 간주하지 마세요.

## 1. 시연용 PostgreSQL과 데이터 준비

로컬 개발 PostgreSQL이 없다면 compose의 postgres만 띄우거나, 이미 있는 로컬 PostgreSQL의 별도 데이터베이스를 사용합니다.

```sh
export POSTGRES_OWNER_PASSWORD='demo-owner-password'
export POSTGRES_RUNTIME_PASSWORD='demo-runtime-password'
docker compose up -d postgres migrate runtime-role-bootstrap
export DATABASE_URL='postgresql://pcsupporter_runtime:demo-runtime-password@127.0.0.1:5432/pcsupporter'
```

이 `DATABASE_URL`은 시연 전용이어야 합니다. 운영 주소를 재사용하지 마세요. 스키마는 compose의 `migrate` 서비스가 `db:migrate`로 적용하고, 이후 스키마가 바뀌면 같은 서비스를 다시 실행합니다.

원본 `data/`의 private 카탈로그 snapshot은 import 명령으로 시연 PostgreSQL에 넣습니다. 파일 복사가 아니라 검증된 저장소 쓰기입니다.

```sh
npm run import:private-catalog -- --source-dir data --dry-run
npm run import:private-catalog -- --source-dir data --apply --replace-danawa --include-accessories --replace-accessories --include-cooling-fan-overrides
```

`--replace-*` 플래그는 전체 snapshot이 있을 때만 허용되며, 부분 snapshot은 해당 플래그 없이 병합합니다. 나머지 운영 아티팩트(manifest·검수 이력 등)는 `PC_SUPPORTER_DATA_DIR` 아래 파일이므로 필요한 경우 별도 디렉터리에 복사해 둡니다.

## 2. 로컬 서버 실행

데모 전용 관리자 비밀번호를 입력하고, 서버 세션 키는 새로 생성합니다. 실제 계정의 비밀번호를 재사용하지 마세요. production 모드는 32자 이상의 rate-limit 비밀값도 요구합니다.

```sh
export NODE_ENV=production
read -s "ADMIN_PASSWORD?데모용 관리자 비밀번호: "
printf '\n'
export ADMIN_PASSWORD
export ADMIN_SESSION_SECRET="$(openssl rand -hex 32)"
export RATE_LIMIT_HMAC_SECRET="$(openssl rand -hex 32)"
export PRICE_REFRESH_SCHEDULER_ENABLED=false
export BUILD_MONITOR_SCHEDULER_ENABLED=false
export DANAWA_CRAWL_SCHEDULER_ENABLED=false
export DANAWA_CRAWL_ON_START=false
export PREVIEW_PORT=5201
export PREVIEW_API_PORT=4213
export PREVIEW_HOST=127.0.0.1
export PREVIEW_API_HOST=127.0.0.1
export PC_SUPPORTER_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pc-supporter-demo.XXXXXX")"
npm run preview:full
```

브라우저에서 `http://127.0.0.1:5201/`을 엽니다. 관리자 데이터 검수 화면은 `/admin`이며, 위에서 입력한 데모 전용 비밀번호로 로그인합니다. 시작 전에 `lsof -nP -iTCP:5201 -sTCP:LISTEN`과 `lsof -nP -iTCP:4213 -sTCP:LISTEN` 결과가 비어 있는지 확인하고, 사용 중이면 비어 있는 포트 쌍으로 바꾸세요. `preview:full`은 Vite strict-port를 사용하므로 점유 포트에서 다른 서버로 자동 이동하지 않고 실패합니다. PC Supporter는 브라우저에 저장된 견적·캐시를 사용하므로, 예전에 사용한 주소에서 상태 오류가 보이면 기존 브라우저 데이터를 지우지 말고 새 포트로 다시 여세요.

## 3. 추천 시연 순서

1. 홈에서 **새 견적 시작하기**를 누르고 용도, 목표, 예산을 고른 뒤 예상 구성을 확인합니다.
2. 생성된 견적에서 부품 호환·구매 준비·조립 확인 패널을 살펴봅니다.
3. **부품 카탈로그**에서 범주, 검색, 상세 사양, 확인 시각과 가격 참고 안내를 확인합니다.
4. **주변 부품**에서 액세서리 범주와 제품 정보를 살펴봅니다.
5. **가격 추적**, **저장 견적**, **내 견적**에서 목록과 비교·저장 동작을 보여줍니다.
6. `/admin`에서 카탈로그 품질과 데이터 검수 패널을 확인합니다.

가격 추적은 `JBCNC JB-80M 3+4P (화이트)`를 검색해 상품 카드의 **가격 추적**을 누르면 짧게 보여줄 수 있습니다. 목표가는 설정하지 않은 샘플이며, 가격 이력의 빈 상태는 기록된 변동이 없다는 뜻입니다. 목록의 현재가 확인은 저장된 카탈로그 값을 읽습니다.

일반형의 목표 전달을 보여줄 때는 새 견적 온보딩에서 예산 200만원을 선택합니다. 이 경로는 예산을 최대 금액으로 두고 `high` 성능 목표(12GB VRAM 이상 GPU, CPU 성능 조건)를 자동 구성 요청까지 전달합니다. 현재 검수 결과는 Ryzen 5 3600과 RTX 2060 12GB, 합계 892,480원이며 1,107,520원이 남습니다. 예산을 모두 사용해야 한다는 뜻은 아니며, 호환 정보 부족은 결과에서 별도 확인합니다.

빠르게 게이밍 결과를 보여줄 때는 자동 구성 화면의 **QHD 게이밍 · 220만원** preset을 불러온 뒤 **자동 견적 생성**을 누릅니다. 이전 엔진의 2,171,160원 결과는 현재 엔진을 다시 띄우기 전 증거이므로 최신 시연 결과로 인용하지 않습니다. 최종 fresh preview에서 나온 구성·finding을 확인한 뒤 함께 설명하고, 구매 준비 완료로 소개하지 마세요. 사용자가 선택한 목표는 실제 FPS 보장이 아닙니다.

## 기능 재검증

브라우저 검증은 관리자·저장·공유 데이터를 쓸 수 있으므로 시연용 서버에 직접 실행하지 마세요. 새 임시 PostgreSQL 데이터베이스와 import 절차를 다시 준비한 뒤 테스트 포트를 지정합니다. 실행 전 두 QA 포트가 비어 있는지 `lsof -nP -iTCP:58104 -sTCP:LISTEN` 및 `lsof -nP -iTCP:58105 -sTCP:LISTEN`으로 확인합니다. 점유된 포트에는 접속하지 말고 다른 빈 쌍을 고르세요. `preview:full`은 strict port 모드로 시작합니다.

테스트 preview를 띄울 첫 번째 터미널에서 위 1단계의 전용 데이터베이스 준비를 다시 수행하고 아래 설정을 적용합니다.

```sh
export PREVIEW_PORT=58104
export PREVIEW_API_PORT=58105
export PREVIEW_HOST=127.0.0.1
export PREVIEW_API_HOST=127.0.0.1
export PC_SUPPORTER_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pc-supporter-qa.XXXXXX")"
npm run preview:full
```

아래 검수 명령은 두 번째 터미널에서 실행합니다. 관리자 비밀번호에는 테스트 preview를 띄울 때 설정한 값을 입력합니다.

```sh
read -s "BROWSER_SMOKE_ADMIN_PASSWORD?데모용 관리자 비밀번호: "
printf '\n'
export BROWSER_SMOKE_ADMIN_PASSWORD
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:58104 npm run test:browser
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:58104 npm run test:browser:compatible-demo
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:58104 npm run test:browser:generator-selection-reasons
BUDGET_LADDER_SUMMARY_SMOKE_BASE_URL=http://127.0.0.1:58104 npm run test:browser:budget-ladder-summary
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:58104 \
  QUOTE_ONBOARDING_SMOKE_TIMEOUT_MS=30000 npm run test:browser:quote-onboarding
```

테스트는 격리된 브라우저 프로필을 사용하고, 저장 상태는 테스트 preview가 가리키는 PostgreSQL에만 씁니다. 검수 후 그 데이터베이스를 버려도 최종 시연 저장 상태에는 영향이 없습니다.

## 시연 데이터 사용 시 주의

- 표기 가격은 카탈로그에서 관찰한 참고값입니다. 판매처 재고, 배송비, 옵션, 결제 가격은 해당 상품 페이지에서 다시 확인해야 합니다.
- 가격 추적 화면의 새로고침·자동 확인은 시연 카탈로그의 저장 가격을 다시 읽습니다. 외부 판매처 페이지를 즉시 요청하지 않으며 새 가격 관측 이력도 만들지 않습니다.
- `가격·사양 새로 불러오기` 또는 관리자 크롤 작업은 외부 판매처 페이지를 요청합니다. 이 안내의 기본 설정은 자동 갱신과 시작 시 크롤을 끄므로, 데이터 갱신 시연이 필요할 때만 관리자에서 수동으로 실행하세요.
- 데이터는 운영 PostgreSQL이 아닌 시연 전용 PostgreSQL에 저장됩니다. 영속 운영, 다중 사용자 공유, 백업·복구는 검증 범위에 포함되지 않습니다.
- 서버를 멈출 때는 실행 중인 터미널에서 `Ctrl+C`를 누릅니다. 시연용 데이터베이스를 버리면 시연 중 저장한 결과도 이어지지 않습니다.
