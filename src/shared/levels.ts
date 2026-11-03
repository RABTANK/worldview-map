export const LEVELS = ['continent', 'city', 'district', 'building_group', 'building'] as const;

export type RegionLevel = (typeof LEVELS)[number];

export const LEVEL_LABEL: Record<RegionLevel, string> = {
  continent: '大陆',
  city: '城市',
  district: '区域',
  building_group: '建筑群',
  building: '建筑',
};

export function isRegionLevel(value: string): value is RegionLevel {
  return (LEVELS as readonly string[]).includes(value);
}

/** 该层级要求的父层级。大陆没有父级。 */
export function expectedParentLevel(level: RegionLevel): RegionLevel | null {
  const index = LEVELS.indexOf(level);
  return index <= 0 ? null : LEVELS[index - 1];
}
