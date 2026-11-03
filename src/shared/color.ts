export function hexToRgba(hex: string, alpha = 1): [number, number, number, number] {
  let body = hex.trim().replace('#', '');
  if (body.length === 3) body = body.split('').map((char) => char + char).join('');
  const value = Number.parseInt(body, 16);
  if (!Number.isFinite(value) || body.length !== 6) return [0.5, 0.5, 0.5, alpha];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha];
}
