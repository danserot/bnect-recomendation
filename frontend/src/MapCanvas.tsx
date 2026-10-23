import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { VectorPoint } from '@bnect/shared';
import {
  axisTicks,
  margins,
  plotSize,
  toScreen,
  toWorld,
  zoomAt,
  type MapFrame,
  type MapView,
} from './mapGeometry';

export default function MapCanvas({
  points,
  view,
  onView,
  baseSpan,
  colors,
  anchor,
  found,
  query,
  onHover,
  onOpen,
  onFrame,
  variance,
}: {
  points: VectorPoint[];
  view: MapView;
  onView: (view: MapView) => void;
  baseSpan: number;
  colors: Map<string, string>;
  anchor?: string;
  found?: string;
  query: { x: number; y: number };
  onHover: (point: VectorPoint | null) => void;
  onOpen: (point: VectorPoint) => void;
  onFrame: (frame: MapFrame) => void;
  variance: [number, number];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState<MapFrame>({ width: 900, height: 530 });
  const live = useRef({ view, frame, baseSpan, onView, onHover, onOpen });
  live.current = { view, frame, baseSpan, onView, onHover, onOpen };
  const hitGrid = useRef(new Map<string, { point: VectorPoint; x: number; y: number }[]>());
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    x: number;
    y: number;
    distance: number;
    startX: number;
    startY: number;
    moved: boolean;
    pinched: boolean;
  } | null>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      const next = { width, height: width < 600 ? 430 : 530 };
      setFrame(next);
      onFrame(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onFrame]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    element.width = frame.width * ratio;
    element.height = frame.height * ratio;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#fafbfc';
    ctx.fillRect(0, 0, frame.width, frame.height);
    const size = plotSize(frame),
      bottom = margins.top + size.height,
      right = margins.left + size.width;
    const a = toWorld(margins.left, bottom, view, frame),
      b = toWorld(right, margins.top, view, frame);
    const xt = axisTicks(a.x, b.x),
      yt = axisTicks(a.y, b.y);
    ctx.font = '11px Arial';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = '#dfe4eb';
    ctx.fillStyle = '#687384';
    for (const value of xt.values) {
      const p = toScreen(value, 0, view, frame);
      ctx.beginPath();
      ctx.moveTo(p.x, margins.top);
      ctx.lineTo(p.x, bottom);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(value.toFixed(xt.digits), p.x, bottom + 20);
    }
    for (const value of yt.values) {
      const p = toScreen(0, value, view, frame);
      ctx.beginPath();
      ctx.moveTo(margins.left, p.y);
      ctx.lineTo(right, p.y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(value.toFixed(yt.digits), margins.left - 10, p.y + 4);
    }
    ctx.setLineDash([]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(margins.left, margins.top, size.width, size.height);
    ctx.clip();
    ctx.strokeStyle = '#8a98a9';
    const zero = toScreen(0, 0, view, frame);
    ctx.beginPath();
    ctx.moveTo(zero.x, margins.top);
    ctx.lineTo(zero.x, bottom);
    ctx.moveTo(margins.left, zero.y);
    ctx.lineTo(right, zero.y);
    ctx.stroke();
    const grid = new Map<string, { point: VectorPoint; x: number; y: number }[]>();
    const draw = (p: VectorPoint, highlight: boolean) => {
      const position = toScreen(p.x, p.y, view, frame);
      if (
        position.x < margins.left ||
        position.x > right ||
        position.y < margins.top ||
        position.y > bottom
      )
        return;
      const key = `${Math.floor(position.x / 20)}:${Math.floor(position.y / 20)}`;
      const bucket = grid.get(key) ?? [];
      bucket.push({ point: p, ...position });
      grid.set(key, bucket);
      ctx.beginPath();
      ctx.arc(position.x, position.y, highlight ? 3.3 : 1.7, 0, Math.PI * 2);
      ctx.fillStyle = colors.get(p.tender.industryGroup) ?? '#777';
      ctx.globalAlpha = highlight ? 1 : 0.72;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (highlight) {
        ctx.strokeStyle = '#202b39';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      if (p.tender.id === anchor || p.tender.id === found) {
        ctx.beginPath();
        ctx.arc(position.x, position.y, found === p.tender.id ? 9 : 7, 0, Math.PI * 2);
        ctx.strokeStyle = found === p.tender.id ? '#185adb' : '#f47721';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };
    for (const point of points) if (!point.recommended) draw(point, false);
    for (const point of points) if (point.recommended) draw(point, true);
    const q = toScreen(query.x, query.y, view, frame);
    ctx.fillStyle = '#f47721';
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - 5);
    ctx.lineTo(q.x + 4, q.y);
    ctx.lineTo(q.x, q.y + 5);
    ctx.lineTo(q.x - 4, q.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    hitGrid.current = grid;
    ctx.fillStyle = '#39475a';
    ctx.textAlign = 'center';
    ctx.font = '12px Arial';
    ctx.fillText(
      `X · PCA 1 (${(variance[0] * 100).toFixed(1)}%)`,
      margins.left + size.width / 2,
      frame.height - 12,
    );
    ctx.textAlign = 'left';
    ctx.fillText(`Y · PCA 2 (${(variance[1] * 100).toFixed(1)}%)`, margins.left, 17);
  }, [points, view, frame, colors, anchor, found, query, variance]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const current = live.current;
      current.onView(
        zoomAt(
          current.view,
          current.frame,
          event.clientX - rect.left,
          event.clientY - rect.top,
          Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * 0.002),
          current.baseSpan,
        ),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  function position(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function nearest(x: number, y: number) {
    let best: VectorPoint | null = null,
      distance = 81;
    const gx = Math.floor(x / 20),
      gy = Math.floor(y / 20);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const candidate of hitGrid.current.get(`${gx + dx}:${gy + dy}`) ?? []) {
          const d = (x - candidate.x) ** 2 + (y - candidate.y) ** 2;
          if (d <= distance) {
            distance = d;
            best = candidate.point;
          }
        }
    return best;
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    const p = position(event);
    pointers.current.set(event.pointerId, p);
    const values = [...pointers.current.values()];
    if (values.length === 1)
      gesture.current = {
        ...p,
        startX: p.x,
        startY: p.y,
        distance: 0,
        moved: false,
        pinched: false,
      };
    else if (values.length === 2)
      gesture.current = {
        x: (values[0].x + values[1].x) / 2,
        y: (values[0].y + values[1].y) / 2,
        distance: Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y),
        startX: p.x,
        startY: p.y,
        moved: true,
        pinched: true,
      };
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const p = position(event),
      g = gesture.current;
    if (!pointers.current.has(event.pointerId) || !g) {
      live.current.onHover(nearest(p.x, p.y));
      return;
    }
    pointers.current.set(event.pointerId, p);
    const values = [...pointers.current.values()],
      current = live.current,
      size = plotSize(current.frame);
    if (values.length === 2) {
      const midpoint = { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
      const distance = Math.max(
        1,
        Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y),
      );
      const before = toWorld(g.x, g.y, current.view, current.frame);
      const scaled = zoomAt(
        current.view,
        current.frame,
        g.x,
        g.y,
        g.distance / distance,
        current.baseSpan,
      );
      const after = toWorld(midpoint.x, midpoint.y, scaled, current.frame);
      current.onView({
        ...scaled,
        x: scaled.x + before.x - after.x,
        y: scaled.y + before.y - after.y,
      });
      Object.assign(g, { ...midpoint, distance, pinched: true, moved: true });
    } else {
      if (Math.hypot(p.x - g.startX, p.y - g.startY) > 4) g.moved = true;
      if (g.moved)
        current.onView({
          ...current.view,
          x: current.view.x - ((p.x - g.x) / size.width) * current.view.span,
          y: current.view.y + ((p.y - g.y) / size.width) * current.view.span,
        });
      g.x = p.x;
      g.y = p.y;
    }
    current.onHover(null);
  }
  function up(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
    const p = position(event),
      g = gesture.current;
    pointers.current.delete(event.pointerId);
    if (!cancelled && g && !g.moved && !g.pinched) {
      const point = nearest(p.x, p.y);
      if (point) live.current.onOpen(point);
    }
    if (!pointers.current.size) gesture.current = null;
    else if (g) {
      const remaining = [...pointers.current.values()][0];
      Object.assign(g, { ...remaining, startX: remaining.x, startY: remaining.y, moved: true });
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <canvas
      className="map-canvas"
      ref={canvas}
      style={{ height: frame.height }}
      tabIndex={0}
      role="img"
      aria-label={`Карта: ${points.length} точек. Перетаскивайте для перемещения, колесо или плюс и минус для масштаба, стрелки для сдвига. Для выбора тендера используйте поиск над картой.`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={(event) => up(event)}
      onPointerCancel={(event) => up(event, true)}
      onPointerLeave={() => {
        if (!pointers.current.size) onHover(null);
      }}
      onKeyDown={(event) => {
        const delta = view.span * 0.1;
        const updates: Record<string, MapView> = {
          ArrowLeft: { ...view, x: view.x - delta },
          ArrowRight: { ...view, x: view.x + delta },
          ArrowUp: { ...view, y: view.y + delta },
          ArrowDown: { ...view, y: view.y - delta },
        };
        if (updates[event.key]) {
          event.preventDefault();
          onView(updates[event.key]);
        } else if (['+', '=', '-'].includes(event.key)) {
          event.preventDefault();
          onView(
            zoomAt(
              view,
              frame,
              frame.width / 2,
              frame.height / 2,
              event.key === '-' ? 1.3 : 1 / 1.3,
              baseSpan,
            ),
          );
        }
      }}
    />
  );
}
