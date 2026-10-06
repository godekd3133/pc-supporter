# PC Supporter Azure 학생 크레딧 이전

PC Supporter 코드·운영 데이터는 Azure for Students의 전용 VM으로 이전했습니다. 실제 배포 릴리스는 `20261005152751`, 엔진은 `2.60.0`입니다. 기존 공개 주소의 연결 전환과 최종 운영 검사는 아래 실제 결과에 함께 기록합니다. 절차 문서 작성, 설치 검사, 실제 서버 실행과 브라우저 검증은 서로 구분합니다.

## 범위와 비용 경계

- PC Supporter만 이전한다. 기존 Lightsail의 KBO 앱·DB·서비스·도메인은 이전하거나 삭제하지 않는다.
- Azure for Students의 실제 활성 구독, 남은 크레딧과 만료일을 먼저 확인한다. 유료 종량제 전환, 결제수단 추가, 구독 업그레이드는 하지 않는다. 크레딧이 소진되거나 만료되면 학생 구독 서비스가 중지될 수 있다. [Microsoft 공식 안내](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/azurestudents-subscription-disabled)
- 리전·VM 크기·디스크·공인 IP의 가용성과 비용은 로그인한 학생 구독에서 확인한다. 다른 구독으로 우회하거나 생성 실패를 자동 유료 전환으로 해결하지 않는다.
- 새 서버는 Ubuntu 24.04 amd64 전용 VM으로 준비한다. Node 22 LTS, 원본과 같은 PostgreSQL 16, Caddy stable을 사용한다. 17/18 선택은 명시한 경우에만 가능하며 이번 이전에서 DB major 변경을 가정하지 않는다.
- SSH 22는 작업자 IP로 제한한다. 공개 웹 포트는 80/443만 사용하고 API 4174와 PostgreSQL 5432는 localhost에서만 수신한다. 기존 HTTPS 주소는 Lightsail의 PC Supporter 블록을 Azure로 연결하는 방식으로 유지한다.

## 이전 전 확인과 백업

1. 실제 Git 루트·브랜치·dirty 파일과 작업자 소유 범위를 확인한다. 승인된 최신 작업 트리의 소스와 웹 빌드를 함께 배포하며, 커밋·push·다른 작업자의 수정 되돌리기를 이전 과정에 끼워 넣지 않는다.
2. 원본 `/opt/pc-supporter/current`의 릴리스와 핵심 파일 SHA256, 엔진 버전, 서비스 상태를 기록한다. Azure에 같은 소스가 올라갔는지는 새 릴리스에서 다시 확인한다.
3. `/etc/pc-supporter/backend.env`와 root 전용 `/etc/pc-supporter/migration.env`, `/var/lib/pc-supporter`를 private 백업한다. 디렉터리는 0700, 비밀값을 포함한 파일·DB dump는 0600으로 제한한다. env 내용, DB URL, 암호를 stdout·명령 인수·보고서·Git 파일에 기록하지 않는다.
4. 원본 PC Supporter의 API·worker만 멈춰 쓰기를 잠시 중단한 뒤 일관된 최종 PostgreSQL custom dump와 runtime 파일 백업을 만든다. KBO 서비스는 계속 실행한다. 스케줄러와 worker 상태를 기록하고, 복사본 검증 전 원본 데이터를 삭제하지 않는다.
5. source PostgreSQL major는 실제 서버에서 확인한다. 2026-10-05 원본 확인값은 **16.15**다. 원본 `pg_dump` wrapper의 cluster 설정 문제를 피하려면 `/usr/lib/postgresql/16/bin/pg_dump`를 사용한다. `PGHOST`·`PGPORT` 등을 private 프로세스 환경에서 전달하고 비밀값을 출력하지 않는다.
6. dump의 SHA256과 읽기 가능 여부, DB 이름·테이블별 건수를 기록한다. schema, 상품, 가격 이력, 사용자 상태, 작업 큐 등 PC Supporter의 모든 저장 항목을 포함하되 다른 앱 DB나 cluster 전역 역할을 통째로 가져오지 않는다.

## 새 VM bootstrap

원본 공유 Lightsail에서는 실행하지 않는다. 아래 명령은 새 Azure Ubuntu VM에서만 실행하며, VM 생성·네트워크·구독 작업을 수행하지 않는다.

```bash
sudo bash scripts/azure-host-bootstrap.sh --postgres-major 16 --check-only
sudo bash scripts/azure-host-bootstrap.sh --postgres-major 16
```

`--check-only`는 입력·OS·CPU 아키텍처·fresh-host 조건을 검사하고 파일을 바꾸지 않는다. 설치는 root/sudo가 필요하다. 기존 PC Supporter 디렉터리·서비스 사용자·PostgreSQL cluster·Caddyfile이 있으면 작업 소유권 충돌로 중단한다. 중간 설치가 실패한 서버에 무조건 재실행하지 말고 실제 생성된 항목과 실패 원인을 확인한다.

Node는 공식 `nodejs.org`의 Node 22 Linux x64 tarball을 다운로드하고 같은 공식 HTTPS 체크섬의 SHA256을 검증한다. tar의 절대경로와 `..` 경로를 거부하고 root 소유 전용 prefix에 설치한다. SHA256 검사는 전송·파일 무결성 검증이며 별도의 릴리스 서명 검증을 수행한다고 보고하지 않는다. Node 22는 2027-04-30까지 Maintenance LTS로 안내돼 있다. [Node 다운로드](https://nodejs.org/en/download), [Node 릴리스 일정](https://github.com/nodejs/Release#release-schedule)

PostgreSQL 16은 Ubuntu 24.04 기본 apt 패키지로 설치한다. 명시한 17/18은 공식 PGDG noble 저장소를 사용한다. bootstrap은 `127.0.0.1:5432` 수신을 확인하지만 DB·owner/runtime role·비밀값은 만들지 않는다. [PostgreSQL 공식 Ubuntu 설치 안내](https://www.postgresql.org/download/linux/ubuntu/)

Caddy는 공식 stable apt 저장소의 패키지와 systemd 서비스를 설치한다. 새 패키지의 기본 사이트를 제거하고 사이트 없는 Caddyfile을 검증해 시작한다. 기존 `scripts/lightsail-deploy.sh --host --domain`이 관리 블록을 추가할 수 있는 상태로 남긴다. [Caddy 공식 설치 안내](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)

## DB·runtime·환경 이전

1. 원본 PC Supporter DB와 같은 DB 이름 및 schema owner를 새 localhost PostgreSQL에 준비한다. 원본의 owner/runtime credential 관계와 환경 파일 분리를 유지한다. 슈퍼유저 비밀값을 API·worker의 환경에 넣지 않는다.
2. custom dump는 PC Supporter DB에만 `pg_restore --single-transaction --exit-on-error --no-owner --no-acl`로 schema owner 계정으로 복원한다. `--no-acl`은 아직 없는 원본 runtime role을 참조하는 GRANT의 복원 실패를 막기 위한 것으로, runtime 권한은 기존 배포의 canonical role-bootstrap에서 정확히 부여한다. 복원 단계에서 실패하면 API를 공개하지 않는다. 기존 DB를 `--clean`으로 자동 삭제하는 재시도는 하지 않는다.
3. private runtime 파일은 `/var/lib/pc-supporter`로 복원하고 `pc-supporter:pc-supporter` 소유를 부여한다. Node modules, 다른 서비스 파일이나 다른 DB를 runtime 파일에 섞지 않는다.
4. `backend.env`는 root:pc-supporter 0640, `migration.env`는 root:root 0600으로 설치한다. 기존 배포 스크립트가 이 경계를 검증한다. 최초 이전 시 관리 인증 비밀값과 데이터 연결을 새 기본값으로 재생성하지 않고 원본 값을 보존한다.
5. API 환경에는 `SERVER_HOST=127.0.0.1`, `PORT=4174`, `PC_SUPPORTER_DATA_DIR=/var/lib/pc-supporter`를 확인한다. `DATABASE_URL`은 제한된 runtime role, `DATABASE_MIGRATION_URL`과 role-bootstrap 값은 root 전용 migration 파일에 둔다. localhost로 옮긴 endpoint만 바꾸고 나머지 설정은 검토 없이 삭제하지 않는다.
6. 기존 웹 origin·Capacitor origin·관리 세션 정책을 보존하고 새 Azure HTTPS origin을 필요한 CORS 목록에 추가한다. 실제 새 주소를 확인한 뒤 변경하며 광범위한 `*` 허용으로 대체하지 않는다.

## 기존 배포 스크립트 재사용

macOS 작업 트리에서 웹 빌드와 배포 bundle을 검증한 뒤 새 Azure SSH target과 새 HTTPS domain을 명시한다. 비밀 env를 이미 private 경로에 설치한 새 서버에서는 `--preserve-env`로 보존한다.

```bash
npm run build
bash scripts/lightsail-deploy.sh --dry-run
bash scripts/lightsail-deploy.sh \
  --host azureadmin@AZURE_HOST \
  --ssh-key /PRIVATE/PATH/azure-ssh-key \
  --domain AZURE_HTTPS_DOMAIN \
  --preserve-env
```

`AZURE_HOST`·`AZURE_HTTPS_DOMAIN`·키 경로는 실제 생성 결과로 치환한다. placeholder를 그대로 실행하지 않는다. 최초 env를 직접 전달해야 한다면 스크립트의 `--env-file`·`--migration-env-file`을 사용하고 private 입력 파일 권한을 먼저 확인한다. 기존 스크립트가 schema migration, runtime role provisioning, 권한 smoke, API 시작, worker 시작과 heartbeat 확인을 맡는다. 이름에 Lightsail이 있어도 SSH target·domain·앱 경로를 명시하면 동일 배포 경로를 사용한다.

## 검증 후 HTTPS 연결 전환

1. 새 서버 `/api/health`에서 ready, 같은 엔진 버전, DB 준비 상태와 새 worker heartbeat를 확인한다. API/worker/Caddy active, 4174·5432의 localhost 수신, 핵심 소스와 웹 파일 SHA256 일치를 확인한다. 권한 smoke는 runtime CRUD 허용과 schema/DDL 변경 거부를 모두 확인해야 한다.
2. 복원 DB의 테이블별 건수·핵심 상품·가격 확인 시각·관리 설정·작업 큐를 최종 백업과 비교한다. 목표 부품 제한과 국내 가격 조건이 유지되는지 확인한다. local seed data로 운영 DB를 가리는 방식은 쓰지 않는다.
3. 새 Azure 외부 HTTPS로 80·220·400만원 생성 및 주요 vendor/예산 경로를 요청한다. 합계·부품·호환 불가 건수·확인 필요 항목·응답 시간을 기록하고 원본 400만원 120초 timeout과 비교한다. 응답 시간 개선은 실제 같은 요청의 결과로 보고한다.
4. 새 사이트의 UI, 도움말, `− / +` 연동, 공유 링크, 로그인과 HTML 보고서를 실제 브라우저에서 확인한다. 서버 health 성공을 화면 검증으로 대신하지 않는다.
5. 새 Azure가 위 검사를 통과한 후 **기존 Lightsail Caddy의 PC Supporter managed block만** 새 HTTPS upstream으로 연결한다. upstream의 Host와 TLS server name을 맞추고 원래 Host·forwarded 정보를 전달하는 설정은 Caddy 공식 reverse proxy 문법으로 검증한다. KBO 블록은 바꾸지 않는다.
6. 기존 `https://pc-supporter.3-39-79-1.sslip.io` 주소에서 API·웹·모바일 origin을 다시 확인한다. 기존 링크와 설치 앱의 endpoint를 유지하기 위한 bridge이며 Lightsail 의존성이 즉시 제거됐다고 보고하지 않는다. Azure 쪽 forwarded 헤더 신뢰는 기존 bridge의 정확한 출발 IP에만 한정한다.
7. Azure worker가 정상 처리하는 것을 확인한 후 원본 PC Supporter API/worker의 재시작과 스케줄러 실행을 방지한다. 원본 Caddy와 KBO는 유지한다. 원본 PC Supporter 데이터·백업은 검증과 rollback 기간이 끝날 때까지 보존한다.

## 복구와 완료 기준

새 서버 공개 전 실패하면 bridge를 전환하지 않고 원본 PC Supporter API/worker만 복구한다. bridge 전환 후 실패하면 PC Supporter Caddy 블록을 저장해 둔 원본 설정으로 돌린다. Azure에서 새 쓰기가 발생한 후에는 오래된 원본 DB로 단순히 되돌리지 않는다. 양쪽 쓰기를 중단하고 어느 DB가 최신인지 확인한 뒤 데이터 역이전을 계획한다.

학생 크레딧은 실행 중 VM뿐 아니라 디스크·공인 IP 등 리소스 사용에도 영향을 받는다. 종료와 할당 해제·삭제는 서로 다르므로 실제 비용과 보존 필요성을 확인한다. 이 문서에 따라 이전했다고 기존 공유 Lightsail VM을 삭제하거나 학생 구독을 유료 전환하지 않는다.

완료 보고에는 다음 증거를 함께 남긴다.

| 항목 | 실제 결과 기록 |
|---|---|
| 학생 구독 상태·크레딧·만료·유료 전환 없음 | Azure for Students Enabled. 학생 크레딧 원액과 마지막 정산 잔액 USD 100 확인. 순간 사용량이 모두 차감된 실시간 잔액을 뜻하지 않음. spendingLimit On 유지. 만료 2027-10-05 17:50:58 KST. 유료 전환·결제수단 추가 없음. |
| Azure VM·리전·크기·주소·네트워크 | 전용 RG `pc-supporter-students`, VM `pc-supporter-vm`, Korea Central, Standard_B2ats_v2 2 vCPU / 1GiB(게스트 실제 842MB), Ubuntu 24.04.4 amd64. 공인 IP `20.196.193.112`, `pc-supporter-71697d83-kc.koreacentral.cloudapp.azure.com`. Trusted Launch Secure Boot/vTPM 적용. SSH는 작업자 IP/32, 공개 80·443, 4174·5432는 localhost. 기존 `yio-students` 리소스는 변경하지 않음. |
| source/target PostgreSQL major·백업·복원 건수 | 원본·대상 PostgreSQL 16. 최종 원본 백업 `/opt/pc-supporter/backups/azure-20261005T142456Z-cutover`. 24개 테이블 모두 최종 백업 건수와 복원 건수 일치. 부품 7,587개·액세서리 4,484개·저장 견적/소유자 상태 0개 확인. schema revision 3, SHA256 `2eac909c9efc45e6cf78cab3171ea86e93b199063cad2e9cf69d4cb7e46e0fd6`. 운영 파일·환경 비밀값도 보존. |
| 배포 릴리스·소스/웹 SHA256·엔진 버전 | 릴리스 `20261005152751`, 엔진 `2.60.0`. 기준 커밋 `8fecd66f31b54904a54d2bf312e5cc1c03ee8759`에 검증된 작업 트리 수정을 포함. 파일별 SHA는 `public/deployment-info.json`에 기록하며 새 커밋·push 없이 배포함. |
| DB 권한 smoke·API/worker/Caddy·localhost 수신 | 제한 실행 역할 CRUD 허용, public schema DDL와 schema ledger 쓰기 거부 확인. API·worker·Caddy active, PostgreSQL ready, heartbeat 확인. API 4174·PG 5432 localhost. |
| 새 HTTPS와 기존 HTTPS bridge 외부 검사 | Azure 직접 HTTPS health 통과. 기존 주소 `https://pc-supporter.3-39-79-1.sslip.io`에서 연결 오류 보완 전 24견적 HTTP 200. PC Supporter Caddy 블록만 Azure HTTPS upstream으로 연결하며 TLS 검증 유지. |
| 예산별 결과·응답 시간·브라우저 화면 | 연결 오류·CPU 조절 보완 전 운영 24견적 모두 예산 이내·호환 불가 0. 0.872–3.054초. NVIDIA 80만원 759,640원 / 400만원 3,717,090원 / 1,000만원 8,360,550원. AMD 220만원 7500X3D+RX9070XT 2,146,730원. 표와 전체 원 응답은 HTML 보고서와 `artifacts/azure-migration-2026-10-05/final-budget-matrix.json`에 기록. 실제 Azure 새 세션에서 3개 단일 선택 즉시 이동, 국내 신품 벌크 포함 검토, 5500GT·16GB·1TB·500W·759,640원 생성, 성능 도움말 클릭·부품 − / + 표시 확인. 실제 화면 `azure-80-desktop.png`, `azure-80-metrics.png` 보존. |
| 원본 PC Supporter 중지·KBO 유지·rollback 백업 | 원본 PC Supporter API·worker 중지·자동 시작 방지. 기존 KBO·Caddy·DB와 원본 백업 보존. 초기 Azure 복원 DB·runtime 폴더도 보존. 기존 주소 bridge가 남아 있으므로 AWS 의존성 전체 제거로 기록하지 않음. |

bootstrap의 입력·구문 검사와 실제 Ubuntu 설치, DB 복원, 운영 HTTPS 결과는 별개의 검증 항목이다. 로그인·리소스 생성·실제 서버 실행이 남아 있는 상태를 배포 완료로 표현하지 않는다.

## 이번 이전에서 확인하고 고친 동작

- 운영 GPU 관리 설정의 이름 패턴이 최초 RTX 50 / 지정 RTX 3050 / 지정 RX 580에 머물러 후속 허용 RX 9000을 제외하고 있었습니다. RX 9000 이름 패턴만 추가해 DB와 운영 파일을 함께 맞췄고, 원본 설정을 별도로 보관했습니다. 고가 AMD 견적이 RX 580을 계속 재사용하는 원인을 해소했습니다.
- 실제 웹의 새 80만원 견적은 국내 정품만 기본값 때문에 1TB 최소 구성 804,830원에서 실패했습니다. 새 예산 게임 견적의 기본값만 국내 신품 벌크 포함으로 바꾸어 5500GT / AG400 G2 / 16GB / 1TB / 500W 762,650원이 생성되도록 했습니다. 사용자가 명시한 구매 조건, 기존 초안·프리셋의 정품만 조건은 보존합니다. 벌크 상품에 패키지 기본 쿨러가 없으면 기본 쿨러를 있다고 가정하지 않습니다.
- API와 worker는 TypeScript를 매번 실행하며 시작하지 않고 검증한 Node runtime bundle로 시작합니다. 환경 파일의 권한과 경로를 sudo로 검사하고 작은 VM에서 npm 실행 메모리를 제한했습니다. API 준비 확인 후 worker를 시작하며 준비 상태와 heartbeat를 따로 검사합니다.
- PostgreSQL localhost 설정이 자동 입력 도구에서 잘못 인용된 원인을 수정하고 실제 설정값과 수신 주소를 재확인했습니다. 실패한 부분 설치에서 DB를 삭제하거나 다른 프로젝트 자원을 손대지 않았습니다.

## 비용과 보존 범위

무료 컴퓨트 적용을 가정하지 않은 PC Supporter의 보수적인 월 예상은 약 **USD 14.59**입니다. 해당 VM의 무료 컴퓨트 할당이 실제 적용되면 디스크·공인 IP 예상은 약 USD 6.05지만, 750시간 적용 여부를 확정하지 않았습니다. 기존 Yio도 같은 학생 구독 크레딧을 소비하므로 USD 100이 PC Supporter 전용 잔액이거나 1년 무료 운영을 보장한다고 해석하지 않습니다. 실제 사용 요금은 정산 지연 후 Cost Management에서 확인해야 합니다.

Azure에 최초 검증용 복원 DB `pcsupporter_preflight_20261005`와 `/var/lib/pc-supporter.azure-preflight-20261005`를 보존했습니다. 원본 PC Supporter DB·백업도 남아 있습니다. 기존 Lightsail은 KBO와 기존 주소의 HTTPS 연결에 계속 사용되며, VM 전체를 삭제하지 않았습니다.

## 연결 오류·CPU 조절 보완 전 운영 검사 기록

`artifacts/azure-migration-2026-10-05/final-budget-matrix.json`은 기존 origin으로 요청한 NVIDIA·AMD 각각 12예산의 원 응답입니다. 모든 요청은 게임 예산 / 국내 신품 벌크 포함 / RAM 최소16GB / SSD 최소1TB 조건이며 HTTP200, 예산 이내, 호환 불가0건입니다. 미확인 사양과 구매 확인 항목은 원 응답에 남겨 두었습니다. worker 재개 후 실제 가격이 갱신돼 이 검사 당시 80만원 합계는 759,640원이며 초기 진단 762,650원과 구분합니다. 이 24개 검사에 이후 연결 오류·CPU 조절 보완의 안정성 증명을 대신하지 않습니다.

`artifacts/azure-migration-2026-10-05/final-owner-session-check.json`에 기존 주소의 소유자 기능 검사를 남겼습니다. 새 견적 생성201, 소유자 조회200, 타인 삭제401, 위조 origin403, 테스트 견적 삭제200·로그아웃200을 확인했습니다. 세션 cookie는 HttpOnly·Secure·SameSite·host-only이며 원 응답의 소유자 비밀값은 보고서에 기록하지 않습니다.

연결 오류 보완 전 400만원 반복 검사 `final-performance.json`은 순차10회 2.069–6.904초, 중앙값 2.6835초, p95 6.904초입니다. 10개 표본의 올림 방식 p95가 최대값과 같으며 장기 서비스 p95로 해석하지 않습니다. 동시2회는 10.991·11.191초입니다. 그 재실행12회는 모두 HTTP200·같은 합계3,717,090원·예산 이내·호환 불가0건입니다. 최초 반복 실행의 한 HTTP 빈 본문으로 JSON 해석에 실패한 기록도 `final-performance.log`에 보존했습니다. 실제 API가 PostgreSQL 25P03 idle-in-transaction timeout의 연결 오류를 처리하지 못해 2026-10-05 23:44:30 KST에 한 번 재시작한 원인을 확인했습니다. 커널 OOM 기록은 없었습니다. 수정·배포 뒤 재검사 결과는 다음 기록에 추가하며 실패가 전혀 없었다고 보고하지 않습니다.

실제 Azure 화면 검사에서는 최초 CSS 미리 읽기 오류가 한 번 발생했습니다. 해당 파일의 서버 존재와 HTTP200·파일 일치를 확인했고 새로고침 뒤 정상 표시됐습니다. 파일 수정으로 해결한 사실은 없습니다.

최종 기존 주소의 native CORS 사전 요청은204, 허용 origin은 `capacitor://localhost`, `X-Share-Owner-Token`·`X-PC-Owner-Mode` 허용을 확인했습니다. 실제 설치 앱 바이너리나 기기 실행은 이번 서버 검사에 포함하지 않습니다. 최종 IP 검사는 직접 Azure와 기존 주소 요청이 같은 실제 사용자 IP로2회 집계되고, bridge·위조·loopback IP 집계가 없는 것을 확인했습니다(`final-proxy-ip.json`).

실제390×844px 모바일의 80만원 결과는 가로 넘침 없이 표시됐습니다(`azure-80-mobile.png`). 수정 전 CPU + 조절에서 5500GT→5600G에 불필요한 RTX5050·600W 파워가 함께 선택되고336,650원 예산 초과가 표시된 문제를 확인했습니다. 아래 수정 후 검사와 구분합니다.

## 최종 보완과 검사 구분

PostgreSQL pool과 대여한 client의 연결 오류 수명 처리를 수정했습니다. 25P03 오류가 발생한 연결은 손상 상태로 처리해 폐기하고 COMMIT을 거부하며, 타임아웃 값을 늘리지 않습니다. 실제 production DB의 runtime 역할로 별도 읽기 전용 QA transaction에만1000ms timeout을 주어 재현했습니다. `real-pg-fault-check.json`에서25P03 포착·COMMIT 거부·새 연결 SELECT1 정상·DB 변경0건을 확인했습니다. 실제 Repository 경로도 별도 읽기 전용 transaction으로 재현했습니다(`real-repository-fault-check.log`). 실패한 COMMIT 거부·준비 상태 실패→회복·DB 변경0건·당시 API/worker 재시작0회를 확인했습니다. 어떤 실제 업무가 유휴 transaction을 만들었는지까지 확정하지 않았습니다.

CPU + 조절 요청이 내장그래픽지원 CPU끼리 바뀔 때 외장GPU를 강제로 포함하던 입력을 수정했습니다. 생성기 조절 helper→실제 엔진 통합 검사는5500GT→5600G의 내장그래픽·SSD 유지·호환 불가0건으로 통과했습니다. 릴리스20261005152751의 실제 Azure 브라우저에서 CPU +를 다시 눌러5600G·내장 그래픽·500W·786,730원을 확인했습니다. CPU만 바뀌고 GPU·파워·저장장치는 유지됐습니다.

집중 검사에서 신규 PostgreSQL6개+기존lease2개가 통과했습니다. generator-balance/phase1 gaming31개 중30개가 통과하고 기존10예산GPU 비교 루프가 기본5초 한도에서 시간초과했습니다. fail-closed3개 중2개가 통과하고 기존 API초기실행1개가 시간초과했습니다. 로컬 부하311.57관측과 검사 실패를 함께 남기되 원인이 확정됐다고 해석하지 않습니다. 초기 전체2265개 통과+3개 timeout 재실행 통과와 최종 수정 뒤의 집중 검사를 구분합니다.
