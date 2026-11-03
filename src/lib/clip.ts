import type { ClipboardItem } from "../types";

export type PasteTransform = "plain" | "trim" | "singleLine" | "upper" | "lower" | "title" | "jsonPretty" | "jsonMinify";

export const pasteTransformActions: Array<{ key: PasteTransform; label: string; enabled?: (text: string) => boolean }> = [
  { key: "plain", label: "Plain text" },
  { key: "trim", label: "Trimmed" },
  { key: "singleLine", label: "Single line" },
  { key: "upper", label: "UPPERCASE" },
  { key: "lower", label: "lowercase" },
  { key: "title", label: "Title Case" },
  { key: "jsonPretty", label: "Pretty JSON", enabled: (text) => Boolean(formatJson(text)) },
  { key: "jsonMinify", label: "Minified JSON", enabled: (text) => Boolean(formatJson(text)) }
];

export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function previewText(item: ClipboardItem): string {
  if (item.kind === "image") return item.ocrText || "Image";
  if (item.kind === "note") return item.text || "Empty note";
  return item.text || "";
}

export function smartText(item: ClipboardItem): string {
  return item.text || item.ocrText || "";
}

export function kindLabel(item: ClipboardItem): string {
  if (item.kind === "note") return "Note";
  if (item.kind === "image") return "Image";
  return "Text";
}

export function looksLikeCode(text: string): boolean {
  if (!text.includes("\n") && text.length < 24) return false;
  return /[{};]\s*$|^\s*(?:import|export|const|let|var|function|class|def|SELECT|INSERT|UPDATE|pnpm|npm|git|cargo)\b|=>|<\/?[a-z][\w-]*>/im.test(text);
}

export function firstUrl(text: string): string | null {
  return text.match(/\bhttps?:\/\/[^\s<>"')]+/i)?.[0] ?? null;
}

export function urlDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

export function firstFilePath(text: string): string | null {
  return text.match(/(?:[A-Za-z]:\\|\\\\)[^\n\r<>|?*]+/)?.[0]?.trim() ?? null;
}

export function extractEmails(text: string): string[] {
  return [...new Set(text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? [])];
}

export function formatJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

export function beautifyCode(text: string): string {
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

export function transformText(text: string, transform: PasteTransform): string | null {
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

export function rankPaletteItems(items: ClipboardItem[], query: string): ClipboardItem[] {
  const needle = query.trim();
  if (!needle) return items;

  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(needle, item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.item.pinned) - Number(a.item.pinned) || a.index - b.index)
    .map((entry) => entry.item);
}

export function dayBucket(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Earlier this week";
  return "Older";
}

export function groupByDay(items: ClipboardItem[]): Array<{ label: string; items: ClipboardItem[] }> {
  const groups: Array<{ label: string; items: ClipboardItem[] }> = [];
  for (const item of items) {
    const label = dayBucket(item.createdAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export const isTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
