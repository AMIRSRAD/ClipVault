# Changelog

## 1.4.0 - 2026-11-18

### Added
- Appearance setting (Settings -> Appearance): choose System, Light, or Dark. The choice applies to the main window and the quick paste popup and is remembered.

### Changed
- ClipVault is now free to use. The new `LICENSE` lets anyone download, install, and use the app (personally or commercially) and share the unmodified official installer; the source stays published for review and personal builds, and distributing modified versions or reselling needs written permission. The installer's license page, About page, and package metadata were updated to match.
- README: added light-mode and multi-select screenshots, refreshed the Settings screenshot, and updated the license notes.
- Browser demo build: `?theme=` and `?select=` options for documentation screenshots.

## 1.3.0 - 2026-11-18

### Added
- Multi-paste in the quick paste popup. Select several text items and paste them together in the order you picked them. Hover a row to reveal its checkbox, or press `Space`, `Shift`+arrows, or `Ctrl`/`Shift`-click. The footer shows how many are selected, a **Join** menu (new line, blank line, space, comma, nothing; remembered), **Clear**, and **Paste N**. `Enter` pastes the selection, `Ctrl+C` copies it, and `Esc` clears it.
- `?view=` option for the browser demo build, used for documentation screenshots.

### Changed
- The README is reorganised into three parts: a plain-language guide with screenshots for people who just want to use ClipVault, a technical explanation, and getting started / building from source.
- New screenshots (main window, Notes, Settings, and the popup in dark, light, and multi-select) using everyday sample data.
- The popup's footer hints now show `Space Select`.

## 1.2.0 - 2026-11-03

### Added
- Select multiple items: use the checklist button, or Ctrl/Shift-click. Shift-click selects a range and `Ctrl+A` selects everything shown. A bulk panel offers Copy text, Pin/Unpin, and Delete for the whole selection, and deleting several items asks for confirmation.
- Clear history: from the list's **...** menu or **Settings -> Backup & data**, with options to keep pinned clips and notes. Cleared clips are also compacted out of the database file.

### Changed
- Bulk delete, pin, and clear run as single transactions that also clean up tags and the search index.

## 1.1.0 - 2026-11-03

### Added
- Quiet automatic updates. ClipVault checks for a signed release once a day, downloads it in the background, and shows a small dismissible "Update ready" card in the sidebar. Nothing is installed until you click Restart. Settings -> Updates and About have a "Check now" button, and the daily check can be turned off.
- Native rounded corners, border, and shadow for the quick paste window on Windows 11.

### Changed
- Redesigned quick paste popup: search first, light section tabs, a flat list with image thumbnails, pinned items on top, actions on hover, and a single-line footer.
- Cleaner preview pane in the main window: a Paste button with a "Paste as" menu, one muted line of metadata, quiet suggested actions, and inline tags.
- Update signatures are verified with a public key built into the app.

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
