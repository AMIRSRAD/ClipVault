import { Braces, ChevronDown, Clipboard, ClipboardPaste, Code2, Copy, ExternalLink, FileText, FolderOpen, Globe, Image, Mail, NotebookPen, Pin, PinOff, ScanText, Tag, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { openExternal, pasteText, runOcr, updateNote } from "../api";
import {
  beautifyCode,
  extractEmails,
  firstFilePath,
  firstUrl,
  formatBytes,
  formatJson,
  fullTimestamp,
  kindLabel,
  looksLikeCode,
  pasteTransformActions,
  smartText,
  transformText,
  urlDomain
} from "../lib/clip";
import type { ClipboardItem, OcrResponse } from "../types";

export function DetailPanel({
  item,
  onDelete,
  onPin,
  onPaste,
  onTagSave,
  onRefresh,
  onToast
}: {
  item: ClipboardItem | null;
  onDelete: (item: ClipboardItem) => Promise<void>;
  onPin: (item: ClipboardItem) => Promise<void>;
  onPaste: (item: ClipboardItem) => Promise<void>;
  onTagSave: (item: ClipboardItem, tags: string[]) => Promise<void>;
  onRefresh: (id: string) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [noteText, setNoteText] = useState("");
  const [ocr, setOcr] = useState<OcrResponse | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);

  useEffect(() => {
    setNoteText(item?.kind === "note" ? item.text ?? "" : "");
    setOcr(null);
  }, [item?.id]);

  if (!item) {
    return (
      <section className="detail-pane">
        <div className="empty-state">
          <div className="empty-icon">
            <Clipboard size={22} />
          </div>
          <strong>Nothing selected</strong>
          <span>Pick an item from the list to preview it here.</span>
        </div>
      </section>
    );
  }

  const current = item;
  const text = smartText(current);
  const isCode = current.kind !== "image" && looksLikeCode(text);
  const noteDirty = current.kind === "note" && noteText !== (current.text ?? "");
  const KindIcon = current.kind === "image" ? Image : current.kind === "note" ? NotebookPen : FileText;
  const title = current.kind === "note" ? firstLine(noteText) || "Untitled note" : current.sourceTitle || current.sourceApp || "Clipboard item";

  async function copyText(value: string, message: string) {
    await navigator.clipboard?.writeText(value);
    onToast(message);
  }

  async function handleOcr() {
    setOcrRunning(true);
    try {
      const response = await runOcr(current.id);
      setOcr(response);
      await onRefresh(current.id);
      if (response.status === "ready") onToast("Text extracted");
    } finally {
      setOcrRunning(false);
    }
  }

  async function saveNote() {
    if (!noteDirty) return;
    await updateNote(current.id, noteText);
    await onRefresh(current.id);
    onToast("Note saved");
  }

  async function applyText(value: string, message: string) {
    if (current.kind === "note") {
      setNoteText(value);
      await updateNote(current.id, value);
      await onRefresh(current.id);
      onToast(message);
      return;
    }
    await copyText(value, `${message} and copied`);
  }

  return (
    <section className="detail-pane" aria-label="Preview">
      <header className="detail-header">
        <div className="detail-titles">
          <h2 title={title}>
            {current.pinned && <Pin className="title-pin" size={15} aria-label="Pinned" />}
            {title}
          </h2>
          <p className="detail-sub">
            <KindIcon size={13} strokeWidth={1.9} />
            {kindLabel(current)}
            <span aria-hidden>·</span>
            {current.kind === "note" ? "Saved note" : current.sourceApp ?? "Unknown app"}
            <span aria-hidden>·</span>
            {fullTimestamp(current.createdAt)}
          </p>
        </div>
        <div className="command-bar">
          <PasteSplit item={current} text={current.kind === "note" ? noteText : text} onPaste={() => onPaste(current)} />
          <button className="icon-button" onClick={() => text && copyText(text, "Copied to clipboard")} disabled={!text} title="Copy text" aria-label="Copy text">
            <Copy size={16} />
          </button>
          <button className="icon-button" onClick={() => onPin(current)} title={current.pinned ? "Unpin (P)" : "Pin (P)"} aria-label={current.pinned ? "Unpin" : "Pin"}>
            {current.pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
          <button className="icon-button danger" onClick={() => onDelete(current)} title="Delete (Del)" aria-label="Delete">
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div className="detail-scroll">
        <div className={`preview-card${current.kind === "image" ? " image" : ""}${current.kind === "note" ? " note" : ""}`}>
          {current.kind === "note" ? (
            <textarea
              className={isCode ? "note-editor mono" : "note-editor"}
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              onBlur={saveNote}
              onKeyDown={(event: ReactKeyboardEvent) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  void saveNote();
                }
              }}
              placeholder="Write a note…"
              spellCheck
            />
          ) : current.kind === "image" && current.imageUrl ? (
            <img src={current.imageUrl} alt="Copied image" />
          ) : (
            <pre className={isCode ? "mono" : undefined}>{current.text}</pre>
          )}
        </div>
        <div className="preview-stats">
          {current.kind === "image" ? (
            <span>{formatBytes(current.sizeBytes)}</span>
          ) : (
            <>
              <span>{plural((current.kind === "note" ? noteText : text).length, "character")}</span>
              <span>{plural((current.kind === "note" ? noteText : text).split("\n").length, "line")}</span>
            </>
          )}
          {current.kind === "note" && <span className={noteDirty ? "save-state dirty" : "save-state"}>{noteDirty ? "Unsaved · Ctrl+S" : "Saved"}</span>}
          {current.expiresAt && !current.pinned && <span>Expires {new Date(current.expiresAt).toLocaleDateString()}</span>}
        </div>

        {current.kind === "image" && (
          <DetailSection title="Text in image">
            {current.ocrText ? (
              <div className="ocr-block">
                <p>{current.ocrText}</p>
                <button className="button subtle small" onClick={() => copyText(current.ocrText ?? "", "Image text copied")}>
                  <Copy size={13} />
                  Copy text
                </button>
              </div>
            ) : (
              <div className="ocr-block empty">
                <p>{ocr && ocr.status !== "ready" ? ocr.message : "Extract text from this image with Windows OCR. Runs locally."}</p>
                <button className="button small" onClick={handleOcr} disabled={ocrRunning}>
                  <ScanText size={13} />
                  {ocrRunning ? "Reading…" : "Extract text"}
                </button>
              </div>
            )}
          </DetailSection>
        )}

        <SmartActions item={current} text={current.kind === "note" ? noteText : text} onApply={applyText} onCopy={copyText} />

        <div className="tags-row">
          <Tag size={14} aria-hidden />
          <TagEditor tags={current.tags} onChange={(tags) => onTagSave(current, tags)} />
        </div>
      </div>
    </section>
  );
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim())?.trim().slice(0, 80) ?? "";
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function SmartActions({
  item,
  text,
  onApply,
  onCopy
}: {
  item: ClipboardItem;
  text: string;
  onApply: (text: string, message: string) => Promise<void>;
  onCopy: (value: string, message: string) => Promise<void>;
}) {
  const url = firstUrl(text);
  const domain = url ? urlDomain(url) : null;
  const filePath = firstFilePath(text);
  const emails = extractEmails(text);
  const json = formatJson(text);
  const code = item.kind !== "image" && looksLikeCode(text);
  const cleaned = code ? beautifyCode(text) : null;

  const actions = [
    url && { key: "url", icon: ExternalLink, label: "Open link", run: () => openExternal(url), title: url },
    domain && { key: "domain", icon: Globe, label: `Copy ${domain}`, run: () => onCopy(domain, "Domain copied") },
    filePath && { key: "path", icon: FolderOpen, label: "Open in Explorer", run: () => openExternal(filePath), title: filePath },
    json && json !== text && { key: "json", icon: Braces, label: "Format JSON", run: () => onApply(json, "JSON formatted") },
    cleaned && cleaned !== text && { key: "code", icon: Code2, label: "Clean up code", run: () => onApply(cleaned, "Code cleaned up") },
    emails.length > 0 && {
      key: "emails",
      icon: Mail,
      label: emails.length === 1 ? "Copy email" : `Copy ${emails.length} emails`,
      run: () => onCopy(emails.join("\n"), emails.length === 1 ? "Email copied" : "Emails copied")
    }
  ].filter(Boolean) as Array<{ key: string; icon: typeof Globe; label: string; run: () => void; title?: string }>;

  if (actions.length === 0) return null;

  return (
    <div className="suggest-row" aria-label="Suggested actions">
      {actions.map(({ key, icon: Icon, label, run, title }) => (
        <button key={key} className="suggest" onClick={run} title={title}>
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}

function PasteSplit({ item, text, onPaste }: { item: ClipboardItem; text: string; onPaste: () => void }) {
  const [open, setOpen] = useState(false);
  const actions = item.kind === "image" || !text.trim() ? [] : pasteTransformActions.filter((action) => action.key !== "plain" && action.enabled?.(text) !== false);

  useEffect(() => {
    setOpen(false);
  }, [item.id]);

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

  async function pasteAs(key: (typeof actions)[number]["key"]) {
    setOpen(false);
    const transformed = transformText(text, key);
    if (transformed !== null) await pasteText(transformed);
  }

  return (
    <div className="split-button">
      <button className="button accent" onClick={onPaste} title="Paste into the last active app (Enter)">
        <ClipboardPaste size={15} />
        Paste
      </button>
      {actions.length > 0 && (
        <button
          className="button accent split-toggle"
          aria-label="Paste as…"
          aria-expanded={open}
          title="Paste as…"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          <ChevronDown size={15} />
        </button>
      )}
      {open && (
        <div className="menu" role="menu">
          <div className="menu-label">Paste as</div>
          {actions.map((action) => (
            <button key={action.key} role="menuitem" onClick={() => pasteAs(action.key)}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function commit() {
    const additions = draft
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag && !tags.includes(tag));
    setDraft("");
    if (additions.length) onChange([...tags, ...additions]);
  }

  return (
    <div className="tag-editor">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button onClick={() => onChange(tags.filter((candidate) => candidate !== tag))} aria-label={`Remove tag ${tag}`}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          } else if (event.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        placeholder={tags.length ? "Add tag" : "Add a tag and press Enter"}
        aria-label="Add tag"
      />
    </div>
  );
}
