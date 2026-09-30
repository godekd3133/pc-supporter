# 모바일 빌드와 TestFlight

PC Supporter는 Vite로 만든 웹 클라이언트를 Capacitor 8 네이티브 셸에 넣어 iPhone과 Android에서 실행합니다. 호환성 계산·카탈로그·저장/공유 API는 앱 안에 복제하지 않고 HTTPS API 서버를 호출합니다.

## API 연결 계약

웹 개발에서는 `VITE_API_BASE_URL`을 비워 두면 기존처럼 Vite proxy를 통해 상대 경로 `/api`를 사용합니다. 원격 API 모드 native bundle은 `VITE_API_BASE_URL`에 API 서버 origin을 지정해야 합니다. 빌드 시 CSP meta의 `connect-src`에는 그 API URL의 origin만 추가합니다.

```text
VITE_API_BASE_URL=https://api.example.com
CORS_ALLOWED_ORIGINS=capacitor://localhost,https://localhost,http://localhost
ADMIN_COOKIE_SAMESITE=none
```

`VITE_API_BASE_URL`에는 계정·비밀번호를 넣지 않고 origin만 넣습니다. 운영 API는 HTTPS여야 하며, `http://127.0.0.1:4174`와 `http://10.0.2.2:4174`는 각각 iOS Simulator와 Android Emulator 검증에만 사용할 수 있습니다. Android debug 변형에는 이 로컬 HTTP API를 위한 cleartext/mixed-content 설정이 들어가지만, HTTPS 운영 bundle에서는 자동으로 꺼집니다.

API 서버는 Capacitor 기본 origin을 허용하고 `ETag`, `Last-Modified`, `Retry-After` 응답 헤더를 노출합니다. native 관리자 로그인을 사용할 때는 HTTPS API와 `ADMIN_COOKIE_SAMESITE=none`을 함께 설정해야 합니다. `CORS_ALLOWED_ORIGINS`는 실제 웹 운영 origin을 추가할 때 쉼표로 이어 붙입니다.

Capacitor에서는 owner-session `session-v1` cookie mode를 사용하지 않습니다. 공유 자원의 기존 소유자 권한은 기기에 보관된 legacy owner token으로 서버 API에 전달하며, owner token은 공개 캐시에 저장하지 않습니다.

Express가 웹 앱을 제공할 때 CSP 응답 헤더는 같은 `dist/index.html`의 CSP meta 정책을 재사용하고 `frame-ancestors 'none'`만 헤더에 추가합니다. 웹·Capacitor의 `connect-src`는 빌드 입력 `VITE_API_BASE_URL`에서 나오므로 웹 앱과 API를 다른 origin으로 둘 때도 헤더와 HTML 정책이 어긋나지 않습니다. 같은 출처 웹 배포에서는 이 변수를 비워 상대 경로 `/api`를 사용합니다.

## 온라인 API와 기기 캐시

원격 API iOS bundle은 `VITE_API_BASE_URL`에 지정한 HTTPS 서버를 먼저 호출합니다. `/api/meta`, `/api/parts`, `/api/accessories`의 성공한 GET/HEAD 응답은 API origin과 전체 경로·query가 같은 요청에 한해 기기의 제한된 캐시에 저장합니다. 각 응답은 최대 512 KB, 전체는 최대 750 KB, 유효기간은 24시간입니다. 용량이 차면 오래 사용하지 않은 항목부터 비우며, 저장 공간이 부족해도 API 응답이나 견적 편집을 막지 않습니다.

서버에 연결할 수 없거나 응답 시간이 초과된 경우에만 해당 요청과 정확히 일치하는 캐시 응답을 표시합니다. 화면은 저장 시각을 보여 줍니다. 권한 오류와 기타 HTTP 오류는 이전 응답으로 가리지 않습니다. 소유자 정보, 저장 견적, 관리자 응답과 모든 변경 요청은 캐시에 넣지 않으며, 연결이 끊긴 상태에서 서버 변경이 성공한 것처럼 처리하지 않습니다. 이 캐시는 마지막으로 가져온 공개 카탈로그 조회 결과를 다시 보여 주는 기능이며 전체 카탈로그 snapshot이나 호환 계산을 오프라인에서 새로 수행하는 기능은 아닙니다. 기존 초안, 로컬 공유 자료와 owner token을 온라인 모드로 자동 이전하거나 서버에 일괄 등록하지 않습니다. 서버에 저장된 자원은 기존 API 권한 확인을 거쳐 사용합니다.

API 주소는 앱 bundle에 들어가는 공개 HTTPS origin입니다. 데이터베이스 URL, 관리자 비밀번호, owner token은 앱 설정에 포함하지 않습니다. PostgreSQL 연결은 서버가 관리하므로 서버의 저장소 구성이 바뀌어도 공개 API 계약이 유지되는 한 iOS 앱에서 SQL 연결 설정을 바꿀 필요는 없습니다.

## Native 빌드

원격 API 모드 native build는 의존성 설치 후 `VITE_API_BASE_URL`이 없으면 중단됩니다.

```bash
VITE_API_BASE_URL=https://api.example.com npm run build:mobile
```

이 명령은 웹 `dist/`와 충돌하지 않도록 native web assets를 격리된 `dist-mobile/`에 생성하고, 같은 디렉터리를 Capacitor `webDir`로 지정한 뒤 TypeScript·Vite·bundle gate와 `cap sync`를 실행합니다. 따라서 remote `VITE_API_BASE_URL`을 넣은 native build가 실행 중이어도 웹 preview가 사용하는 `dist/`를 덮어쓰지 않습니다. 생성된 `dist-mobile/`, `ios/App/App/public`, `android/app/src/main/assets/public`, Gradle/Xcode build output은 Git에 넣지 않습니다.

Android debug APK는 native build 뒤에 JDK 21과 Android SDK를 지정해 빌드합니다.

```bash
cd android
JAVA_HOME=/absolute/path/to/jdk-21/Contents/Home \
ANDROID_HOME=/absolute/path/to/Android/sdk \
./gradlew assembleDebug
```

결과 APK는 `android/app/build/outputs/apk/debug/app-debug.apk`입니다. 이는 emulator/device 검증용 debug APK이며 release keystore 서명이나 Google Play 배포 승인이 아닙니다. iOS Simulator `.app`은 `ios/App/App.xcodeproj`의 `App` scheme을 `iphonesimulator` 대상으로 build할 수 있습니다. 실제 iPhone용 archive에는 Apple Developer Team ID와 별도 서명이 필요합니다. Build metadata 파일은 앱 assets와 분리하고, Android APK/iOS app 안의 snapshot revision을 build manifest와 대조해 확인합니다.

Android Emulator에서 원격 API까지 확인하려면 API 서버를 `4174` 포트에 띄우고 다음을 실행합니다.

```bash
VITE_API_BASE_URL=http://10.0.2.2:4174 npm run mobile:android:debug
```

결과 APK는 `android/app/build/outputs/apk/debug/app-debug.apk`입니다. Android debug APK는 테스트 설치용이며 Google Play release 서명을 대신하지 않습니다.

Google Play bundle의 unsigned 빌드는 다음으로 생성합니다.

```bash
VITE_API_BASE_URL=https://api.example.com npm run mobile:android:aab
```

결과물은 `android/app/build/outputs/bundle/release/app-release.aab`이며 keystore가 없는 로컬 검증용 unsigned AAB입니다. Play Console에 업로드하려면 별도의 release keystore와 서명 설정이 필요합니다.

## KBO Fans와 같은 Lightsail API 배포

KBO Fans가 운영 중인 Lightsail static IP `3.39.79.1`과 기존 Caddy를 유지하면서 PC Supporter를 같은 인스턴스에 별도 서비스로 추가할 수 있습니다. PC Supporter는 `/opt/pc-supporter`, `/var/lib/pc-supporter`, `pc-supporter-api` systemd service, `4174` 내부 포트를 사용하고, 기본 HTTPS host는 `pc-supporter.3-39-79-1.sslip.io`입니다. KBO Fans의 `8000` 포트와 `/opt/kbo-fans` 및 기존 Caddy site block은 덮어쓰지 않습니다.

먼저 `aws login`으로 AWS 세션을 복구하고 Lightsail SSH access key/certificate를 준비한 뒤, 배포 consumer가 요구하는 현재 production web build를 `dist/`에 생성합니다. native `build:mobile`의 `dist-mobile/`은 Capacitor용이므로 Lightsail web deployment input으로 사용하지 않습니다.

```bash
npm run build
./scripts/lightsail-deploy.sh \
  --host ubuntu@3.39.79.1 \
  --domain pc-supporter.3-39-79-1.sslip.io \
  --ssh-key /tmp/pc-supporter-lightsail-key \
  --ssh-certificate /tmp/pc-supporter-lightsail-key-cert.pub
```

첫 배포에서 `--env-file`을 생략하면 원격 `/etc/pc-supporter/backend.env`에 관리자 비밀번호와 세션 secret을 생성하고 값을 출력하지 않습니다. 이후에는 remote env를 보존하는 배포만 사용합니다.

```bash
./scripts/lightsail-deploy.sh \
  --host ubuntu@3.39.79.1 \
  --domain pc-supporter.3-39-79-1.sslip.io \
  --ssh-key /tmp/pc-supporter-lightsail-key \
  --ssh-certificate /tmp/pc-supporter-lightsail-key-cert.pub \
  --preserve-env
```

배포 스크립트는 production admin 인증값이 없으면 public deployment를 거부하고, Caddy 설정을 먼저 백업한 뒤 별도 site block만 추가합니다. 첫 기동에서 `tsx`가 저사양 Lightsail 인스턴스의 cold compile에 시간을 사용할 수 있으므로 내부 `/api/health`는 기본 240초 동안 systemd 상태와 함께 반복 확인합니다. `PC_SUPPORTER_INTERNAL_HEALTH_TIMEOUT_SECONDS`로 이 대기 시간을 조정할 수 있습니다. 외부 `/api/health`는 `https://localhost` native origin을 함께 보내 CORS header까지 확인한 뒤 성공으로 종료합니다. AWS session이 만료됐거나 SSH가 `Permission denied (publickey)`이면 bundle dry-run까지만 수행하고 배포 성공으로 기록하지 않습니다.

### main push 자동 배포

`main`에 push하면 `.github/workflows/ci.yml`의 `deploy` job이 `verify`, `browser-smoke`, `container-smoke`를 모두 통과한 뒤 `ubuntu-24.04` runner에서 위 스크립트를 `--preserve-env`로 실행합니다. 배포용 SSH private key는 repo secret `LIGHTSAIL_DEPLOY_SSH_KEY`(전용 ed25519 키, `ubuntu`의 `authorized_keys`에 등록됨)를 사용하고, 호스트 키는 워크플로우에 고정합니다. 배포를 건너뛰려면 PR에만 커밋하거나 `main` 외 브랜치에 push합니다.

## iOS Simulator와 archive

Simulator 검증은 Xcode에서 `ios/App/App.xcodeproj`의 `App` scheme을 열어 실행합니다. CLI에서 web assets를 먼저 갱신한 뒤 `xcodebuild`로 simulator build를 실행할 수 있습니다. 실제 기기용 archive는 Apple Developer Team ID와 자동 서명이 필요합니다.

```bash
VITE_API_BASE_URL=https://api.example.com \
APPLE_TEAM_ID=XXXXXXXXXX \
npm run mobile:ios:archive
```

archive 결과는 `ios/App/output/App.ipa`에 생성됩니다. `APPLE_TEAM_ID`는 10자리 Team ID이며 인증서·App Store Connect API key·private key 값은 저장소나 `.env.example`에 넣지 않습니다.

## TestFlight 업로드

TestFlight 업로드는 다음 조건이 갖춰져 있을 때만 실행합니다.

1. App Store Connect에 bundle ID `com.godekd3133.pcsupporter`에 해당하는 앱 레코드가 있습니다.
2. `APPLE_TEAM_ID`의 Apple Developer 계정이 이 bundle ID에 서명할 권한을 가집니다.
3. archive에 들어간 `VITE_API_BASE_URL`이 외부 iPhone에서 접근 가능한 HTTPS API이고, 그 서버에 CORS origin과 운영 보안 환경변수가 설정되어 있습니다.
4. Xcode Organizer 또는 App Store Connect Transporter에 로그인할 수 있는 인증이 준비되어 있습니다.

IPA를 만든 뒤 Xcode Organizer에서 `Distribute App` → `App Store Connect` → `Upload`를 선택하면 됩니다. CI/Transporter를 사용할 때는 API key ID·issuer ID·private key 파일을 CI secret 또는 로컬 keychain으로 주입하고, 값 자체를 로그·커밋·문서에 남기지 않습니다. 업로드 성공은 TestFlight processing 완료나 실제 iPhone 설치·사용 승인을 의미하지 않으므로 App Store Connect의 build processing과 TestFlight 그룹 배포 상태를 별도로 확인합니다.
