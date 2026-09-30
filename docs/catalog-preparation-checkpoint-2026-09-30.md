# 카탈로그 준비 체크포인트 — 2026-09-30

## 마감 판정

이번 실행에서 현재 작업 트리의 `npm run build:local-bundle`과 `npm test`를 순서대로 마쳤습니다. 빌드는 exit 0, 테스트는 327개 파일·1,772개 테스트 통과입니다. 이번 기록은 현재 빌드와 테스트 결과를 고정한 마감 요약이며, 카탈로그 준비 목표의 완료를 뜻하지 않습니다.

원본 주변 부품의 전체 관측 RootScope는 여전히 `partial`입니다. 주변 부품 source 4,484개와 core 5,648개가 빌드에 반영됐고, 미완료 수집·사양 확인 및 목록 manifest count conflict가 남아 있습니다. 추가 수집이나 개발은 이번 마감 범위에 포함하지 않습니다.

## 현재 빌드와 카탈로그 근거

| 범위 | 현재 결과 | 해석 |
| --- | --- | --- |
| 핵심 카탈로그 | 5,648개: 필수 필드 완료 4,115개, 추가 확인 1,533개. | 원본 핵심 inventory는 complete로 표기되지만 필수 사양 확인은 남아 있습니다. |
| 주변 부품 source/build | 4,484개: `live` 4,321개, `incomplete` 121개, `seed` 42개. 사양 평가는 완료 3,301개, 일부 확인 306개, 미평가 877개입니다. | `live`는 판매 목록 상세 수집 상태이며, 모든 장착 조건 확인을 뜻하지 않습니다. 원본 관측 범위는 `partial`입니다. |
| 주변 부품 가격·이미지 | 가격 있음 4,474개, 가격 없음 10개. 이미지 URL 있음 4,442개, Danawa 이미지 URL 누락 0개, 수동 아이콘 42개. | 이미지 URL 존재는 화면 렌더링 확인을 뜻하지 않습니다. |
| 정합성 | 중복 PCode 0개, core와의 중복 0개. | 현재 source 검사 결과입니다. 목록 원본의 선언 수 충돌은 별도로 남아 있습니다. |
| 기본 주변 부품 목록 | manifest 선언 3,647개, 고유 관측 3,463개. 보충 관측을 합치면 3,911개로 선언 수보다 264개 많습니다. | manifest의 count conflict 때문에 accessory inventory는 `partial`로 유지합니다. 선언 수를 임의로 고치지 않습니다. |
| Bundle 상세 import | 292개 imported, 102개 quarantined: fetch failed 101개, abort 1개. | 격리 원인은 상세 fetch 실패/중단입니다. 이를 metadata 부재로 설명하지 않습니다. 전체 import 완료를 뜻하지 않습니다. |
| 11개 source pilot | canonical identity 확인 후 11개 적용 완료. 가격 확인 10/11, 가격 미확인 1/11, 실제 이미지 URL 11/11, 필수 사양 필드 확인 11/11. | pilot 결과이며 전체 미확인 SKU 해결이나 전체 import 완료를 뜻하지 않습니다. |

빌드 manifest는 public `core.json`, `accessories.json` 두 파일을 생성했고, private sidecar file count는 26입니다. 출력 디렉터리의 실제 파일은 public 쪽 manifest 포함 3개, `dist-local/data` 쪽은 번들된 catalog와 bundle manifest를 포함해 28개입니다. 빌드 상태는 `local-catalog-included-partial`입니다.

## 가져오기와 원본 경계

주변 부품 가져오기는 canonical identity 근거를 요구합니다. pilot 11개는 해당 기준으로 확인하고 적용했습니다. 이 결과를 전체 주변 부품에 일반화하지 않습니다. parent의 publisher/geo 값을 자식에 상속하지 않고, 원본 목록과 정렬은 변경하지 않습니다.

기본 목록과 보충 목록을 합친 관측은 manifest 선언 수보다 264개 많습니다. bundle 관측은 66페이지, 고유 parent 2,521개, 고유 member 1,241개이며, parent 없는 member 400개와 member 없는 parent 97개가 보고돼 있습니다. 두 누락 수의 중복 없는 합집합은 아직 계산·검증되지 않았습니다.

## 코드 및 화면 검증 상태

- 현재 작업 트리 `npm run build:local-bundle`: 성공. 로그는 `/tmp/pc-supporter-close-build.log`에 있습니다.
- 현재 작업 트리 `npm test`: 327개 파일·1,772개 테스트 통과. 로그는 `/tmp/pc-supporter-close-test.log`에 있습니다.
- 최근 full browser smoke에서는 picker 열기 및 닫기(Esc) 후 기존 trigger 복귀 경로가 통과했습니다.
- persistence 검증은 전체 통과가 아닙니다. revision 경합을 포함한 focus timing 문제를 진단했고, 전체 persistence smoke의 최종 0-pass 또는 성공 주장을 하지 않습니다. isolated 결과를 전체 persistence 통과로 확대하지 않습니다.
- 이 마감 실행은 위 build와 test만 수행했습니다. 별도 demo/API metadata readback이나 persistence 전체 검증 결과로 해석하지 않습니다.

## 완료되지 않은 범위

- 원본 주변 부품 전체 관측과 manifest count conflict는 `partial`입니다.
- Bundle import에는 102개 quarantined 항목이 남아 있고, parent/member 누락 식별자의 합집합은 미검증입니다.
- 주변 부품 미평가 877개와 핵심 사양 추가 확인 1,533개가 남아 있습니다.
- 전체 persistence browser smoke는 완료로 판정하지 않습니다.

따라서 현재 결과는 빌드 및 자동 테스트 통과이며 카탈로그 확보 목표 100% 완료가 아닙니다.
