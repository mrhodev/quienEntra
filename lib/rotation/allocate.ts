export const EPS = 1e-6;

/**
 * Reparte `total` en proporción a `weights` sin superar `caps` (water-filling).
 * Lo que un jugador no puede recibir por su tope se redistribuye entre el resto.
 */
export function allocate(weights: number[], caps: number[], total: number): number[] {
  const n = weights.length;
  const result = new Array<number>(n).fill(0);
  const capSum = caps.reduce((a, c) => a + c, 0);
  if (capSum <= total + EPS) return caps.slice();

  const order = [...Array(n).keys()]
    .filter((i) => weights[i] > 0 && caps[i] > 0)
    .sort((a, b) => caps[a] / weights[a] - caps[b] / weights[b] || a - b);

  let remaining = total;
  let weightLeft = order.reduce((a, i) => a + weights[i], 0);
  for (const i of order) {
    const share = (remaining * weights[i]) / weightLeft;
    if (caps[i] <= share) {
      result[i] = caps[i];
      remaining -= caps[i];
      weightLeft -= weights[i];
    } else {
      result[i] = share;
    }
  }
  // Con los topes ordenados, una vez que alguien no alcanza su tope nadie posterior lo alcanza:
  // recalculamos las cuotas finales de los que quedaron sin tope.
  for (const i of order) {
    if (result[i] < caps[i]) result[i] = (remaining * weights[i]) / weightLeft;
  }
  return result;
}

/**
 * Cuotas con piso: nadie queda por debajo de `floors[i]` (que ya debe ser ≤ caps[i]).
 * Los que quedan en el piso se fijan y el resto se reparte entre los demás.
 */
export function allocateWithFloors(
  weights: number[],
  caps: number[],
  floors: number[],
  total: number,
): number[] {
  const n = weights.length;
  const fixed = new Array<boolean>(n).fill(false);
  let result = new Array<number>(n).fill(0);

  for (let guard = 0; guard <= n; guard++) {
    const free = [...Array(n).keys()].filter((i) => !fixed[i]);
    const fixedSum = [...Array(n).keys()].filter((i) => fixed[i]).reduce((a, i) => a + floors[i], 0);
    const freeAlloc = allocate(
      free.map((i) => weights[i]),
      free.map((i) => caps[i]),
      Math.max(0, total - fixedSum),
    );
    result = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) if (fixed[i]) result[i] = floors[i];
    free.forEach((i, k) => (result[i] = freeAlloc[k]));

    let changed = false;
    for (const i of free) {
      if (result[i] < floors[i] - EPS) {
        fixed[i] = true;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return result;
}
