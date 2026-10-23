export interface MapView {
  x: number;
  y: number;
  span: number;
}
export interface MapFrame {
  width: number;
  height: number;
}
export const margins = { left: 68, right: 22, top: 26, bottom: 58 };
export function plotSize(frame: MapFrame) {
  return {
    width: Math.max(1, frame.width - margins.left - margins.right),
    height: Math.max(1, frame.height - margins.top - margins.bottom),
  };
}
export function toWorld(px: number, py: number, view: MapView, frame: MapFrame) {
  const size = plotSize(frame);
  return {
    x: view.x + ((px - margins.left) / size.width - 0.5) * view.span,
    y: view.y - (((py - margins.top) / size.height - 0.5) * view.span * size.height) / size.width,
  };
}
export function toScreen(x: number, y: number, view: MapView, frame: MapFrame) {
  const size = plotSize(frame);
  return {
    x: margins.left + size.width * (0.5 + (x - view.x) / view.span),
    y: margins.top + size.height / 2 - ((y - view.y) / view.span) * size.width,
  };
}
export function zoomAt(
  view: MapView,
  frame: MapFrame,
  px: number,
  py: number,
  factor: number,
  baseSpan: number,
): MapView {
  const before = toWorld(px, py, view, frame);
  const span = Math.max(baseSpan / 100, Math.min(baseSpan * 10, view.span * factor));
  const after = toWorld(px, py, { ...view, span }, frame);
  return { x: view.x + before.x - after.x, y: view.y + before.y - after.y, span };
}
export function fitView(points: { x: number; y: number }[], frame: MapFrame): MapView {
  if (!points.length) return { x: 0, y: 0, span: 1 };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const size = plotSize(frame);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    span: Math.max(maxX - minX, ((maxY - minY) * size.width) / size.height, 0.001) * 1.18,
  };
}
export function axisTicks(low: number, high: number) {
  const rough = (high - low) / 6;
  const power = 10 ** Math.floor(Math.log10(rough || 1));
  const step = [1, 2, 5, 10].find((n) => n * power >= rough)! * power;
  const values: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-6; value += step)
    values.push(Math.abs(value) < step * 1e-6 ? 0 : value);
  return { values, digits: Math.max(0, -Math.floor(Math.log10(step))) };
}
