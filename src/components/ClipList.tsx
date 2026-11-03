import { ChevronDown, Clipboard, FileText, Image, NotebookPen, Pin, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { groupByDay, looksLikeCode, previewText, relativeTime } from "../lib/clip";
import type { ClipboardItem } from "../types";

export type NoteTemplate = { label: string; icon: typeof Clipboard; tags: string[]; text: string };

export function ClipList({
  title,
  items,
  loading,
  selectedId,
  query,
  onQueryChange,
  onSelect,
  onPaste,
  onDelete,
  onTogglePin,
  filterBar,
  emptyMessage,
  primaryAction
}: {
  title: string;
  items: ClipboardItem[];
  loading: boolean;
  selectedId: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
  onPaste: (item: ClipboardItem) => void;
  onDelete: (item: ClipboardItem) => void;
  onTogglePin: (item: ClipboardItem) => void;
  filterBar?: ReactNode;
  emptyMessage: { title: string; body: string };
  primaryAction?: ReactNode;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupByDay(items), [items]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function moveSelection(delta: number) {
    if (items.length === 0) return;
    const index = items.findIndex((item) => item.id === selectedId);
    const next = Math.max(0, Math.min(items.length - 1, (index < 0 ? 0 : index) + delta));
    onSelect(items[next].id);
  }

  function handleListKey(event: ReactKeyboardEvent) {
    const selected = items.find((item) => item.id === selectedId);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (items[0]) onSelect(items[0].id);
    } else if (event.key === "End") {
      event.preventDefault();
      if (items.length) onSelect(items[items.length - 1].id);
    } else if (event.key === "Enter" && selected) {
      event.preventDefault();
      onPaste(selected);
    } else if (event.key === "Delete" && selected) {
      event.preventDefault();
      onDelete(selected);
    } else if (event.key.toLowerCase() === "p" && !event.ctrlKey && selected) {
      event.preventDefault();
      onTogglePin(selected);
    }
  }

  function handleSearchKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      onQueryChange("");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      listRef.current?.focus();
      moveSelection(selectedId ? 1 : 0);
    } else if (event.key === "Enter") {
      listRef.current?.focus();
    }
  }

  return (
    <section className="list-pane" aria-label={title}>
      <header className="pane-header">
        <div className="pane-title">
          <h1>{title}</h1>
          {!loading && <span className="count-badge">{items.length}</span>}
        </div>
        {primaryAction}
      </header>

      <div className="search-field">
        <Search size={15} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleSearchKey}
          placeholder="Search clips, OCR text, apps, tags"
          aria-label="Search"
        />
        {query ? (
          <button className="search-clear" onClick={() => onQueryChange("")} aria-label="Clear search">
            <X size={14} />
          </button>
        ) : (
          <kbd>Ctrl+F</kbd>
        )}
      </div>

      {filterBar}

      <div className="clip-list" ref={listRef} tabIndex={0} onKeyDown={handleListKey} role="listbox" aria-label={`${title} items`}>
        {loading && items.length === 0 ? (
          <div className="list-skeleton" aria-hidden>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="skeleton-row" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Clipboard size={22} />
            </div>
            <strong>{query ? "No matches" : emptyMessage.title}</strong>
            <span>{query ? `Nothing matches "${query}" in this view.` : emptyMessage.body}</span>
          </div>
        ) : (
          groups.map((group) => (
            <div className="clip-group" key={group.label}>
              <div className="group-label">{group.label}</div>
              {group.items.map((item) => (
                <ClipRow key={item.id} item={item} selected={item.id === selectedId} onSelect={() => onSelect(item.id)} onPaste={() => onPaste(item)} />
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ClipRow({ item, selected, onSelect, onPaste }: { item: ClipboardItem; selected: boolean; onSelect: () => void; onPaste: () => void }) {
  const Icon = item.kind === "image" ? Image : item.kind === "note" ? NotebookPen : FileText;
  const text = previewText(item);
  const code = item.kind !== "image" && looksLikeCode(text);

  return (
    <div
      className={`clip-row${selected ? " selected" : ""}${item.kind === "note" ? " note" : ""}`}
      data-id={item.id}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={onPaste}
    >
      {item.kind === "image" && item.imageUrl ? (
        <div className="clip-thumb">
          <img src={item.imageUrl} alt="" />
        </div>
      ) : (
        <div className={`clip-icon kind-${item.kind}`}>
          <Icon size={16} strokeWidth={1.9} />
        </div>
      )}
      <div className="clip-body">
        <p className={code ? "clip-text mono" : "clip-text"}>{item.kind === "image" && !item.ocrText ? item.sourceTitle || "Image" : text}</p>
        <div className="clip-meta">
          <span className="clip-source">{item.kind === "note" ? "Note" : item.sourceApp ?? "Unknown app"}</span>
          <span aria-hidden>·</span>
          <span>{relativeTime(item.createdAt)}</span>
          {item.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="tag-mini">
              {tag}
            </span>
          ))}
        </div>
      </div>
      {item.pinned && <Pin className="clip-pin" size={13} aria-label="Pinned" />}
    </div>
  );
}

export function FilterChips({
  options,
  value,
  onChange,
  allLabel
}: {
  options: string[];
  value: string | null;
  onChange: (value: string | null) => void;
  allLabel: string;
}) {
  return (
    <div className="chip-row" role="tablist">
      <button role="tab" aria-selected={value === null} className={value === null ? "chip active" : "chip"} onClick={() => onChange(null)}>
        {allLabel}
      </button>
      {options.map((option) => (
        <button key={option} role="tab" aria-selected={value === option} className={value === option ? "chip active" : "chip"} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}

export function NewNoteButton({ templates, onCreate }: { templates: NoteTemplate[]; onCreate: (template?: NoteTemplate) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="split-button">
      <button className="button accent" onClick={() => onCreate()}>
        <Plus size={15} />
        New note
      </button>
      <button
        className="button accent split-toggle"
        aria-label="New note from template"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-label">From template</div>
          {templates.map((template) => {
            const Icon = template.icon;
            return (
              <button
                key={template.label}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onCreate(template);
                }}
              >
                <Icon size={14} />
                {template.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
