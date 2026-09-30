# PC Supporter iOS update from latest commit — 2026-09-30

## Release source

- App: PC Supporter (`com.godekd3133.pcsupporter`)
- Version/build: `1.0 (11)`
- App source commit: `9d6300cbdcaed5f8830cb090bfe5d980ce0a2f05` (`Align accessory refresh and public smoke contracts`)
- Source checkout: `artifacts/release-update-2026-09-30/source/`, created with `git archive` from that exact commit.
- The original worktree's uncommitted App changes were not used or modified.
- Release-only source adjustments: `CURRENT_PROJECT_VERSION=11` in the isolated Xcode project and one `memoryFormFactor` string allowance in the isolated offline-snapshot export validator. No app runtime/domain source was changed.

## Catalog provenance

The latest commit does not track `data/catalog.json` or `data/accessories.json`; these are ignored runtime data. I compared the current full data against the prior release's input after applying only the same release projection (remove the Danawa `cate` query while retaining each pcode URL, omit null `radiatorSizeMm`). Both projected JSON files matched the prior inputs byte-for-byte:

- Parts: 5,648 rows; SHA-256 `9a93f01c3e5ffba957037e0a7656d5fde962b84ed89639e881c631dd4b445d92`.
- Accessories: 4,484 rows; SHA-256 `ead977ea4b37d9ee22ae644e93f2354031d9bc9912f5bf03b859979fa14bf06e`.
- Reused validated offline snapshot revision: `catalog-0-bb8cfb90d221661a`.
- Snapshot file hashes: parts `04ee0ce8c62ef7e53c114abcc48391ad5a05bf3f76d0311a325d4decabdbe720`; accessories `6d31af384b24c9b1db8b125ec1bfb998ea7942c68433100848bd53c7fce7b8ea`.
- Coverage: all 9 part categories and all 10 accessory categories. The snapshot excludes image URLs and private recommendation evidence per the offline snapshot contract.

## Build and upload checkpoints

| Checkpoint | Result | Evidence |
| --- | --- | --- |
| Mobile offline build | Passed | `artifacts/release-update-2026-09-30/source/artifacts/pc-supporter-offline/dist-mobile-offline/offline-build-report.json`; 5,648 parts + 4,484 accessories, Capacitor synced and native assets byte-checked against the web build |
| Capacitor native project generation | Passed | `npx cap sync ios` generated `config.xml` and `capacitor.config.json` required by the Xcode project from the exact archive source |
| Xcode archive | Passed | `/Users/kimminkyu/Library/Developer/Xcode/Archives/2026-09-30/PC Supporter 1.0 (11).xcarchive`; `artifacts/release-update-2026-09-30/logs/archive.log` |
| IPA export and signature | Passed | `artifacts/release-update-2026-09-30/export/App.ipa`; `artifacts/release-update-2026-09-30/logs/export.log`. Bundle ID/version match; Apple Distribution team `A23ZPKGMW9`; strict deep signature verification passed; `get-task-allow=false`; `beta-reports-active=true` |
| Organizer upload | Passed | Xcode Organizer: `App upload complete: App 1.0 (11) uploaded`; status `Uploaded`, build 11, 1:38 PM |
| App Store Connect processing / TestFlight group visibility | Unverified | The existing web session redirected to Apple sign-in with `authResult=FAILED`. No credentials or 2FA were entered. |
| Device install / launch | Unverified | No device install or launch was performed. |

IPA SHA-256: `f4b164a9645c98d205d6695328ff5ebe45730e840d30e6483ebc2ebabf867af5`.
The IPA's embedded catalog revision and counts match the reused snapshot manifest.
