//! Quiet auto-update.
//!
//! A background task checks for a signed release a minute after launch and then once a day
//! (a sleeping timer, so it costs nothing while idle). When one is found it is downloaded in
//! the background and the UI is told, but nothing is installed or shown until the user chooses
//! "Restart to update".

use std::{sync::Mutex, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::AppState;

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(60);
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Pending>>,
}

struct Pending {
    update: Update,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateCheck {
    UpToDate,
    Ready(UpdateInfo),
    Error { message: String },
}

impl UpdateState {
    fn info(&self) -> Option<UpdateInfo> {
        let pending = self.pending.lock().ok()?;
        pending.as_ref().map(|pending| UpdateInfo {
            version: pending.update.version.clone(),
            notes: pending.update.body.clone(),
        })
    }
}

/// Looks for a newer release and, if there is one, downloads it and keeps it ready to install.
async fn check_and_download(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let state = app.state::<UpdateState>();
    if let Some(info) = state.info() {
        return Ok(Some(info));
    }

    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    let info = UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
    };
    if let Ok(mut pending) = state.pending.lock() {
        *pending = Some(Pending { update, bytes });
    }
    let _ = app.emit("update-ready", info.clone());
    Ok(Some(info))
}

fn auto_update_enabled(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .and_then(|state| state.storage.settings().ok())
        .map(|settings| settings.auto_update)
        .unwrap_or(true)
}

/// Starts the daily background check.
pub fn spawn_background_checks(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            if auto_update_enabled(&app) {
                // Failures (offline, rate limited) are ignored; we simply try again tomorrow.
                let _ = check_and_download(&app).await;
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> UpdateCheck {
    match check_and_download(&app).await {
        Ok(Some(info)) => UpdateCheck::Ready(info),
        Ok(None) => UpdateCheck::UpToDate,
        Err(message) => UpdateCheck::Error { message },
    }
}

#[tauri::command]
pub fn pending_update(state: State<'_, UpdateState>) -> Option<UpdateInfo> {
    state.info()
}

/// Runs the downloaded installer. On Windows the installer closes ClipVault and relaunches it.
#[tauri::command]
pub fn install_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let pending = state
        .pending
        .lock()
        .map_err(|_| "update lock poisoned".to_string())?
        .take()
        .ok_or_else(|| "No update is ready to install".to_string())?;

    pending
        .update
        .install(&pending.bytes)
        .map_err(|error| error.to_string())?;
    app.exit(0);
    Ok(())
}
