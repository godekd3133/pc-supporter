# 10/12 HTML 보고서 입력과 재생성

입력: `docs/feedback-2026-10-12/report-data.json`
생성기: `artifacts/feedback-2026-10-12/build-report.py`

```sh
python3 artifacts/feedback-2026-10-12/build-report.py
```

출력:
- `public/reports/feedback-response-2026-10-12.html`
- `public/reports/feedback-response-2026-10-12.css`
- `public/reports/feedback-response-2026-10-12-standalone.html`

호스팅 버전은 외부 CSS를 사용한다. 오프라인 버전만 CSS를 포함한다. 두 버전 모두 JavaScript, 외부 이미지, 라이브러리, 네트워크 요청이 없다. 10/6 보고서는 변경하지 않는다.

## 최종 입력 필드

| 필드 | 내용 |
|---|---|
| `version`, `updated_at`, `summary` | 실제 배포 버전, KST 확인 시각, 확인한 결과를 요약 |
| `status` | `pending`, `implemented`, `verified`, `deployed`, `partial`, `failed` |
| `changes[]` | `feedback`, `cause`, `change`, `evidence`, `status` |
| `balance_matrix[]` | 13행 유지. `cpu`, `gpu`, `expected`, `actual`, `status`, `evidence` |
| `expected` / `actual` | `{ "cpu": "good", "gpu": "slightly_strong" }` 형식. 실제 값 미확인이면 `actual: null` |
| 밸런스 enum | `too_weak`, `slightly_weak`, `good`, `slightly_strong`, `too_strong` |
| `prices.attempted` | 실제 가격 확인 시도 상품 수 |
| `prices.success` | 실제 양의 판매가 확인 성공 수. 변동 없는 가격도 포함 |
| `prices.unavailable` | 상품은 확인했지만 현재 판매가가 없는 상품 수 |
| `prices.failed` | 차단·네트워크·상품 식별 실패 등으로 판매 상태를 확인하지 못한 수 |
| `prices.rows[]` | `name`, `before_won`, `after_won`, `checked_at`, `note`, `status`. 가격은 정수 원 또는 null. `status: unavailable` / `failed`도 허용 |
| `tests[]` | `name`, `result`, `evidence`, `status`. 단위·타입/빌드·API·브라우저·운영 검증을 구분 |
| `budgets[]` | `request`, `build`, `total_won`, `note`, `status`. 330만원, 200만원 4K 분기 및 추천 예산 기록 |
| `deployment` | `status`, `summary`, `url`. 실제 확인한 HTTPS 서비스 주소만 입력 |
| `remaining[]` | 실제 남은 확인만 나열. 모두 완료한 경우 빈 배열 |

현재 파일은 확인하지 않은 가격·13개 기준·배포 결과를 `pending`으로 남겼다. 3개 파일·76개 단계/저장/UI 단위 검증만 `verified`다. 원인과 결과는 최종 운영 확인 후 갱신한다. 배포 완료나 가격 최신화 완료를 입력 전에 주장하지 않는다.

모든 텍스트는 HTML로 escape한다. 배포 링크는 HTTPS일 때만 생성한다. 보고서 13행은 일반 게임 기준이며, 배틀그라운드 선택에 따른 X3D 규칙은 별도로 설명한다. 해상도별 VRAM 하한은 프로젝트 추천 정책이고 게임 FPS 보장으로 서술하지 않는다.
