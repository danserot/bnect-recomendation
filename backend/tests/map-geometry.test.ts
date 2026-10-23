import { describe, it, expect } from 'vitest';
import { toScreen, toWorld, zoomAt, fitView, plotSize } from '../../frontend/src/mapGeometry';
const frame = { width: 900, height: 530 },
  view = { x: 0.12, y: -0.03, span: 0.5 };
describe('map navigation geometry', () => {
  it('preserves a world coordinate through screen conversion', () => {
    const screen = toScreen(0.2, -0.1, view, frame);
    const world = toWorld(screen.x, screen.y, view, frame);
    expect(world.x).toBeCloseTo(0.2, 10);
    expect(world.y).toBeCloseTo(-0.1, 10);
  });
  it('zooms around the cursor without moving its world location', () => {
    const before = toWorld(235, 315, view, frame);
    const after = toWorld(235, 315, zoomAt(view, frame, 235, 315, 0.5, 1), frame);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });
  it('fits tall distributions within the plot and handles empty categories', () => {
    const fitted = fitView(
      [
        { x: 1, y: -10 },
        { x: 1, y: 10 },
      ],
      frame,
    );
    const size = plotSize(frame);
    for (const y of [-10, 10]) {
      const p = toScreen(1, y, fitted, frame);
      expect(p.y).toBeGreaterThan(26);
      expect(p.y).toBeLessThan(26 + size.height);
    }
    expect(fitView([], frame).span).toBeGreaterThan(0);
  });
  it('limits extreme zoom requests', () => {
    expect(zoomAt(view, frame, 100, 100, 0.000001, 1).span).toBe(0.01);
    expect(zoomAt(view, frame, 100, 100, 100000, 1).span).toBe(10);
  });
});
