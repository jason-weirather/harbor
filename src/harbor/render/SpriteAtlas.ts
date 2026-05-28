export const HARBOR_PLACEHOLDER_SPRITES = [
  "tile.water.shallow.0",
  "tile.water.deep.0",
  "tile.sand.0",
  "tile.grass.0",
  "overlay.shore.foam.0",
  "prop.tree.pine.0",
  "prop.reeds.0",
  "prop.rock.0",
  "prop.bush.0",
  "prop.foreground.foliage.0",
  "fisher.idle.right.0",
  "fisher.cast.right.0",
  "fisher.reel.right.0",
  "wildlife.egret.fly.0",
  "wildlife.egret.stand.0",
  "wildlife.egret.strike.0",
  "wildlife.egret.eat.0",
  "fish.lanternKoi.swim.0",
  "fx.ripple.0",
  "fx.splash.0",
  "fx.sparkle.0",
] as const;

export type HarborSpriteName = (typeof HARBOR_PLACEHOLDER_SPRITES)[number];

export interface HarborSpriteFrame {
  h: number;
  name: HarborSpriteName;
  source: "procedural-placeholder";
  w: number;
  x: number;
  y: number;
}

export interface HarborSpriteAtlas {
  frames: Record<HarborSpriteName, HarborSpriteFrame>;
  image: string;
  meta: {
    description: string;
    pixelRatio: number;
  };
}

export const HARBOR_PLACEHOLDER_ATLAS: HarborSpriteAtlas = {
  image: "harbor-placeholder-atlas://procedural",
  frames: Object.fromEntries(
    HARBOR_PLACEHOLDER_SPRITES.map((name, index) => [
      name,
      {
        h: 32,
        name,
        source: "procedural-placeholder",
        w: 32,
        x: (index % 8) * 32,
        y: Math.floor(index / 8) * 32,
      },
    ]),
  ) as Record<HarborSpriteName, HarborSpriteFrame>,
  meta: {
    description:
      "Stable placeholder frame names for the Harbor art pipeline. Canvas draws procedural stand-ins until bitmap atlases land.",
    pixelRatio: 1,
  },
};

export function getSpriteFrame(name: HarborSpriteName) {
  return HARBOR_PLACEHOLDER_ATLAS.frames[name];
}
