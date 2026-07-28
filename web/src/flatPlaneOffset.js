/**
 * UV offset a unit-height flat plane would take under the same view tilt /
 * height scale as steep parallax (x -= P.x, y += P.y). Used on the split
 * flat side so drag compares rigid plane motion vs heightmap parallax 1:1.
 */
export function flatPlaneUvOffset(viewTilt, heightScale) {
  const tx = viewTilt?.x ?? 0;
  const ty = viewTilt?.y ?? 0;
  const h = heightScale ?? 0;
  if (h <= 0) return { x: 0, y: 0 };
  const invLen = 1 / Math.hypot(tx, ty, 1);
  return { x: -tx * invLen * h, y: ty * invLen * h };
}
