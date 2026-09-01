## 변경 요약

<!-- 어떤 producer/consumer와 사용자 흐름을 바꿨는지 적어 주세요. -->

## 증거 층

- [ ] 계약/정적
- [ ] 단위 테스트
- [ ] API/runtime
- [ ] 브라우저/UI
- [ ] 외부 데이터/crawl
- [ ] 실제 조립/센서

## 검증

```text
npm run typecheck:
npm test -- --reporter=dot:
npm run build:
```

## 데이터·보안 확인

- [ ] `.env`, credential, 관리자 비밀번호, session secret을 포함하지 않았습니다.
- [ ] `data/*.json`, `dist/`, `node_modules/`, `.playwright-mcp/`, `artifacts/`를 포함하지 않았습니다.
- [ ] 외부 상품 데이터의 이용·재배포 판단을 테스트 통과와 혼동하지 않았습니다.

## 미실행 검증과 남은 위험

<!-- 실행하지 못한 검증, 별도 환경이 필요한 검증, 운영 영향과 다음 행동을 적어 주세요. -->
