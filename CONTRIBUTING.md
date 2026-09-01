# Contributing to PC Supporter

## 개발 환경

```bash
npm ci
cp .env.example .env
DANAWA_CRAWL_ON_START=false npm run dev
```

웹은 `http://127.0.0.1:5173`, API는 `http://127.0.0.1:4174`에서 실행됩니다. PostgreSQL을 사용할 때만 `.env`의 `DATABASE_URL`을 설정하고 `docker compose up -d postgres`를 사용합니다. 설정하지 않으면 파일 persistence fallback으로 개발할 수 있습니다.

## 변경 전 확인

변경이 속한 계약·엔진·API·UI 경계를 먼저 찾고, 호환성 판정과 데이터 신뢰도·가격·실제 조립 검증을 하나의 성공 상태로 합치지 않습니다. 외부 데이터를 다루는 변경은 다나와 이용 조건과 재배포 범위를 별도로 확인합니다.

## 필수 검증

```bash
npm run typecheck
npm test -- --reporter=dot
npm run build
```

크롤러를 건드렸다면 먼저 네트워크 저장이 없는 검증을 사용합니다.

```bash
npm run crawl:dry
```

실제 crawl은 작은 범위와 충분한 delay로 수행하고, 생성된 `data/*.json`은 commit하지 않습니다.

## 공개 저장소 데이터·비밀 정책

- `.env`와 모든 credential, 관리자 비밀번호, session secret을 올리지 않습니다.
- `data/*.json`은 live catalog, crawl state, 사용자 저장 상태이므로 올리지 않습니다.
- `dist/`, `node_modules/`, `.playwright-mcp/`, `artifacts/`를 올리지 않습니다.
- 재현 가능한 기본 데이터는 `server/seed-catalog.ts`에 유지합니다.
- 공개 문서에 외부 상품의 최신 가격이나 재배포 허용을 보장하는 표현을 추가하지 않습니다.

## 커밋과 PR

커밋은 한 가지 책임만 갖도록 나눕니다. 예시는 다음과 같습니다.

- `feat(engine): explain memory compatibility findings`
- `fix(api): preserve catalog quality on partial refresh`
- `test(ui): cover import preview boundary`
- `docs(repo): record validation evidence`

PR에는 변경된 증거 층, 실행한 명령과 최종 exit 결과, 실행하지 못한 검증, 데이터/보안 영향, UI 변경 시 캡처 여부를 적습니다. 정적 테스트 통과를 브라우저·실제 조립·운영 배포 성공으로 표현하지 않습니다.
