---
trigger: always_on
description: 프론트엔드 작업물은 완료 보고 전에 실제 브라우저 스크린샷으로 검증·제출한다
---

# 프론트엔드 작업 — 스크린샷 증거 필수

UI에 보이는 변경(React 컴포넌트·CSS·라우트된 화면·상태별 렌더링)을 했다면 완료 보고 전에 반드시 실제 렌더링 스크린샷으로 확인하고 그 결과를 보고한다. 코드와 테스트만으로 "동작한다"고 주장하지 않는다.

## 절차

1. 앱을 실행한다 — dev 서버가 이미 떠 있으면 재사용하고, 없으면 `npm run dev`(또는 `npm run dev:web`)로 띄운다. 실행 중 포트는 `lsof -iTCP -sTCP:LISTEN`으로 확인한다.
2. 브라우저로 해당 화면을 열고 필요한 상태를 재현한다(Playwright MCP `browser_navigate`/`browser_evaluate`/`browser_take_screenshot`, 또는 `scripts/*smoke*.mjs`의 CDP 방식). 로그인·로컬 상태가 필요하면 localStorage/sessionStorage를 먼저 심는다.
3. 변경 부분의 스크린샷을 찍어 눈으로 검증한다. 파일은 `/*.png`나 `.playwright-mcp/`에 저장한다 — 둘 다 gitignore 처리돼 있어 커밋되지 않는다.
4. 보고할 때 무엇을 찍었는지(URL·상태·화면 영역)와 검증 결과를 함께 적는다.

## 예외

서버를 띄울 수 없거나 헤드리스 브라우저를 쓸 수 없는 환경이면 스크린샷을 생략할 수 있지만, 왜 생략했는지 보고에 한 줄로 명시한다.
