use chrono::{Duration, Utc};
use tauri::{AppHandle, Manager, State};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, HTCAPTION, WM_NCLBUTTONDOWN};
use winreg::{enums::*, RegKey};

use crate::{
    clipboard,
    models::{AppSettings, ClipboardFilters, ClipboardItem, OcrResponse, SearchResponse},
    ocr, AppState,
};

#[tauri::command]
pub fn search_items(
    state: State<'_, AppState>,
    query: String,
    filters: ClipboardFilters,
    limit: i64,
    offset: i64,
) -> Result<SearchResponse, String> {
    state
        .storage
        .search(query, filters, limit.clamp(1, 200), offset.max(0))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_item(state: State<'_, AppState>, id: String) -> Result<Option<ClipboardItem>, String> {
    state.storage.get(&id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn paste_item(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let item = state
        .storage
        .get(&id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "clipboard item not found".to_string())?;

    let paste_target = state
        .paste_target
        .lock()
        .map_err(|_| "paste target lock poisoned".to_string())?
        .to_owned();

    pause_briefly(&state)?;
    clipboard::paste_item(&item, paste_target).map_err(|error| error.to_string())?;
    state
        .storage
        .mark_used(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn paste_text(state: State<'_, AppState>, text: String) -> Result<(), String> {
    let paste_target = state
        .paste_target
        .lock()
        .map_err(|_| "paste target lock poisoned".to_string())?
        .to_owned();

    pause_briefly(&state)?;
    clipboard::paste_text(&text, paste_target).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_item(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.storage.delete(&id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pin_item(state: State<'_, AppState>, id: String, pinned: bool) -> Result<(), String> {
    state
        .storage
        .pin(&id, pinned)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_tags(state: State<'_, AppState>, id: String, tags: Vec<String>) -> Result<(), String> {
    state
        .storage
        .set_tags(&id, tags)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_note(
    state: State<'_, AppState>,
    text: String,
    tags: Vec<String>,
) -> Result<ClipboardItem, String> {
    state
        .storage
        .create_note(text, tags)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_note(
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<ClipboardItem, String> {
    state
        .storage
        .update_note(&id, text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn run_ocr(state: State<'_, AppState>, id: String) -> Result<OcrResponse, String> {
    let item = state
        .storage
        .get(&id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "clipboard item not found".to_string())?;
    let image_png = if item.kind == crate::models::ClipboardKind::Image {
        state
            .storage
            .image_blob(&id)
            .map_err(|error| error.to_string())?
    } else {
        None
    };
    let response = ocr::run_ocr(&item, image_png.as_deref());
    if response.status == "ready" {
        if let Some(text) = &response.text {
            state
                .storage
                .set_ocr_text(&id, text)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(response)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.storage.settings().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    set_launch_on_startup(settings.launch_on_startup).map_err(|error| error.to_string())?;
    state
        .storage
        .update_settings(&settings)
        .map_err(|error| error.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub fn pause_capture(
    state: State<'_, AppState>,
    duration_seconds: Option<i64>,
) -> Result<(), String> {
    let mut pause_until = state
        .pause_until
        .lock()
        .map_err(|_| "pause lock poisoned".to_string())?;
    *pause_until = duration_seconds
        .map(|seconds| Utc::now() + Duration::seconds(seconds.max(1)))
        .or(Some(Utc::now() + Duration::days(3650)));
    Ok(())
}

#[tauri::command]
pub fn export_backup(state: State<'_, AppState>) -> Result<String, String> {
    state
        .storage
        .export_backup()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn import_backup(state: State<'_, AppState>, backup: String) -> Result<usize, String> {
    state
        .storage
        .import_backup(&backup)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_external(target: String) -> Result<(), String> {
    let operation = wide_null("open");
    let target = wide_null(&target);
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(operation.as_ptr()),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        return Err("Windows could not open this target.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn close_palette(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("palette") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    window
        .set_always_on_top(false)
        .map_err(|error| error.to_string())?;

    if let Some(palette) = app.get_webview_window("palette") {
        palette.hide().map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn start_palette_drag(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("palette")
        .ok_or_else(|| "palette window not found".to_string())?;
    let tauri_hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let hwnd = HWND(tauri_hwnd.0 as _);

    unsafe {
        ReleaseCapture().map_err(|error| error.to_string())?;
        let _ = SendMessageW(
            hwnd,
            WM_NCLBUTTONDOWN,
            WPARAM(HTCAPTION as usize),
            LPARAM(0),
        );
    }

    Ok(())
}

fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn pause_briefly(state: &State<'_, AppState>) -> Result<(), String> {
    let mut pause_until = state
        .pause_until
        .lock()
        .map_err(|_| "pause lock poisoned".to_string())?;
    *pause_until = Some(Utc::now() + Duration::seconds(2));
    Ok(())
}

fn set_launch_on_startup(enabled: bool) -> anyhow::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")?;

    if enabled {
        let exe = std::env::current_exe()?;
        run_key.set_value("ClipVault", &format!("\"{}\"", exe.display()))?;
    } else {
        let _ = run_key.delete_value("ClipVault");
    }

    Ok(())
}
