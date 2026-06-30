import {
  Braces,
  Clipboard,
  Code2,
  Copy,
  Download,
  ExternalLink,
  NotebookPen,
  FileText,
  FolderOpen,
  Globe,
  Image,
  Info,
  Keyboard,
  ListChecks,
  Mail,
  Pause,
  Pin,
  PinOff,
  Search,
  Settings,
  Shield,
  SquareArrowOutUpRight,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import clipvaultIcon from "./assets/clipvault-icon.png";
import {
  closePalette,
  createNote,
  deleteItem,
  exportBackup,
  getItem,
  getSettings,
  importBackup,
  openMainWindow,
  openExternal,
  pasteItem,
  pasteText,
  pauseCapture,
  pinItem,
  runOcr,
  searchItems,
  setTags,
  updateSettings,
  updateNote,
  startPaletteDrag as startNativePaletteDrag
} from "./api";
import type { AppSettings, ClipboardFilters, ClipboardItem, OcrResponse } from "./types";

type ViewKey = "all" | "pinned" | "text" | "images" | "notes" | "tags" | "settings" | "info";
type ViewGroup = "clipboard" | "saved" | "utility";
type PasteTransform = "plain" | "trim" | "singleLine" | "upper" | "lower" | "title" | "jsonPretty" | "jsonMinify";
type PaletteContextMenu = { item: ClipboardItem; x: number; y: number } | null;

const viewLabels: Array<{ key: ViewKey; label: string; icon: typeof Clipboard; group: ViewGroup }> = [
  { key: "all", label: "All", icon: Clipboard, group: "clipboard" },
  { key: "pinned", label: "Pinned", icon: Pin, group: "clipboard" },
  { key: "text", label: "Text", icon: FileText, group: "clipboard" },
  { key: "images", label: "Images", icon: Image, group: "clipboard" },
  { key: "notes", label: "Notes", icon: NotebookPen, group: "saved" },
  { key: "tags", label: "Tags", icon: Tags, group: "utility" },
  { key: "settings", label: "Settings", icon: Settings, group: "utility" },
  { key: "info", label: "Info", icon: Info, group: "utility" }
];

const noteTemplates = [
  {
    label: "Meeting",
    icon: NotebookPen,
    tags: ["meeting"],
    text: "Meeting notes\n\nDate:\nAttendees:\n\nAgenda:\n- \n\nNotes:\n- \n\nAction items:\n- "
  },
  {
    label: "Todo",
    icon: ListChecks,
    tags: ["todo"],
    text: "Todo\n\n- [ ] "
  },
  {
    label: "Code",
    icon: Code2,
    tags: ["code"],
    text: "Snippet\n\n```ts\n\n```"
  },
  {
    label: "Prompt",
    icon: Sparkles,
    tags: ["prompts"],
    text: "Prompt\n\nContext:\n\nTask:\n\nConstraints:\n\nOutput:"
  },
  {
    label: "Email",
    icon: Mail,
    tags: ["emails"],
    text: "Subject:\n\nHi,\n\n\n\nBest,"
  }
] satisfies Array<{ label: string; icon: typeof Clipboard; tags: string[]; text: string }>;

const noteCollections = ["work", "code", "emails", "prompts", "personal"] as const;
const pasteTransformActions: Array<{ key: PasteTransform; label: string; enabled?: (text: string) => boolean }> = [
  { key: "plain", label: "Plain text" },
  { key: "trim", label: "Trim spaces" },
  { key: "singleLine", label: "Single line" },
  { key: "upper", label: "UPPERCASE" },
  { key: "lower", label: "lowercase" },
  { key: "title", label: "Title Case" },
  { key: "jsonPretty", label: "JSON pretty", enabled: (text) => Boolean(formatJson(text)) },
  { key: "jsonMinify", label: "JSON minify", enabled: (text) => Boolean(formatJson(text)) }
];

function filtersForView(view: ViewKey, tag: string | null, noteCollection: string | null): ClipboardFilters {
  if (view === "pinned") return { kind: "all", pinned: true };
  if (view === "text") return { kind: "text" };
  if (view === "images") return { kind: "image" };
  if (view === "notes") return { kind: "note", tag: noteCollection };
  if (view === "tags") return { kind: "all", tag };
  return { kind: "all" };
}

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function previewText(item: ClipboardItem): string {
  if (item.kind === "image") return item.ocrText || "Image copied to clipboard";
  if (item.kind === "note") return item.text || "Empty note";
  return item.text || "";
}

function smartText(item: ClipboardItem): string {
  return item.text || item.ocrText || "";
}

function firstUrl(text: string): string | null {
  return text.match(/\bhttps?:\/\/[^\s<>"')]+/i)?.[0] ?? null;
}

function urlDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function firstFilePath(text: string): string | null {
  return text.match(/(?:[A-Za-z]:\\|\\\\)[^\n\r<>|?*]+/)?.[0]?.trim() ?? null;
}

function extractEmails(text: string): string[] {
  return [...new Set(text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? [])];
}

function formatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function beautifyCode(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b[\p{L}\p{N}]/gu, (char) => char.toUpperCase());
}

function transformText(text: string, transform: PasteTransform): string | null {
  if (transform === "plain") return text;
  if (transform === "trim") return text.trim();
  if (transform === "singleLine") return text.replace(/\s*\r?\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  if (transform === "upper") return text.toUpperCase();
  if (transform === "lower") return text.toLowerCase();
  if (transform === "title") return titleCase(text);

  const parsed = formatJson(text);
  if (!parsed) return null;
  if (transform === "jsonPretty") return parsed;
  if (transform === "jsonMinify") return JSON.stringify(JSON.parse(text));
  return null;
}

function searchableText(item: ClipboardItem): string {
  return [previewText(item), item.sourceApp, item.sourceTitle, ...item.tags].filter(Boolean).join(" ").toLowerCase();
}

function fuzzyScore(query: string, item: ClipboardItem): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;

  const haystack = searchableText(item);
  if (haystack.includes(needle)) return 200 + needle.length;

  let score = 0;
  let position = 0;
  let streak = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, position);
    if (found === -1) return 0;
    streak = found === position ? streak + 1 : 1;
    score += 8 + streak * 2 - Math.min(found - position, 10);
    position = found + 1;
  }
  return score;
}

function rankPaletteItems(items: ClipboardItem[], query: string): ClipboardItem[] {
  const needle = query.trim();
  if (!needle) return items;

  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(needle, item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.item.pinned) - Number(a.item.pinned) || a.index - b.index)
    .map((entry) => entry.item);
}

function App() {
  const [windowMode, setWindowMode] = useState<"main" | "palette">("main");

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        setWindowMode(getCurrentWindow().label === "palette" ? "palette" : "main");
      })
      .catch(() => setWindowMode("main"));
  }, []);

  return windowMode === "palette" ? <PaletteOnly /> : <MainShell />;
}

function MainShell() {
  const [view, setView] = useState<ViewKey>("all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [noteCollection, setNoteCollection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.tags))].sort(), [items]);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  const loadItems = useCallback(async () => {
    setLoading(true);
    const response = await searchItems({
      query,
      filters: filtersForView(view, selectedTag, noteCollection),
      limit: 100,
      offset: 0
    });
    setItems(response.items);
    setSelectedId((current) => (current && response.items.some((item) => item.id === current) ? current : response.items[0]?.id ?? null));
    setLoading(false);
  }, [noteCollection, query, selectedTag, view]);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    getItem(selectedId)
      .then((item) => {
        if (!item || cancelled) return;
        setItems((current) => current.map((candidate) => (candidate.id === item.id ? item : candidate)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;

    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("open-settings", () => {
          setView("settings");
          setSelectedTag(null);
          setNoteCollection(null);
        })
      )
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch(() => undefined);

    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function refreshSelected(id: string) {
    const item = await getItem(id);
    if (!item) {
      await loadItems();
      return;
    }
    setItems((current) => current.map((candidate) => (candidate.id === id ? item : candidate)));
  }

  async function handleDelete(id: string) {
    await deleteItem(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function handlePin(item: ClipboardItem) {
    await pinItem(item.id, !item.pinned);
    await refreshSelected(item.id);
  }

  async function handleTagSave(item: ClipboardItem, value: string) {
    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    await setTags(item.id, tags);
    await refreshSelected(item.id);
  }

  async function handleCopy(item: ClipboardItem) {
    if (item.text) await navigator.clipboard?.writeText(item.text);
  }

  async function handleCreateNote(template?: (typeof noteTemplates)[number]) {
    const tags = template?.tags ?? (noteCollection ? [noteCollection] : []);
    const note = await createNote(template?.text ?? "", tags);
    setView("notes");
    setItems((current) => [note, ...current]);
    setSelectedId(note.id);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={clipvaultIcon} alt="" />
          </div>
          <div>
            <strong>ClipVault</strong>
            <span>Private clipboard memory</span>
          </div>
        </div>

        <nav className="nav-list">
          {viewLabels.map(({ key, label, icon: Icon, group }, index) => (
            <button
              key={key}
              className={`nav-item nav-item-${group}${view === key ? " active" : ""}${index > 0 && viewLabels[index - 1].group !== group ? " starts-group" : ""}`}
              onClick={() => {
                setView(key);
                if (key !== "tags") setSelectedTag(null);
                if (key !== "notes") setNoteCollection(null);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="privacy-strip">
          <Shield size={18} />
          <div>
            <strong>Local encrypted</strong>
            <span>30 day retention</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="search-box">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clips, OCR text, apps, or tags" />
          </div>
          <button className="toolbar-button" onClick={() => setPaletteOpen(true)} title="Open quick paste">
            <Keyboard size={18} />
            <span>{settings?.hotkey ?? "Ctrl+Shift+V"}</span>
          </button>
          <button className="toolbar-button" onClick={() => pauseCapture(null)} title="Pause capture">
            <Pause size={18} />
            <span>Pause</span>
          </button>
          {view === "notes" && (
            <button className="toolbar-button" onClick={() => handleCreateNote()} title="New note">
              <NotebookPen size={18} />
              <span>New Note</span>
            </button>
          )}
        </header>

        {view === "settings" && settings ? (
          <SettingsPanel settings={settings} onChange={setSettings} />
        ) : view === "info" ? (
          <InfoPanel />
        ) : (
          <section className="content-grid">
            <div className="timeline">
              {view === "tags" && (
                <div className="tag-filter-row">
                  {tags.map((tag) => (
                    <button key={tag} className={selectedTag === tag ? "tag-chip active" : "tag-chip"} onClick={() => setSelectedTag(tag)}>
                      {tag}
                    </button>
                  ))}
                </div>
              )}
              {view === "notes" && (
                <div className="note-template-row">
                  <span>Saved snippet library</span>
                  <div>
                    <button className={noteCollection === null ? "template-button active" : "template-button"} onClick={() => setNoteCollection(null)}>
                      All notes
                    </button>
                    {noteCollections.map((collection) => (
                      <button
                        key={collection}
                        className={noteCollection === collection ? "template-button active" : "template-button"}
                        onClick={() => setNoteCollection(collection)}
                      >
                        {collection}
                      </button>
                    ))}
                  </div>
                  <span>Templates</span>
                  <div>
                    {noteTemplates.map((template) => {
                      const Icon = template.icon;
                      return (
                        <button key={template.label} className="template-button" onClick={() => handleCreateNote(template)}>
                          <Icon size={15} />
                          {template.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {loading ? (
                <div className="empty-state">Loading clipboard history...</div>
              ) : items.length === 0 ? (
                <div className="empty-state">No clips match this view.</div>
              ) : (
                items.map((item) => (
                  <TimelineItem key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => setSelectedId(item.id)} />
                ))
              )}
            </div>
            <DetailPanel
              item={selected}
              onDelete={handleDelete}
              onPin={handlePin}
              onCopy={handleCopy}
              onPaste={pasteItem}
              onTagSave={handleTagSave}
              onRefresh={refreshSelected}
            />
          </section>
        )}
      </main>

      {paletteOpen && <PaletteOverlay onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

function TimelineItem({ item, selected, onSelect }: { item: ClipboardItem; selected: boolean; onSelect: () => void }) {
  const Icon = item.kind === "image" ? Image : item.kind === "note" ? NotebookPen : FileText;
  return (
    <button className={selected ? "timeline-item selected" : "timeline-item"} onClick={onSelect}>
      <div className="item-icon">
        <Icon size={18} />
      </div>
      <div className="item-body">
        <div className="item-meta">
          <span>{item.sourceApp ?? "Unknown app"}</span>
          <span>{relativeTime(item.createdAt)}</span>
        </div>
        <p>{previewText(item)}</p>
        <div className="item-tags">
          {item.pinned && <span className="mini-pill">Pinned</span>}
          {item.tags.map((tag) => (
            <span key={tag} className="mini-pill">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

function DetailPanel({
  item,
  onDelete,
  onPin,
  onCopy,
  onPaste,
  onTagSave,
  onRefresh
}: {
  item: ClipboardItem | null;
  onDelete: (id: string) => Promise<void>;
  onPin: (item: ClipboardItem) => Promise<void>;
  onCopy: (item: ClipboardItem) => Promise<void>;
  onPaste: (id: string) => Promise<void>;
  onTagSave: (item: ClipboardItem, value: string) => Promise<void>;
  onRefresh: (id: string) => Promise<void>;
}) {
  const [tagText, setTagText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [ocr, setOcr] = useState<OcrResponse | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  useEffect(() => {
    setTagText(item?.tags.join(", ") ?? "");
    setNoteText(item?.kind === "note" ? item.text ?? "" : "");
    setOcr(null);
    setActionStatus(null);
  }, [item?.id]);

  if (!item) return <aside className="detail-panel empty-state">Select a clip to preview it.</aside>;

  const currentItem = item;

  async function handleOcr() {
    const response = await runOcr(currentItem.id);
    setOcr(response);
    await onRefresh(currentItem.id);
  }

  async function handleNoteSave() {
    if (currentItem.kind !== "note" || noteText === (currentItem.text ?? "")) return;
    await updateNote(currentItem.id, noteText);
    await onRefresh(currentItem.id);
  }

  async function applyTextAction(text: string, status: string) {
    if (currentItem.kind === "note") {
      setNoteText(text);
      await updateNote(currentItem.id, text);
      await onRefresh(currentItem.id);
      setActionStatus(status);
      return;
    }

    await navigator.clipboard?.writeText(text);
    setActionStatus(status);
  }

  return (
    <aside className="detail-panel">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">{item.kind}</span>
          <h1>{item.sourceTitle || item.sourceApp || "Clipboard item"}</h1>
        </div>
        <button className="icon-button" onClick={() => onPin(item)} title={item.pinned ? "Unpin" : "Pin"}>
          {item.pinned ? <PinOff size={18} /> : <Pin size={18} />}
        </button>
      </div>

      <div className="preview-surface">
        {item.kind === "note" ? (
          <textarea
            className="note-editor"
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            onBlur={handleNoteSave}
            placeholder="Write a note..."
          />
        ) : item.kind === "image" && item.imageUrl ? (
          <img src={item.imageUrl} alt="Copied clipboard item" />
        ) : (
          <pre>{item.text}</pre>
        )}
      </div>

      {item.ocrText && (
        <div className="ocr-text">
          <Sparkles size={16} />
          <span>{item.ocrText}</span>
        </div>
      )}

      {ocr && ocr.status !== "ready" && <div className={`ocr-status ${ocr.status}`}>{ocr.message}</div>}

      <SmartActions item={item} onApplyText={applyTextAction} onStatus={setActionStatus} />
      <PasteTransformActions item={item} />
      {actionStatus && <div className="action-status">{actionStatus}</div>}

      <label className="field-label" htmlFor="tags">
        Tags
      </label>
      <input id="tags" className="text-input" value={tagText} onChange={(event) => setTagText(event.target.value)} onBlur={() => onTagSave(item, tagText)} />

      <div className="action-row">
        <button className="primary-button" onClick={() => onPaste(item.id)}>
          <Clipboard size={18} />
          Paste
        </button>
        <button className="secondary-button" onClick={() => onCopy(item)}>
          <Copy size={18} />
          Copy
        </button>
        {item.kind === "image" && (
          <button className="secondary-button" onClick={handleOcr}>
            <Sparkles size={18} />
            OCR
          </button>
        )}
        {item.kind === "note" && (
          <button className="secondary-button" onClick={handleNoteSave} disabled={noteText === (item.text ?? "")}>
            <NotebookPen size={18} />
            Save
          </button>
        )}
        <button className="danger-button" onClick={() => onDelete(item.id)}>
          <Trash2 size={18} />
        </button>
      </div>
    </aside>
  );
}

function SmartActions({
  item,
  onApplyText,
  onStatus
}: {
  item: ClipboardItem;
  onApplyText: (text: string, status: string) => Promise<void>;
  onStatus: (status: string) => void;
}) {
  const text = smartText(item);
  const url = firstUrl(text);
  const domain = url ? urlDomain(url) : null;
  const filePath = firstFilePath(text);
  const emails = extractEmails(text);
  const json = formatJson(text);
  const codeCandidate = item.kind === "note" || /[{};=<>]|(?:function|const|let|class|import)\s/.test(text);

  if (!text.trim() && !url && !filePath) return null;

  async function copyValue(value: string, status: string) {
    await navigator.clipboard?.writeText(value);
    onStatus(status);
  }

  return (
    <div className="smart-actions" aria-label="Preview actions">
      {url && (
        <button className="smart-action-button" onClick={() => openExternal(url)} title={url}>
          <ExternalLink size={15} />
          Open URL
        </button>
      )}
      {domain && (
        <button className="smart-action-button" onClick={() => copyValue(domain, "Domain copied")}>
          <Globe size={15} />
          Copy domain
        </button>
      )}
      {json && (
        <button className="smart-action-button" onClick={() => onApplyText(json, item.kind === "note" ? "Note formatted as JSON" : "Formatted JSON copied")}>
          <Braces size={15} />
          Format JSON
        </button>
      )}
      {codeCandidate && text.trim().length > 0 && (
        <button className="smart-action-button" onClick={() => onApplyText(beautifyCode(text), item.kind === "note" ? "Note cleaned up" : "Cleaned code copied")}>
          <Code2 size={15} />
          Beautify code
        </button>
      )}
      {emails.length > 0 && (
        <button className="smart-action-button" onClick={() => copyValue(emails.join("\n"), "Email addresses copied")}>
          <Mail size={15} />
          Extract emails
        </button>
      )}
      {filePath && (
        <button className="smart-action-button" onClick={() => openExternal(filePath)} title={filePath}>
          <FolderOpen size={15} />
          Open path
        </button>
      )}
    </div>
  );
}

function PasteTransformActions({ item }: { item: ClipboardItem }) {
  const text = smartText(item);
  if (!text.trim()) return null;

  async function handlePaste(transform: PasteTransform) {
    const transformed = transformText(text, transform);
    if (transformed !== null) await pasteText(transformed);
  }

  return (
    <div className="paste-transforms">
      <span>Paste as</span>
      <div>
        {pasteTransformActions
          .filter((action) => action.enabled?.(text) !== false)
          .map((action) => (
            <button key={action.key} className="smart-action-button" onClick={() => handlePaste(action.key)}>
              {action.label}
            </button>
          ))}
      </div>
    </div>
  );
}

function SettingsPanel({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  async function patch(next: Partial<AppSettings>) {
    const updated = await updateSettings({ ...settings, ...next });
    onChange(updated);
  }

  async function handleExport() {
    const backup = await exportBackup();
    const blob = new Blob([backup], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `clipvault-backup-${new Date().toISOString().slice(0, 10)}.cvbackup`;
    anchor.click();
    URL.revokeObjectURL(url);
    setBackupStatus("Encrypted backup exported");
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    const count = await importBackup(await file.text());
    const updated = await getSettings();
    onChange(updated);
    setBackupStatus(`Imported ${count} saved items`);
  }

  return (
    <section className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <p>Capture stays local, encrypted, and easy to pause.</p>
      </div>
      <div className="settings-grid">
        <label className="setting-row">
          <span>Capture clipboard</span>
          <input type="checkbox" checked={settings.captureEnabled} onChange={(event) => patch({ captureEnabled: event.target.checked })} />
        </label>
        <label className="setting-row">
          <span>Suppress sensitive values</span>
          <input type="checkbox" checked={settings.suppressSensitive} onChange={(event) => patch({ suppressSensitive: event.target.checked })} />
        </label>
        <label className="setting-row">
          <span>Close to tray</span>
          <input type="checkbox" checked={settings.closeToTray} onChange={(event) => patch({ closeToTray: event.target.checked })} />
        </label>
        <label className="setting-row">
          <span>Minimize to tray</span>
          <input type="checkbox" checked={settings.minimizeToTray} onChange={(event) => patch({ minimizeToTray: event.target.checked })} />
        </label>
        <label className="setting-row">
          <span>Start minimized</span>
          <input type="checkbox" checked={settings.startMinimized} onChange={(event) => patch({ startMinimized: event.target.checked })} />
        </label>
        <label className="setting-row">
          <span>Launch on Windows startup</span>
          <input type="checkbox" checked={settings.launchOnStartup} onChange={(event) => patch({ launchOnStartup: event.target.checked })} />
        </label>
        <label className="setting-row">
          <span>Retention days</span>
          <input type="number" min={1} max={365} value={settings.retentionDays} onChange={(event) => patch({ retentionDays: Number(event.target.value) })} />
        </label>
        <label className="setting-row">
          <span>Storage cap MB</span>
          <input type="number" min={64} max={4096} value={settings.maxStorageMb} onChange={(event) => patch({ maxStorageMb: Number(event.target.value) })} />
        </label>
        <label className="setting-row wide">
          <span>Global hotkey</span>
          <input value={settings.hotkey} onChange={(event) => patch({ hotkey: event.target.value })} />
        </label>
        <label className="setting-row wide">
          <span>Excluded apps</span>
          <textarea value={settings.excludedApps.join("\n")} onChange={(event) => patch({ excludedApps: event.target.value.split("\n").filter(Boolean) })} />
        </label>
        <label className="setting-row wide">
          <span>Excluded title patterns</span>
          <textarea value={settings.excludedTitlePatterns.join("\n")} onChange={(event) => patch({ excludedTitlePatterns: event.target.value.split("\n").filter(Boolean) })} />
        </label>
        <div className="setting-row wide backup-row">
          <span>Encrypted backup</span>
          <p>Export notes, pinned clips, and settings into a local DPAPI-protected backup file.</p>
          <div className="backup-actions">
            <button className="secondary-button" onClick={handleExport}>
              <Download size={17} />
              Export
            </button>
            <label className="secondary-button file-button">
              <Upload size={17} />
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
            {backupStatus && <small className="backup-status">{backupStatus}</small>}
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoPanel() {
  return (
    <section className="settings-page">
      <div className="settings-header">
        <h1>Info</h1>
        <p>Creator, website, and license details for ClipVault.</p>
      </div>
      <div className="settings-grid">
        <div className="setting-row wide info-row">
          <span>ClipVault</span>
          <dl className="info-list">
            <div>
              <dt>Creator</dt>
              <dd>Amirsalar Saberi rad</dd>
            </div>
            <div>
              <dt>Website</dt>
              <dd>
                <button className="link-button" onClick={() => openExternal("https://amirsrad.ir")}>
                  <ExternalLink size={14} />
                  amirsrad.ir
                </button>
              </dd>
            </div>
            <div>
              <dt>License</dt>
              <dd>Copyright Amirsalar Saberi rad. All rights reserved.</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function PaletteOnly() {
  return (
    <div className="palette-window">
      <PaletteOverlay onClose={() => closePaletteWindow()} embedded />
    </div>
  );
}

function PaletteOverlay({ onClose, embedded = false }: { onClose: () => void | Promise<void>; embedded?: boolean }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"all" | "text" | "image" | "note" | "pinned">("all");
  const [contextMenu, setContextMenu] = useState<PaletteContextMenu>(null);
  const [isClosing, setIsClosing] = useState(false);

  const sectionTitle = mode === "note" ? "Notes" : mode === "image" ? "Images" : mode === "text" ? "Text" : mode === "pinned" ? "Pinned" : "Clipboard";
  const groupedItems = useMemo(() => {
    if (mode !== "all") return [{ key: mode, title: sectionTitle, items }];

    const clips = items.filter((item) => item.kind !== "note");
    const notes = items.filter((item) => item.kind === "note");
    return [
      { key: "notes", title: "Saved notes", items: notes },
      { key: "clipboard", title: "Clipboard", items: clips }
    ].filter((group) => group.items.length > 0);
  }, [items, mode, sectionTitle]);
  const displayItems = useMemo(() => groupedItems.flatMap((group) => group.items), [groupedItems]);
  const contextMenuText = contextMenu ? smartText(contextMenu.item) : "";
  const contextPasteActions = pasteTransformActions.filter((action) => contextMenuText.trim() && action.enabled?.(contextMenuText) !== false);

  useEffect(() => {
    if (!embedded || !("__TAURI_INTERNALS__" in window)) return;
    let unlistenOpened: (() => void) | undefined;
    let unlistenClosing: (() => void) | undefined;

    import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        unlistenOpened = await listen("palette-opened", () => {
          setQuery("");
          setMode("all");
          setActive(0);
          setContextMenu(null);
          setIsClosing(false);
        });

        unlistenClosing = await listen("palette-closing", () => {
          setContextMenu(null);
          setIsClosing(true);
        });
      })
      .catch(() => undefined);

    return () => {
      unlistenOpened?.();
      unlistenClosing?.();
    };
  }, [embedded]);

  useEffect(() => {
    const filters: ClipboardFilters =
      mode === "text"
        ? { kind: "text" }
        : mode === "image"
          ? { kind: "image" }
          : mode === "note"
            ? { kind: "note" }
            : mode === "pinned"
              ? { kind: "all", pinned: true }
              : { kind: "all" };

    searchItems({ query: "", filters, limit: 80, offset: 0 }).then((response) => {
      setItems(rankPaletteItems(response.items, query).slice(0, 16));
      setActive(0);
      setContextMenu(null);
    });
  }, [mode, query]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, []);

  useEffect(() => {
    const handle = async (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (event.altKey) {
        const nextMode = event.key === "1" ? "all" : event.key === "2" ? "text" : event.key === "3" ? "image" : event.key === "4" ? "note" : event.key === "5" ? "pinned" : null;
        if (nextMode) {
          event.preventDefault();
          setMode(nextMode);
          setActive(0);
          return;
        }
      }
      if (event.key === "Escape") {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        onClose();
      }
      if (event.key === "ArrowDown") setActive((value) => Math.min(value + 1, displayItems.length - 1));
      if (event.key === "ArrowUp") setActive((value) => Math.max(value - 1, 0));
      if (event.key === "Enter" && displayItems[active]) await pasteAndClose(displayItems[active].id);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && displayItems[active]) {
        if (target instanceof HTMLInputElement && target.selectionStart !== target.selectionEnd) return;
        event.preventDefault();
        const value = displayItems[active].text || displayItems[active].ocrText;
        if (value) await navigator.clipboard?.writeText(value);
      }
      if (!isTyping && event.key === "Delete" && displayItems[active]) {
        event.preventDefault();
        const id = displayItems[active].id;
        await deleteItem(id);
        setItems((current) => current.filter((item) => item.id !== id));
        setActive((value) => Math.max(0, Math.min(value, displayItems.length - 2)));
      }
      if (!isTyping && event.key.toLowerCase() === "p" && displayItems[active]) {
        event.preventDefault();
        const item = displayItems[active];
        await pinItem(item.id, !item.pinned);
        setItems((current) => current.map((candidate) => (candidate.id === item.id ? { ...candidate, pinned: !item.pinned } : candidate)));
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [active, contextMenu, displayItems, onClose]);

  async function pasteAndClose(id: string) {
    await onClose();
    try {
      await pasteItem(id);
    } catch (error) {
      console.error("Failed to paste item", error);
    }
  }

  async function pasteTransformedAndClose(item: ClipboardItem, transform: PasteTransform) {
    const transformed = transformText(smartText(item), transform);
    if (transformed === null) return;
    await onClose();
    try {
      await pasteText(transformed);
    } catch (error) {
      console.error("Failed to paste transformed text", error);
    }
  }

  function openItemContextMenu(event: ReactMouseEvent, item: ClipboardItem, displayIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    setActive(displayIndex);

    const menuWidth = 206;
    const menuHeight = smartText(item).trim() ? 338 : 112;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));
    setContextMenu({ item, x, y });
  }

  async function copyPaletteText(event: ReactMouseEvent | ReactKeyboardEvent, item: ClipboardItem) {
    event.preventDefault();
    event.stopPropagation();
    const value = item.text || item.ocrText;
    if (value) await navigator.clipboard?.writeText(value);
  }

  async function togglePinned(event: ReactMouseEvent | ReactKeyboardEvent, item: ClipboardItem) {
    event.preventDefault();
    event.stopPropagation();
    await pinItem(item.id, !item.pinned);
    setItems((current) => {
      const updated = current.map((candidate) => (candidate.id === item.id ? { ...candidate, pinned: !item.pinned } : candidate));
      return mode === "pinned" ? updated.filter((candidate) => candidate.pinned) : updated;
    });
  }

  async function copyContextText(item: ClipboardItem) {
    const value = smartText(item);
    if (value) await navigator.clipboard?.writeText(value);
    setContextMenu(null);
  }

  return (
    <div className={embedded ? "palette-root embedded" : "palette-backdrop"}>
      <div className={`${embedded ? "palette-panel embedded" : "palette-panel"} ${isClosing ? "closing" : ""}`}>
        <div className="palette-drag-strip" title="Drag popup" aria-label="Drag quick paste popup" onMouseDown={(event) => startPaletteDrag(event, embedded)}>
          <span />
        </div>
        <div className="palette-titlebar" onMouseDown={(event) => startPaletteDrag(event, embedded)}>
          <strong>ClipVault</strong>
          <div className="palette-window-actions">
            <button className="palette-title-button" onClick={() => openMainWindow()} title="Open ClipVault">
              <SquareArrowOutUpRight size={15} />
              <span>Open app</span>
            </button>
            <button className="palette-close" onClick={onClose} title="Close">
              <X size={17} />
            </button>
          </div>
        </div>
        <div className="palette-tabs">
          <button className={mode === "all" ? "active" : ""} onClick={() => setMode("all")} title="All clips (Alt+1)">
            <Clipboard size={16} />
          </button>
          <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")} title="Text clips (Alt+2)">
            <FileText size={16} />
          </button>
          <button className={mode === "image" ? "active" : ""} onClick={() => setMode("image")} title="Image clips (Alt+3)">
            <Image size={16} />
          </button>
          <button className={mode === "note" ? "palette-note-tab active" : "palette-note-tab"} onClick={() => setMode("note")} title="Notes (Alt+4)">
            <NotebookPen size={16} />
          </button>
          <button className={mode === "pinned" ? "active" : ""} onClick={() => setMode("pinned")} title="Pinned clips (Alt+5)">
            <Pin size={16} />
          </button>
        </div>
        <div className="palette-search">
          <Search size={19} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Paste from ClipVault" />
        </div>
        <div className="palette-hints">
          <kbd>Enter</kbd>
          <span>Paste</span>
          <kbd>Ctrl+C</kbd>
          <span>Copy</span>
          <kbd>Alt+1-5</kbd>
          <span>Sections</span>
        </div>
        <div className="palette-results">
          {groupedItems.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            groupedItems.map((group) => {
              let groupStart = 0;
              for (const prior of groupedItems) {
                if (prior.key === group.key) break;
                groupStart += prior.items.length;
              }

              return (
                <section key={group.key} className={group.key === "notes" ? "palette-result-group notes" : "palette-result-group"}>
                  <div className="palette-section-title">
                    <span>{group.title}</span>
                    <small>{group.items.length}</small>
                  </div>
                  {group.items.map((item, index) => {
                    const displayIndex = groupStart + index;
                    return (
                      <div
                        key={item.id}
                        className={`${displayIndex === active ? "palette-result active" : "palette-result"} ${item.kind === "note" ? "note-result" : ""}`}
                        onMouseEnter={() => setActive(displayIndex)}
                        onContextMenu={(event) => openItemContextMenu(event, item, displayIndex)}
                      >
                        <div
                          className="palette-card-main"
                          role="button"
                          tabIndex={0}
                          onClick={() => pasteAndClose(item.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") void pasteAndClose(item.id);
                          }}
                        >
                          <div className="palette-card-label">
                            {item.kind === "note" ? <NotebookPen size={13} /> : item.kind === "image" ? <Image size={13} /> : <Clipboard size={13} />}
                            <small>{item.kind === "note" ? "Note" : item.kind === "image" ? "Image clip" : "Clipboard clip"}</small>
                          </div>
                          <span>{previewText(item)}</span>
                          <small>{item.kind === "note" ? "Saved snippet" : item.sourceApp}</small>
                        </div>
                        <div className="palette-card-actions">
                          <button
                            className="palette-action-button"
                            title="Copy text"
                            disabled={!item.text && !item.ocrText}
                            onClick={(event) => copyPaletteText(event, item)}
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            className={item.pinned ? "palette-pin pinned" : "palette-pin"}
                            title={item.pinned ? "Unpin" : "Pin"}
                            onClick={(event) => togglePinned(event, item)}
                          >
                            {item.pinned ? <Pin size={15} /> : <PinOff size={15} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </section>
              );
            })
          )}
        </div>
        {contextMenu && (
          <div
            className="palette-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button role="menuitem" onClick={() => pasteAndClose(contextMenu.item.id)}>
              <Clipboard size={14} />
              Paste item
            </button>
            <button role="menuitem" disabled={!contextMenuText} onClick={() => copyContextText(contextMenu.item)}>
              <Copy size={14} />
              Copy text
            </button>
            {contextPasteActions.length > 0 && (
              <>
                <div className="palette-context-label">Paste as</div>
                {contextPasteActions.map((action) => (
                  <button key={action.key} role="menuitem" onClick={() => pasteTransformedAndClose(contextMenu.item, action.key)}>
                    <Clipboard size={14} />
                    {action.label}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

async function closePaletteWindow() {
  await closePalette();
}

async function startPaletteDrag(event: ReactMouseEvent, embedded: boolean) {
  if (!embedded || event.button !== 0 || !("__TAURI_INTERNALS__" in window)) return;
  const target = event.target as HTMLElement;
  if (target.closest("button")) return;

  event.preventDefault();
  event.stopPropagation();
  await startNativePaletteDrag();
}

export default App;
