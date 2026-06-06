import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ClipboardFilters, ClipboardItem, OcrResponse, SearchResponse } from "./types";
import { demoItems, demoSettings, mockOcr, mockSearch } from "./mockData";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type SearchPayload = {
  query: string;
  filters: ClipboardFilters;
  limit: number;
  offset: number;
};

export async function searchItems(payload: SearchPayload): Promise<SearchResponse> {
  if (!isTauri()) return mockSearch(payload.query, payload.filters, payload.limit, payload.offset);
  return invoke<SearchResponse>("search_items", payload);
}

export async function getItem(id: string): Promise<ClipboardItem | null> {
  if (!isTauri()) return demoItems.find((item) => item.id === id) ?? null;
  return invoke<ClipboardItem | null>("get_item", { id });
}

export async function pasteItem(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("paste_item", { id });
}

export async function deleteItem(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("delete_item", { id });
}

export async function pinItem(id: string, pinned: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("pin_item", { id, pinned });
}

export async function setTags(id: string, tags: string[]): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_tags", { id, tags });
}

export async function createNote(text: string, tags: string[]): Promise<ClipboardItem> {
  if (!isTauri()) {
    return {
      id: `demo-note-${Date.now()}`,
      kind: "note",
      text,
      ocrText: null,
      imageUrl: null,
      sourceApp: "ClipVault",
      sourceTitle: "Note",
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      pinned: false,
      tags,
      sizeBytes: text.length,
      expiresAt: null
    };
  }
  return invoke<ClipboardItem>("create_note", { text, tags });
}

export async function updateNote(id: string, text: string): Promise<ClipboardItem> {
  if (!isTauri()) {
    const existing = demoItems.find((item) => item.id === id);
    return { ...(existing ?? demoItems[0]), kind: "note", text, sizeBytes: text.length };
  }
  return invoke<ClipboardItem>("update_note", { id, text });
}

export async function runOcr(id: string): Promise<OcrResponse> {
  if (!isTauri()) return mockOcr(id);
  return invoke<OcrResponse>("run_ocr", { id });
}

export async function getSettings(): Promise<AppSettings> {
  if (!isTauri()) return demoSettings;
  return invoke<AppSettings>("get_settings");
}

export async function updateSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isTauri()) return settings;
  return invoke<AppSettings>("update_settings", { settings });
}

export async function pauseCapture(durationSeconds: number | null): Promise<void> {
  if (!isTauri()) return;
  await invoke("pause_capture", { durationSeconds });
}

export async function exportBackup(): Promise<string> {
  if (!isTauri()) return `clipvault-dpapi-v1:demo-${Date.now()}`;
  return invoke<string>("export_backup");
}

export async function importBackup(backup: string): Promise<number> {
  if (!isTauri()) return backup.trim() ? 0 : 0;
  return invoke<number>("import_backup", { backup });
}

export async function openExternal(target: string): Promise<void> {
  if (!isTauri()) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }
  await invoke("open_external", { target });
}

export async function closePalette(): Promise<void> {
  if (!isTauri()) return;
  await invoke("close_palette");
}

export async function startPaletteDrag(): Promise<void> {
  if (!isTauri()) return;
  await invoke("start_palette_drag");
}
