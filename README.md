# ClipVault

ClipVault is a modern lightweight Windows clipboard manager with encrypted local history, saved note snippets, OCR, smart preview actions, and a fast Windows-style quick-paste popup.

It captures text and images, gives you a fast `Ctrl+Shift+V` quick paste popup, lets you save reusable notes/snippets, and keeps all content local.

## Screenshots

![ClipVault main window with example clipboard items](docs/assets/main-window.png)

![ClipVault quick paste popup with example items](docs/assets/quick-paste-popup.png)

## Features

- Text and image clipboard history.
- Searchable timeline with source metadata, tags, pins, and SQLite FTS indexing.
- Windows-style quick paste popup with compact dark UI, bottom-center placement, keyboard navigation, fuzzy search, right-click paste options, and grouped clipboard/notes results.
- Default global shortcut: `Ctrl+Shift+V`.
- System tray menu for opening ClipVault, opening quick paste, pausing/resuming capture, opening Settings, and quitting.
- Window behavior settings for close-to-tray, minimize-to-tray, start minimized, and launch on Windows startup.
- Polished Windows window behavior with no console window, tray-first close/minimize support, and stable reopen behavior.
- Dedicated Info tab for creator, website, and license ownership details.
- Notes as saved snippets, stored in the same encrypted item system as clipboard entries.
- Saved snippet collections backed by tags: work, code, emails, prompts, and personal.
- Favorite note templates: meeting note, todo, code snippet, prompt, and email reply.
- On-demand local OCR for copied screenshots and image clips using Windows native OCR APIs.
- Smart preview actions for detected content:
  - open URL
  - copy domain
  - format JSON
  - beautify code
  - extract emails
  - open Windows file path
- Paste transformations for text: plain, trim, no line breaks, upper/lower/title case, JSON prettify, and JSON minify.
- Privacy controls for capture pause, excluded apps/window titles, sensitive-value suppression, and retention.
- Clipboard restore after quick paste for text and images when the prior clipboard content can be read.
- Encrypted import/export for settings, notes, and pinned clips.
- Custom app icon for the title bar, taskbar, tray, installer, and in-app branding.

## Tech Stack

- Tauri 2
- React 18
- TypeScript
- Vite
- Rust
- SQLite with SQLCipher
- Windows DPAPI for protecting local encryption material and backup payloads
- Windows clipboard, global shortcut, paste simulation, and OCR integrations

## Creator And License

- Creator: Amirsalar Saberi rad
- Website: [amirsrad.ir](https://amirsrad.ir)
- License: Copyright Amirsalar Saberi rad. All rights reserved.

The repository includes a root `LICENSE` file with the same all-rights-reserved ownership notice.

## Requirements

- Windows 10/11.
- Node.js 20+.
- pnpm 10.16.1 (Corepack reads the pinned version from `package.json`).
- Rust and Cargo through rustup.
- Microsoft C++ Build Tools.
- Microsoft Edge WebView2 runtime.
- Strawberry Perl, used by the vendored OpenSSL build for SQLCipher.

## Install

```powershell
corepack enable
pnpm install --frozen-lockfile
```

For end users, download and run the `*-setup.exe` installer from the [GitHub Releases](https://github.com/AMIRSRAD/ClipVault/releases) page. The NSIS installer installs for the current Windows user and creates a Start Menu shortcut. ClipVault does not enable startup launch during installation. To enable it later, open **Settings → Launch on Windows startup**; this adds a per-user Run entry. Turning the option off or uninstalling ClipVault removes that entry. Windows may show its normal publisher reputation prompt for an unsigned installer.

## Development

Run the frontend only:

```powershell
pnpm dev
```

Run the full Tauri desktop app:

```powershell
pnpm tauri dev
```

## Build

```powershell
pnpm build
pnpm tauri build
```

Release outputs are generated under:

- `src-tauri/target/release/clipvault.exe`
- `src-tauri/target/release/bundle/nsis/ClipVault_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/ClipVault_0.1.0_x64_en-US.msi`

The app icon is generated from:

- `src-tauri/icons/icon-source.png`
- `src-tauri/icons/icon.ico`
- `src/assets/clipvault-icon.png`

## Verification

Use these before cutting a Windows release:

```powershell
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm tauri build
```

If Cargo or native dependencies are not on PATH in PowerShell, prepend the local toolchain paths first:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;C:\Strawberry\perl\site\bin;$env:Path"
```

## Roadmap

- Clipboard restore after paste for more content formats.
- Tray menu polish.
- Export/import UX refinements and cross-machine backup options.
- Optional Tesseract OCR fallback.
- End-to-end encrypted PC/Android sync, keeping Android clipboard platform limits in mind.
