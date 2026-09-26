"use client";

import { setPref } from "./prefs";

export type Theme = "system" | "light" | "dark";

/** Tema claro por defecto al sol, oscuro opcional (RNF-04). */
export function applyTheme(theme: Theme) {
  setPref("theme", theme === "system" ? null : theme);
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** Aplica el tema guardado antes del primer pintado, sin parpadeo. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("quienentra:theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;
