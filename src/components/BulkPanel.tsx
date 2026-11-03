import { Copy, Pin, PinOff, Trash2, X } from "lucide-react";
import type { ClipboardItem } from "../types";

export function BulkPanel({
  items,
  onDelete,
  onPin,
  onCopy,
  onClear
}: {
  items: ClipboardItem[];
  onDelete: () => void;
  onPin: (pinned: boolean) => void;
  onCopy: () => void;
  onClear: () => void;
}) {
  const allPinned = items.every((item) => item.pinned);
  const copyable = items.some((item) => item.text || item.ocrText);
  const counts = {
    text: items.filter((item) => item.kind === "text").length,
    image: items.filter((item) => item.kind === "image").length,
    note: items.filter((item) => item.kind === "note").length
  };
  const summary = [
    counts.text && `${counts.text} text`,
    counts.image && `${counts.image} ${counts.image === 1 ? "image" : "images"}`,
    counts.note && `${counts.note} ${counts.note === 1 ? "note" : "notes"}`
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="detail-pane bulk-pane" aria-label="Selected items">
      <div className="bulk-center">
        <div className="bulk-stack" aria-hidden>
          {items.slice(0, 3).map((item, index) => (
            <span key={item.id} style={{ transform: `translate(${index * 6}px, ${index * -6}px)` }} />
          ))}
        </div>
        <h2>
          {items.length} {items.length === 1 ? "item" : "items"} selected
        </h2>
        <p>{summary}</p>

        <div className="bulk-actions">
          <button className="button" onClick={onCopy} disabled={!copyable}>
            <Copy size={15} />
            Copy text
          </button>
          <button className="button" onClick={() => onPin(!allPinned)}>
            {allPinned ? <PinOff size={15} /> : <Pin size={15} />}
            {allPinned ? "Unpin" : "Pin"}
          </button>
          <button className="button danger-fill" onClick={onDelete}>
            <Trash2 size={15} />
            Delete
          </button>
        </div>
        <button className="button subtle" onClick={onClear}>
          <X size={14} />
          Clear selection
        </button>
        <p className="bulk-hint">
          <kbd>Ctrl A</kbd> select all · <kbd>Del</kbd> delete · <kbd>Esc</kbd> done
        </p>
      </div>
    </section>
  );
}
