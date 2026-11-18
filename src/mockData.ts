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

const inDays = (days: number) => new Date(now.getTime() + 1000 * 60 * 60 * 24 * days).toISOString();

const demoNote = (id: string, text: string, minutesAgo: number, pinned: boolean, tags: string[]): ClipboardItem => ({
  id,
  kind: "note",
  text,
  ocrText: null,
  imageUrl: null,
  sourceApp: "ClipVault",
  sourceTitle: "Note",
  createdAt: new Date(now.getTime() - 1000 * 60 * minutesAgo).toISOString(),
  lastUsedAt: null,
  pinned,
  tags,
  sizeBytes: text.length,
  expiresAt: null
});

export const demoItems: ClipboardItem[] = [
  {
    ...demoText(
      "demo-1",
      "Flight BA 249 · Fri 14 Nov · London to Lisbon\nBoarding 08:45 · Gate B12 · Seat 14A",
      "Microsoft Edge",
      "Booking confirmation",
      4,
      ["travel"]
    ),
    pinned: true
  },
  {
    id: "demo-2",
    kind: "image",
    text: null,
    ocrText: "Q4 sales summary: North 42%, South 31%, West 27%",
    imageUrl: `data:image/svg+xml,${screenshotSvg}`,
    sourceApp: "Snipping Tool",
    sourceTitle: "Screenshot",
    createdAt: new Date(now.getTime() - 1000 * 60 * 42).toISOString(),
    lastUsedAt: null,
    pinned: false,
    tags: ["screenshot"],
    sizeBytes: 184024,
    expiresAt: inDays(30)
  },
  demoText(
    "demo-3",
    "Hi Sara,\n\nThanks for the quick review. I pushed the fixes. Can you take another look when you get a chance?\n\nBest,\nAmir",
    "Outlook",
    "RE: Project update",
    64,
    ["emails"]
  ),
  demoNote("demo-4", "Groceries\n\n- Olive oil\n- Fresh basil\n- Coffee beans\n- Lemons\n- Sourdough", 125, true, ["personal"]),
  demoText("demo-5", "Flat 4, 27 Orchard Street, Bristol BS1 5QT", "Microsoft Edge", "Maps", 180),
  demoText("demo-6", "https://en.wikipedia.org/wiki/Cut,_copy,_and_paste", "Microsoft Edge", "Cut, copy, and paste", 300, ["links"]),
  demoText("demo-7", "+44 117 496 0123", "Phone Link", "Contacts", 60 * 20),
  demoText("demo-8", "Order #48213 · Tracking 1Z 999 AA1 01 2345 6784", "Microsoft Edge", "Your order has shipped", 60 * 22),
  demoText("demo-9", 'git commit -m "Fix typo in the welcome message"', "Windows Terminal", "Terminal", 60 * 26, ["code"]),
  demoNote("demo-10", "Meeting notes\n\nThursday, 14:00, room 3B\nAttendees: Sara, Tom, Priya\n\nAction items:\n- Send the revised budget\n- Book the next review", 60 * 50, false, ["work"]),
  demoText("demo-11", "Meeting moved to Thursday 14:00, room 3B", "Microsoft Teams", "Planning sync", 60 * 24 * 4)
];

function demoText(id: string, text: string, sourceApp: string, sourceTitle: string, minutesAgo: number, tags: string[] = []): ClipboardItem {
  return {
    id,
    kind: "text",
    text,
    ocrText: null,
    imageUrl: null,
    sourceApp,
    sourceTitle,
    createdAt: new Date(now.getTime() - 1000 * 60 * minutesAgo).toISOString(),
    lastUsedAt: null,
    pinned: false,
    tags,
    sizeBytes: text.length,
    expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString()
  };
}

export const demoSettings: AppSettings = {
  retentionDays: 30,
  maxStorageMb: 512,
  hotkey: "Ctrl+Shift+V",
  captureEnabled: true,
  excludedApps: ["1Password.exe", "KeePassXC.exe"],
  excludedTitlePatterns: ["password", "secret", "private key"],
  suppressSensitive: true,
  ocrMode: "onDemand",
  closeToTray: true,
  minimizeToTray: true,
  startMinimized: false,
  launchOnStartup: false,
  autoUpdate: true
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
