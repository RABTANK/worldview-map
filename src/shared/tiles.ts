export const TILE_TYPES = [
  'floor_wood',
  'floor_stone',
  'wall',
  'door',
  'stairs',
  'window',
  'furniture',
  'lamp',
  'rug',
  'water',
] as const;

export type TileType = (typeof TILE_TYPES)[number];

export const TILE_LABEL: Record<TileType, string> = {
  floor_wood: '木地板',
  floor_stone: '石地板',
  wall: '墙',
  door: '门',
  stairs: '楼梯',
  window: '窗',
  furniture: '家具',
  lamp: '灯',
  rug: '地毯',
  water: '水',
};

export const TILE_COLORS: Record<TileType, string> = {
  floor_wood: '#8d5a32',
  floor_stone: '#8e8a83',
  wall: '#2a3036',
  door: '#c4894a',
  stairs: '#d9c7a6',
  window: '#7eb6d6',
  furniture: '#6b3f2a',
  lamp: '#f2d16b',
  rug: '#7d3048',
  water: '#3a7ca5',
};

export function isTileType(value: string): value is TileType {
  return (TILE_TYPES as readonly string[]).includes(value);
}
