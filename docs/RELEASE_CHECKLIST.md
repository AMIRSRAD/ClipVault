# Release Checklist

Use this checklist before pushing or cutting a local Windows build.

## Clean Working Tree

- Confirm only source, config, docs, icons, and lockfiles are staged.
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
npm --version
cargo --version
```

If Cargo or native build tools are missing from PATH:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;C:\Strawberry\perl\site\bin;$env:Path"
```

## Build Checks

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run tauri -- build
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

## Release Outputs

Tauri writes Windows release outputs to:

- `src-tauri/target/release/clipvault.exe`
- `src-tauri/target/release/bundle/nsis/ClipVault_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/ClipVault_0.1.0_x64_en-US.msi`

These files are build artifacts and should not be committed.
