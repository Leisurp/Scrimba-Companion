# Releasing

Releases are GitHub Releases with three files whose names never change, so the "latest" download
links in the README always work:

| File | What |
|---|---|
| `ScrimbaCompanion.apk` | Android app, signed with the project's release key |
| `ScrimbaCompanion-unsigned.ipa` | iPhone app, unsigned (users re-sign it with AltStore, SideStore or Sideloadly) |
| `SHA256SUMS.txt` | Checksums of both |

## One-time setup

The release workflow refuses to publish unless the Android release key is configured. Add these
repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The keystore file, base64-encoded (`base64 -w0 release.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password (same as the keystore password for PKCS12 keystores) |

Keep the keystore and its password backed up somewhere safe, outside the repository. If they're
lost, no future APK can update existing installs; if they leak, anyone can publish fake updates.

To create a keystore:

```bash
keytool -genkeypair -keystore release.jks -storetype PKCS12 -alias scrimba-companion -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Scrimba Companion"
```

## Publishing a version

1. Set `version` in `app.json` (for example `1.1.0`) and commit. Android's `versionCode` and iOS's
   `buildNumber` are derived from it during the build (`scripts/set-build-numbers.mjs`), so updates
   install over older versions.
2. Tag and push:

   ```bash
   git tag v1.1.0
   ```

   ```bash
   git push origin v1.1.0
   ```

3. The **Release** workflow checks the tag against `app.json`, runs the tests, builds and signs
   the APK, builds the `.ipa` and publishes the release with short install notes.

To rebuild an existing tag, run the **Release** workflow by hand (Actions → Release → Run
workflow) and enter the tag.
