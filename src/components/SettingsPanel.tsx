import { Download, ExternalLink, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { version } from "../../package.json";
import clipvaultIcon from "../assets/clipvault-icon.png";
import { checkForUpdate, exportBackup, getSettings, importBackup, installUpdate, openExternal, updateSettings } from "../api";
import type { AppSettings, UpdateInfo } from "../types";

export function SettingsPanel({
  settings,
  onChange,
  onToast,
  update,
  onUpdateFound,
  onClearHistory
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onToast: (message: string) => void;
  update: UpdateInfo | null;
  onUpdateFound: (update: UpdateInfo) => void;
  onClearHistory: () => void;
}) {
  async function patch(next: Partial<AppSettings>) {
    try {
      onChange(await updateSettings({ ...settings, ...next }));
    } catch (error) {
      onToast(typeof error === "string" ? error : "Couldn't save that setting");
    }
  }

  async function handleExport() {
    const backup = await exportBackup();
    const url = URL.createObjectURL(new Blob([backup], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `clipvault-backup-${new Date().toISOString().slice(0, 10)}.cvbackup`;
    anchor.click();
    URL.revokeObjectURL(url);
    onToast("Encrypted backup exported");
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    try {
      const count = await importBackup(await file.text());
      onChange(await getSettings());
      onToast(`Imported ${count} saved item${count === 1 ? "" : "s"}`);
    } catch {
      onToast("That backup couldn't be imported");
    }
  }

  return (
    <section className="page">
      <div className="page-inner">
        <header className="page-header">
          <h1>Settings</h1>
          <p>Everything stays on this PC, encrypted with your Windows account.</p>
        </header>

        <SettingsGroup title="Capture">
          <ToggleRow label="Capture clipboard" description="Save text and images you copy to your history." checked={settings.captureEnabled} onChange={(value) => patch({ captureEnabled: value })} />
          <ToggleRow
            label="Skip sensitive values"
            description="Don't save things that look like passwords, API keys, tokens, or card numbers."
            checked={settings.suppressSensitive}
            onChange={(value) => patch({ suppressSensitive: value })}
          />
          <SettingRow label="Keep history for" description="Pinned clips and notes are never removed.">
            <NumberField value={settings.retentionDays} min={1} max={365} suffix="days" onCommit={(value) => patch({ retentionDays: value })} />
          </SettingRow>
          <SettingRow label="Storage limit" description="Oldest unpinned clips are removed first.">
            <NumberField value={settings.maxStorageMb} min={64} max={4096} suffix="MB" onCommit={(value) => patch({ maxStorageMb: value })} />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="Quick paste">
          <SettingRow label="Keyboard shortcut" description="Opens the quick paste popup from any app.">
            <TextField value={settings.hotkey} onCommit={(value) => patch({ hotkey: value })} width={170} />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="Privacy">
          <SettingRow label="Ignored apps" description="One process name per line, e.g. 1Password.exe." stacked>
            <ListField value={settings.excludedApps} onCommit={(value) => patch({ excludedApps: value })} placeholder="KeePassXC.exe" />
          </SettingRow>
          <SettingRow label="Ignored window titles" description="Skip copies from windows whose title contains any of these words." stacked>
            <ListField value={settings.excludedTitlePatterns} onCommit={(value) => patch({ excludedTitlePatterns: value })} placeholder="password" />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup title="Window">
          <ToggleRow label="Close to tray" description="Keep ClipVault running when you close the window." checked={settings.closeToTray} onChange={(value) => patch({ closeToTray: value })} />
          <ToggleRow label="Minimize to tray" checked={settings.minimizeToTray} onChange={(value) => patch({ minimizeToTray: value })} />
          <ToggleRow label="Start minimized" checked={settings.startMinimized} onChange={(value) => patch({ startMinimized: value })} />
          <ToggleRow label="Launch on Windows startup" checked={settings.launchOnStartup} onChange={(value) => patch({ launchOnStartup: value })} />
        </SettingsGroup>

        <SettingsGroup title="Updates">
          <ToggleRow
            label="Download updates automatically"
            description="Checks once a day in the background. Nothing is installed until you choose Restart."
            checked={settings.autoUpdate}
            onChange={(value) => patch({ autoUpdate: value })}
          />
          <UpdateRow update={update} onUpdateFound={onUpdateFound} onToast={onToast} />
        </SettingsGroup>

        <SettingsGroup title="Backup & data">
          <SettingRow label="Encrypted backup" description="Notes, pinned clips, and settings. Can only be restored by this Windows account.">
            <div className="row-actions">
              <button className="button" onClick={handleExport}>
                <Download size={15} />
                Export
              </button>
              <label className="button file-button">
                <Upload size={15} />
                Import
                <input
                  type="file"
                  accept=".cvbackup,text/plain"
                  onChange={(event) => {
                    void handleImport(event.currentTarget.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </SettingRow>
          <SettingRow label="Clear clipboard history" description="Permanently removes saved clips from this PC. You choose whether to keep pinned clips and notes.">
            <button className="button danger-outline" onClick={onClearHistory}>
              <Trash2 size={15} />
              Clear history…
            </button>
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  );
}

function UpdateRow({ update, onUpdateFound, onToast }: { update: UpdateInfo | null; onUpdateFound: (update: UpdateInfo) => void; onToast: (message: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setMessage(null);
    try {
      const result = await checkForUpdate();
      if (result.status === "ready") {
        onUpdateFound({ version: result.version, notes: result.notes });
      } else if (result.status === "upToDate") {
        setMessage(`You're up to date (version ${version}).`);
      } else {
        setMessage("Couldn't check for updates. Are you online?");
      }
    } catch {
      setMessage("Couldn't check for updates. Are you online?");
    } finally {
      setChecking(false);
    }
  }

  async function install() {
    try {
      await installUpdate();
    } catch (error) {
      onToast(typeof error === "string" ? error : "Couldn't install the update");
    }
  }

  return (
    <SettingRow label={update ? `Version ${update.version} is ready` : "Check for updates"} description={update ? "Restarting installs it and reopens ClipVault." : message ?? `You have version ${version}.`}>
      {update ? (
        <button className="button accent" onClick={install}>
          Restart to update
        </button>
      ) : (
        <button className="button" onClick={check} disabled={checking}>
          {checking ? "Checking…" : "Check now"}
        </button>
      )}
    </SettingRow>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function SettingRow({ label, description, children, stacked = false }: { label: string; description?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={stacked ? "setting-row stacked" : "setting-row"}>
      <div className="setting-copy">
        <span className="setting-label">{label}</span>
        {description && <span className="setting-description">{description}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-row clickable">
      <div className="setting-copy">
        <span className="setting-label">{label}</span>
        {description && <span className="setting-description">{description}</span>}
      </div>
      <div className="setting-control">
        <span className="toggle-state">{checked ? "On" : "Off"}</span>
        <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      </div>
    </label>
  );
}

function NumberField({ value, min, max, suffix, onCommit }: { value: number; min: number; max: number; suffix: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const parsed = Math.round(Number(draft));
    if (!Number.isFinite(parsed)) return setDraft(String(value));
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <div className="input-with-suffix">
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
      />
      <span>{suffix}</span>
    </div>
  );
}

function TextField({ value, onCommit, width }: { value: string; onCommit: (value: string) => void; width: number }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit() {
    const next = draft.trim();
    if (!next) return setDraft(value);
    if (next !== value) onCommit(next);
  }

  return (
    <input
      className="input"
      style={{ width }}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && commit()}
    />
  );
}

function ListField({ value, onCommit, placeholder }: { value: string[]; onCommit: (value: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value.join("\n"));
  useEffect(() => setDraft(value.join("\n")), [value]);

  return (
    <textarea
      className="input textarea"
      value={draft}
      placeholder={placeholder}
      rows={3}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (next.join("\n") !== value.join("\n")) onCommit(next);
      }}
    />
  );
}

export function InfoPanel({ update, onUpdateFound, onToast }: { update: UpdateInfo | null; onUpdateFound: (update: UpdateInfo) => void; onToast: (message: string) => void }) {
  return (
    <section className="page">
      <div className="page-inner">
        <header className="page-header">
          <h1>About</h1>
        </header>

        <div className="about-hero">
          <img src={clipvaultIcon} alt="" />
          <div>
            <h2>ClipVault</h2>
            <p>Private, encrypted clipboard history for Windows.</p>
            <span className="version">Version {version}</span>
          </div>
        </div>

        <SettingsGroup title="Updates">
          <UpdateRow update={update} onUpdateFound={onUpdateFound} onToast={onToast} />
        </SettingsGroup>

        <SettingsGroup title="Details">
          <SettingRow label="Creator">
            <span className="setting-value">Amirsalar Saberi rad</span>
          </SettingRow>
          <SettingRow label="Website">
            <button className="link-button" onClick={() => openExternal("https://amirsrad.ir")}>
              amirsrad.ir
              <ExternalLink size={13} />
            </button>
          </SettingRow>
          <SettingRow label="License">
            <span className="setting-value">Copyright Amirsalar Saberi rad. All rights reserved.</span>
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  );
}
