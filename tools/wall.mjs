// Wall geometry: reads the SketchUp export of the gallery (an OBJ in inches,
// y up) and unfolds the nailed walls into one flat elevation strip, as a
// viewer standing in the room sees them from left to right.
//
// Nails are recognised by shape, not by group name: a nail is a small prism,
// NAIL_LENGTH long, standing out of a wall. The wall it belongs to is the
// large vertical face its base sits on.

const NAIL_LENGTH = 3;
const NAIL_MAX_DIAMETER = 1.5;
const EPS = 0.01;
const ROW_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const round = (v, places = 2) => Number(v.toFixed(places));

function parseObj(text) {
  const vertices = [];
  const groups = [];
  let group = null;
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === "v") vertices.push([Number(p[1]), Number(p[2]), Number(p[3])]);
    else if (p[0] === "g") { group = { name: p.slice(1).join(" "), faces: [] }; groups.push(group); }
    else if (p[0] === "f" && group) {
      // OBJ indices are 1-based and global to the file.
      group.faces.push(p.slice(1).map((t) => parseInt(t, 10) - 1));
    }
  }
  return { vertices, groups };
}

const bounds = (points) => [0, 1, 2].map((k) => {
  const vals = points.map((p) => p[k]);
  return [Math.min(...vals), Math.max(...vals)];
});

// Vertical, axis-aligned faces: the candidate wall surfaces. `axis` is the
// horizontal axis the face is perpendicular to (0 = x, 2 = z).
function verticalFaces({ vertices, groups }) {
  const out = [];
  for (const g of groups) {
    for (const f of g.faces) {
      const b = bounds(f.map((i) => vertices[i]));
      for (const axis of [0, 2]) {
        const along = axis === 0 ? 2 : 0;
        if (b[axis][1] - b[axis][0] < EPS && b[1][1] - b[1][0] > EPS && b[along][1] - b[along][0] > EPS) {
          out.push({ axis, along, at: b[axis][0], span: b[along], height: b[1] });
        }
      }
    }
  }
  return out;
}

function findNails({ vertices, groups }) {
  const nails = [];
  for (const g of groups) {
    const idx = [...new Set(g.faces.flat())];
    if (!idx.length) continue;
    const b = bounds(idx.map((i) => vertices[i]));
    const ext = b.map(([lo, hi]) => hi - lo);
    const axis = [0, 2].find((k) => Math.abs(ext[k] - NAIL_LENGTH) < EPS);
    if (axis === undefined) continue;
    const along = axis === 0 ? 2 : 0;
    if (ext[1] > NAIL_MAX_DIAMETER || ext[along] > NAIL_MAX_DIAMETER) continue;
    nails.push({
      axis, along, ends: b[axis],
      pos: (b[along][0] + b[along][1]) / 2,
      y: (b[1][0] + b[1][1]) / 2,
    });
  }
  return nails;
}

export function parseWall(objText) {
  const model = parseObj(objText);
  const faces = verticalFaces(model);

  // Attach every nail to the wall face under its base.
  const walls = new Map();
  for (const nail of findNails(model)) {
    const face = faces
      .filter((f) => f.axis === nail.axis
        && nail.ends.some((e) => Math.abs(e - f.at) < EPS)
        && nail.pos > f.span[0] && nail.pos < f.span[1]
        && nail.y > f.height[0] && nail.y < f.height[1])
      .sort((p, q) => (q.span[1] - q.span[0]) - (p.span[1] - p.span[0]))[0];
    if (!face) throw new Error("A nail in the model does not sit on any wall face.");
    const key = `${face.axis}:${face.at.toFixed(2)}`;
    if (!walls.has(key)) {
      // The nail points into the room. Facing the wall, "right" is up × normal.
      const tip = nail.ends.find((e) => Math.abs(e - face.at) >= EPS);
      const normal = Math.sign(tip - face.at);
      const rightSign = face.axis === 0 ? -normal : normal; // along z for an x-wall, along x for a z-wall
      walls.set(key, { face, rightSign, nails: [] });
    }
    walls.get(key).nails.push(nail);
  }

  // Each wall runs from its left end to its right end in plan (x, z).
  const list = [...walls.values()].map((w) => {
    const [lo, hi] = w.face.span;
    const leftAlong = w.rightSign > 0 ? lo : hi, rightAlong = w.rightSign > 0 ? hi : lo;
    const plan = (v) => (w.face.axis === 0 ? [w.face.at, v] : [v, w.face.at]);
    return { ...w, leftAlong, left: plan(leftAlong), right: plan(rightAlong), length: hi - lo };
  });
  const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < EPS;

  // Chain the walls corner to corner, starting from the one nothing leads into.
  let cur = list.find((w) => !list.some((o) => o !== w && same(o.right, w.left)));
  if (!cur) throw new Error("The nailed walls form a closed loop; no starting wall.");
  const ordered = [];
  while (cur) {
    ordered.push(cur);
    const end = cur.right;
    cur = list.find((w) => !ordered.includes(w) && same(w.left, end));
  }
  if (ordered.length !== list.length) throw new Error("The nailed walls are not one connected run.");

  const height = Math.max(...ordered.map((w) => w.face.height[1]));
  const floor = Math.min(...ordered.map((w) => w.face.height[0]));
  let offset = 0;
  const outWalls = [];
  const placed = new Map(); // dedupes components the modeller left stacked on a nail
  for (const [n, w] of ordered.entries()) {
    for (const nail of w.nails) {
      const u = round(offset + Math.abs(nail.pos - w.leftAlong));
      const y = round(height - nail.y);
      placed.set(`${u}:${y}`, { u, y, wall: n });
    }
    outWalls.push({ u: round(offset), length: round(w.length) });
    offset += w.length;
  }

  // The nails lie on one regular lattice across the unfolded strip. Corners
  // fall on lattice columns that carry no nails.
  const nails = [...placed.values()];
  const us = [...new Set(nails.map((n) => n.u))].sort((a, b) => a - b);
  const ys = [...new Set(nails.map((n) => n.y))].sort((a, b) => a - b);
  const pitch = (vals) => {
    const gaps = vals.slice(1).map((v, i) => v - vals[i]);
    return round(Math.min(...gaps));
  };
  const pitchU = pitch(us), pitchY = pitch(ys);
  if (ys.length > ROW_LETTERS.length) throw new Error("More nail rows than row letters.");
  for (const nail of nails) {
    nail.col = Math.round((nail.u - us[0]) / pitchU);
    nail.row = Math.round((nail.y - ys[0]) / pitchY);
    if (Math.abs(us[0] + nail.col * pitchU - nail.u) > 0.05 || Math.abs(ys[0] + nail.row * pitchY - nail.y) > 0.05) {
      throw new Error(`The nails do not lie on a regular lattice (nail at ${nail.u}, ${nail.y}; pitch ${pitchU} × ${pitchY}).`);
    }
  }
  nails.sort((a, b) => a.col - b.col || a.row - b.row);

  // Columns are numbered left to right across the whole strip, rows lettered
  // from the top: nail "E-34" is the fifth row down in the 34th nailed column.
  const colNumber = new Map([...new Set(nails.map((n) => n.col))].map((c, i) => [c, i + 1]));
  const names = outWalls.length === 3 ? ["Left wall", "Centre wall", "Right wall"]
    : outWalls.map((_, i) => `Wall ${i + 1}`);
  return {
    units: "in",
    width: round(offset),
    height: round(height - floor),
    pitch: [pitchU, pitchY],
    walls: outWalls.map((w, i) => ({ name: names[i], ...w })),
    nails: nails.map((n) => ({
      id: ROW_LETTERS[n.row] + "-" + String(colNumber.get(n.col)).padStart(2, "0"),
      wall: n.wall, col: n.col, row: n.row, u: n.u, y: n.y,
    })),
  };
}
