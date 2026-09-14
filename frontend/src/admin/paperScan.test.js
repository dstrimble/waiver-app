import { describe, expect, it } from "vitest";
import { pageMapper } from "./paperScan.js";

// A page photographed at an angle: no two sides parallel.
const TILTED = [
  { x: 10, y: 20 },
  { x: 110, y: 10 },
  { x: 130, y: 160 },
  { x: 0, y: 140 },
];

function diagonalsCross([tl, tr, br, bl]) {
  const d1 = { x: br.x - tl.x, y: br.y - tl.y };
  const d2 = { x: bl.x - tr.x, y: bl.y - tr.y };
  const t = ((tr.x - tl.x) * d2.y - (tr.y - tl.y) * d2.x) / (d1.x * d2.y - d1.y * d2.x);
  return [tl.x + t * d1.x, tl.y + t * d1.y];
}

describe("paperScan", () => {
  it("maps the corners of the flattened page onto the corners in the photo", () => {
    const map = pageMapper(TILTED);
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].forEach(([u, v], i) => {
      const [x, y] = map(u, v);
      expect(x).toBeCloseTo(TILTED[i].x, 6);
      expect(y).toBeCloseTo(TILTED[i].y, 6);
    });
  });

  it("puts the middle of the page where its diagonals cross, as perspective does", () => {
    const [x, y] = pageMapper(TILTED)(0.5, 0.5);
    const [cx, cy] = diagonalsCross(TILTED);
    expect(x).toBeCloseTo(cx, 6);
    expect(y).toBeCloseTo(cy, 6);
  });

  it("only scales a page photographed square on", () => {
    const map = pageMapper([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ]);
    const [x, y] = map(0.5, 0.25);
    expect(x).toBeCloseTo(100, 9);
    expect(y).toBeCloseTo(25, 9);
  });
});
