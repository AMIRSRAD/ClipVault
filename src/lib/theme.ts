export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "clipvault.theme";

function isChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

export function getTheme(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isChoice(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // The choice still applies for this session.
  }
  apply(choice);
}

/** Applies the saved theme. `?theme=light|dark` overrides it without saving (used for documentation screenshots). */
export function initTheme() {
  const override = new URLSearchParams(window.location.search).get("theme");
  apply(isChoice(override) ? override : getTheme());

  // The main window and the quick paste popup share storage, so a change in one updates the other.
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) apply(getTheme());
  });
}
