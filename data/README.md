# 공개 저장소의 데이터 경계

이 디렉터리의 JSON은 두 종류로 나뉩니다.

- 제품 카탈로그·액세서리 수집 결과: `catalog.json`, `accessories.json`
- 실행 중 생성되는 상태·이력: 크롤링 manifest/state, 저장 견적, 비교·관심 목록, 변경 로그, lease 파일 등

이 공개 저장소에는 위 JSON을 커밋하지 않습니다. 수집 결과에는 외부 사이트에서 가져온 상품·가격·이미지·원문 URL이 포함되고, 실행 상태에는 로컬 사용자의 저장 견적이나 관리자 작업 이력이 포함될 수 있기 때문입니다. `.gitignore`의 `data/*.json`·`data/*.lock`·`data/*.lease`·`data/*.tmp`가 이 경계를 강제합니다.

데이터가 없는 새 checkout도 `server/seed-catalog.ts`를 확장하는 `server/seed-catalog-starter.ts`와 `server/seed-accessories.ts`의 결정적 starter catalog로 시작할 수 있습니다. 서버가 처음 카탈로그를 읽을 때 seed를 `data/catalog.json`·`data/accessories.json`으로 materialize하므로, 공개 저장소의 테스트·개발 시작점은 외부 수집 결과에 의존하지 않습니다. 현재 starter core는 9개 핵심 부품 범주에 총 115개 기준 후보를 포함하고, 가격대·플랫폼·폼팩터별 선택 폭을 제공합니다. starter accessory는 10개 주변 부품 범주에 총 42개 기준 후보를 포함하지만 실판매가·재고를 의미하지 않으며, live 수집 결과가 들어오면 source product code·품질 기준으로 병합됩니다. 핵심 starter 115개는 live 또는 PostgreSQL 레코드가 이미 존재해도 유지되는 기준 후보이며, live 레코드가 생겼다는 이유로 확장 starter를 bootstrap 이후 제거하지 않습니다. 관리자 데이터 센터의 `starter 기준값 대조`는 이 기준 catalog와 현재 catalog를 `category:id`로 비교하는 읽기 전용 진단이며, 카탈로그 파일을 자동으로 병합·삭제·덮어쓰지 않습니다.

`starter 상품 코드 매핑 검수`는 ID가 다른 live 다나와 상품을 후보로 제안하지만, 런타임에 남아 있는 starter 기준 행은 실제 상품 코드 매핑 완료로 세지 않습니다. 고신뢰 점수도 자동 승인이나 카탈로그 병합을 뜻하지 않습니다. 관리자가 명시적으로 승인한 매핑만 `catalog-seed-mappings.json`에 별도 저장하며, 카탈로그 원본과 사용자 견적을 덮어쓰지 않습니다. 대상 상품이 삭제되거나 상품 코드가 바뀌면 매핑은 stale 상태로 재검수해야 합니다. 이 파일은 실행 중 생성되는 로컬 상태이므로 공개 저장소에 커밋하지 않습니다.

자동 후보가 없는 항목은 관리자 화면의 `수동 필요` 필터에서 다나와 상품 코드와 원문 URL을 입력할 수 있습니다. 입력값은 URL의 `pcode`·범주, 현재 catalog 수집 여부, starter와의 핵심 규격을 먼저 확인하고, HTTPS 원문 본문에서 상품 식별자가 확인된 경우에만 별도 매핑 레지스트리에 기록됩니다. 수집 전 상품은 자동으로 새 catalog 항목을 만들지 않습니다.
수집 큐의 `범주 빠른 수집`은 관리자 확인 뒤 `/api/admin/crawl`에 유효한 핵심 부품 `category`를 전달하는 샘플 실행입니다. 실행 결과는 기존 `catalog.json` 저장소·crawler manifest·change log 경계를 따르며, 큐나 매핑 화면이 수집 상품을 임의로 생성하지 않습니다. 관리자 화면에서 시작한 수집은 완료 이벤트 후 큐와 매핑 후보를 자동으로 다시 계산하고, 외부 CLI 실행 뒤에는 관리자가 큐를 다시 계산해 새 live 후보를 확인할 수 있습니다.

`원문 수집 작업 큐`는 이런 누락 항목의 범주 수집 필요·검색 후 수집·기존 매핑 재확인 상태와 범주별 작업량을 읽기 전용으로 계산합니다. 각 항목의 범주 빠른 수집은 관리자 확인 뒤 기존 핵심 부품 crawler를 최대 16개 상품의 샘플 범위로 실행하며, 결과는 기존 catalog·manifest·change log 경계에 저장됩니다. CSV·JSON 패키지는 운영자가 수집 순서를 공유하기 위한 산출물이며 제품·가격·사용자 견적을 포함하거나 변경하지 않습니다. 관리자 화면에서 시작한 수집은 완료 후 큐 fingerprint와 최신 catalog·매핑 후보를 자동으로 다시 계산하며, 외부 실행은 `다시 계산`으로 갱신해야 합니다.

## 로컬 실행

```bash
cp .env.example .env
DANAWA_CRAWL_ON_START=false npm run dev
```

실제 카탈로그를 만들려면 다나와 이용 조건·robots 정책·데이터 재배포 범위를 확인한 뒤 `.env`에서 수집 옵션을 설정하고 작은 dry-run부터 실행합니다.

```bash
npm run crawl:dry
```

외부 데이터 디렉터리를 코드 checkout 밖에 두려면 `PC_SUPPORTER_DATA_DIR`을 절대 경로 또는 실행 위치 기준 경로로 지정합니다. 이 값을 지정해도 해당 경로의 JSON은 공개 저장소에 추가하지 않습니다.

```text
PC_SUPPORTER_DATA_DIR=/path/to/private/pc-supporter-data
```

PostgreSQL을 사용하는 배포 환경으로 private 핵심·주변 부품 snapshot을 옮길 때는 source 디렉터리를 명시적으로 검증한 뒤 적용합니다. `--dry-run`은 저장소를 변경하지 않으며, `--replace-danawa`는 snapshot에 포함된 9개 핵심 범주의 기존 Danawa 행을 교체하므로 전체 핵심 snapshot일 때만 사용합니다. 교체 모드는 9개 범주가 모두 포함되지 않으면 실행 단계에서 차단되며, 부분 데이터는 `--replace-danawa` 없이 병합해야 합니다. `--include-accessories`를 함께 지정하면 같은 디렉터리의 `accessories.json`도 검증·file volume에 병합하고, 전체 주변 부품 snapshot일 때만 `--replace-accessories`로 기존 Danawa 주변 부품을 교체합니다. 주변 부품 교체도 10개 지원 범주가 모두 있어야 하며, 누락 범주가 있으면 `--include-accessories`만 사용해 병합해야 합니다. 실행 대상은 현재 프로세스의 `PC_SUPPORTER_DATA_DIR`·`DATABASE_URL`입니다.

```bash
npm run import:private-catalog -- --source-dir /path/to/private/pc-supporter-data --dry-run
npm run import:private-catalog -- --source-dir /path/to/private/pc-supporter-data --apply --replace-danawa
npm run import:private-catalog -- --source-dir /path/to/private/pc-supporter-data --apply --replace-danawa --include-accessories --replace-accessories
```

Docker Compose에서는 source를 read-only bind mount한 일회성 app container에서 실행할 수 있습니다. PostgreSQL 컨테이너와 app의 내부 주소는 compose 환경값을 그대로 사용하며, 외부 상품 JSON은 image나 공개 저장소에 포함되지 않습니다.

```bash
docker compose run --rm -v /path/to/private/pc-supporter-data:/imports:ro app npm run import:private-catalog -- --source-dir /imports --dry-run
docker compose run --rm -v /path/to/private/pc-supporter-data:/imports:ro app npm run import:private-catalog -- --source-dir /imports --apply --replace-danawa
docker compose run --rm -v /path/to/private/pc-supporter-data:/imports:ro app npm run import:private-catalog -- --source-dir /imports --apply --replace-danawa --include-accessories --replace-accessories
```

공개 저장소에서 제품 수가 seed 기준보다 많아졌다는 사실은 데이터 수집 성공이나 최신 가격을 의미하지 않습니다. `DATA TRUST`와 관리자 manifest의 coverage·freshness·가격 확인 상태를 별도 근거로 확인해야 합니다.
