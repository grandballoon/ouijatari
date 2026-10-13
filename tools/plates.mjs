// Plate geometry: turns one plate's SVG (as produced by `mutool draw -F svg`
// from the artist's Illustrator file) into a catalog entry — a simplified
// outline in wall units plus the silhouette metrics the brief asks for.
//
// Everything here is a pure function of its input, so the catalog is
// reproducible and the functions are testable without the source artwork.
//
// Units: Illustrator works in points, 72 to the inch. The catalog is in inches,
// the unit of the SketchUp wall model, with y pointing down and the origin at
// the centre of the artboard. The artboard is the plate's reference frame: its
// upward direction is the plate's designated top, and its centre is the
// mounting point (see "Plate and wall data" in README.md).

export const POINTS_PER_INCH = 72;
// Outline tolerance. The source outlines are pixel traces with sub-point
// stair-steps; 0.02 in is half a millimetre on a plate roughly 300 mm across.
export const SIMPLIFY_TOLERANCE_IN = 0.02;
// Sampling pitch for area and moments.
const RASTER_STEP_IN = 0.05;
// A concavity counts as separating two branches when it is at least this deep,
// as a fraction of the square root of the convex hull's area.
const BRANCH_POCKET_DEPTH = 0.18;
const CURVE_SEGMENTS = 8;

const attrsOf = (tag) => Object.fromEntries(
  [...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])
);

function parseMatrix(transform) {
  if (!transform) return [1, 0, 0, 1, 0, 0];
  const m = /^matrix\(([^)]+)\)$/.exec(transform.trim());
  if (!m) throw new Error(`Unsupported transform "${transform}".`);
  const n = m[1].split(/[\s,]+/).map(Number);
  if (n.length !== 6 || n.some(Number.isNaN)) throw new Error(`Bad matrix "${transform}".`);
  return n;
}

// Absolute M/L/H/V/C/Z only — the full set mutool emits. Anything else is an
// error rather than a silently wrong outline.
export function parsePathData(d) {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const rings = [];
  let ring = null, x = 0, y = 0, i = 0, cmd = null;
  const num = () => {
    const v = Number(tokens[i++]);
    if (Number.isNaN(v)) throw new Error(`Expected a number in path data near token ${i}.`);
    return v;
  };
  const isCmd = (t) => /^[A-Za-z]$/.test(t);
  while (i < tokens.length) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    else if (cmd === "M") cmd = "L"; // coordinates after a moveto are linetos
    switch (cmd) {
      case "M": x = num(); y = num(); ring = [[x, y]]; rings.push(ring); break;
      case "L": x = num(); y = num(); ring.push([x, y]); break;
      case "H": x = num(); ring.push([x, y]); break;
      case "V": y = num(); ring.push([x, y]); break;
      case "C": {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
        for (let k = 1; k <= CURVE_SEGMENTS; k++) {
          const t = k / CURVE_SEGMENTS, u = 1 - t;
          ring.push([
            u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          ]);
        }
        x = x3; y = y3;
        break;
      }
      case "Z": case "z":
        if (ring) { [x, y] = ring[0]; }
        cmd = null;
        break;
      default:
        throw new Error(`Unsupported path command "${cmd}".`);
    }
  }
  return rings;
}

// Reads the filled silhouette out of a plate SVG. Stroke-only duplicates of the
// outline, clip paths and white backing shapes are not part of the plate.
export function silhouetteFromSvg(svg) {
  const vb = /viewBox="([^"]+)"/.exec(svg);
  if (!vb) throw new Error("SVG has no viewBox.");
  const [, , width, height] = vb[1].split(/[\s,]+/).map(Number);
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/g, "");
  const rings = [];
  const rules = new Set();
  for (const [tag] of body.matchAll(/<path\b[^>]*>/g)) {
    const a = attrsOf(tag);
    const fill = (a.fill || "#000000").toLowerCase();
    if (fill === "none" || fill === "#ffffff" || fill === "#fff") continue;
    const [ma, mb, mc, md, me, mf] = parseMatrix(a.transform);
    rules.add(a["fill-rule"] === "evenodd" ? "evenodd" : "nonzero");
    for (const ring of parsePathData(a.d || "")) {
      rings.push(ring.map(([px, py]) => [
        (ma * px + mc * py + me - width / 2) / POINTS_PER_INCH,
        (mb * px + md * py + mf - height / 2) / POINTS_PER_INCH,
      ]));
    }
  }
  if (!rings.length) throw new Error("SVG contains no filled path.");
  if (rules.size > 1) throw new Error("SVG mixes fill rules across its filled paths.");
  return {
    width: width / POINTS_PER_INCH,
    height: height / POINTS_PER_INCH,
    rule: [...rules][0],
    rings,
  };
}

const signedArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
};

const distToSegment = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

function douglasPeucker(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let worst = 0, at = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(pts[i], pts[lo], pts[hi]);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol) { keep[at] = 1; stack.push([lo, at], [at, hi]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Simplifies a closed ring. The ring is split at its two mutually farthest-ish
// vertices so that neither half is anchored on an arbitrary start point.
export function simplifyRing(ring, tol = SIMPLIFY_TOLERANCE_IN) {
  const pts = ring.filter((p, i) => {
    const q = ring[(i + 1) % ring.length];
    return p[0] !== q[0] || p[1] !== q[1];
  });
  if (pts.length < 4) return pts;
  let far = 0, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const first = douglasPeucker(pts.slice(0, far + 1), tol);
  const second = douglasPeucker([...pts.slice(far), pts[0]], tol);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

// Drops specks and simplifies what is left. A speck is a ring too small to be
// cut metal: under a hundredth of a square inch.
export function simplifySilhouette(rings, tol = SIMPLIFY_TOLERANCE_IN) {
  return rings
    .map((r) => simplifyRing(r, tol))
    .filter((r) => r.length >= 3 && Math.abs(signedArea(r)) >= 0.01);
}

function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src) => {
    const h = [];
    for (const q of src) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half(p.reverse())];
}

// Scanline coverage of the silhouette under its fill rule, sampled on a grid.
// Returns area and the first and second moments of the filled region.
function coverage(rings, rule, step) {
  let minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (const [, y] of r) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = minY + step / 2; y < maxY; y += step) {
    const xs = [];
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [x0, y0] = r[j], [x1, y1] = r[i];
        if ((y0 <= y) === (y1 <= y)) continue;
        xs.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
      }
    }
    xs.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k][1];
      const inside = rule === "evenodd" ? (k + 1) % 2 === 1 : wind !== 0;
      if (!inside) continue;
      // Cell centres lying in this filled span.
      const from = Math.ceil(xs[k][0] / step - 0.5), to = Math.floor(xs[k + 1][0] / step - 0.5);
      for (let c = from; c <= to; c++) {
        const x = (c + 0.5) * step;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      }
    }
  }
  if (!n) throw new Error("Silhouette has no filled area.");
  const cx = sx / n, cy = sy / n;
  return {
    area: n * step * step,
    centroid: [cx, cy],
    cov: [sxx / n - cx * cx, sxy / n - cx * cy, syy / n - cy * cy],
  };
}

// Branches are counted on the main outline as the lobes left between deep
// concavities of the convex hull. No concavity is a blob with one lobe, one
// concavity is a C with two ends, and from there each concavity separates one
// more lobe: an S has two, a Y three, a hand five.
function countBranches(ring, hullScale) {
  const hull = convexHull(ring);
  const onHull = new Set(hull);
  const start = ring.findIndex((p) => onHull.has(p));
  let pockets = 0, a = ring[start], depth = 0;
  for (let k = 1; k <= ring.length; k++) {
    const p = ring[(start + k) % ring.length];
    if (!onHull.has(p)) continue;
    // Walk the outline between consecutive hull vertices a → p.
    depth = 0;
    for (let m = (ring.indexOf(a) + 1) % ring.length; ring[m] !== p; m = (m + 1) % ring.length) {
      depth = Math.max(depth, distToSegment(ring[m], a, p));
    }
    if (depth >= BRANCH_POCKET_DEPTH * hullScale) pockets++;
    a = p;
  }
  return pockets < 2 ? pockets + 1 : pockets;
}

const round = (v, places) => Number(v.toFixed(places));

// The measurable characteristics the brief lists that a silhouette alone can
// supply. Oxidation, colour and brightness need photographs of the finished
// plates and are deliberately absent.
export function measure(rings, rule) {
  const pts = rings.flat();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cov = coverage(rings, rule, RASTER_STEP_IN);
  const hullArea = Math.abs(signedArea(convexHull(pts)));
  let perimeter = 0;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      perimeter += Math.hypot(r[i][0] - r[j][0], r[i][1] - r[j][1]);
    }
  }
  // Principal axes of the filled region.
  const [a, b, c] = cov.cov;
  const mid = (a + c) / 2, dev = Math.hypot((a - c) / 2, b);
  const main = rings.reduce((m, r) => (Math.abs(signedArea(r)) > Math.abs(signedArea(m)) ? r : m));
  return {
    width: round(Math.max(...xs) - Math.min(...xs), 2),
    height: round(Math.max(...ys) - Math.min(...ys), 2),
    area: round(cov.area, 2),
    perimeter: round(perimeter, 2),
    compactness: round((4 * Math.PI * cov.area) / (perimeter * perimeter), 4),
    elongation: round(Math.sqrt((mid + dev) / Math.max(mid - dev, 1e-9)), 3),
    density: round(cov.area / hullArea, 4),
    branches: countBranches(main, Math.sqrt(hullArea)),
  };
}

const coord = (v) => {
  const s = v.toFixed(2);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
};

export const toPathData = (rings) =>
  rings.map((r) => "M" + r.map(([x, y]) => coord(x) + " " + coord(y)).join("L") + "Z").join("");

// Illustrator file stems carry stray spaces ("T_1_23 .ai", "G_7_ 2.ai").
export const plateIdFromFilename = (name) => name.replace(/\.ai$/i, "").replace(/\s+/g, "");

export function plateFromSvg(svg, { id, family, source }) {
  const sil = silhouetteFromSvg(svg);
  const rings = simplifySilhouette(sil.rings);
  return {
    id, family, source,
    ...measure(rings, sil.rule),
    rule: sil.rule,
    d: toPathData(rings),
  };
}
