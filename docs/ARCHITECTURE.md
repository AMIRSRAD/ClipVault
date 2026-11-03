# ClipVault Architecture

## Overview

ClipVault is a Windows-first Tauri desktop app. Rust owns OS integration and persistence. React owns the main window and quick paste popup UI.

## Frontend

- `src/App.tsx` picks the window mode (main or quick paste) and owns the main shell state: current view, search, selection, capture pause, and toasts.
- `src/components/Sidebar.tsx` is the navigation pane with the quick paste shortcut and capture status/pause toggle.
- `src/components/ClipList.tsx` is the searchable, day-grouped list pane with keyboard navigation, filter chips, and the new-note split button.
- `src/components/DetailPanel.tsx` is the preview pane: command bar, preview/note editor, OCR, suggested actions, paste-as transforms, and tag editor.
- `src/components/SettingsPanel.tsx` contains the Settings and About pages.
- `src/components/QuickPaste.tsx` is the quick paste popup, used both as its own window and as an overlay in the main window.
- `src/lib/clip.ts` holds pure helpers: formatting, content detection, paste transforms, fuzzy ranking, and day grouping.
- `src/api.ts` wraps Tauri commands and browser-demo fallbacks.
- `src/types.ts` defines shared frontend models.
- `src/styles.css` contains the Fluent-inspired design tokens (light and dark, following the system theme) and styles for the main app and popup.
- `src/mockData.ts` supports opening the React frontend without Tauri.

Main views:

- History: All clips, Pinned, Text, Images.
- Library: Notes, Tags.
- Footer: Settings, About.

The About view displays creator, website, and license ownership details:

- Creator: Amirsalar Saberi rad.
- Website: `https://amirsrad.ir`.
- License: all rights reserved by Amirsalar Saberi rad.

The quick paste popup groups saved notes separately from clipboard captures and uses local fuzzy reranking over a recent item pool for typo-tolerant search.

## Native Backend

- `src-tauri/src/main.rs` configures Tauri, global shortcut handling, app state, and the clipboard watcher thread.
- `src-tauri/src/commands.rs` exposes native commands to the frontend.
- `src-tauri/src/clipboard.rs` handles Windows clipboard capture and paste simulation. Capture runs on one thread that owns a message-only window registered with `AddClipboardFormatListener`; it blocks in `GetMessageW` until `WM_CLIPBOARDUPDATE`, waits 120 ms for the source app to finish writing, then captures. If the listener can't be registered it falls back to a 650 ms sequence-number poll. Changes made while capture is paused are recorded and skipped, so they are not captured on resume.
- `src-tauri/src/webview_memory.rs` switches a window's WebView2 to its low memory target (`ICoreWebView2_19::SetMemoryUsageTargetLevel`) whenever the window is hidden and back to normal right before it is shown. Every show/hide path in `main.rs` and `window_anim.rs` calls it.
- `src-tauri/src/storage.rs` owns SQLite schema, migrations, encrypted storage, search, tags, notes, import/export, and retention pruning.
- `src-tauri/src/privacy.rs` normalizes content, hashes entries, and suppresses likely sensitive values.
- `src-tauri/src/ocr.rs` provides on-demand Windows OCR.
- `src-tauri/src/crypto.rs` manages SQLCipher key material and DPAPI protection.
- `src-tauri/src/main.rs` also owns tray menu setup, single-instance relaunch behavior, and close/minimize-to-tray window handling.

## Storage

Clipboard captures and notes share the `clipboard_items` table.

Item kinds:

- `text`
- `image`
- `note`

Notes are manual saved snippets. They do not expire during normal retention pruning. Clipboard captures expire according to retention settings unless pinned.

Saved snippet collections are represented as ordinary tags. The frontend treats `work`, `code`, `emails`, `prompts`, and `personal` as first-class collection filters without adding a separate table.

Search indexing uses SQLite FTS over text, OCR text, tags, source app, and source title.

## Encryption

The local SQLite database is protected with SQLCipher. The database key is generated locally and protected with Windows DPAPI for the current user.

Backup export/import uses a `clipvault-dpapi-v1:` text payload. It includes settings, notes, and pinned clips, then protects the serialized payload with DPAPI. These backups are intended for the same Windows user profile unless the format is later extended.

## Ownership And Licensing

ClipVault is proprietary software owned by Amirsalar Saberi rad. The root `LICENSE` file is the source of truth for repository licensing and currently states that all rights are reserved.

## OS Integration

Current Windows integration includes:

- Clipboard sequence watching.
- Text/image capture.
- Global shortcut: `Ctrl+Shift+V`.
- Popup window display and native dragging.
- Paste simulation through temporary clipboard replacement and `Ctrl+V`, followed by best-effort restoration of the previous text or image clipboard content.
- Windows OCR for copied images/screenshots.
- Opening URLs and file paths through ShellExecute.
- System tray menu for Open, Quick Paste, Settings, Pause capture, Resume capture, and Quit.
- Windows startup registration through the current user's Run registry key.

## Push Notes

Build artifacts, dependency folders, logs, and local app data are intentionally ignored. Commit source, config, docs, lockfiles, icons, and capability files.

## Idle Performance

Measured on Windows 11 with the app hidden in the tray (history of a few hundred items):

| | 1.0.0 | 1.0.1 |
| --- | --- | --- |
| Wakeups per second (all processes) | ~2 | 0 |
| CPU | ~0% | ~0.05% |
| Total working set (ClipVault + WebView2) | ~545 MB | ~55-95 MB |
| Quick paste popup appears | instant | 3-14 ms |

Rules to keep it that way: no timers or polling in the React app or Rust backend, no animations running while hidden, and any new show/hide path must go through the helpers that call `webview_memory::set_background`.
