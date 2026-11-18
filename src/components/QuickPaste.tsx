import { Check, ChevronUp, ClipboardPaste, Copy, FileText, Image, NotebookPen, Pin, PinOff, Search, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
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

const JOINERS = {
  newline: { label: "New line", value: "\n" },
  blank: { label: "Blank line", value: "\n\n" },
  space: { label: "Space", value: " " },
  comma: { label: "Comma", value: ", " },
  none: { label: "Nothing", value: "" }
} as const;

type JoinerKey = keyof typeof JOINERS;

function loadJoiner(): JoinerKey {
  try {
    const saved = window.localStorage.getItem("clipvault.joiner");
    if (saved && saved in JOINERS) return saved as JoinerKey;
  } catch {
    // Storage can be unavailable; the default is fine.
  }
  return "newline";
}

/** Only text-bearing clips can be joined into one paste. */
function isPickable(item: ClipboardItem): boolean {
  return item.kind !== "image" && Boolean(item.text);
}

export function QuickPaste({ onClose, embedded = false }: { onClose: () => void | Promise<void>; embedded?: boolean }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>("all");
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<ClipboardItem[]>([]);
  const [joiner, setJoiner] = useState<JoinerKey>(loadJoiner);
  const [joinOpen, setJoinOpen] = useState(false);
  const anchorRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    if (mode !== "all") return [{ key: mode, title: "", items }];
    const pinned = items.filter((item) => item.pinned);
    const recent = items.filter((item) => !item.pinned);
    return [
      { key: "pinned", title: "Pinned", items: pinned },
      { key: "recent", title: pinned.length ? "Recent" : "", items: recent }
    ].filter((group) => group.items.length > 0);
  }, [items, mode]);
  const displayItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selecting = picked.length > 0;
  const pickedOrder = useMemo(() => new Map(picked.map((item, index) => [item.id, index + 1])), [picked]);
  const contextText = contextMenu ? smartText(contextMenu.item) : "";
  const contextPasteActions = pasteTransformActions.filter((action) => action.key !== "plain" && contextText.trim() && action.enabled?.(contextText) !== false);

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
          setPicked([]);
          setJoinOpen(false);
          anchorRef.current = null;
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
      setItems(rankPaletteItems(response.items, query).slice(0, 30));
      setActive(0);
      setContextMenu(null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, query, reloadKey]);

  useEffect(() => {
    listRef.current?.querySelector(".qp-row.active")?.scrollIntoView({ block: "nearest" });
  }, [active, items]);

  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      setJoinOpen(false);
    };
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
        if (joinOpen) setJoinOpen(false);
        else if (contextMenu) setContextMenu(null);
        else if (selecting) clearPicked();
        else if (query) setQuery("");
        else await onClose();
        return;
      }
      if (event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        // Shift+arrows extends the selection, like in any list.
        event.preventDefault();
        const next = Math.max(0, Math.min(displayItems.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)));
        addPicks([displayItems[active], displayItems[next]].filter(Boolean));
        setActive(next);
        return;
      }
      if (event.key === " " && !event.ctrlKey && !event.altKey && !event.metaKey && query === "" && current) {
        event.preventDefault();
        togglePick(current);
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
      if (event.key === "Enter" && selecting) {
        event.preventDefault();
        await pasteSelected();
        return;
      }
      if (event.key === "Enter" && current) {
        event.preventDefault();
        await pasteAndClose(current.id);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && (current || selecting)) {
        if (target instanceof HTMLInputElement && target.selectionStart !== target.selectionEnd) return;
        event.preventDefault();
        const value = selecting ? joinedPicks() : smartText(current);
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
        setPicked((list) => list.filter((item) => item.id !== current.id));
        setActive((value) => Math.max(0, Math.min(value, displayItems.length - 2)));
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [active, contextMenu, displayItems, joinOpen, joiner, mode, onClose, picked, query, selecting]);

  function joinedPicks(): string {
    return picked.map((item) => item.text ?? "").join(JOINERS[joiner].value);
  }

  function addPicks(candidates: ClipboardItem[]) {
    setPicked((current) => {
      const next = [...current];
      for (const item of candidates) {
        if (isPickable(item) && !next.some((picked) => picked.id === item.id)) next.push(item);
      }
      return next;
    });
  }

  function togglePick(item: ClipboardItem) {
    if (!isPickable(item)) return;
    anchorRef.current = item.id;
    setPicked((current) => (current.some((picked) => picked.id === item.id) ? current.filter((picked) => picked.id !== item.id) : [...current, item]));
  }

  function pickRange(toIndex: number) {
    const anchorIndex = anchorRef.current ? displayItems.findIndex((item) => item.id === anchorRef.current) : active;
    const from = anchorIndex >= 0 ? anchorIndex : active;
    const slice = displayItems.slice(Math.min(from, toIndex), Math.max(from, toIndex) + 1);
    addPicks(slice);
  }

  function clearPicked() {
    setPicked([]);
    anchorRef.current = null;
  }

  function chooseJoiner(key: JoinerKey) {
    setJoiner(key);
    setJoinOpen(false);
    try {
      window.localStorage.setItem("clipvault.joiner", key);
    } catch {
      // Remembering the choice is a convenience only.
    }
  }

  async function pasteSelected() {
    const text = joinedPicks();
    if (!text) return;
    await onClose();
    try {
      await pasteText(text);
    } catch (error) {
      console.error("Failed to paste selection", error);
    }
  }

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
    const width = 188;
    const height = contextPasteActions.length ? 36 * 4 + 32 + contextPasteActions.length * 32 + 24 : 36 * 4 + 16;
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
        <div className="qp-grab" onMouseDown={(event) => startPaletteDrag(event, embedded)} title="Drag to move">
          <span />
        </div>

        <div className="qp-search">
          <Search size={16} strokeWidth={2} />
          <input ref={searchRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your clipboard" aria-label="Search" spellCheck={false} />
          {query && (
            <button className="qp-clear" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="qp-tabs" role="tablist">
          {modes.map((entry, index) => (
            <button key={entry.key} role="tab" aria-selected={mode === entry.key} className={mode === entry.key ? "active" : ""} onClick={() => setMode(entry.key)} title={`${entry.label} (Alt+${index + 1})`}>
              {entry.label}
            </button>
          ))}
        </div>

        <div className="qp-list" ref={listRef} role="listbox">
          {groups.length === 0 ? (
            loaded && (
              <div className="qp-empty">
                <ClipboardPaste size={22} strokeWidth={1.6} />
                <strong>{query ? "No matches" : mode === "all" ? "Nothing copied yet" : `No ${modes.find((entry) => entry.key === mode)?.label.toLowerCase()}`}</strong>
                <span>{query ? "Try a different search." : "Things you copy will show up here."}</span>
              </div>
            )
          ) : (
            groups.map((group) => (
              <section key={group.key} className="qp-group">
                {group.title && <div className="qp-label">{group.title}</div>}
                {group.items.map((item) => {
                  const index = runningIndex++;
                  const text = previewText(item).replace(/\n\s*\n+/g, "\n");
                  const isImage = item.kind === "image";
                  const KindIcon = item.kind === "note" ? NotebookPen : isImage ? Image : FileText;
                  const sub = item.kind === "note" ? "Note" : item.sourceApp ?? "Unknown app";
                  const pickable = isPickable(item);
                  const order = pickedOrder.get(item.id);
                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={index === active}
                      className={`qp-row${index === active ? " active" : ""}${item.kind === "note" ? " note" : ""}${order ? " picked" : ""}${selecting ? " selecting" : ""}${pickable ? "" : " unpickable"}`}
                      onMouseMove={() => index !== active && setActive(index)}
                      onClick={(event) => {
                        if (event.ctrlKey || event.metaKey) togglePick(item);
                        else if (event.shiftKey) pickRange(index);
                        else if (selecting) togglePick(item);
                        else void pasteAndClose(item.id);
                      }}
                      onContextMenu={(event) => openContextMenu(event, item, index)}
                    >
                      {pickable && (
                        <button
                          className={order ? "qp-check on" : "qp-check"}
                          role="checkbox"
                          aria-checked={Boolean(order)}
                          aria-label={order ? "Remove from selection" : "Add to selection"}
                          title={order ? "Remove from selection (Space)" : "Select to paste several at once (Space)"}
                          onClick={(event) => {
                            stop(event);
                            togglePick(item);
                          }}
                        >
                          {order ? <span>{order}</span> : null}
                        </button>
                      )}
                      {isImage && item.imageUrl ? (
                        <div className="qp-thumb">
                          <img src={item.imageUrl} alt="" />
                        </div>
                      ) : (
                        <div className="qp-lead">
                          <KindIcon size={15} strokeWidth={1.9} />
                        </div>
                      )}
                      <div className="qp-main">
                        <p className={looksLikeCode(text) ? "qp-text mono" : "qp-text"}>{isImage && !item.ocrText ? "Image" : text}</p>
                        <span className="qp-sub">
                          {sub} · {relativeTime(item.createdAt)}
                        </span>
                      </div>
                      <div className="qp-tail">
                        {item.pinned && <Pin className="qp-pin-mark" size={12} aria-label="Pinned" />}
                        <div className="qp-actions">
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
                            <Copy size={14} />
                          </button>
                          <button
                            className="qp-icon"
                            title={item.pinned ? "Unpin (Ctrl+P)" : "Pin (Ctrl+P)"}
                            aria-label={item.pinned ? "Unpin" : "Pin"}
                            onClick={(event) => {
                              stop(event);
                              void togglePinned(item);
                            }}
                          >
                            {item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>

        {selecting ? (
          <footer className="qp-footer multi">
            <div className="qp-multi-left">
              <span className="qp-count">{picked.length} selected</span>
              <div className="qp-join">
                <button
                  className="qp-link"
                  aria-haspopup="menu"
                  aria-expanded={joinOpen}
                  title="What goes between the pasted items"
                  onClick={(event) => {
                    event.stopPropagation();
                    setJoinOpen((value) => !value);
                  }}
                >
                  Join: {JOINERS[joiner].label}
                  <ChevronUp size={12} />
                </button>
                {joinOpen && (
                  <div className="menu up" role="menu" onClick={(event) => event.stopPropagation()}>
                    <div className="menu-label">Put between items</div>
                    {(Object.keys(JOINERS) as JoinerKey[]).map((key) => (
                      <button key={key} role="menuitemradio" aria-checked={key === joiner} onClick={() => chooseJoiner(key)}>
                        {JOINERS[key].label}
                        {key === joiner && <Check size={14} className="menu-check" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="qp-multi-right">
              <button className="qp-link" onClick={clearPicked} title="Clear selection (Esc)">
                Clear
              </button>
              <button className="button accent small" onClick={() => void pasteSelected()} title="Paste all selected items (Enter)">
                Paste {picked.length}
              </button>
            </div>
          </footer>
        ) : (
          <footer className="qp-footer">
            <div className="qp-hints">
              <span>
                <kbd>↵</kbd> Paste
              </span>
              <span>
                <kbd>Space</kbd> Select
              </span>
              <span>
                <kbd>Ctrl C</kbd> Copy
              </span>
            </div>
            <button className="qp-icon" onClick={() => openMainWindow()} title="Open ClipVault" aria-label="Open ClipVault">
              <SquareArrowOutUpRight size={14} />
            </button>
          </footer>
        )}

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
              <ClipboardPaste size={14} />
              Paste
            </button>
            {isPickable(contextMenu.item) && (
              <button
                role="menuitem"
                onClick={() => {
                  togglePick(contextMenu.item);
                  setContextMenu(null);
                }}
              >
                <Check size={14} />
                {pickedOrder.has(contextMenu.item.id) ? "Deselect" : "Select"}
              </button>
            )}
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
            {contextPasteActions.length > 0 && (
              <>
                <div className="menu-separator" />
                <div className="menu-label">Paste as</div>
                {contextPasteActions.map((action) => (
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
