use tauri::WebviewWindow;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{AnimateWindow, AW_ACTIVATE, AW_BLEND, AW_HIDE};

pub fn show(window: &WebviewWindow, duration_ms: u32) {
    if let Ok(hwnd) = window.hwnd() {
        let hwnd = HWND(hwnd.0 as _);
        if unsafe { AnimateWindow(hwnd, duration_ms, AW_BLEND | AW_ACTIVATE) }.is_ok() {
            return;
        }
    }

    let _ = window.show();
}

pub fn hide(window: &WebviewWindow, duration_ms: u32) {
    if let Ok(hwnd) = window.hwnd() {
        let hwnd = HWND(hwnd.0 as _);
        if unsafe { AnimateWindow(hwnd, duration_ms, AW_BLEND | AW_HIDE) }.is_ok() {
            return;
        }
    }

    let _ = window.hide();
}
