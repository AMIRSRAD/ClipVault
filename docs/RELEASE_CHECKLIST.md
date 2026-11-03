# Release Checklist

Use this checklist before pushing or cutting a local Windows build.

## Clean Working Tree

- Confirm only source, config, docs, icons, and lockfiles are staged.
- Confirm README screenshots under `docs/assets/` contain only sample data and render correctly on GitHub.
- Confirm the root `LICENSE` file is present when license or ownership text changes.
- Do not stage:
  - `node_modules/`
  - `dist/`
  - `src-tauri/target/`
  - generated installers
  - local logs
  - local databases, keys, or backup files

## Verify Toolchain

```powershell
node --version
pnpm --version
cargo --version
```

If Cargo or native build tools are missing from PATH:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;C:\Strawberry\perl\site\bin;$env:Path"
```

## Build Checks

```powershell
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm tauri build
```

## Manual Smoke Test

- Launch `src-tauri/target/release/clipvault.exe`.
- Copy text and confirm it appears in All/Text.
- Copy an image or screenshot and confirm it appears in All/Images.
- Press `Ctrl+Shift+V` and confirm the popup opens.
- Search in the popup with a typo and confirm fuzzy matches appear.
- Paste a text item into Notepad or another text field.
- Create a note from each template.
- Confirm notes appear in the Notes view and the popup Saved notes group.
- Run OCR on an image item and confirm extracted text is saved without extra status boilerplate.
- Try smart actions on URL, JSON, email, code, and file path text.
- Export a backup from Settings.
- Import the backup and confirm the app reports imported items.
- Open the About page and confirm creator, website, and license text are correct.
- Click the website link and confirm it opens `https://amirsrad.ir`.
- Pause and resume capture from the sidebar and confirm the banner appears and clears.
- Open the quick paste popup in light and dark mode; confirm rounded corners, search focus, tab switching with `Tab`, hover actions, and pinning with `Ctrl+P`.
- Open Settings -> Updates and use **Check now**.
- Select several items (checklist button, Shift-click range, `Ctrl+A`), then pin, copy, and delete them; confirm the delete dialog appears and Esc cancels it.
- Use **...** -> **Clear history** with both keep options ticked and confirm pinned clips and notes remain; repeat with both unticked.
- Enable launch on startup, sign out and back in, and confirm ClipVault starts hidden in the tray.

## Idle Performance Check

Run the installed build hidden in the tray (start it with `--minimized`), wait a minute, and confirm:

- ClipVault and its `msedgewebview2.exe` children use about 0% CPU and 0 context switches per second (for example with `Win32_PerfRawData_PerfProc_Process` sampled twice 60 seconds apart).
- Total working set settles under about 100 MB.
- `Ctrl+Shift+V` still shows the popup immediately and Esc hides it.

## Release Outputs

Tauri writes Windows release outputs to:

- `src-tauri/target/release/clipvault.exe`
- `src-tauri/target/release/bundle/nsis/ClipVault_<version>_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/ClipVault_<version>_x64_en-US.msi`

These files are build artifacts and should not be committed.

## Cutting a Release

Updates are signed. The signing key and its password live outside the repository (by default in `%USERPROFILE%\.tauri\clipvault.key` and `clipvault.pass`). **Back both up**: if they are lost, installed copies of ClipVault can never be updated again. The matching public key is in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run the build checks and smoke test above.
3. Build with the signing key available (this also writes the `.sig` files):

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\clipvault.key" -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content "$env:USERPROFILE\.tauri\clipvault.pass" -Raw
   pnpm tauri build
   ```

4. Generate the update manifest (uses `tauri.conf.json` for the version, and an optional notes file):

   ```powershell
   node scripts/make-update-manifest.mjs release-notes.md
   ```

5. Commit, then tag and push: `git tag -a v<version> -m "ClipVault <version>"` and `git push origin main v<version>`.
6. Publish the GitHub release. `latest.json` **must** be attached, because installed apps read it from `releases/latest/download/latest.json`:

   ```powershell
   gh release create v<version> --title "ClipVault <version>" --notes-file release-notes.md `
     "src-tauri/target/release/bundle/nsis/ClipVault_<version>_x64-setup.exe" `
     "src-tauri/target/release/bundle/nsis/ClipVault_<version>_x64-setup.exe.sig" `
     "src-tauri/target/release/bundle/nsis/latest.json" `
     "src-tauri/target/release/bundle/msi/ClipVault_<version>_x64_en-US.msi"
   ```

7. Test the update path: install the previous version, open **Settings -> Updates -> Check now**, and confirm it finds, downloads, and installs the new one. Do not mark the release as a pre-release or draft, or `latest` will not point at it.

## Windows Installer Notes

- The NSIS setup installs for the current user (no admin prompt) under `%LOCALAPPDATA%\ClipVault`, shows the license, and bundles the WebView2 bootstrapper.
- It creates a Start Menu shortcut; the finish page offers a desktop shortcut and launching the app. Silent (`/S`) installs create both shortcuts.
- A first-time interactive install asks whether to launch at sign-in. Choosing yes writes the per-user `Run` value `"<install dir>\clipvault.exe" --minimized`. Upgrades keep an existing choice and re-point it at the new install.
- The app treats that `Run` value as the source of truth for **Settings → Launch on Windows startup** and refreshes its path on every launch.
- The uninstaller removes the shortcuts, the `Run` value, and the Apps & features entry. Ticking "Delete the application data" also removes `%LOCALAPPDATA%\ClipVault\ClipVault` (encrypted database and key).
- Installer artwork is in `src-tauri/windows/` (`installer-header.bmp`, `installer-sidebar.bmp`); hooks are in `nsis-hooks.nsh`.
- Test install, upgrade, startup enable/disable, and uninstall on a clean Windows account before publishing a release.
- The installer is unsigned unless a code-signing certificate is configured; Windows SmartScreen may display a reputation warning.
