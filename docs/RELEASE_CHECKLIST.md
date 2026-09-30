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
- Open the Info tab and confirm creator, website, and license text are correct.
- Click the Info tab website link and confirm it opens `https://amirsrad.ir`.

## Release Outputs

Tauri writes Windows release outputs to:

- `src-tauri/target/release/clipvault.exe`
- `src-tauri/target/release/bundle/nsis/ClipVault_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/ClipVault_0.1.0_x64_en-US.msi`

These files are build artifacts and should not be committed.

## Windows Installer Notes

- The NSIS setup executable installs for the current user and creates a Start Menu shortcut.
- Startup launch is opt-in from Settings and uses the current user's `Run` registry key.
- The NSIS uninstall hook removes ClipVault's `Run` value when uninstalling.
- Test install, upgrade, startup enable/disable, and uninstall on a clean Windows account before publishing a release.
- The installer is unsigned unless a code-signing certificate is configured; Windows SmartScreen may display a reputation warning.
