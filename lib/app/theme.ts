"use client";

import { setPref } from "./prefs";

export type Theme = "dark" | "light";

/** Estilo Fantasy oscuro por defecto; claro para leer al sol (RNF-04). */
export function applyTheme(theme: Theme) {
  setPref("theme", theme === "dark" ? null : theme);
  if (theme === "dark") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** Aplica el tema guardado antes del primer pintado, sin parpadeo. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("quienentra:theme");if(t==="light")document.documentElement.dataset.theme=t}catch(e){}`;
