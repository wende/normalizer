/*
 * Shared math for the preview-only alpha shadow. The sprite is treated as an
 * upright cut-out: source rows rise from the contact point toward the top of
 * the image, then cast onto the canvas plane away from the point light.
 */

export const SHADOW_BAND_COUNT = 16;

// A compact, symmetric blur kernel. Its offsets run perpendicular to the
// shadow direction so the silhouette stays directional rather than smearing
// farther along its length.
export const SHADOW_SOFTNESS_KERNEL = [
  { offset: -2, weight: 0.06 },
  { offset: -1, weight: 0.24 },
  { offset: 0, weight: 0.40 },
  { offset: 1, weight: 0.24 },
  { offset: 2, weight: 0.06 },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute the projected shadow displacement in canvas pixels.
 * `light` has the same source-pixel/world coordinates used by the lit shader.
 */
export function computeShadowProjection(source, rect, light, shadow) {
  const contact = shadow.contact || { x: 0.5, y: 1 };
  const contactX = (clamp(contact.x, 0, 1) - 0.5) * source.width;
  const casterHeight = source.height * clamp(Number(shadow.casterHeight) || 0, 0, 100) / 100;

  /*
   * The lit shader's tangent-space Z points out of the screen, toward the
   * viewer. A positive-Z light therefore sends its cast shadow away from the
   * viewer, which is upward in this ground-plane preview. Tangent-space Y is
   * deliberately not used here: it changes how a surface is lit vertically,
   * but is not a usable depth axis for a front-facing sprite.
   */
  const side = (Number(light.x) - contactX) / source.width;
  const towardViewer = Math.max(0, Number(light.z) || 0);
  const directionLength = Math.hypot(side, towardViewer) || 1;
  const lightFacing = clamp(towardViewer, 0, 1);
  // A more front-on light makes a shorter, more hidden/receding shadow.
  const shadowLength = casterHeight * (0.2 + (1 - lightFacing) * 0.6);
  let shiftX = -side / directionLength * shadowLength * (rect.width / source.width);
  let shiftY = -towardViewer / directionLength * shadowLength * (rect.height / source.height);

  // A light at or below the caster cannot produce a stable perspective
  // projection. Preserve its direction but limit the visual effect.
  const maxShift = Math.max(rect.width, rect.height) * 1.5;
  const length = Math.hypot(shiftX, shiftY);
  if (length > maxShift) {
    const scale = maxShift / length;
    shiftX *= scale;
    shiftY *= scale;
  }

  return {
    shiftX,
    shiftY,
    contactY: clamp(contact.y, 0.05, 1),
  };
}

/** Return one horizontal source band and its height-ramped shadow offset. */
export function shadowBand(projection, index, count = SHADOW_BAND_COUNT) {
  const start = projection.contactY * index / count;
  const end = projection.contactY * (index + 1) / count;
  const startHeight = 1 - start / projection.contactY;
  const endHeight = 1 - end / projection.contactY;
  return {
    start,
    end,
    // The endpoints make adjacent strips share precisely the same edge. `x`
    // and `y` are retained as the midpoint convenience used by math tests.
    xStart: projection.shiftX * startHeight,
    yStart: projection.shiftY * startHeight,
    xEnd: projection.shiftX * endHeight,
    yEnd: projection.shiftY * endHeight,
    x: projection.shiftX * ((startHeight + endHeight) * 0.5),
    y: projection.shiftY * ((startHeight + endHeight) * 0.5),
  };
}

/** Return screen-space softening taps perpendicular to the projection. */
export function shadowSoftnessTaps(projection, softness) {
  const amount = Math.max(0, Number(softness) || 0);
  const length = Math.hypot(projection.shiftX, projection.shiftY);
  const perpendicular = length > 0.001
    ? { x: -projection.shiftY / length, y: projection.shiftX / length }
    : { x: 1, y: 0 };
  return SHADOW_SOFTNESS_KERNEL.map(({ offset, weight }) => ({
    x: perpendicular.x * offset * amount,
    y: perpendicular.y * offset * amount,
    weight,
  }));
}
