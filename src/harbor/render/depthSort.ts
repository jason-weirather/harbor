import type { HarborSceneLayer } from "./SceneLayers";

export interface SceneDrawable {
  draw: () => void;
  id: string;
  layer: HarborSceneLayer;
  order?: number;
  y: number;
}

const LAYER_DEPTH: Record<HarborSceneLayer, number> = {
  background: 0,
  terrain: 1,
  shoreOverlay: 2,
  waterLife: 3,
  props: 4,
  characters: 5,
  fx: 6,
  foreground: 7,
  lighting: 8,
};

export function sortSceneDrawables(drawables: SceneDrawable[]) {
  return [...drawables].sort((left, right) => {
    const layerDelta = LAYER_DEPTH[left.layer] - LAYER_DEPTH[right.layer];

    if (layerDelta !== 0) {
      return layerDelta;
    }

    const yDelta = left.y - right.y;

    if (yDelta !== 0) {
      return yDelta;
    }

    return (left.order ?? 0) - (right.order ?? 0);
  });
}
