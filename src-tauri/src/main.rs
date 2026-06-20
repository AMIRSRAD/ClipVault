#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clipboard;
mod commands;
mod crypto;
mod hotkey;
mod models;
mod ocr;
mod privacy;
mod storage;
mod window_anim;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use clipboard::ClipboardWatcher;
use storage::Storage;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, Window, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

pub struct AppState {
    storage: Arc<Storage>,
    pause_until: Arc<Mutex<Option<DateTime<Utc>>>>,
    paste_target: Arc<Mutex<Option<isize>>>,
    palette_drag_until: Arc<Mutex<Option<DateTime<Utc>>>>,
    main_show_grace_until: Arc<Mutex<Option<DateTime<Utc>>>>,
    palette_focus_grace_until: Arc<Mutex<Option<DateTime<Utc>>>>,
    palette_generation: Arc<AtomicU64>,
}

impl AppState {
    fn new(storage: Storage) -> Self {
        Self {
            storage: Arc::new(storage),
            pause_until: Arc::new(Mutex::new(None)),
            paste_target: Arc::new(Mutex::new(None)),
            palette_drag_until: Arc::new(Mutex::new(None)),
            main_show_grace_until: Arc::new(Mutex::new(None)),
            palette_focus_grace_until: Arc::new(Mutex::new(None)),
            palette_generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
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
            commands::paste_text,
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
            let watcher = ClipboardWatcher::new(
                state.storage.clone(),
                state.pause_until.clone(),
                app.handle().clone(),
            );
            app.manage(state);
            setup_tray(app.handle())?;

            let settings = app
                .state::<AppState>()
                .storage
                .settings()
                .unwrap_or_default();
            let shortcut = hotkey::parse_hotkey(&settings.hotkey)
                .or_else(|_| hotkey::parse_hotkey("Ctrl+Shift+V"))
                .map_err(|error| tauri::Error::Anyhow(anyhow::anyhow!(error)))?;
            app.global_shortcut().register(shortcut)?;

            if settings.start_minimized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            std::thread::spawn(move || {
                watcher.run();
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if window
                        .app_handle()
                        .state::<AppState>()
                        .storage
                        .settings()
                        .map(|settings| settings.close_to_tray)
                        .unwrap_or(true)
                    {
                        api.prevent_close();
                        clear_main_show_grace(window.app_handle());
                        let _ = window.hide();
                    }
                }

                if matches!(event, WindowEvent::Resized(_))
                    && window
                        .app_handle()
                        .state::<AppState>()
                        .storage
                        .settings()
                        .map(|settings| settings.minimize_to_tray)
                        .unwrap_or(true)
                    && !main_show_grace_active(window.app_handle())
                    && window.is_minimized().unwrap_or(false)
                {
                    hide_event_window(window, 120);
                }
                return;
            }

            if window.label() == "palette"
                && matches!(event, WindowEvent::Focused(false))
                && !palette_drag_grace_active(window.app_handle())
                && !palette_focus_grace_active(window.app_handle())
            {
                hide_event_window(window, 90);
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run ClipVault");
}

fn main() {
    run();
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open ClipVault", true, None::<&str>)?;
    let quick_paste = MenuItem::with_id(app, "quick_paste", "Quick Paste", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause capture", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Resume capture", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &quick_paste,
            &settings,
            &separator_one,
            &pause,
            &resume,
            &separator_two,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("ClipVault")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quick_paste" => show_palette(app),
            "settings" => {
                show_main_window(app);
                let _ = app.emit("open-settings", ());
            }
            "pause" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut pause_until) = state.pause_until.lock() {
                        *pause_until = Some(Utc::now() + chrono::Duration::days(3650));
                    }
                }
            }
            "resume" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut pause_until) = state.pause_until.lock() {
                        *pause_until = None;
                    }
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

fn show_palette(app: &AppHandle) {
    remember_paste_target(app);
    let generation = next_palette_generation(app);
    mark_palette_focus_grace(app);

    if let Some(window) = app.get_webview_window("palette") {
        show_palette_window(&window);
        let _ = window.emit("palette-opened", ());
    }

    retry_show_palette(app, generation);
}

fn position_palette_bottom_center(window: &WebviewWindow) {
    let Ok(window_size) = window.outer_size() else {
        let _ = window.center();
        return;
    };

    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        let _ = window.center();
        return;
    };

    let work_area = monitor.work_area();
    let horizontal_space = work_area.size.width as i32 - window_size.width as i32;
    let vertical_space = work_area.size.height as i32 - window_size.height as i32;
    let bottom_gap = 56;
    let x = work_area.position.x + (horizontal_space / 2).max(0);
    let y = work_area.position.y + (vertical_space - bottom_gap).max(0);

    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        show_main_window_handle(app, &window);
    }

    if app.get_webview_window("palette").is_some() {
        hide_palette_window(app, 90);
    }
}

pub(crate) fn show_main_window_handle(app: &AppHandle, window: &WebviewWindow) {
    mark_main_show_grace(app);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    let _ = window.set_always_on_top(false);
}

fn retry_show_palette(app: &AppHandle, generation: u64) {
    for delay_ms in [40, 120, 240] {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            if current_palette_generation(&app_handle) != generation {
                return;
            }

            if let Some(window) = app_handle.get_webview_window("palette") {
                show_palette_window(&window);
            }
        });
    }
}

fn show_palette_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    position_palette_bottom_center(window);
    let _ = window.show();
    let _ = window.set_focus();
}

pub(crate) fn hide_palette_window(app: &AppHandle, duration_ms: u32) {
    let hide_generation = next_palette_generation(app);

    if let Some(window) = app.get_webview_window("palette") {
        let _ = window.emit("palette-closing", ());
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(duration_ms as u64));
        if current_palette_generation(&app_handle) != hide_generation {
            return;
        }

        if let Some(window) = app_handle.get_webview_window("palette") {
            let _ = window.hide();
        }
    });
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

fn palette_drag_grace_active(app: &AppHandle) -> bool {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut drag_until) = state.palette_drag_until.lock() {
            if let Some(until) = drag_until.as_ref() {
                if *until > Utc::now() {
                    return true;
                }
            }
            *drag_until = None;
        }
    }

    false
}

pub(crate) fn mark_main_show_grace(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut show_grace_until) = state.main_show_grace_until.lock() {
            *show_grace_until = Some(Utc::now() + chrono::Duration::milliseconds(180));
        }
    }
}

fn clear_main_show_grace(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut show_grace_until) = state.main_show_grace_until.lock() {
            *show_grace_until = None;
        }
    }
}

fn main_show_grace_active(app: &AppHandle) -> bool {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut show_grace_until) = state.main_show_grace_until.lock() {
            if let Some(until) = show_grace_until.as_ref() {
                if *until > Utc::now() {
                    return true;
                }
            }
            *show_grace_until = None;
        }
    }

    false
}

fn mark_palette_focus_grace(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut focus_grace_until) = state.palette_focus_grace_until.lock() {
            *focus_grace_until = Some(Utc::now() + chrono::Duration::milliseconds(240));
        }
    }
}

fn palette_focus_grace_active(app: &AppHandle) -> bool {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut focus_grace_until) = state.palette_focus_grace_until.lock() {
            if let Some(until) = focus_grace_until.as_ref() {
                if *until > Utc::now() {
                    return true;
                }
            }
            *focus_grace_until = None;
        }
    }

    false
}

fn hide_event_window(window: &Window, duration_ms: u32) {
    if window.label() == "palette" {
        hide_palette_window(window.app_handle(), duration_ms);
        return;
    }

    if let Some(webview_window) = window.app_handle().get_webview_window(window.label()) {
        window_anim::hide(&webview_window, duration_ms);
        return;
    }

    let _ = window.hide();
}

pub(crate) fn next_palette_generation(app: &AppHandle) -> u64 {
    app.try_state::<AppState>()
        .map(|state| state.palette_generation.fetch_add(1, Ordering::SeqCst) + 1)
        .unwrap_or(0)
}

pub(crate) fn current_palette_generation(app: &AppHandle) -> u64 {
    app.try_state::<AppState>()
        .map(|state| state.palette_generation.load(Ordering::SeqCst))
        .unwrap_or(0)
}
