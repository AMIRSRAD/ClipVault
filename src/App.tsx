import { Code2, ListChecks, Mail, NotebookPen, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  capturePaused,
  closePalette,
  createNote,
  deleteItem,
  getItem,
  getSettings,
  installUpdate,
  pasteItem,
  pendingUpdate,
  pauseCapture,
  pinItem,
  resumeCapture,
  searchItems,
  setTags
} from "./api";
import { ClipList, FilterChips, NewNoteButton } from "./components/ClipList";
import type { NoteTemplate } from "./components/ClipList";
import { DetailPanel } from "./components/DetailPanel";
import { QuickPaste } from "./components/QuickPaste";
import { InfoPanel, SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import type { ViewKey } from "./components/Sidebar";
import { isTauriRuntime } from "./lib/clip";
import type { AppSettings, ClipboardFilters, ClipboardItem, UpdateInfo } from "./types";

const noteTemplates: NoteTemplate[] = [
  { label: "Meeting notes", icon: NotebookPen, tags: ["meeting"], text: "Meeting notes\n\nDate:\nAttendees:\n\nAgenda:\n- \n\nNotes:\n- \n\nAction items:\n- " },
  { label: "Todo list", icon: ListChecks, tags: ["todo"], text: "Todo\n\n- [ ] " },
  { label: "Code snippet", icon: Code2, tags: ["code"], text: "Snippet\n\n```ts\n\n```" },
  { label: "Prompt", icon: Sparkles, tags: ["prompts"], text: "Prompt\n\nContext:\n\nTask:\n\nConstraints:\n\nOutput:" },
  { label: "Email reply", icon: Mail, tags: ["emails"], text: "Subject:\n\nHi,\n\n\n\nBest," }
];

const noteCollections = ["work", "code", "emails", "prompts", "personal"];

const viewMeta: Record<Exclude<ViewKey, "settings" | "info">, { title: string; empty: { title: string; body: string } }> = {
  all: { title: "All clips", empty: { title: "Your clipboard history is empty", body: "Copy some text or an image and it will appear here." } },
  pinned: { title: "Pinned", empty: { title: "No pinned clips", body: "Pin clips you reuse so they never expire." } },
  text: { title: "Text", empty: { title: "No text clips", body: "Copied text will show up here." } },
  images: { title: "Images", empty: { title: "No images", body: "Screenshots and copied images will show up here." } },
  notes: { title: "Notes", empty: { title: "No notes yet", body: "Notes are reusable snippets that never expire." } },
  tags: { title: "Tags", empty: { title: "Nothing tagged", body: "Add tags to clips from the preview pane." } }
};

function filtersForView(view: ViewKey, tag: string | null, noteCollection: string | null): ClipboardFilters {
  if (view === "pinned") return { kind: "all", pinned: true };
  if (view === "text") return { kind: "text" };
  if (view === "images") return { kind: "image" };
  if (view === "notes") return { kind: "note", tag: noteCollection };
  if (view === "tags") return { kind: "all", tag };
  return { kind: "all" };
}

function App() {
  const [windowMode, setWindowMode] = useState<"main" | "palette">("main");

  useEffect(() => {
    if (!isTauriRuntime()) {
      if (new URLSearchParams(window.location.search).has("palette")) setWindowMode("palette");
      return;
    }
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => setWindowMode(getCurrentWindow().label === "palette" ? "palette" : "main"))
      .catch(() => setWindowMode("main"));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.window = windowMode;
  }, [windowMode]);

  return windowMode === "palette" ? <QuickPaste onClose={() => closePalette()} embedded /> : <MainShell />;
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
  const [paused, setPaused] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const toastTimer = useRef<number>();

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message });
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const response = await searchItems({ query, filters: filtersForView(view, selectedTag, noteCollection), limit: 200, offset: 0 });
      setItems(response.items);
      setSelectedId((current) => (current && response.items.some((item) => item.id === current) ? current : response.items[0]?.id ?? null));
    } finally {
      setLoading(false);
    }
  }, [noteCollection, query, selectedTag, view]);

  const refreshTags = useCallback(async () => {
    const response = await searchItems({ query: "", filters: { kind: "all" }, limit: 500, offset: 0 });
    setAllTags([...new Set(response.items.flatMap((item) => item.tags))].sort());
  }, []);

  const refreshPaused = useCallback(() => {
    capturePaused()
      .then(setPaused)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    getSettings().then(setSettings);
    refreshPaused();
    window.addEventListener("focus", refreshPaused);
    return () => window.removeEventListener("focus", refreshPaused);
  }, [refreshPaused]);

  useEffect(() => {
    pendingUpdate()
      .then(setUpdate)
      .catch(() => undefined);
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<UpdateInfo>("update-ready", (event) => setUpdate(event.payload)))
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadItems, query ? 120 : 0);
    return () => window.clearTimeout(timer);
  }, [loadItems, query]);

  useEffect(() => {
    if (view === "tags") void refreshTags();
  }, [refreshTags, view]);

  useEffect(() => {
    const reload = () => {
      if (document.visibilityState === "visible") void loadItems();
    };
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [loadItems]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    getItem(selectedId)
      .then((item) => {
        if (!item || cancelled) return;
        setItems((current) => current.map((candidate) => (candidate.id === item.id ? { ...item, imageUrl: item.imageUrl ?? candidate.imageUrl } : candidate)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen("open-settings", () => navigate("settings")))
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n" && !event.shiftKey) {
        event.preventDefault();
        void handleCreateNote();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function navigate(next: ViewKey) {
    setView(next);
    if (next !== "tags") setSelectedTag(null);
    if (next !== "notes") setNoteCollection(null);
  }

  async function refreshSelected(id: string) {
    const item = await getItem(id);
    if (!item) {
      await loadItems();
      return;
    }
    setItems((current) => current.map((candidate) => (candidate.id === id ? item : candidate)));
  }

  async function handleDelete(item: ClipboardItem) {
    const index = items.findIndex((candidate) => candidate.id === item.id);
    await deleteItem(item.id);
    const remaining = items.filter((candidate) => candidate.id !== item.id);
    setItems(remaining);
    if (selectedId === item.id) setSelectedId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
    showToast(item.kind === "note" ? "Note deleted" : "Clip deleted");
  }

  async function handlePin(item: ClipboardItem) {
    await pinItem(item.id, !item.pinned);
    if (view === "pinned" && item.pinned) {
      await loadItems();
    } else {
      await refreshSelected(item.id);
    }
    showToast(item.pinned ? "Unpinned" : "Pinned — this clip won't expire");
  }

  async function handleTagSave(item: ClipboardItem, tags: string[]) {
    await setTags(item.id, tags);
    await refreshSelected(item.id);
  }

  async function handlePaste(item: ClipboardItem) {
    try {
      await pasteItem(item.id);
      if (!isTauriRuntime()) {
        await navigator.clipboard?.writeText(item.text || item.ocrText || "");
        showToast("Copied (paste is only available in the desktop app)");
      }
    } catch {
      showToast("Couldn't paste that item");
    }
  }

  async function handleInstallUpdate() {
    try {
      showToast("Installing update…");
      await installUpdate();
    } catch (error) {
      showToast(typeof error === "string" ? error : "Couldn't install the update");
    }
  }

  async function handleTogglePause() {
    if (paused) await resumeCapture();
    else await pauseCapture(null);
    setPaused(!paused);
    showToast(paused ? "Capture resumed" : "Capture paused until you resume it");
  }

  async function handleCreateNote(template?: NoteTemplate) {
    const tags = template?.tags ?? (noteCollection ? [noteCollection] : []);
    const note = await createNote(template?.text ?? "", tags);
    navigate("notes");
    setQuery("");
    setItems((current) => [note, ...current.filter((item) => item.id !== note.id)]);
    setSelectedId(note.id);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".note-editor")?.focus(), 60);
  }

  const listTitle = view === "settings" || view === "info" ? "" : viewMeta[view].title;
  const filterBar = useMemo(() => {
    if (view === "notes") return <FilterChips options={noteCollections} value={noteCollection} onChange={setNoteCollection} allLabel="All notes" />;
    if (view === "tags") return allTags.length ? <FilterChips options={allTags} value={selectedTag} onChange={setSelectedTag} allLabel="Any tag" /> : null;
    return null;
  }, [allTags, noteCollection, selectedTag, view]);

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        onNavigate={navigate}
        paused={paused}
        onTogglePause={handleTogglePause}
        retentionDays={settings?.retentionDays ?? null}
        hotkey={settings?.hotkey ?? "Ctrl+Shift+V"}
        onQuickPaste={() => setPaletteOpen(true)}
        update={update && dismissedUpdate !== update.version ? update : null}
        onInstallUpdate={handleInstallUpdate}
        onDismissUpdate={() => update && setDismissedUpdate(update.version)}
      />

      <main className="content">
        {paused && (
          <div className="info-bar warning" role="status">
            <span className="info-bar-dot" aria-hidden />
            <strong>Capture is paused.</strong>
            <span>New copies aren't being saved.</span>
            <button className="button small" onClick={handleTogglePause}>
              Resume
            </button>
          </div>
        )}
        {view === "settings" ? (
          settings && <SettingsPanel settings={settings} onChange={setSettings} onToast={showToast} update={update} onUpdateFound={setUpdate} />
        ) : view === "info" ? (
          <InfoPanel update={update} onUpdateFound={setUpdate} onToast={showToast} />
        ) : (
          <div className="browser">
            <ClipList
              title={listTitle}
              items={items}
              loading={loading}
              selectedId={selected?.id ?? null}
              query={query}
              onQueryChange={setQuery}
              onSelect={setSelectedId}
              onPaste={handlePaste}
              onDelete={handleDelete}
              onTogglePin={handlePin}
              filterBar={filterBar}
              emptyMessage={viewMeta[view].empty}
              primaryAction={view === "notes" ? <NewNoteButton templates={noteTemplates} onCreate={handleCreateNote} /> : undefined}
            />
            <DetailPanel
              item={selected}
              onDelete={handleDelete}
              onPin={handlePin}
              onPaste={handlePaste}
              onTagSave={handleTagSave}
              onRefresh={refreshSelected}
              onToast={showToast}
            />
          </div>
        )}
      </main>

      {toast && (
        <div className="toast" key={toast.id} role="status">
          {toast.message}
        </div>
      )}

      {paletteOpen && <QuickPaste onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

export default App;
