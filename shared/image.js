// RGBA image helpers shared by the browser app and the Node CLI.
//
// Pure functions over plain { width, height, data } records — no DOM, no Node
// APIs. ImageData satisfies this shape structurally, so the browser passes it
// directly; the CLI passes the equivalent record from pngjs.

/**
 * Byte offset of the RGBA pixel (x, y) within a width-wide RGBA buffer.
 */
export function rgbaOffset(width, x, y) {
  return (y * width + x) * 4;
}

/**
 * Convert an RGBA image to a single-channel Float32Array of luma values in
 * [0, 255]. Uses Qt's qGray weights (11r + 16g + 5b) / 32 to match upstream
 * Laigter; fully transparent pixels are zeroed before the weighted sum.
 */
export function grayscaleFromRgba(image) {
  const out = new Float32Array(image.width * image.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    const alpha = image.data[p + 3];
    const r = alpha === 0 ? 0 : image.data[p];
    const g = alpha === 0 ? 0 : image.data[p + 1];
    const b = alpha === 0 ? 0 : image.data[p + 2];
    out[i] = Math.floor((11 * r + 16 * g + 5 * b) / 32);
  }
  return out;
}
