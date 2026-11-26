// segments.js — seven-segment digits, drawn as SVG paths (the trip screen's €/h figure).
//
// Drawn rather than set in a font: no font file to download or license, works offline, and the unlit segments
// can show faintly, as on a real display. Pure: text in, path data out. Tested in segments.test.js.
//
//      a
//    f   b
//      g
//    e   c
//      d      .

const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  '-': 'g', '—': 'g', '–': 'g',
};

/**
 * Path data for a string of digits, '.', ',' and dashes, its baseline at y = 0, starting at x = 0.
 * Each character gives all seven segments, lit or not; '.' and ',' give a decimal point (lit).
 * Characters it cannot draw are skipped.
 *
 * @param {string} text
 * @param {object} [o]
 * @param {number} [o.w]      digit width
 * @param {number} [o.h]      digit height
 * @param {number} [o.t]      segment thickness
 * @param {number} [o.gap]    space between characters
 * @param {number} [o.slant]  lean to the right (tan of the angle)
 * @returns {{ segments: {d: string, on: boolean}[], width: number }}
 */
export function segmentPaths(text, { w = 20, h = 36, t = 4.4, gap = 4.5, slant = 0.12 } = {}) {
  const segments = [];
  const j = 0.6; // small joint between neighbouring segments
  const pt = (x, y) => `${(x - y * slant).toFixed(2)},${y.toFixed(2)}`; // y ≤ 0 above the baseline: leans right
  const bar = (x1, y1, x2, y2) => { // a segment with pointed ends, horizontal (y1 = y2) or vertical (x1 = x2)
    const k = t / 2;
    const p = y1 === y2
      ? [[x1, y1], [x1 + k, y1 - k], [x2 - k, y1 - k], [x2, y1], [x2 - k, y1 + k], [x1 + k, y1 + k]]
      : [[x1, y1], [x1 + k, y1 + k], [x1 + k, y2 - k], [x1, y2], [x1 - k, y2 - k], [x1 - k, y1 + k]];
    return `M${p.map(([x, y]) => pt(x, y)).join('L')}Z`;
  };

  let x = 0;
  for (const ch of String(text)) {
    if (ch === '.' || ch === ',') {
      const s = t * 1.1;
      x -= gap / 2;
      segments.push({ d: `M${[[x, -s], [x + s, -s], [x + s, 0], [x, 0]].map(([a, b]) => pt(a, b)).join('L')}Z`, on: true });
      x += s + gap;
      continue;
    }
    const lit = SEGMENTS[ch];
    if (lit === undefined) continue;
    const xl = x + t / 2, xr = x + w - t / 2;
    const ya = -h + t / 2, yg = -h / 2, yd = -t / 2;
    const all = {
      a: bar(xl + j, ya, xr - j, ya), g: bar(xl + j, yg, xr - j, yg), d: bar(xl + j, yd, xr - j, yd),
      f: bar(xl, ya + j, xl, yg - j), b: bar(xr, ya + j, xr, yg - j),
      e: bar(xl, yg + j, xl, yd - j), c: bar(xr, yg + j, xr, yd - j),
    };
    for (const [name, d] of Object.entries(all)) segments.push({ d, on: lit.includes(name) });
    x += w + gap;
  }
  return { segments, width: Math.max(0, x - gap) };
}
