# 공개 저장소의 데이터 경계

이 디렉터리의 JSON은 두 종류로 나뉩니다.

- 제품 카탈로그·액세서리 수집 결과: `catalog.json`, `accessories.json`
- 실행 중 생성되는 상태·이력: 크롤링 manifest/state, 저장 견적, 비교·관심 목록, 변경 로그, lease 파일 등

이 공개 저장소에는 위 JSON을 커밋하지 않습니다. 수집 결과에는 외부 사이트에서 가져온 상품·가격·이미지·원문 URL이 포함되고, 실행 상태에는 로컬 사용자의 저장 견적이나 관리자 작업 이력이 포함될 수 있기 때문입니다. `.gitignore`의 `data/*.json`·`data/*.lock`·`data/*.lease`·`data/*.tmp`가 이 경계를 강제합니다.

데이터가 없는 새 checkout도 `server/seed-catalog.ts`의 결정적 seed 카탈로그로 시작할 수 있습니다. 서버가 처음 카탈로그를 읽을 때 seed를 `data/catalog.json`으로 materialize하므로, 공개 저장소의 테스트·개발 시작점은 외부 수집 결과에 의존하지 않습니다. 액세서리는 라이브 수집 전까지 비어 있는 상태로 시작합니다.

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

공개 저장소에서 제품 수가 seed 기준보다 많아졌다는 사실은 데이터 수집 성공이나 최신 가격을 의미하지 않습니다. `DATA TRUST`와 관리자 manifest의 coverage·freshness·가격 확인 상태를 별도 근거로 확인해야 합니다.
