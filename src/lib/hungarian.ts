/**
 * Rectangular Hungarian / Munkres assignment (minimize cost).
 * Dummy rows/cols are padded with a large cost and stripped from the result.
 */
export function hungarianAssign(cost: number[][]): { row: number; col: number; cost: number }[] {
  const rows = cost.length;
  const cols = cost[0]?.length ?? 0;
  if (rows === 0 || cols === 0) {
    return [];
  }

  const n = Math.max(rows, cols);
  const LARGE = 1e9;
  const a = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => {
      if (r < rows && c < cols) {
        return cost[r][c];
      }
      return LARGE;
    }),
  );

  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) {
          continue;
        }
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const pairs: { row: number; col: number; cost: number }[] = [];
  for (let j = 1; j <= n; j += 1) {
    const i = p[j];
    if (i >= 1 && i <= rows && j <= cols) {
      pairs.push({ row: i - 1, col: j - 1, cost: cost[i - 1][j - 1] });
    }
  }
  return pairs;
}
