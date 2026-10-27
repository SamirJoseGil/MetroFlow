// Gestión del tema claro/oscuro. La preferencia se guarda en localStorage y,
// si no existe, comienza en oscuro. El atributo data-theme del elemento <html>
// es la única fuente de verdad para los tokens visuales.

export type Theme = "light" | "dark";

const STORAGE_KEY = "metroflow-theme";

export function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* localStorage puede no estar disponible */
  }
  return "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignorar si no se puede persistir */
  }
}

export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  storeTheme(next);
  return next;
}
