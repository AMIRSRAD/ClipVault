# ClipVault Architecture

## Overview

ClipVault is a Windows-first Tauri desktop app. Rust owns OS integration and persistence. React owns the main window and quick paste popup UI.

## Frontend

- `src/App.tsx` contains the main shell, settings view, detail panel, notes workflow, and quick paste popup.
- `src/api.ts` wraps Tauri commands and browser-demo fallbacks.
- `src/types.ts` defines shared frontend models.
- `src/styles.css` contains the dark Windows-inspired UI system for both the main app and popup.
- `src/mockData.ts` supports opening the React frontend without Tauri.

Main views:

- Clipboard categories: All, Pinned, Text, Images.
- Saved content: Notes.
- Utility: Tags, Settings.

The quick paste popup groups saved notes separately from clipboard captures and uses local fuzzy reranking over a recent item pool for typo-tolerant search.

## Native Backend

- `src-tauri/src/main.rs` configures Tauri, global shortcut handling, app state, and the clipboard watcher thread.
- `src-tauri/src/commands.rs` exposes native commands to the frontend.
- `src-tauri/src/clipboard.rs` handles Windows clipboard capture and paste simulation.
- `src-tauri/src/storage.rs` owns SQLite schema, migrations, encrypted storage, search, tags, notes, import/export, and retention pruning.
- `src-tauri/src/privacy.rs` normalizes content, hashes entries, and suppresses likely sensitive values.
- `src-tauri/src/ocr.rs` provides on-demand Windows OCR.
- `src-tauri/src/crypto.rs` manages SQLCipher key material and DPAPI protection.

## Storage

Clipboard captures and notes share the `clipboard_items` table.

Item kinds:

- `text`
- `image`
- `note`

Notes are manual saved snippets. They do not expire during normal retention pruning. Clipboard captures expire according to retention settings unless pinned.

Search indexing uses SQLite FTS over text, OCR text, tags, source app, and source title.

## Encryption

The local SQLite database is protected with SQLCipher. The database key is generated locally and protected with Windows DPAPI for the current user.

Backup export/import uses a `clipvault-dpapi-v1:` text payload. It includes settings, notes, and pinned clips, then protects the serialized payload with DPAPI. These backups are intended for the same Windows user profile unless the format is later extended.

## OS Integration

Current Windows integration includes:

- Clipboard sequence watching.
- Text/image capture.
- Global shortcut: `Ctrl+Shift+V`.
- Popup window display and native dragging.
- Paste simulation through temporary clipboard replacement and `Ctrl+V`.
- Windows OCR for copied images/screenshots.
- Opening URLs and file paths through ShellExecute.

## Push Notes

Build artifacts, dependency folders, logs, and local app data are intentionally ignored. Commit source, config, docs, lockfiles, icons, and capability files.
