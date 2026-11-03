//! Keeps ClipVault light while it sits in the tray.
//!
//! Both windows stay alive so the quick paste popup opens instantly. While a window is hidden,
//! WebView2 is asked to run in its low memory mode (it trims its working set and drops caches);
//! the normal level is restored right before the window is shown again.

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use windows_core::Interface;

/// Switches a window's web view between background (`true`) and normal (`false`) memory use.
pub fn set_background(window: &WebviewWindow, background: bool) {
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(core) = core.cast::<ICoreWebView2_19>() else {
            return;
        };
        let level = if background {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        let _ = core.SetMemoryUsageTargetLevel(level);
    });
}
