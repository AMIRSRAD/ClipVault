#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clipboard;
mod commands;
mod crypto;
mod models;
mod ocr;
mod privacy;
mod storage;

use std::sync::Arc;
use std::sync::Mutex;

use clipboard::ClipboardWatcher;
use chrono::{DateTime, Utc};
use storage::Storage;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

pub struct AppState {
    storage: Arc<Storage>,
    pause_until: Arc<Mutex<Option<DateTime<Utc>>>>,
    paste_target: Arc<Mutex<Option<isize>>>,
}

impl AppState {
    fn new(storage: Storage) -> Self {
        Self {
            storage: Arc::new(storage),
            pause_until: Arc::new(Mutex::new(None)),
            paste_target: Arc::new(Mutex::new(None)),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_palette(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::search_items,
            commands::get_item,
            commands::paste_item,
            commands::delete_item,
            commands::pin_item,
            commands::set_tags,
            commands::create_note,
            commands::update_note,
            commands::run_ocr,
            commands::get_settings,
            commands::update_settings,
            commands::pause_capture,
            commands::export_backup,
            commands::import_backup,
            commands::open_external,
            commands::close_palette,
            commands::open_main_window,
            commands::start_palette_drag
        ])
        .setup(|app| {
            let storage = Storage::open()?;
            let state = AppState::new(storage);
            let watcher = ClipboardWatcher::new(state.storage.clone(), state.pause_until.clone(), app.handle().clone());
            app.manage(state);

            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyV);
            app.global_shortcut().register(shortcut)?;

            std::thread::spawn(move || {
                watcher.run();
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run ClipVault");
}

fn main() {
    run();
}

fn show_palette(app: &AppHandle) {
    remember_paste_target(app);

    if let Some(window) = app.get_webview_window("palette") {
        let _ = window.center();
        let _ = window.unminimize();
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("palette-opened", ());
    }
}

fn remember_paste_target(app: &AppHandle) {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return;
    }

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut target) = state.paste_target.lock() {
            *target = Some(hwnd.0 as isize);
        }
    }
}
