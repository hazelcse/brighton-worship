/**
 * Trimming a songsheet's white page margins for display: each side margin is halved and the top
 * and bottom are trimmed by the same proportion, so the page keeps its shape and just reads larger.
 * Margins differ from sheet to sheet (some have almost none), so they're measured from the page's
 * pixels, never cut into ink, and every page of a sheet gets the same zoom so text stays one size.
 */

/** White space around a page's ink, as fractions of its width (l, r) and height (t, b). */
export type Margins = { l: number; r: number; t: number; b: number };

/** The part of a page to show, as fractions of its width (x, w) and height (y, h). */
export type Crop = { x: number; y: number; w: number; h: number };

export const NO_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };

/** Kept clear around the ink (fraction of the page), so anti-aliased edges are never clipped. */
const SAFETY = 0.012;

/** A pixel darker than this in any channel counts as ink. */
const INK = 225;

/** The page's margins, or null for a blank page. */
export function measureMargins(data: ImageData): Margins | null {
  const { width, height, data: px } = data;
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (px[i + 3] > 32 && (px[i] < INK || px[i + 1] < INK || px[i + 2] < INK)) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const clear = (v: number) => Math.max(0, v - SAFETY);
  return {
    l: clear(left / width),
    r: clear((width - 1 - right) / width),
    t: clear(top / height),
    b: clear((height - 1 - bottom) / height),
  };
}

/** Margins of an image or canvas, measured from a small copy. Null if it can't be read or is blank. */
export function marginsOf(source: HTMLImageElement | HTMLCanvasElement): Margins | null {
  const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!w || !h) return null;
  const scale = Math.min(1, 400 / w);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  try {
    return measureMargins(ctx.getImageData(0, 0, c.width, c.height));
  } catch {
    return null;
  }
}

/**
 * One crop per page (null margins: blank page). Each side loses half the narrowest margin that
 * side has on any page; top and bottom lose the same share of the height, split by how much room
 * each has. If a page hasn't the room, the whole sheet zooms in less.
 */
export function sheetCrops(pages: (Margins | null)[]): Crop[] {
  const inked = pages.filter((m): m is Margins => m !== null);
  if (!inked.length) return pages.map(() => NO_CROP);
  let cl = Math.min(...inked.map((m) => m.l)) / 2;
  let cr = Math.min(...inked.map((m) => m.r)) / 2;
  const cut = cl + cr;
  if (cut <= 0) return pages.map(() => NO_CROP);
  const fit = Math.min(1, ...inked.map((m) => (m.t + m.b) / cut));
  cl *= fit;
  cr *= fit;
  const cv = cl + cr; // the same share of the height as of the width: the page keeps its shape
  return pages.map((m) => {
    const room = m ? m.t + m.b : 1;
    const top = m && room > 0 ? (cv * m.t) / room : 0;
    return { x: cl, y: top, w: 1 - cl - cr, h: 1 - cv };
  });
}
