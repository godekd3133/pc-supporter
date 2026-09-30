# PC Supporter 로컬 시연 실행 안내

이 안내는 현재 저장소의 프로덕션 번들을 **내 컴퓨터에서만** 시연하는 절차입니다. 서버는 `127.0.0.1`에만 엽니다. 2–3단계의 격리 시연은 쓰기 작업을 임시 데이터 폴더에 저장합니다. `preview:local-bundle`을 바로 실행하면 `dist-local/data/`를 사용하므로, 반복 QA에는 2–3단계의 임시 사본을 사용합니다. 배포, 결제, 실제 주문은 포함하지 않습니다.

현재 checkout의 로컬 snapshot은 코어 5,648개(필수 사양 확인 4,115개·부분 확인 1,533개), 주변 부품 4,181개입니다. 주변 부품 품질은 `live` 4,018개·`incomplete` 121개·seed 42개, 정규화 사양 프로파일은 완전 3,003개·부분 301개·미평가 877개입니다. 가격 값은 4,172개, `priceCheckedAt`은 3,903개에 있으며 상세 보강은 429개 성공·실패 0건입니다. Danawa 상품 이미지 URL 4,139개를 확인했고, 이미지가 없는 42개는 fallback icon을 사용합니다. 팬 PCode 31078118은 CUA 화면에서 34,200원, 120mm·25mm·3개 구성으로 확인했습니다. 표기 가격은 참고값이며 구매 시점 금액을 보장하지 않습니다.

Danawa 기본 주변 부품 목록은 3,463/3,647개입니다. 정렬 보완을 포함한 고유 코드 증거는 3,911개로 선언 수보다 264개 많고, 쿨링팬은 2,427/2,163개입니다. 불일치 이유는 확인되지 않아 source list는 `partial`로 유지합니다. 아래 수치는 checkout 원본 기준입니다. 최근 변경을 포함한 `dist/` 및 실행 중 preview는 fresh build·재시작·`/api/meta` 확인 전까지 같은 데이터라고 간주하지 마세요.

## 1. 로컬 시연 번들 만들기

저장소 루트에서 실행합니다.

```sh
npm run build:local-bundle
```

기본 `npm run build`는 원격·파일 모드 웹 번들만 생성합니다. 명시적 `build:local-bundle`은 공개 API와 같은 projection을 적용한 코어·주변 부품 JSON과 manifest를 `dist/catalog-data/`에 저장하고, 서버가 사용하는 원본 catalog/accessory snapshot, override, 수집 목록 manifest를 정적 웹 경로 밖인 `dist-local/data/` sidecar에 저장합니다. 공개 projection은 정적 파일로 제공될 수 있으므로 현재 공개 API에서 허용하는 고객용 필드만 포함하고, 원본 sidecar는 Git ignore 대상입니다. 로컬 JSON이 없는 깨끗한 checkout에서는 로컬 카탈로그 패키징이 생략됩니다.

패키징된 로컬 sidecar를 직접 시연하려면 `npm run preview:local-bundle`을 실행합니다. 이 명령은 `dist-local/data/`를 API의 `PC_SUPPORTER_DATA_DIR`로 사용하고 PostgreSQL·자동 수집·자동 갱신을 끈 뒤 웹과 API를 loopback에서 함께 시작합니다. 반복 QA에서 sidecar에 상태 파일을 추가하지 않으려면 아래처럼 별도 임시 데이터 폴더를 사용합니다. manifest 상태가 `partial`이면 빌드 화면의 데이터가 아직 불완전하다는 뜻입니다.

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

브라우저에서 `http://127.0.0.1:5201/`을 엽니다. 관리자 데이터 검수 화면은 `/admin`이며, 위에서 입력한 데모 전용 비밀번호로 로그인합니다. 시작 전에 `lsof -nP -iTCP:5201 -sTCP:LISTEN`과 `lsof -nP -iTCP:4213 -sTCP:LISTEN` 결과가 비어 있는지 확인하고, 사용 중이면 비어 있는 포트 쌍으로 바꾸세요. `preview:full`은 Vite strict-port를 사용하므로 점유 포트에서 다른 서버로 자동 이동하지 않고 실패합니다. PC Supporter는 브라우저에 저장된 견적·캐시를 사용하므로, 예전에 사용한 주소에서 상태 오류가 보이면 기존 브라우저 데이터를 지우지 말고 새 포트로 다시 여세요.

## 4. 추천 시연 순서

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

브라우저 검증은 관리자·저장·공유 데이터를 쓸 수 있으므로 시연용 서버에 직접 실행하지 마세요. `58100/58101`과 `58150/58151`은 이전 데모 증거이고, `58174/58175`는 갱신 카탈로그를 읽지만 엔진이 이전 상태인 preview입니다. 최종 fresh build/restart 후 검증한 데모 포트는 이 안내에 별도로 갱신할 예정입니다. 별도 QA preview 예시는 `58104/58105`입니다. 새 터미널에서 2–3단계를 반복하되 새 임시 폴더를 만들고 테스트 포트를 지정합니다. 실행 전 두 QA 포트가 비어 있는지 `lsof -nP -iTCP:58104 -sTCP:LISTEN` 및 `lsof -nP -iTCP:58105 -sTCP:LISTEN`으로 확인합니다. 점유된 포트에는 접속하지 말고 다른 빈 쌍을 고르세요. `preview:full`은 strict port 모드로 시작합니다.

테스트 preview를 띄운 첫 번째 터미널에서 아래 설정을 적용하고 실행합니다.

```sh
export PREVIEW_PORT=58104
export PREVIEW_API_PORT=58105
export PREVIEW_HOST=127.0.0.1
export PREVIEW_API_HOST=127.0.0.1
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

테스트는 격리된 브라우저 프로필을 사용하고, 서버 기록은 테스트 preview의 데이터 폴더에만 씁니다. 검수 후 그 임시 데이터 사본을 폐기해도 최종 시연 서버의 저장 상태에는 영향이 없습니다.

## 시연 데이터 사용 시 주의

- 표기 가격은 카탈로그에서 관찰한 참고값입니다. 판매처 재고, 배송비, 옵션, 결제 가격은 해당 상품 페이지에서 다시 확인해야 합니다.
- 가격 추적 화면의 새로고침·자동 확인은 시연 카탈로그의 저장 가격을 다시 읽습니다. 외부 판매처 페이지를 즉시 요청하지 않으며 새 가격 관측 이력도 만들지 않습니다.
- `가격·사양 새로 불러오기` 또는 관리자 크롤 작업은 외부 판매처 페이지를 요청합니다. 이 안내의 기본 설정은 자동 갱신과 시작 시 크롤을 끄므로, 데이터 갱신 시연이 필요할 때만 관리자에서 수동으로 실행하세요.
- 데이터는 PostgreSQL이 아닌 시연 전용 파일 폴더에 저장됩니다. 영속 운영, 다중 사용자 공유, 백업·복구는 검증 범위에 포함되지 않습니다.
- 서버를 멈출 때는 실행 중인 터미널에서 `Ctrl+C`를 누릅니다. 임시 폴더를 새로 만들면 시연 중 저장한 결과도 이어지지 않습니다.
