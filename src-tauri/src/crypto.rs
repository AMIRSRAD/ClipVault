use std::{fs, path::Path};

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

pub fn load_or_create_database_key(path: &Path) -> Result<Vec<u8>> {
    if path.exists() {
        let protected = fs::read(path)
            .with_context(|| format!("failed to read key file {}", path.display()))?;
        return unprotect(&protected);
    }

    let seed = format!(
        "{}:{}:{}",
        uuid::Uuid::new_v4(),
        whoami_fallback(),
        chrono::Utc::now()
    );
    let key = Sha256::digest(seed.as_bytes()).to_vec();
    let protected = protect(&key)?;
    fs::write(path, protected)
        .with_context(|| format!("failed to write key file {}", path.display()))?;
    Ok(key)
}

#[cfg(target_os = "windows")]
pub fn protect(bytes: &[u8]) -> Result<Vec<u8>> {
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )?;
        let protected = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output.pbData as *mut c_void));
        Ok(protected)
    }
}

#[cfg(target_os = "windows")]
pub fn unprotect(bytes: &[u8]) -> Result<Vec<u8>> {
    use std::ffi::c_void;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )?;
        let unprotected =
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(output.pbData as *mut c_void));
        Ok(unprotected)
    }
}

#[cfg(not(target_os = "windows"))]
pub fn protect(bytes: &[u8]) -> Result<Vec<u8>> {
    Ok(bytes.to_vec())
}

#[cfg(not(target_os = "windows"))]
pub fn unprotect(bytes: &[u8]) -> Result<Vec<u8>> {
    Ok(bytes.to_vec())
}

fn whoami_fallback() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "clipvault".to_string())
}
