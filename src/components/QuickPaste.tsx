import { Clipboard, Copy, FileText, Image, NotebookPen, Pin, PinOff, Search, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import clipvaultIcon from "../assets/clipvault-icon.png";
import { deleteItem, openMainWindow, pasteItem, pasteText, pinItem, searchItems, startPaletteDrag as startNativePaletteDrag } from "../api";
import { isTauriRuntime, looksLikeCode, pasteTransformActions, previewText, rankPaletteItems, relativeTime, smartText, transformText } from "../lib/clip";
import type { PasteTransform } from "../lib/clip";
import type { ClipboardFilters, ClipboardItem } from "../types";

type Mode = "all" | "text" | "image" | "note" | "pinned";
type ContextMenu = { item: ClipboardItem; x: number; y: number } | null;

const modes: Array<{ key: Mode; label: string }> = [
  { key: "all", label: "All" },
  { key: "text", label: "Text" },
  { key: "image", label: "Images" },
  { key: "note", label: "Notes" },
  { key: "pinned", label: "Pinned" }
];

const modeFilters: Record<Mode, ClipboardFilters> = {
  all: { kind: "all" },
  text: { kind: "text" },
  image: { kind: "image" },
  note: { kind: "note" },
  pinned: { kind: "all", pinned: true }
};

export function QuickPaste({ onClose, embedded = false }: { onClose: () => void | Promise<void>; embedded?: boolean }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>("all");
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    if (mode !== "all") return [{ key: mode, title: modes.find((entry) => entry.key === mode)?.label ?? "", items }];
    return [
      { key: "notes", title: "Notes", items: items.filter((item) => item.kind === "note") },
      { key: "clips", title: "Recent", items: items.filter((item) => item.kind !== "note") }
    ].filter((group) => group.items.length > 0);
  }, [items, mode]);
  const displayItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const contextText = contextMenu ? smartText(contextMenu.item) : "";
  const contextPasteActions = pasteTransformActions.filter((action) => contextText.trim() && action.enabled?.(contextText) !== false);

  useEffect(() => {
    if (!embedded || !isTauriRuntime()) return;
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
          setReloadKey((value) => value + 1);
          searchRef.current?.focus();
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
    let cancelled = false;
    searchItems({ query: "", filters: modeFilters[mode], limit: 80, offset: 0 }).then((response) => {
      if (cancelled) return;
      setItems(rankPaletteItems(response.items, query).slice(0, 20));
      setActive(0);
      setContextMenu(null);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, query, reloadKey]);

  useEffect(() => {
    resultsRef.current?.querySelector(".qp-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

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
      const current = displayItems[active];

      if (event.altKey && /^[1-5]$/.test(event.key)) {
        event.preventDefault();
        setMode(modes[Number(event.key) - 1].key);
        return;
      }
      if (event.key === "Tab" && !event.altKey && !event.ctrlKey) {
        event.preventDefault();
        const index = modes.findIndex((entry) => entry.key === mode);
        setMode(modes[(index + (event.shiftKey ? modes.length - 1 : 1)) % modes.length].key);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (contextMenu) setContextMenu(null);
        else if (query) setQuery("");
        else await onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((value) => Math.min(value + 1, displayItems.length - 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((value) => Math.max(value - 1, 0));
      }
      if (event.key === "Enter" && current) {
        event.preventDefault();
        await pasteAndClose(current.id);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && current) {
        if (target instanceof HTMLInputElement && target.selectionStart !== target.selectionEnd) return;
        event.preventDefault();
        const value = smartText(current);
        if (value) await navigator.clipboard?.writeText(value);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p" && current) {
        event.preventDefault();
        await togglePinned(current);
      }
      if (event.key === "Delete" && current && (!isTyping || !query)) {
        event.preventDefault();
        await deleteItem(current.id);
        setItems((list) => list.filter((item) => item.id !== current.id));
        setActive((value) => Math.max(0, Math.min(value, displayItems.length - 2)));
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [active, contextMenu, displayItems, mode, onClose, query]);

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

  async function togglePinned(item: ClipboardItem) {
    await pinItem(item.id, !item.pinned);
    setItems((current) => {
      const updated = current.map((candidate) => (candidate.id === item.id ? { ...candidate, pinned: !item.pinned } : candidate));
      return mode === "pinned" ? updated.filter((candidate) => candidate.pinned) : updated;
    });
  }

  function openContextMenu(event: ReactMouseEvent, item: ClipboardItem, index: number) {
    event.preventDefault();
    event.stopPropagation();
    setActive(index);
    const width = 200;
    const height = smartText(item).trim() ? 320 : 100;
    setContextMenu({
      item,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))
    });
  }

  function stop(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  let runningIndex = 0;

  return (
    <div className={embedded ? "qp-root embedded" : "qp-backdrop"} onMouseDown={embedded ? undefined : (event) => event.target === event.currentTarget && onClose()}>
      <div className={`qp${embedded ? " embedded" : ""}${isClosing ? " closing" : ""}`} role="dialog" aria-label="Quick paste">
        <header className="qp-header" onMouseDown={(event) => startPaletteDrag(event, embedded)}>
          <div className="qp-title">
            <img src={clipvaultIcon} alt="" />
            <span>Clipboard</span>
          </div>
          <div className="qp-header-actions">
            <button className="qp-icon" onClick={() => openMainWindow()} title="Open ClipVault" aria-label="Open ClipVault">
              <SquareArrowOutUpRight size={14} />
            </button>
            <button className="qp-icon" onClick={() => onClose()} title="Close (Esc)" aria-label="Close">
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="qp-search">
          <Search size={15} />
          <input ref={searchRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your clipboard" aria-label="Search" />
        </div>

        <div className="qp-tabs" role="tablist">
          {modes.map((entry, index) => (
            <button key={entry.key} role="tab" aria-selected={mode === entry.key} className={mode === entry.key ? "active" : ""} onClick={() => setMode(entry.key)} title={`${entry.label} (Alt+${index + 1})`}>
              {entry.label}
            </button>
          ))}
        </div>

        <div className="qp-results" ref={resultsRef} role="listbox">
          {groups.length === 0 ? (
            <div className="qp-empty">
              <Clipboard size={20} />
              <strong>{query ? "No matches" : "Nothing here yet"}</strong>
              <span>{query ? "Try a different search." : "Copy something and it will show up here."}</span>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="qp-group">
                {groups.length > 1 && <div className="qp-group-label">{group.title}</div>}
                {group.items.map((item) => {
                  const index = runningIndex++;
                  const text = previewText(item).replace(/\n\s*\n+/g, "\n");
                  const KindIcon = item.kind === "note" ? NotebookPen : item.kind === "image" ? Image : FileText;
                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={index === active}
                      className={`qp-item${index === active ? " active" : ""}${item.kind === "note" ? " note" : ""}`}
                      onMouseMove={() => index !== active && setActive(index)}
                      onClick={() => pasteAndClose(item.id)}
                      onContextMenu={(event) => openContextMenu(event, item, index)}
                    >
                      {item.kind === "image" && item.imageUrl ? (
                        <div className="qp-image">
                          <img src={item.imageUrl} alt="" />
                        </div>
                      ) : (
                        <p className={looksLikeCode(text) ? "qp-text mono" : "qp-text"}>{text}</p>
                      )}
                      <div className="qp-meta">
                        <KindIcon size={12} />
                        <span className="qp-source">{item.kind === "note" ? "Note" : item.sourceApp ?? "Unknown app"}</span>
                        <span>· {relativeTime(item.createdAt)}</span>
                        {item.pinned && <Pin className="qp-pinned" size={11} aria-label="Pinned" />}
                      </div>
                      <div className="qp-item-actions">
                        <button
                          className="qp-icon"
                          title="Copy"
                          aria-label="Copy"
                          disabled={!smartText(item)}
                          onClick={async (event) => {
                            stop(event);
                            await navigator.clipboard?.writeText(smartText(item));
                          }}
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          className={item.pinned ? "qp-icon pinned" : "qp-icon"}
                          title={item.pinned ? "Unpin (Ctrl+P)" : "Pin (Ctrl+P)"}
                          aria-label={item.pinned ? "Unpin" : "Pin"}
                          onClick={(event) => {
                            stop(event);
                            void togglePinned(item);
                          }}
                        >
                          {item.pinned ? <Pin size={13} /> : <PinOff size={13} />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <footer className="qp-footer">
          <span>
            <kbd>↵</kbd> Paste
          </span>
          <span>
            <kbd>Ctrl+C</kbd> Copy
          </span>
          <span>
            <kbd>Ctrl+P</kbd> Pin
          </span>
          <span>
            <kbd>Tab</kbd> Section
          </span>
        </footer>

        {contextMenu && (
          <div
            className="menu context"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button role="menuitem" onClick={() => pasteAndClose(contextMenu.item.id)}>
              <Clipboard size={14} />
              Paste
            </button>
            <button
              role="menuitem"
              disabled={!contextText}
              onClick={async () => {
                await navigator.clipboard?.writeText(contextText);
                setContextMenu(null);
              }}
            >
              <Copy size={14} />
              Copy
            </button>
            <button
              role="menuitem"
              onClick={() => {
                void togglePinned(contextMenu.item);
                setContextMenu(null);
              }}
            >
              {contextMenu.item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              {contextMenu.item.pinned ? "Unpin" : "Pin"}
            </button>
            {contextPasteActions.length > 1 && (
              <>
                <div className="menu-separator" />
                <div className="menu-label">Paste as</div>
                {contextPasteActions
                  .filter((action) => action.key !== "plain")
                  .map((action) => (
                    <button key={action.key} role="menuitem" onClick={() => pasteTransformedAndClose(contextMenu.item, action.key)}>
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

async function startPaletteDrag(event: ReactMouseEvent, embedded: boolean) {
  if (!embedded || event.button !== 0 || !isTauriRuntime()) return;
  if ((event.target as HTMLElement).closest("button")) return;
  event.preventDefault();
  event.stopPropagation();
  await startNativePaletteDrag();
}
