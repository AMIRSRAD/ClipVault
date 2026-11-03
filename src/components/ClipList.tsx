import { Check, ChevronDown, Clipboard, FileText, Image, ListChecks, MoreHorizontal, NotebookPen, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { groupByDay, looksLikeCode, previewText, relativeTime } from "../lib/clip";
import type { ClipboardItem } from "../types";

export type NoteTemplate = { label: string; icon: typeof Clipboard; tags: string[]; text: string };

export type Selection = {
  active: boolean;
  checked: Set<string>;
  onToggle: (id: string, range: boolean) => void;
  onSelectAll: () => void;
  onStart: () => void;
  onDone: () => void;
  onDeleteChecked: () => void;
};

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
  primaryAction,
  selection,
  onClearHistory
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
  selection: Selection;
  onClearHistory: () => void;
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selection.onSelectAll();
      return;
    }
    if (selection.active) {
      if (event.key === " " && selected) {
        event.preventDefault();
        selection.onToggle(selected.id, event.shiftKey);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        selection.onDone();
        return;
      }
      if (event.key === "Delete" && selection.checked.size > 0) {
        event.preventDefault();
        selection.onDeleteChecked();
        return;
      }
    }
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
      {selection.active ? (
        <header className="pane-header selecting">
          <div className="pane-title">
            <h1>{selection.checked.size > 0 ? `${selection.checked.size} selected` : "Select items"}</h1>
          </div>
          <div className="header-actions">
            <button className="button small" onClick={selection.onSelectAll} disabled={items.length === 0}>
              {selection.checked.size === items.length && items.length > 0 ? "All selected" : "Select all"}
            </button>
            <button className="button small accent" onClick={selection.onDone}>
              Done
            </button>
          </div>
        </header>
      ) : (
        <header className="pane-header">
          <div className="pane-title">
            <h1>{title}</h1>
            {!loading && <span className="count-badge">{items.length}</span>}
          </div>
          <div className="header-actions">
            {primaryAction}
            <button className="icon-button" onClick={selection.onStart} disabled={items.length === 0} title="Select multiple items" aria-label="Select multiple items">
              <ListChecks size={17} />
            </button>
            <ListMenu onSelect={selection.onStart} onClearHistory={onClearHistory} canSelect={items.length > 0} />
          </div>
        </header>
      )}

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
                <ClipRow
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  selecting={selection.active}
                  checked={selection.checked.has(item.id)}
                  onSelect={() => onSelect(item.id)}
                  onToggle={(range) => selection.onToggle(item.id, range)}
                  onPaste={() => onPaste(item)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ClipRow({
  item,
  selected,
  selecting,
  checked,
  onSelect,
  onToggle,
  onPaste
}: {
  item: ClipboardItem;
  selected: boolean;
  selecting: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggle: (range: boolean) => void;
  onPaste: () => void;
}) {
  const Icon = item.kind === "image" ? Image : item.kind === "note" ? NotebookPen : FileText;
  const text = previewText(item);
  const code = item.kind !== "image" && looksLikeCode(text);

  return (
    <div
      className={`clip-row${selected ? " selected" : ""}${item.kind === "note" ? " note" : ""}${selecting ? " selecting" : ""}${checked ? " checked" : ""}`}
      data-id={item.id}
      role="option"
      aria-selected={selecting ? checked : selected}
      onClick={(event: ReactMouseEvent) => {
        if (selecting || event.ctrlKey || event.metaKey || event.shiftKey) {
          onSelect();
          onToggle(event.shiftKey);
          return;
        }
        onSelect();
      }}
      onDoubleClick={selecting ? undefined : onPaste}
    >
      {selecting && (
        <span className={checked ? "row-check on" : "row-check"} aria-hidden>
          {checked && <Check size={13} strokeWidth={3} />}
        </span>
      )}
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

function ListMenu({ onSelect, onClearHistory, canSelect }: { onSelect: () => void; onClearHistory: () => void; canSelect: boolean }) {
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
      <button
        className="icon-button"
        aria-label="More actions"
        aria-expanded={open}
        title="More actions"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" disabled={!canSelect} onClick={onSelect}>
            <ListChecks size={14} />
            Select items
          </button>
          <div className="menu-separator" />
          <button role="menuitem" className="danger" onClick={onClearHistory}>
            <Trash2 size={14} />
            Clear history…
          </button>
        </div>
      )}
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
