import { Clipboard, FileText, Image, Info, Keyboard, NotebookPen, Pause, Pin, Play, Settings, Tags, X } from "lucide-react";
import clipvaultIcon from "../assets/clipvault-icon.png";
import type { UpdateInfo } from "../types";

export type ViewKey = "all" | "pinned" | "text" | "images" | "notes" | "tags" | "settings" | "info";

type NavEntry = { key: ViewKey; label: string; icon: typeof Clipboard };

const navSections: Array<{ title?: string; entries: NavEntry[] }> = [
  {
    title: "History",
    entries: [
      { key: "all", label: "All clips", icon: Clipboard },
      { key: "pinned", label: "Pinned", icon: Pin },
      { key: "text", label: "Text", icon: FileText },
      { key: "images", label: "Images", icon: Image }
    ]
  },
  {
    title: "Library",
    entries: [
      { key: "notes", label: "Notes", icon: NotebookPen },
      { key: "tags", label: "Tags", icon: Tags }
    ]
  }
];

const footerEntries: NavEntry[] = [
  { key: "settings", label: "Settings", icon: Settings },
  { key: "info", label: "About", icon: Info }
];

export function Sidebar({
  view,
  onNavigate,
  paused,
  onTogglePause,
  retentionDays,
  hotkey,
  onQuickPaste,
  update,
  onInstallUpdate,
  onDismissUpdate
}: {
  view: ViewKey;
  onNavigate: (view: ViewKey) => void;
  paused: boolean;
  onTogglePause: () => void;
  retentionDays: number | null;
  hotkey: string;
  onQuickPaste: () => void;
  update: UpdateInfo | null;
  onInstallUpdate: () => void;
  onDismissUpdate: () => void;
}) {
  const renderEntry = ({ key, label, icon: Icon }: NavEntry) => (
    <button key={key} className={view === key ? "nav-item active" : "nav-item"} onClick={() => onNavigate(key)} aria-current={view === key ? "page" : undefined}>
      <Icon size={16} strokeWidth={1.9} />
      <span>{label}</span>
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={clipvaultIcon} alt="" />
        <strong>ClipVault</strong>
      </div>

      <nav className="nav" aria-label="Main">
        {navSections.map((section) => (
          <div className="nav-section" key={section.title}>
            {section.title && <div className="nav-heading">{section.title}</div>}
            {section.entries.map(renderEntry)}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {update && (
          <div className="update-card" role="status">
            <div className="update-copy">
              <strong>Update ready</strong>
              <span>Version {update.version}</span>
            </div>
            <button className="button accent small" onClick={onInstallUpdate} title="Install the update and restart ClipVault">
              Restart
            </button>
            <button className="icon-button subtle" onClick={onDismissUpdate} title="Not now" aria-label="Dismiss update notice">
              <X size={14} />
            </button>
          </div>
        )}

        <button className="quick-paste-button" onClick={onQuickPaste} title="Open quick paste">
          <Keyboard size={16} strokeWidth={1.9} />
          <span>Quick paste</span>
          <kbd>{hotkey}</kbd>
        </button>

        <div className={paused ? "capture-card paused" : "capture-card"}>
          <span className="capture-dot" aria-hidden />
          <div className="capture-copy">
            <strong>{paused ? "Capture paused" : "Capturing"}</strong>
            <span>Encrypted · {retentionDays ?? 30}-day history</span>
          </div>
          <button className="icon-button subtle" onClick={onTogglePause} title={paused ? "Resume capture" : "Pause capture"} aria-label={paused ? "Resume capture" : "Pause capture"}>
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
        </div>

        <div className="nav-section">{footerEntries.map(renderEntry)}</div>
      </div>
    </aside>
  );
}
