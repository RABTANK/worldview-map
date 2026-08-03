// ============================================================
// tile-config.js - RPG Maker 风格瓦片类型定义
// 用于建筑平面图的最小物块单元系统
// ============================================================

// ---- 瓦片类型枚举 ----
const TILE = {
  VOID:       0,
  WALL:       1,
  FLOOR:      2,
  DOOR:       3,
  WINDOW:     4,
  STAIRS_UP:  5,
  STAIRS_DOWN:6,
  GRASS:      7,
  WATER:      8,
  PATH:       9,
  THRONE:    10,
  ALTAR:     11,
  BED:       12,
  TABLE:     13,
  CHEST:     14,
  BOOKSHELF: 15,
  PILLAR:    16,
  FOUNTAIN:  17,
  STATUE:    18,
  COUNTER:   19,
  BARREL:    20,
  PLANT:     21,
  CARPET:    22,
  FORGE:     23,
  ANVIL:     24,
  STOVE:     25,
  BED_LARGE: 26,
  DESK:      27,
  CHAIR:     28,
  FIREPLACE: 29,
  WELL:      30,
  GRAVE:     31,
  BRIDGE:    32,
  GATE:      33,
};

// ---- 瓦片视觉配置 ----
const TILE_CONFIG = {
  [TILE.VOID]:       { name: '空',     color: 'transparent',           border: 'transparent',           icon: '' },
  [TILE.WALL]:       { name: '墙壁',   color: '#3a3a4e',               border: '#5a5a7e',               icon: '' },
  [TILE.FLOOR]:      { name: '地板',   color: '#2a2a3a',               border: '#33334a',               icon: '' },
  [TILE.DOOR]:       { name: '门',     color: '#8b6914',               border: '#b8860b',               icon: '\u{1F6AA}' },
  [TILE.WINDOW]:     { name: '窗',     color: '#4a6a8a',               border: '#5a7a9a',               icon: '' },
  [TILE.STAIRS_UP]:  { name: '上楼',   color: '#c0c0c0',               border: '#d0d0d0',               icon: '\u2191' },
  [TILE.STAIRS_DOWN]:{ name: '下楼',   color: '#8a8a8a',               border: '#9a9a9a',               icon: '\u2193' },
  [TILE.GRASS]:      { name: '草地',   color: '#2a4a2a',               border: '#3a5a3a',               icon: '' },
  [TILE.WATER]:      { name: '水域',   color: '#1a3a5a',               border: '#2a4a6a',               icon: '' },
  [TILE.PATH]:       { name: '路径',   color: '#4a4a3a',               border: '#5a5a4a',               icon: '' },
  [TILE.THRONE]:     { name: '王座',   color: '#8b6914',               border: '#ffd700',               icon: '\u{1F451}' },
  [TILE.ALTAR]:      { name: '祭坛',   color: '#d0d0e0',               border: '#e0e0f0',               icon: '\u2719' },
  [TILE.BED]:        { name: '床',     color: '#5a3a2a',               border: '#6a4a3a',               icon: '' },
  [TILE.BED_LARGE]:  { name: '大床',   color: '#6a3a2a',               border: '#7a4a3a',               icon: '' },
  [TILE.TABLE]:      { name: '桌子',   color: '#6a4a2a',               border: '#7a5a3a',               icon: '' },
  [TILE.DESK]:       { name: '书桌',   color: '#5a4a2a',               border: '#6a5a3a',               icon: '' },
  [TILE.CHAIR]:      { name: '椅子',   color: '#4a3a2a',               border: '#5a4a3a',               icon: '' },
  [TILE.CHEST]:      { name: '箱子',   color: '#8b6914',               border: '#a07914',               icon: '\u{1F4E6}' },
  [TILE.BOOKSHELF]:  { name: '书架',   color: '#4a3a2a',               border: '#5a4a3a',               icon: '' },
  [TILE.PILLAR]:     { name: '柱子',   color: '#5a5a6a',               border: '#7a7a8a',               icon: '' },
  [TILE.FOUNTAIN]:   { name: '喷泉',   color: '#3a6a8a',               border: '#4a7a9a',               icon: '\u{1F6B0}' },
  [TILE.STATUE]:     { name: '雕像',   color: '#8a8a9a',               border: '#9a9aaa',               icon: '\u{1F5FD}' },
  [TILE.COUNTER]:    { name: '柜台',   color: '#6a5a3a',               border: '#7a6a4a',               icon: '' },
  [TILE.BARREL]:     { name: '木桶',   color: '#6a4a2a',               border: '#7a5a3a',               icon: '' },
  [TILE.PLANT]:      { name: '植物',   color: '#3a5a2a',               border: '#4a6a3a',               icon: '' },
  [TILE.CARPET]:     { name: '地毯',   color: '#6a2a2a',               border: '#7a3a3a',               icon: '' },
  [TILE.FORGE]:      { name: '熔炉',   color: '#5a2a1a',               border: '#6a3a2a',               icon: '' },
  [TILE.ANVIL]:      { name: '铁砧',   color: '#4a4a4a',               border: '#5a5a5a',               icon: '' },
  [TILE.STOVE]:      { name: '炉灶',   color: '#5a3a1a',               border: '#6a4a2a',               icon: '' },
  [TILE.FIREPLACE]:  { name: '壁炉',   color: '#5a2a1a',               border: '#7a3a2a',               icon: '\u{1F525}' },
  [TILE.WELL]:       { name: '水井',   color: '#3a4a5a',               border: '#4a5a6a',               icon: '' },
  [TILE.GRAVE]:      { name: '墓穴',   color: '#3a3a3a',               border: '#4a4a4a',               icon: '' },
  [TILE.BRIDGE]:     { name: '桥',     color: '#6a4a2a',               border: '#7a5a3a',               icon: '' },
  [TILE.GATE]:       { name: '大门',   color: '#5a4a3a',               border: '#8b6914',               icon: '\u{1F6AA}' },
};

// ---- 字符映射表 (用于设计平面图时用字符快捷表示) ----
const CHAR_TO_TILE = {
  ' ': TILE.VOID,
  '#': TILE.WALL,
  '.': TILE.FLOOR,
  'D': TILE.DOOR,
  'W': TILE.WINDOW,
  'U': TILE.STAIRS_UP,
  'X': TILE.STAIRS_DOWN,
  'G': TILE.GRASS,
  '~': TILE.WATER,
  '-': TILE.PATH,
  'H': TILE.THRONE,
  'A': TILE.ALTAR,
  'b': TILE.BED,
  'B': TILE.BED_LARGE,
  'T': TILE.TABLE,
  'd': TILE.DESK,
  'c': TILE.CHAIR,
  'C': TILE.CHEST,
  'S': TILE.BOOKSHELF,
  'P': TILE.PILLAR,
  'f': TILE.FOUNTAIN,
  's': TILE.STATUE,
  'K': TILE.COUNTER,
  'O': TILE.BARREL,
  'p': TILE.PLANT,
  'R': TILE.CARPET,
  'F': TILE.FORGE,
  'N': TILE.ANVIL,
  'E': TILE.STOVE,
  'L': TILE.FIREPLACE,
  'I': TILE.WELL,
  'g': TILE.GRAVE,
  '=': TILE.BRIDGE,
  'M': TILE.GATE,
};

// ---- 将字符串平面图转换为瓦片数组 ----
function parseTileMap(rows) {
  if (!rows || rows.length === 0) return { width: 0, height: 0, tiles: [] };
  const height = rows.length;
  const width = Math.max(...rows.map(r => r.length));
  const tiles = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x] || ' ';
      row.push(CHAR_TO_TILE[ch] !== undefined ? CHAR_TO_TILE[ch] : TILE.VOID);
    }
    tiles.push(row);
  }
  return { width, height, tiles };
}

// ---- 层级配置 (扩展: 包含楼层) ----
const LEVEL_CONFIG_FULL = {
  1: { name: '大陆',   fontSize: 18, fontWeight: 700, zoom: 1   },
  2: { name: '城市',   fontSize: 16, fontWeight: 700, zoom: 2.5 },
  3: { name: '区域',   fontSize: 13, fontWeight: 600, zoom: 5   },
  4: { name: '建筑群', fontSize: 12, fontWeight: 500, zoom: 8   },
  5: { name: '建筑',   fontSize: 11, fontWeight: 500, zoom: 12  },
};
