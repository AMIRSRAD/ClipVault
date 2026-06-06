export type ClipboardKind = "text" | "image" | "note";

export type ClipboardItem = {
  id: string;
  kind: ClipboardKind;
  text: string | null;
  ocrText: string | null;
  imageUrl: string | null;
  sourceApp: string | null;
  sourceTitle: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  pinned: boolean;
  tags: string[];
  sizeBytes: number;
  expiresAt: string | null;
};

export type ClipboardFilters = {
  kind?: ClipboardKind | "all";
  pinned?: boolean;
  tag?: string | null;
};

export type AppSettings = {
  retentionDays: number;
  maxStorageMb: number;
  hotkey: string;
  captureEnabled: boolean;
  excludedApps: string[];
  excludedTitlePatterns: string[];
  suppressSensitive: boolean;
  ocrMode: "onDemand" | "disabled";
};

export type SearchResponse = {
  items: ClipboardItem[];
  total: number;
};

export type OcrResponse = {
  status: "ready" | "unavailable" | "not_image" | "failed";
  text: string | null;
  message: string;
};
