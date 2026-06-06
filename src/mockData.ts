import type { AppSettings, ClipboardItem, SearchResponse, ClipboardFilters, OcrResponse } from "./types";

const screenshotSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 380">
  <rect width="680" height="380" fill="#f7f8fb"/>
  <rect x="38" y="36" width="604" height="308" rx="18" fill="#ffffff" stroke="#d5d9e2"/>
  <rect x="70" y="74" width="210" height="22" rx="6" fill="#2f5f8f"/>
  <rect x="70" y="122" width="540" height="14" rx="7" fill="#cbd5e1"/>
  <rect x="70" y="154" width="480" height="14" rx="7" fill="#d9dee8"/>
  <rect x="70" y="202" width="160" height="92" rx="12" fill="#2fbf71"/>
  <rect x="252" y="202" width="160" height="92" rx="12" fill="#d94f45"/>
  <rect x="434" y="202" width="160" height="92" rx="12" fill="#f2c14e"/>
</svg>`);

const now = new Date();

export const demoItems: ClipboardItem[] = [
  {
    id: "demo-1",
    kind: "text",
    text: "pnpm create tauri-app clipvault --template react-ts",
    ocrText: null,
    imageUrl: null,
    sourceApp: "Windows Terminal",
    sourceTitle: "ClipVault setup",
    createdAt: new Date(now.getTime() - 1000 * 60 * 4).toISOString(),
    lastUsedAt: null,
    pinned: true,
    tags: ["code", "setup"],
    sizeBytes: 52,
    expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString()
  },
  {
    id: "demo-2",
    kind: "image",
    text: null,
    ocrText: "Dashboard status: green, red, yellow",
    imageUrl: `data:image/svg+xml,${screenshotSvg}`,
    sourceApp: "Snipping Tool",
    sourceTitle: "Screenshot",
    createdAt: new Date(now.getTime() - 1000 * 60 * 42).toISOString(),
    lastUsedAt: null,
    pinned: false,
    tags: ["screenshot"],
    sizeBytes: 184024,
    expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString()
  },
  {
    id: "demo-3",
    kind: "text",
    text: "SELECT id, kind, created_at FROM clipboard_items WHERE pinned = 1 ORDER BY created_at DESC;",
    ocrText: null,
    imageUrl: null,
    sourceApp: "DataGrip",
    sourceTitle: "local clipboard query",
    createdAt: new Date(now.getTime() - 1000 * 60 * 87).toISOString(),
    lastUsedAt: new Date(now.getTime() - 1000 * 60 * 20).toISOString(),
    pinned: false,
    tags: ["sql", "code"],
    sizeBytes: 87,
    expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 29).toISOString()
  },
  {
    id: "demo-4",
    kind: "note",
    text: "Remember to review ClipVault popup spacing after the next build.",
    ocrText: null,
    imageUrl: null,
    sourceApp: "ClipVault",
    sourceTitle: "Design note",
    createdAt: new Date(now.getTime() - 1000 * 60 * 120).toISOString(),
    lastUsedAt: null,
    pinned: true,
    tags: ["notes", "design"],
    sizeBytes: 62,
    expiresAt: null
  }
];

export const demoSettings: AppSettings = {
  retentionDays: 30,
  maxStorageMb: 512,
  hotkey: "Ctrl+Shift+V",
  captureEnabled: true,
  excludedApps: ["1Password.exe", "KeePassXC.exe"],
  excludedTitlePatterns: ["password", "secret", "private key"],
  suppressSensitive: true,
  ocrMode: "onDemand"
};

export function mockSearch(query: string, filters: ClipboardFilters, limit: number, offset: number): SearchResponse {
  const q = query.trim().toLowerCase();
  const filtered = demoItems.filter((item) => {
    const haystack = [item.text, item.ocrText, item.sourceApp, item.sourceTitle, item.tags.join(" ")].join(" ").toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (filters.kind && filters.kind !== "all" && item.kind !== filters.kind) return false;
    if (filters.pinned && !item.pinned) return false;
    if (filters.tag && !item.tags.includes(filters.tag)) return false;
    return true;
  });

  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length
  };
}

export function mockOcr(id: string): OcrResponse {
  const item = demoItems.find((candidate) => candidate.id === id);
  if (!item || item.kind !== "image") {
    return { status: "not_image", text: null, message: "OCR only works on image entries." };
  }
  return {
    status: "ready",
    text: item.ocrText ?? "Dashboard status: green, red, yellow",
    message: "OCR text is available for this image."
  };
}
