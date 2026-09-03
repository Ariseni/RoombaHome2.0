import { Canvas, Circle, Group, Line, Path, Skia, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import type { MapModel } from '@/protocol/maps/bundle';
import { type Bounds, type Point, type PolygonCoords, isValidBounds, pointInPolygon } from '@/protocol/maps/geometry';
import type { PositionSample } from '@/protocol/models/livemap';
import { colors, roomPalette } from '@/ui/theme';
import type { SelectedArea } from '@/store/maps';

interface Props {
  model: MapModel;
  selected: SelectedArea[];
  onToggle: (area: SelectedArea) => void;
  liveSamples?: PositionSample[];
  width: number;
  height: number;
}

interface ViewBox {
  scale: number;
  ox: number;
  oy: number;
}

function viewBox(b: Bounds, w: number, h: number, pad = 24): ViewBox {
  if (!isValidBounds(b) || w <= 0 || h <= 0) return { scale: 1, ox: 0, oy: 0 };
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const ox = (w - bw * scale) / 2 - b.minX * scale;
  const oy = (h - bh * scale) / 2 + b.maxY * scale; // flip Y
  return { scale, ox, oy };
}

function toScreen(p: Point, v: ViewBox): Point {
  return [p[0] * v.scale + v.ox, -p[1] * v.scale + v.oy];
}

function pathOf(polygons: PolygonCoords[], v: ViewBox) {
  const p = Skia.Path.Make();
  for (const poly of polygons) {
    for (const ring of poly) {
      if (ring.length === 0) continue;
      const [x0, y0] = toScreen(ring[0], v);
      p.moveTo(x0, y0);
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = toScreen(ring[i], v);
        p.lineTo(x, y);
      }
      p.close();
    }
  }
  return p;
}

function hexWithAlpha(hex: string, a: string): string {
  return hex.length === 7 ? `${hex}${a}` : hex;
}

export function MapCanvas({ model, selected, onToggle, liveSamples, width, height }: Props) {
  const v = useMemo(() => viewBox(model.bounds, width, height), [model.bounds, width, height]);

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const saved = useSharedValue({ scale: 1, tx: 0, ty: 0 });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      saved.value = { scale: scale.value, tx: tx.value, ty: ty.value };
    })
    .onUpdate((e) => {
      scale.value = Math.min(6, Math.max(0.6, saved.value.scale * e.scale));
    });

  const pan = Gesture.Pan()
    .onStart(() => {
      saved.value = { scale: scale.value, tx: tx.value, ty: ty.value };
    })
    .onUpdate((e) => {
      tx.value = saved.value.tx + e.translationX;
      ty.value = saved.value.ty + e.translationY;
    });

  const tapJs = Gesture.Tap().runOnJS(true).onEnd((e) => {
    const s = scale.value;
    const mx = (e.x - tx.value - width / 2) / s + width / 2;
    const my = (e.y - ty.value - height / 2) / s + height / 2;
    // invert viewBox to map coords
    const mapX = (mx - v.ox) / v.scale;
    const mapY = -(my - v.oy) / v.scale;
    const point: Point = [mapX, mapY];
    for (const z of model.zones) {
      if (z.polygons.some((p) => pointInPolygon(point, p))) {
        onToggle({ id: z.id, type: 'zid', name: z.name });
        return;
      }
    }
    for (const r of model.rooms) {
      if (r.polygons.some((p) => pointInPolygon(point, p))) {
        onToggle({ id: r.id, type: 'rid', name: r.name });
        return;
      }
    }
  });

  const composed = Gesture.Simultaneous(pinch, pan, tapJs);

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const roomPaths = useMemo(
    () =>
      model.rooms.map((r, i) => ({
        id: r.id,
        color: roomPalette[i % roomPalette.length],
        path: pathOf(r.polygons, v),
        selected: selected.some((s) => s.id === r.id && s.type === 'rid'),
      })),
    [model.rooms, selected, v],
  );
  const zonePaths = useMemo(
    () =>
      model.zones.map((z) => ({
        id: z.id,
        path: pathOf(z.polygons, v),
        selected: selected.some((s) => s.id === z.id && s.type === 'zid'),
      })),
    [model.zones, selected, v],
  );
  const kozPaths = useMemo(() => pathOf(model.policyZones.flatMap((p) => p.polygons), v), [model.policyZones, v]);
  const borderPaths = useMemo(() => pathOf(model.borders, v), [model.borders, v]);
  const dock = model.dock ? toScreen(model.dock.point, v) : null;
  const livePts = (liveSamples ?? []).map((s) => toScreen([s.x, s.y], v));
  const last = livePts[livePts.length - 1];

  return (
    <View style={{ width, height }}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[{ width, height }, anim]}>
          <Canvas style={{ width, height }}>
            <Group>
              {borderPaths ? <Path path={borderPaths} color={colors.border} style="stroke" strokeWidth={2} /> : null}
              {roomPaths.map((r) => (
                <Path
                  key={r.id}
                  path={r.path}
                  color={hexWithAlpha(r.color, r.selected ? 'CC' : '55')}
                  style="fill"
                />
              ))}
              {roomPaths.map((r) => (
                <Path key={`${r.id}-s`} path={r.path} color={r.selected ? colors.accent : hexWithAlpha(r.color, 'AA')} style="stroke" strokeWidth={r.selected ? 2.5 : 1} />
              ))}
              {zonePaths.map((z) => (
                <Path
                  key={z.id}
                  path={z.path}
                  color={z.selected ? 'rgba(251,191,36,0.45)' : 'rgba(251,191,36,0.18)'}
                  style="fill"
                />
              ))}
              {kozPaths ? <Path path={kozPaths} color="rgba(248,113,113,0.35)" style="fill" /> : null}
              {livePts.length > 1
                ? livePts.slice(1).map((p, i) => (
                    <Line key={i} p1={vec(livePts[i][0], livePts[i][1])} p2={vec(p[0], p[1])} color={colors.accent} strokeWidth={2} />
                  ))
                : null}
              {last ? <Circle cx={last[0]} cy={last[1]} r={6} color={colors.accent} /> : null}
              {dock ? <Circle cx={dock[0]} cy={dock[1]} r={7} color={colors.text} /> : null}
              {dock ? <Circle cx={dock[0]} cy={dock[1]} r={3} color={colors.bg} /> : null}
            </Group>
          </Canvas>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export const mapCanvasStyles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: colors.bg },
});
