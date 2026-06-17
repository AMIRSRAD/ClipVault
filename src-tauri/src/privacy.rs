use sha2::{Digest, Sha256};

use crate::models::AppSettings;

const MAX_TEXT_CAPTURE_BYTES: usize = 512 * 1024;
const MAX_IMAGE_CAPTURE_BYTES: usize = 8 * 1024 * 1024;

pub fn normalize_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn hash_bytes(kind: &str, bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(kind.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub fn should_capture_text(text: &str, settings: &AppSettings) -> bool {
    if !settings.capture_enabled || text.trim().is_empty() || text.len() > MAX_TEXT_CAPTURE_BYTES {
        return false;
    }

    if settings.suppress_sensitive && looks_sensitive(text) {
        return false;
    }

    true
}

pub fn should_capture_image(size_bytes: usize, settings: &AppSettings) -> bool {
    settings.capture_enabled && size_bytes > 0 && size_bytes <= MAX_IMAGE_CAPTURE_BYTES
}

pub fn source_is_excluded(
    app: &Option<String>,
    title: &Option<String>,
    settings: &AppSettings,
) -> bool {
    let app_name = app.as_deref().unwrap_or_default().to_lowercase();
    let title_value = title.as_deref().unwrap_or_default().to_lowercase();

    settings
        .excluded_apps
        .iter()
        .any(|candidate| app_name.contains(&candidate.to_lowercase()))
        || settings
            .excluded_title_patterns
            .iter()
            .any(|pattern| title_value.contains(&pattern.to_lowercase()))
}

pub fn looks_sensitive(text: &str) -> bool {
    let trimmed = text.trim();
    let lower = trimmed.to_lowercase();

    if lower.contains("-----begin ") && lower.contains(" private key-----") {
        return true;
    }

    if lower.contains("password=")
        || lower.contains("passwd=")
        || lower.contains("api_key=")
        || lower.contains("secret=")
    {
        return true;
    }

    let compact = trimmed.replace(['-', '_', ' '], "");
    compact.len() >= 32
        && compact
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_whitespace() {
        assert_eq!(normalize_text("  hello\n\nworld\t "), "hello world");
    }

    #[test]
    fn suppresses_private_keys() {
        assert!(looks_sensitive(
            "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----"
        ));
    }

    #[test]
    fn suppresses_long_tokens() {
        assert!(looks_sensitive(
            "exampletokenabcdefghijklmnopqrstuvwxyz1234567890"
        ));
    }
}
