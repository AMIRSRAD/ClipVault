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

const SECRET_KEY_NAMES: &[&str] = &[
    "password",
    "passwd",
    "pwd",
    "api_key",
    "apikey",
    "api-key",
    "secret",
    "token",
    "access_key",
    "private_key",
    "client_secret",
    "authorization",
];

const TOKEN_PREFIXES: &[&str] = &[
    "ghp_",
    "gho_",
    "ghu_",
    "ghs_",
    "github_pat_",
    "sk-",
    "sk_live_",
    "pk_live_",
    "xoxb-",
    "xoxp-",
    "akia",
    "asia",
    "aiza",
    "glpat-",
];

pub fn looks_sensitive(text: &str) -> bool {
    let trimmed = text.trim();
    let lower = trimmed.to_lowercase();

    if lower.contains("-----begin ") && lower.contains(" private key-----") {
        return true;
    }

    if has_secret_assignment(&lower) || lower.starts_with("bearer ") {
        return true;
    }

    // Single-token values only: prefixed API tokens, JWTs, card numbers, long random strings.
    if trimmed.split_whitespace().count() == 1 {
        if TOKEN_PREFIXES
            .iter()
            .any(|prefix| lower.starts_with(prefix))
            && trimmed.len() >= 16
        {
            return true;
        }
        if is_jwt(trimmed) {
            return true;
        }
    }

    if is_card_number(trimmed) {
        return true;
    }

    let compact = trimmed.replace(['-', '_', ' '], "");
    compact.len() >= 32
        && compact
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '/')
}

/// Detects `password=x`, `password: x` and `"password": "x"` style assignments.
fn has_secret_assignment(lower: &str) -> bool {
    SECRET_KEY_NAMES.iter().any(|name| {
        lower.match_indices(name).any(|(index, _)| {
            let rest = lower[index + name.len()..].trim_start_matches(['"', '\'']);
            let rest = rest.trim_start();
            let Some(value) = rest.strip_prefix(['=', ':']) else {
                return false;
            };
            !value.trim_start_matches([' ', '"', '\'']).is_empty()
        })
    })
}

fn is_jwt(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    parts.len() == 3
        && value.starts_with("eyJ")
        && parts.iter().all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '=')
        })
}

/// 13-19 digits (spaces/dashes allowed) that pass the Luhn check.
fn is_card_number(value: &str) -> bool {
    if !value
        .chars()
        .all(|ch| ch.is_ascii_digit() || ch == ' ' || ch == '-')
    {
        return false;
    }
    let digits: Vec<u32> = value.chars().filter_map(|ch| ch.to_digit(10)).collect();
    if !(13..=19).contains(&digits.len()) {
        return false;
    }
    let sum: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(index, digit)| {
            if index % 2 == 1 {
                let doubled = digit * 2;
                if doubled > 9 {
                    doubled - 9
                } else {
                    doubled
                }
            } else {
                *digit
            }
        })
        .sum();
    sum.is_multiple_of(10)
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

    #[test]
    fn suppresses_assignments() {
        assert!(looks_sensitive("password=hunter2"));
        assert!(looks_sensitive("{\"password\": \"hunter2\"}"));
        assert!(looks_sensitive("API_TOKEN: abc123"));
        assert!(looks_sensitive("Bearer abc.def"));
    }

    #[test]
    fn suppresses_prefixed_tokens_jwts_and_cards() {
        assert!(looks_sensitive("ghp_abcdefghijklmnop1234"));
        assert!(looks_sensitive("AKIAIOSFODNN7EXAMPLE"));
        assert!(looks_sensitive(
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"
        ));
        assert!(looks_sensitive("4111 1111 1111 1111"));
    }

    #[test]
    fn keeps_ordinary_text() {
        assert!(!looks_sensitive(
            "Meeting notes: reset the password policy doc"
        ));
        assert!(!looks_sensitive("password"));
        assert!(!looks_sensitive("1234 5678 9012 3456"));
        assert!(!looks_sensitive("https://example.com/path"));
    }
}
