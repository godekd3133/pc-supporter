# PC Supporter 로컬 시연 실행 안내

이 안내는 현재 저장소의 프로덕션 번들을 **내 컴퓨터에서만** 시연하는 절차입니다. 서버는 `127.0.0.1`에만 열고, 쓰기 작업은 임시 데이터 폴더에 저장합니다. 배포, 결제, 실제 주문은 포함하지 않습니다.

현재 로컬 시연 데이터는 코어 5,648개(필수 사양 확인 4,060개), 주변 부품 3,874개(`live` 3,587, 미완료 245, seed 42)입니다. 주변 부품 정규화 사양 프로파일은 완전 2,700개, 부분 297개, 미평가 877개입니다. 가격은 관찰 당시 참고값이고 코어 5,629개, 주변 부품 3,866개에 숫자 값이 있습니다. 케이스와 GPU의 필수 사양은 각각 3.6%, 43.1%에서만 확인됐습니다. 시연 전에 `/api/meta`를 확인해 실행 중 데이터의 범위와 카탈로그 기준 시점을 다시 읽습니다.

## 1. 로컬 시연 번들 만들기

저장소 루트에서 실행합니다.

```sh
npm run build:local-bundle
```

기본 `npm run build`는 원격·파일 모드 웹 번들만 생성합니다. 명시적 `build:local-bundle`은 공개 API와 같은 projection을 적용한 코어·주변 부품 JSON과 manifest를 `dist/catalog-data/`에 저장하고, 서버가 사용하는 원본 catalog/accessory snapshot, override, 수집 목록 manifest를 정적 웹 경로 밖인 `dist-local/data/` sidecar에 저장합니다. 공개 projection은 정적 파일로 제공될 수 있으므로 현재 공개 API에서 허용하는 고객용 필드만 포함하고, 원본 sidecar는 Git ignore 대상입니다. 로컬 JSON이 없는 깨끗한 checkout에서는 로컬 카탈로그 패키징이 생략됩니다.

패키징된 로컬 sidecar를 바로 쓰려면 `npm run preview:local-bundle`을 실행합니다. 이 명령은 `dist-local/data/`를 API의 `PC_SUPPORTER_DATA_DIR`로 사용하고 PostgreSQL·자동 수집·자동 갱신을 끈 뒤 웹과 API를 loopback에서 함께 시작합니다. manifest 상태가 `partial`이면 빌드 화면의 데이터가 아직 불완전하다는 뜻입니다.

## 2. 시연 전용 데이터 폴더 만들기

원본 `data/`는 이 절차에서 수정하지 않습니다. 카탈로그와 시연에 필요한 근거 파일만 임시 폴더에 복사합니다. `data/*.json`은 Git ignore 대상인 로컬 데이터이므로, 이 안내는 현재 데이터가 있는 이 작업 폴더에서 실행합니다.

```sh
export PC_SUPPORTER_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pc-supporter-demo.XXXXXX")"
cp data/catalog.json data/accessories.json data/catalog-change-log.json \
  data/benchmark-overrides.json data/gaming-performance-evidence.json \
  data/gpu-physical-overrides.json data/case-rgb-load-overrides.json \
  data/cooling-fan-load-overrides.json data/m2-slot-overrides.json \
  data/catalog-spec-overrides.json data/catalog-spec-override-source-check-history.json \
  data/accessory-coverage.json data/accessory-crawl-manifest.json data/accessory-crawl-state.json \
  "$PC_SUPPORTER_DATA_DIR/"
for optional_data_file in data/physical-source-check-history.json data/benchmark-source-check-history.json \
  data/catalog-spec-refresh-history.json data/catalog-seed-mappings.json; do
  if [ -f "$optional_data_file" ]; then
    cp "$optional_data_file" "$PC_SUPPORTER_DATA_DIR/"
  fi
done
```

이 폴더는 시연 중 저장·비교·관심 가격 등 서버 파일이 생성될 위치입니다. 새 임시 폴더를 만들면 초기 카탈로그부터 다시 복사해야 합니다.

## 3. 로컬 서버 실행

데모 전용 관리자 비밀번호를 입력하고, 서버 세션 키는 새로 생성합니다. 실제 계정의 비밀번호를 재사용하지 마세요.

```sh
export NODE_ENV=production
export DATABASE_URL=''
read -s "ADMIN_PASSWORD?데모용 관리자 비밀번호: "
printf '\n'
export ADMIN_PASSWORD
export ADMIN_SESSION_SECRET="$(openssl rand -hex 32)"
export PRICE_REFRESH_SCHEDULER_ENABLED=false
export BUILD_MONITOR_SCHEDULER_ENABLED=false
export DANAWA_CRAWL_SCHEDULER_ENABLED=false
export DANAWA_CRAWL_ON_START=false
export PREVIEW_PORT=5201
export PREVIEW_API_PORT=4213
export PREVIEW_HOST=127.0.0.1
export PREVIEW_API_HOST=127.0.0.1
npm run preview:full
```

브라우저에서 `http://127.0.0.1:5201/`을 엽니다. 관리자 데이터 검수 화면은 `/admin`이며, 위에서 입력한 데모 전용 비밀번호로 로그인합니다. 포트가 사용 중이거나 같은 브라우저에서 예전 시연 데이터를 보존해야 한다면 `PREVIEW_PORT`, `PREVIEW_API_PORT`를 사용하지 않은 값으로 바꿉니다. PC Supporter는 브라우저에 저장된 견적·캐시를 사용하므로, 예전에 사용한 주소에서 상태 오류가 보이면 기존 브라우저 데이터를 지우지 말고 새 포트로 다시 여세요.

## 4. 추천 시연 순서

1. 홈에서 **새 견적 시작하기**를 누르고 용도, 목표, 예산을 고른 뒤 예상 구성을 확인합니다.
2. 생성된 견적에서 부품 호환·구매 준비·조립 확인 패널을 살펴봅니다.
3. **부품 카탈로그**에서 범주, 검색, 상세 사양, 확인 시각과 가격 참고 안내를 확인합니다.
4. **주변 부품**에서 액세서리 범주와 제품 정보를 살펴봅니다.
5. **가격 추적**, **저장 견적**, **내 견적**에서 목록과 비교·저장 동작을 보여줍니다.
6. `/admin`에서 카탈로그 품질과 데이터 검수 패널을 확인합니다.

빠르게 결과를 보여줄 때는 자동 구성 화면의 **QHD 게이밍 · 220만원** preset을 불러온 뒤 **자동 견적 생성**을 누릅니다. 최근 검수 결과는 2,171,160원이며, 호환 검사는 CPU 전력·메인보드 전원부 확인 1개를 표시했습니다. 결과 경고를 함께 설명하고 구매 준비 완료로 소개하지 마세요. 사용자가 선택한 목표는 실제 FPS 보장이 아닙니다.

## 기능 재검증

브라우저 검증은 관리자·저장·공유 데이터를 쓸 수 있으므로 최종 시연용 `5201/4213` 서버에 직접 실행하지 마세요. 새 터미널에서 2–3단계를 반복해 별도 임시 데이터 사본을 만들고, 테스트 preview 포트를 `5202/4214`로 지정한 뒤 실행합니다. 시연 서버와 테스트 서버는 모두 `127.0.0.1`에만 엽니다.

```sh
read -s "BROWSER_SMOKE_ADMIN_PASSWORD?데모용 관리자 비밀번호: "
printf '\n'
export BROWSER_SMOKE_ADMIN_PASSWORD
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:5202 npm run test:browser
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:5202 npm run test:browser:compatible-demo
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:5202 npm run test:browser:generator-selection-reasons
BUDGET_LADDER_SUMMARY_SMOKE_BASE_URL=http://127.0.0.1:5202 npm run test:browser:budget-ladder-summary
BROWSER_SMOKE_BASE_URL=http://127.0.0.1:5202 \
  QUOTE_ONBOARDING_SMOKE_TIMEOUT_MS=30000 npm run test:browser:quote-onboarding
```

테스트는 격리된 브라우저 프로필을 사용하고, 서버 기록은 테스트 preview의 데이터 폴더에만 씁니다. 검수 후 그 임시 데이터 사본을 폐기해도 최종 시연 서버의 저장 상태에는 영향이 없습니다.

## 시연 데이터 사용 시 주의

- 표기 가격은 카탈로그에서 관찰한 참고값입니다. 판매처 재고, 배송비, 옵션, 결제 가격은 해당 상품 페이지에서 다시 확인해야 합니다.
- `가격·사양 새로 불러오기` 또는 관리자 크롤 작업은 외부 판매처 페이지를 요청합니다. 이 안내의 기본 설정은 자동 갱신과 시작 시 크롤을 끄므로, 시연에서는 필요할 때만 수동으로 실행하세요.
- 데이터는 PostgreSQL이 아닌 시연 전용 파일 폴더에 저장됩니다. 영속 운영, 다중 사용자 공유, 백업·복구는 검증 범위에 포함되지 않습니다.
- 서버를 멈출 때는 실행 중인 터미널에서 `Ctrl+C`를 누릅니다. 임시 폴더를 새로 만들면 시연 중 저장한 결과도 이어지지 않습니다.
