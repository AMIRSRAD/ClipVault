use std::{fs, path::Path};

use anyhow::{Context, Result};

pub fn load_or_create_database_key(path: &Path) -> Result<Vec<u8>> {
    if path.exists() {
        let protected = fs::read(path)
            .with_context(|| format!("failed to read key file {}", path.display()))?;
        return unprotect(&protected);
    }

    let mut key = vec![0u8; 32];
    getrandom::getrandom(&mut key)
        .map_err(|err| anyhow::anyhow!("failed to generate key: {err}"))?;
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
pub fn protect(_bytes: &[u8]) -> Result<Vec<u8>> {
    anyhow::bail!("ClipVault key protection requires Windows DPAPI")
}

#[cfg(not(target_os = "windows"))]
pub fn unprotect(_bytes: &[u8]) -> Result<Vec<u8>> {
    anyhow::bail!("ClipVault key protection requires Windows DPAPI")
}
