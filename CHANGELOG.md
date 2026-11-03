# Changelog

## 1.0.1 — 2026-11-03

Idle performance release.

### Changed
- The clipboard is now watched with the Windows clipboard listener instead of a 650 ms poll, so the app has zero wakeups while idle and captures copies about half a second sooner.
- Hidden windows run WebView2 in its low-memory mode, cutting memory in the tray from about 545 MB to roughly 55-95 MB. The popup still opens in a few milliseconds.

### Fixed
- Anything copied while capture was paused was saved the moment capture resumed. It is now skipped.

## 1.0.0 — 2026-11-03

First stable release.

### Added
- Windows 11 style interface that follows the system light/dark theme, with a redesigned sidebar, day-grouped clip list, preview pane, Settings, and About pages.
- Redesigned quick paste popup with section tabs, image previews, hover actions, and a shortcut footer.
- Main window shortcuts: `Ctrl+F` search, `Ctrl+N` new note, `Enter` paste, `P` pin, `Delete` remove.
- Resume capture from the app (previously only from the tray); the sidebar shows capture status and the real retention setting.
- Branded installer with a license page, desktop shortcut option, optional start-at-sign-in prompt, bundled WebView2 bootstrapper, and full uninstall including app data on request.
- The startup entry launches ClipVault hidden in the tray and stays in sync with Settings.
- Sensitive-value detection for JSON/assignment passwords, prefixed API tokens, JWTs, bearer tokens, and card numbers. Content that password managers mark as excluded from clipboard history is never saved.
- GitHub Actions CI for build, rustfmt, clippy, and tests.

### Changed
- New database keys come from the OS random number generator. Existing keys keep working.
- The quick paste window has its own minimal Tauri capability.
- The frontend is split into components under `src/components/`.
