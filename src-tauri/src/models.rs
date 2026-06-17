use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardKind {
    Text,
    Image,
    Note,
}

impl ClipboardKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Image => "image",
            Self::Note => "note",
        }
    }
}

impl TryFrom<&str> for ClipboardKind {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "text" => Ok(Self::Text),
            "image" => Ok(Self::Image),
            "note" => Ok(Self::Note),
            other => Err(format!("unknown clipboard kind: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: String,
    pub kind: ClipboardKind,
    pub text: Option<String>,
    pub ocr_text: Option<String>,
    pub image_url: Option<String>,
    pub source_app: Option<String>,
    pub source_title: Option<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub pinned: bool,
    pub tags: Vec<String>,
    pub size_bytes: i64,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFilters {
    pub kind: Option<String>,
    pub pinned: Option<bool>,
    pub tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub items: Vec<ClipboardItem>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub retention_days: i64,
    pub max_storage_mb: i64,
    pub hotkey: String,
    pub capture_enabled: bool,
    pub excluded_apps: Vec<String>,
    pub excluded_title_patterns: Vec<String>,
    pub suppress_sensitive: bool,
    pub ocr_mode: String,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default)]
    pub launch_on_startup: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            retention_days: 30,
            max_storage_mb: 512,
            hotkey: "Ctrl+Shift+V".to_string(),
            capture_enabled: true,
            excluded_apps: vec!["1Password.exe".into(), "KeePassXC.exe".into()],
            excluded_title_patterns: vec!["password".into(), "secret".into(), "private key".into()],
            suppress_sensitive: true,
            ocr_mode: "onDemand".to_string(),
            close_to_tray: true,
            minimize_to_tray: true,
            start_minimized: false,
            launch_on_startup: false,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResponse {
    pub status: String,
    pub text: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct NewClipboardItem {
    pub kind: ClipboardKind,
    pub text: Option<String>,
    pub image_png: Option<Vec<u8>>,
    pub thumbnail_png: Option<Vec<u8>>,
    pub source_app: Option<String>,
    pub source_title: Option<String>,
    pub hash: String,
    pub size_bytes: i64,
}
