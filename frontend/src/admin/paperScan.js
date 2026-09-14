// Photos of paper waivers: shrinking one to send to be read, and flattening
// the page out of it once its corners are known.

// Claude reads images at full detail up to this long edge; bigger only costs upload time.
const READ_LONG_EDGE = 2576;
// Stays under the API's 5 MB limit for one image.
const MAX_READ_CHARS = 4.5 * 1024 * 1024;
// The stored photo: handwriting on a letter page stays legible, and the
// waiver list, which carries every signature, stays small.
const SCAN_LONG_EDGE = 1700;

/** Corners of the whole photo - top-left, top-right, bottom-right, bottom-left - as fractions. */
export const FULL_FRAME = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function openImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That photo could not be opened. Try a JPEG or PNG."));
    };
    image.src = url;
  });
}

/**
 * A chosen photo, upright and no bigger than Claude can use.
 *
 * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number, dataUrl: string}>}
 */
export async function loadPhoto(file) {
  const image = await openImage(file);
  const scale = Math.min(1, READ_LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

  let dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  for (const quality of [0.75, 0.6]) {
    if (dataUrl.length <= MAX_READ_CHARS) break;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return { canvas, width: canvas.width, height: canvas.height, dataUrl };
}

/**
 * Where a point of the flattened page lies in the photo: maps (u, v) in the
 * unit square onto the quadrilateral with the given corners, by the
 * square-to-quad projective transform (Heckbert, 1989).
 *
 * @param {{x: number, y: number}[]} corners top-left, top-right, bottom-right, bottom-left
 * @returns {(u: number, v: number) => [number, number]}
 */
export function pageMapper([p0, p1, p2, p3]) {
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = det ? (sx * dy2 - dx2 * sy) / det : 0;
  const h = det ? (dx1 * sy - sx * dy1) / det : 0;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + p0.x) / w, (d * u + e * v + p0.y) / w];
  };
}

/** Whether corners outline something worth cropping to, rather than a sliver. */
export function isUsablePage(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  if (!corners.every((c) => Number.isFinite(c?.x) && Number.isFinite(c?.y))) return false;
  let twiceArea = 0;
  corners.forEach((c, i) => {
    const next = corners[(i + 1) % 4];
    twiceArea += c.x * next.y - next.x * c.y;
  });
  return Math.abs(twiceArea) / 2 >= 0.05;
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The page cut out of the photo and squared up, as a JPEG data URL - anything
 * outside the corners is gone.
 */
export function cropToPage(photo, corners) {
  const { canvas, width, height } = photo;
  const points = corners.map((c) => ({ x: c.x * width, y: c.y * height }));
  const [tl, tr, br, bl] = points;
  const naturalWidth = Math.max(distance(tl, tr), distance(bl, br));
  const naturalHeight = Math.max(distance(tl, bl), distance(tr, br));
  const scale = Math.min(1, SCAN_LONG_EDGE / Math.max(naturalWidth, naturalHeight, 1));
  const outWidth = Math.max(1, Math.round(naturalWidth * scale));
  const outHeight = Math.max(1, Math.round(naturalHeight * scale));

  const source = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const out = document.createElement("canvas");
  out.width = outWidth;
  out.height = outHeight;
  const outCtx = out.getContext("2d");
  const target = outCtx.createImageData(outWidth, outHeight);
  const pixels = target.data;
  const map = pageMapper(points);
  const maxX = width - 1;
  const maxY = height - 1;

  for (let y = 0; y < outHeight; y += 1) {
    const v = (y + 0.5) / outHeight;
    for (let x = 0; x < outWidth; x += 1) {
      let [sx, sy] = map((x + 0.5) / outWidth, v);
      sx = Math.min(maxX, Math.max(0, sx));
      sy = Math.min(maxY, Math.max(0, sy));
      // Bilinear, so handwriting keeps its edges.
      const x0 = Math.min(Math.floor(sx), Math.max(0, maxX - 1));
      const y0 = Math.min(Math.floor(sy), Math.max(0, maxY - 1));
      const x1 = Math.min(x0 + 1, maxX);
      const y1 = Math.min(y0 + 1, maxY);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * width + x0) * 4;
      const i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const o = (y * outWidth + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const top = source[i00 + c] + (source[i10 + c] - source[i00 + c]) * fx;
        const bottom = source[i01 + c] + (source[i11 + c] - source[i01 + c]) * fx;
        pixels[o + c] = top + (bottom - top) * fy;
      }
      pixels[o + 3] = 255;
    }
  }

  outCtx.putImageData(target, 0, 0);
  return out.toDataURL("image/jpeg", 0.85);
}
