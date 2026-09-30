# PC Supporter iOS release — 2026-09-30

## Release

- App: PC Supporter, `com.godekd3133.pcsupporter`
- Version/build: `1.0 (10)`
- Apple Developer Team: `A23ZPKGMW9`
- Catalog snapshot: `catalog-0-bb8cfb90d221661a`
- Embedded coverage: 5,648 parts across all 9 part categories and 4,484 accessories across all 10 accessory categories.
- Release lane: offline catalog mobile build. The snapshot omits image URLs and private recommendation evidence. Server-backed sync, shared links, live price refresh, and benchmark-backed recommendations are not included as available offline operations.

## Checkpoints

| Checkpoint | Result | Evidence |
| --- | --- | --- |
| Offline snapshot export | Passed | [`artifacts/release-2026-09-30/offline-snapshot/manifest.json`](../artifacts/release-2026-09-30/offline-snapshot/manifest.json), revision `catalog-0-bb8cfb90d221661a` |
| Mobile web build and Capacitor sync | Passed | [`artifacts/pc-supporter-offline/dist-mobile-offline/offline-build-report.json`](../artifacts/pc-supporter-offline/dist-mobile-offline/offline-build-report.json); synced iOS assets matched the built web files byte-for-byte |
| Xcode archive | Passed | `/Users/kimminkyu/Library/Developer/Xcode/Archives/2026-09-30/PC Supporter 1.0 (10).xcarchive`; [`archive.log`](../artifacts/release-2026-09-30/logs/archive.log) |
| IPA export and distribution signature | Passed | [`App.ipa`](../artifacts/release-2026-09-30/export/App.ipa); [`export.log`](../artifacts/release-2026-09-30/logs/export.log). Apple Distribution `A23ZPKGMW9`; strict deep signature verification passed; `beta-reports-active=true`; `get-task-allow=false` |
| Organizer upload | Passed | Xcode Organizer: `App upload complete: App 1.0 (10) uploaded`; archive status `Uploaded`, build 10 |
| App Store Connect processing / TestFlight availability | Unverified | App Store Connect redirected to sign-in with `authResult=FAILED`. No Apple credentials or 2FA were entered. `VALID` processing state and tester-group visibility are unverified. |
| Device install / launch | Unverified | No device install or launch was performed. |

IPA SHA-256: `0e2cf9f911e8fae778395404c08b39db42c38a91f2eb4bb962673b20ee75e97c`.
The IPA's embedded snapshot revision and row counts were checked against the exported snapshot manifest.

## Relevant fixes and checks

- Danawa parsing now omits unknown liquid-cooler radiator size instead of emitting `NaN`, which had blocked valid offline snapshot export while retaining the product's raw listing text and liquid-cooler classification.
- The offline snapshot projection now preserves motherboard `memoryFormFactor`, used by the compatibility engine to check memory fit.
- Focused suites passed: `server/danawa.test.ts` (57 tests) and `scripts/offline-snapshot.test.ts` (9 tests).

Detailed local artifacts and command outputs are recorded in [`artifacts/release-2026-09-30/release-evidence.md`](../artifacts/release-2026-09-30/release-evidence.md).
