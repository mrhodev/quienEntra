import { buildWindows, type RotationConfig } from "@/lib/rotation";

/**
 * Inicio de la ventana de cambio en curso, en minutos efectivos (§6.4).
 * En vivo las sugerencias se calculan en ese instante: así quedan estables durante toda la
 * ventana (se pueden posponer o descartar) y cuentan como hechos los cambios que el DT ya
 * hizo desde entonces. En el entretiempo, es el inicio del período siguiente.
 */
export function currentBoundaryMin(config: RotationConfig, elapsedMin: number): number {
  let b = 0;
  for (const w of buildWindows(config)) if (w.startMin <= elapsedMin + 1e-6) b = w.startMin;
  return b;
}
