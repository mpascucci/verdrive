// elevation.js — the altitude profile drawn on the trip summary.
//
// During the trip app.js keeps one point per GPS sample: { d, h, L, s, p }
//   d  distance travelled (m)      h  displayed (smoothed) altitude (m)
//   L  fuel used so far (L)        s  trip time so far (s), pauses excluded
//   p  the needle's scale position in the dial's automatic mode (0–1 on the arc, more above it)
// binProfile turns them into a short list for drawing: altitude along the road, the fuel rate in each
// stretch (L/h), its average speed, and the mean needle position, by which the summary colours the stretch. Tested in elevation.test.js.

/**
 * Group the trip points into `n` equal stretches of road.
 * Each stretch gives its mean distance and altitude, and its fuel rate: fuel used over time spent
 * (L/h), so a stop inside a stretch lowers the rate as it does on the dial; its average speed v (road over
 * time, m/s, so a stop lowers it too); and the mean of its points' needle positions p. A stretch with no time
 * has rate and v null; one whose points have no p has p null.
 * Stretches without points are left out.
 *
 * @param {{d:number, h:number|null, L:number, s:number, p?:number}[]} points  in trip order
 * @param {number} [n]  number of stretches
 * @returns {{d:number, h:number, rate:number|null, v:number|null, p:number|null}[]}
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
    let sumD = 0, sumH = 0, k = 0, sumP = 0, kP = 0, last = before;
    while (i < pts.length && (pts[i].d <= end || b === n - 1)) {
      sumD += pts[i].d; sumH += pts[i].h; k++; last = pts[i];
      if (Number.isFinite(pts[i].p)) { sumP += pts[i].p; kP++; }
      i++;
    }
    if (!k) continue;
    const ds = last.s - before.s;
    bins.push({
      d: sumD / k - d0, h: sumH / k,
      rate: ds > 0 ? ((last.L - before.L) / ds) * 3600 : null,
      v: ds > 0 ? (last.d - before.d) / ds : null,
      p: kP ? sumP / kP : null,
    });
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
