use std::{
    borrow::Cow,
    ffi::c_void,
    io::Cursor,
    sync::{Arc, Mutex},
    time::Duration as StdDuration,
};

use anyhow::{Context, Result};
use arboard::{Clipboard, ImageData};
use base64::Engine as _;
use chrono::{DateTime, Utc};
use image::{imageops::FilterType, DynamicImage, ImageBuffer, ImageFormat, Rgba};
use tauri::AppHandle;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_CONTROL, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};

use crate::{
    models::{ClipboardItem, ClipboardKind, NewClipboardItem},
    privacy,
    storage::Storage,
};

pub struct ClipboardWatcher {
    storage: Arc<Storage>,
    pause_until: Arc<Mutex<Option<DateTime<Utc>>>>,
    _app: AppHandle,
}

impl ClipboardWatcher {
    pub fn new(
        storage: Arc<Storage>,
        pause_until: Arc<Mutex<Option<DateTime<Utc>>>>,
        app: AppHandle,
    ) -> Self {
        Self {
            storage,
            pause_until,
            _app: app,
        }
    }

    pub fn run(self) {
        let mut last_sequence = unsafe { GetClipboardSequenceNumber() };
        let mut clipboard = Clipboard::new().ok();

        loop {
            std::thread::sleep(StdDuration::from_millis(650));
            if self.is_paused() {
                continue;
            }

            let sequence = unsafe { GetClipboardSequenceNumber() };
            if sequence == last_sequence {
                continue;
            }
            last_sequence = sequence;

            if clipboard.is_none() {
                clipboard = Clipboard::new().ok();
            }

            if let Some(clipboard) = clipboard.as_mut() {
                let _ = self.capture_text(clipboard);
                let _ = self.capture_image(clipboard);
            }
        }
    }

    fn is_paused(&self) -> bool {
        let Ok(mut pause_until) = self.pause_until.lock() else {
            return false;
        };

        match *pause_until {
            Some(until) if until > Utc::now() => true,
            Some(_) => {
                *pause_until = None;
                false
            }
            None => false,
        }
    }

    fn capture_text(&self, clipboard: &mut Clipboard) -> Result<()> {
        let text = clipboard.get_text()?;
        let settings = self.storage.settings()?;
        let source_app = active_window_app();
        let source_title = active_window_title();
        if privacy::source_is_excluded(&source_app, &source_title, &settings)
            || !privacy::should_capture_text(&text, &settings)
        {
            return Ok(());
        }

        let normalized = privacy::normalize_text(&text);
        let hash = privacy::hash_bytes("text", normalized.as_bytes());
        self.storage.insert_item(NewClipboardItem {
            kind: ClipboardKind::Text,
            text: Some(text),
            image_png: None,
            thumbnail_png: None,
            source_app,
            source_title,
            hash,
            size_bytes: normalized.len() as i64,
        })?;
        Ok(())
    }

    fn capture_image(&self, clipboard: &mut Clipboard) -> Result<()> {
        let image = clipboard.get_image()?;
        let settings = self.storage.settings()?;
        let source_app = active_window_app();
        let source_title = active_window_title();
        let png = encode_rgba_png(image.width, image.height, image.bytes.as_ref())?;

        if privacy::source_is_excluded(&source_app, &source_title, &settings)
            || !privacy::should_capture_image(png.len(), &settings)
        {
            return Ok(());
        }

        let thumbnail = thumbnail_png(&png)?;
        let hash = privacy::hash_bytes("image", &png);
        self.storage.insert_item(NewClipboardItem {
            kind: ClipboardKind::Image,
            text: None,
            image_png: Some(png.clone()),
            thumbnail_png: Some(thumbnail),
            source_app,
            source_title,
            hash,
            size_bytes: png.len() as i64,
        })?;
        Ok(())
    }
}

pub fn paste_item(item: &ClipboardItem, target_hwnd: Option<isize>) -> Result<()> {
    if let Some(text) = &item.text {
        return paste_text(text, target_hwnd);
    }

    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    let previous = ClipboardContent::capture(&mut clipboard);
    if let Some(image_url) = &item.image_url {
        let png = image_url
            .strip_prefix("data:image/png;base64,")
            .context("image item is missing PNG data")?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(png)?;
        let image = image::load_from_memory(&bytes)?.to_rgba8();
        let width = image.width() as usize;
        let height = image.height() as usize;
        clipboard.set_image(ImageData {
            width,
            height,
            bytes: Cow::Owned(image.into_raw()),
        })?;
    } else {
        anyhow::bail!("clipboard item has no pasteable content");
    }

    focus_target_window(target_hwnd);
    std::thread::sleep(StdDuration::from_millis(90));
    send_ctrl_v();
    std::thread::sleep(StdDuration::from_millis(450));
    previous.restore(&mut clipboard);
    Ok(())
}

pub fn paste_text(text: &str, target_hwnd: Option<isize>) -> Result<()> {
    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    let previous = ClipboardContent::capture(&mut clipboard);
    clipboard.set_text(text.to_string())?;

    focus_target_window(target_hwnd);
    std::thread::sleep(StdDuration::from_millis(90));
    send_ctrl_v();
    std::thread::sleep(StdDuration::from_millis(450));
    previous.restore(&mut clipboard);
    Ok(())
}

enum ClipboardContent {
    Text(String),
    Image(ImageData<'static>),
    Empty,
}

impl ClipboardContent {
    fn capture(clipboard: &mut Clipboard) -> Self {
        if let Ok(text) = clipboard.get_text() {
            return Self::Text(text);
        }

        if let Ok(image) = clipboard.get_image() {
            return Self::Image(ImageData {
                width: image.width,
                height: image.height,
                bytes: Cow::Owned(image.bytes.into_owned()),
            });
        }

        Self::Empty
    }

    fn restore(self, clipboard: &mut Clipboard) {
        match self {
            Self::Text(text) => {
                let _ = clipboard.set_text(text);
            }
            Self::Image(image) => {
                let _ = clipboard.set_image(image);
            }
            Self::Empty => {}
        }
    }
}

fn focus_target_window(target_hwnd: Option<isize>) {
    let Some(raw_hwnd) = target_hwnd else {
        return;
    };
    let hwnd = HWND(raw_hwnd as *mut c_void);
    unsafe {
        if IsWindow(hwnd).as_bool() {
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

fn encode_rgba_png(width: usize, height: usize, bytes: &[u8]) -> Result<Vec<u8>> {
    let image = ImageBuffer::<Rgba<u8>, _>::from_raw(width as u32, height as u32, bytes.to_vec())
        .context("clipboard image has invalid dimensions")?;
    let mut encoded = Vec::new();
    DynamicImage::ImageRgba8(image).write_to(&mut Cursor::new(&mut encoded), ImageFormat::Png)?;
    Ok(encoded)
}

fn thumbnail_png(png: &[u8]) -> Result<Vec<u8>> {
    let image = image::load_from_memory(png)?;
    let thumb = image.resize(420, 260, FilterType::Triangle);
    let mut encoded = Vec::new();
    thumb.write_to(&mut Cursor::new(&mut encoded), ImageFormat::Png)?;
    Ok(encoded)
}

fn send_ctrl_v() {
    unsafe {
        let inputs = [
            key_input(VK_CONTROL, KEYBD_EVENT_FLAGS(0)),
            key_input(VK_V, KEYBD_EVENT_FLAGS(0)),
            key_input(VK_V, KEYEVENTF_KEYUP),
            key_input(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn key_input(key: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn active_window_app() -> Option<String> {
    Some("Foreground app".to_string())
}

fn active_window_title() -> Option<String> {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
        let hwnd = GetForegroundWindow();
        let mut buffer = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buffer);
        if len > 0 {
            return Some(String::from_utf16_lossy(&buffer[..len as usize]));
        }
    }
    None
}
