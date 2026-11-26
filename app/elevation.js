// elevation.js — the altitude profile drawn on the trip summary.
//
// During the trip app.js keeps one point per GPS sample: { d, h, L, s }
//   d  distance travelled (m)      h  displayed (smoothed) altitude (m)
//   L  fuel used so far (L)        s  trip time so far (s), pauses excluded
// binProfile turns them into a short list for drawing: altitude along the road, and the fuel rate
// in each stretch (L/h), which the summary colours with the dial's scale. Tested in elevation.test.js.

/**
 * Group the trip points into `n` equal stretches of road.
 * Each stretch gives its mean distance and altitude, and its fuel rate: fuel used over time spent
 * (L/h), so a stop inside a stretch lowers the rate as it does on the dial. A stretch with no time
 * (one point only) has rate null. Stretches without points are left out.
 *
 * @param {{d:number, h:number|null, L:number, s:number}[]} points  in trip order
 * @param {number} [n]  number of stretches
 * @returns {{d:number, h:number, rate:number|null}[]}
 */
export function binProfile(points, n = 120) {
  const pts = points.filter((p) => p.h != null && Number.isFinite(p.h));
  if (pts.length < 2) return [];
  const d0 = pts[0].d;
  const total = pts[pts.length - 1].d - d0;
  if (!(total > 0)) return [];
  const width = total / n;

  const bins = [];
  let i = 0;
  let before = pts[0]; // last point of the previous stretch: the fuel and time totals start there
  for (let b = 0; b < n && i < pts.length; b++) {
    const end = d0 + (b + 1) * width;
    let sumD = 0, sumH = 0, k = 0, last = before;
    while (i < pts.length && (pts[i].d <= end || b === n - 1)) {
      sumD += pts[i].d; sumH += pts[i].h; k++; last = pts[i]; i++;
    }
    if (!k) continue;
    const ds = last.s - before.s;
    bins.push({ d: sumD / k - d0, h: sumH / k, rate: ds > 0 ? ((last.L - before.L) / ds) * 3600 : null });
    before = last;
  }
  return bins;
}

/**
 * Lowest and highest point of a profile (first one found on ties).
 * @param {{d:number, h:number}[]} bins
 * @returns {{min:{d:number,h:number}, max:{d:number,h:number}}|null}
 */
export function extremes(bins) {
  if (!bins.length) return null;
  let min = bins[0], max = bins[0];
  for (const b of bins) {
    if (b.h < min.h) min = b;
    if (b.h > max.h) max = b;
  }
  return { min, max };
}
