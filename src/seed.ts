import type { Polygon } from './shared/geom.js';
import type { RegionLevel } from './shared/levels.js';
import type { TileType } from './shared/tiles.js';
import type { Actor } from './shared/types.js';
import type { RouteInput } from './domain/world.js';
import { createRuntime } from './runtime.js';

const actor: Actor = { keyId: null, name: 'seed', scopes: ['read', 'write', 'delete', 'admin'] };

function poly(points: [number, number][]): Polygon {
  return { type: 'Polygon', points: points.map(([x, y]) => ({ x, y })) };
}

const GLYPH: Record<string, TileType | 'void'> = {
  '#': 'wall',
  '.': 'floor_wood',
  ',': 'floor_stone',
  D: 'door',
  F: 'furniture',
  S: 'stairs',
  W: 'window',
  L: 'lamp',
  R: 'rug',
  '~': 'water',
  ' ': 'void',
};

function parseGrid(rows: string[]): { width: number; height: number; tiles: { x: number; y: number; tileType: TileType }[] } {
  const height = rows.length;
  const width = Math.max(...rows.map((row) => row.length));
  const tiles: { x: number; y: number; tileType: TileType }[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((glyph, x) => {
      const kind = GLYPH[glyph];
      if (!kind || kind === 'void') return;
      tiles.push({ x, y, tileType: kind });
    });
  });
  return { width, height, tiles };
}

const regions: {
  id: string;
  parentId: string | null;
  level: RegionLevel;
  name: string;
  description: string;
  tags: string[];
  fill: string;
  geometry: Polygon;
  sortOrder: number;
}[] = [
  {
    id: 'continent_frostsong',
    parentId: null,
    level: 'continent',
    name: '霜歌大陆',
    description: '折光海北岸的大陆。冬季潮汐会在岸线上留下盐霜，内陆则是被灯塔和学院切开的港城。',
    tags: ['折光海纪', '北方'],
    fill: '#1f6f78',
    sortOrder: 0,
    geometry: poly([
      [120, 110], [205, 95], [250, 55], [330, 75], [380, 45], [435, 85], [500, 70], [535, 128],
      [590, 150], [575, 215], [620, 260], [590, 320], [610, 390], [565, 445], [580, 500], [530, 555],
      [500, 620], [440, 640], [400, 700], [340, 680], [300, 730], [245, 690], [205, 715], [160, 670],
      [110, 665], [90, 600], [55, 565], [80, 500], [50, 455], [72, 390], [40, 335], [85, 285],
      [60, 225], [100, 190],
    ]),
  },
  {
    id: 'continent_greenveil',
    parentId: null,
    level: 'continent',
    name: '翠幕群岛',
    description: '南边一串被暖潮包围的岛屿。珊瑚港是群岛唯一还在记账的城市。',
    tags: ['折光海纪', '群岛'],
    fill: '#2f6b45',
    sortOrder: 1,
    geometry: poly([
      [650, 180], [710, 135], [765, 170], [805, 115], [860, 145], [900, 120], [940, 180], [920, 240],
      [970, 300], [940, 360], [970, 420], [920, 465], [900, 530], [850, 560], [815, 640], [760, 675],
      [720, 620], [665, 645], [625, 585], [600, 525], [570, 490], [590, 420], [555, 365], [585, 310],
      [560, 250], [610, 225],
    ]),
  },
  {
    id: 'city_silverport',
    parentId: 'continent_frostsong',
    level: 'city',
    name: '银港',
    description: '霜歌大陆的主港。灯塔区面向雾，学院区面向星图。',
    tags: ['港口', '主城'],
    fill: '#3d5a80',
    sortOrder: 0,
    geometry: poly([
      [80, 70], [250, 50], [350, 65], [430, 30], [530, 60], [620, 55], [760, 50], [820, 125],
      [790, 210], [830, 280], [805, 355], [820, 420], [770, 465], [710, 505], [650, 545], [580, 570],
      [500, 620], [420, 640], [350, 610], [260, 635], [195, 600], [130, 570], [75, 520], [60, 445],
      [35, 380], [60, 320], [40, 250], [75, 180],
    ]),
  },
  {
    id: 'city_ash',
    parentId: 'continent_frostsong',
    level: 'city',
    name: '灰烬镇',
    description: '大陆南缘的冶炼镇。炉火熄了以后，巷子里仍能踩到温热的炉渣。',
    tags: ['冶炼'],
    fill: '#7a4e2d',
    sortOrder: 1,
    geometry: poly([
      [140, 700], [220, 675], [285, 690], [340, 655], [400, 680], [470, 660], [560, 685], [590, 740],
      [625, 790], [605, 845], [620, 900], [550, 930], [480, 915], [420, 950], [340, 925], [275, 945],
      [210, 915], [180, 865], [135, 820], [160, 765],
    ]),
  },
  {
    id: 'city_coral',
    parentId: 'continent_greenveil',
    level: 'city',
    name: '珊瑚港',
    description: '翠幕群岛的集散港。码头用珍珠粉刷过，雨天会发淡光。',
    tags: ['港口'],
    fill: '#3f7f78',
    sortOrder: 0,
    geometry: poly([
      [120, 120], [220, 95], [300, 120], [365, 80], [455, 105], [530, 75], [620, 105], [700, 80],
      [780, 105], [820, 160], [860, 220], [835, 285], [875, 350], [850, 420], [860, 520], [790, 555],
      [720, 590], [640, 570], [560, 620], [470, 600], [390, 645], [310, 610], [240, 650], [200, 590],
      [145, 535], [110, 465], [80, 390], [105, 320], [70, 255], [110, 195],
    ]),
  },
  {
    id: 'district_lighthouse',
    parentId: 'city_silverport',
    level: 'district',
    name: '灯塔区',
    description: '银港西侧，雾最浓的一片。潮声坊和雾钟庭隔着一条湿石路。',
    tags: ['雾', '海岸'],
    fill: '#6b4c7a',
    sortOrder: 0,
    geometry: poly([
      [40, 80],
      [460, 60],
      [500, 760],
      [50, 820],
    ]),
  },
  {
    id: 'district_college',
    parentId: 'city_silverport',
    level: 'district',
    name: '学院区',
    description: '银港东侧。观星的人把屋顶修得比城墙还高。',
    tags: ['学院'],
    fill: '#3f6b4e',
    sortOrder: 1,
    geometry: poly([
      [540, 70],
      [940, 90],
      [900, 780],
      [520, 740],
    ]),
  },
  {
    id: 'district_furnace',
    parentId: 'city_ash',
    level: 'district',
    name: '熔炉街',
    description: '灰烬镇唯一还保持直线的街道，因为炉渣把弯路填平了。',
    tags: ['炉渣'],
    fill: '#8a4b3a',
    sortOrder: 0,
    geometry: poly([
      [80, 80],
      [880, 120],
      [840, 820],
      [120, 780],
    ]),
  },
  {
    id: 'district_market',
    parentId: 'city_coral',
    level: 'district',
    name: '集市区',
    description: '珊瑚港的摊位按潮汐换位置。退潮时贝壳市集会露出第二排柜台。',
    tags: ['集市'],
    fill: '#2f6f62',
    sortOrder: 0,
    geometry: poly([
      [70, 90],
      [860, 70],
      [900, 800],
      [100, 760],
    ]),
  },
  {
    id: 'group_tidemarket',
    parentId: 'district_lighthouse',
    level: 'building_group',
    name: '潮声坊',
    description: '灯塔脚下的一小片铺面，盐商和守塔人共用一口井。',
    tags: ['坊市'],
    fill: '#8a5a44',
    sortOrder: 0,
    geometry: poly([
      [60, 80],
      [900, 100],
      [860, 460],
      [80, 430],
    ]),
  },
  {
    id: 'group_fogbell',
    parentId: 'district_lighthouse',
    level: 'building_group',
    name: '雾钟庭',
    description: '一座只在能见度低于桅杆时敲响的钟楼院子。',
    tags: ['钟'],
    fill: '#4d5d86',
    sortOrder: 1,
    geometry: poly([
      [80, 520],
      [820, 500],
      [860, 900],
      [70, 880],
    ]),
  },
  {
    id: 'group_starcourt',
    parentId: 'district_college',
    level: 'building_group',
    name: '星象院',
    description: '学院区的高处建筑群，塔影在正午会盖住日晷。',
    tags: ['星象'],
    fill: '#445e8a',
    sortOrder: 0,
    geometry: poly([
      [100, 120],
      [860, 80],
      [900, 820],
      [80, 780],
    ]),
  },
  {
    id: 'group_cinder',
    parentId: 'district_furnace',
    level: 'building_group',
    name: '熄火巷',
    description: '熔炉街尽头，冷炉工坊所在的窄巷。',
    tags: ['工坊'],
    fill: '#6e5344',
    sortOrder: 0,
    geometry: poly([
      [120, 140],
      [840, 100],
      [880, 780],
      [100, 820],
    ]),
  },
  {
    id: 'group_shell',
    parentId: 'district_market',
    level: 'building_group',
    name: '贝壳市集',
    description: '用整面贝壳墙围起来的市集，潮市大厅在正中。',
    tags: ['贝壳'],
    fill: '#3e7c84',
    sortOrder: 0,
    geometry: poly([
      [90, 100],
      [880, 80],
      [900, 820],
      [70, 780],
    ]),
  },
  {
    id: 'building_old_lighthouse',
    parentId: 'group_tidemarket',
    level: 'building',
    name: '旧灯塔',
    description: '还能上楼的灯塔。门厅铺木板，灯室中央有一盏不再旋转的灯。',
    tags: ['灯塔', '室内'],
    fill: '#a33b3b',
    sortOrder: 0,
    geometry: poly([
      [80, 80],
      [420, 60],
      [460, 380],
      [60, 400],
    ]),
  },
  {
    id: 'building_salt_hall',
    parentId: 'group_tidemarket',
    level: 'building',
    name: '盐商会馆',
    description: '盐商用来称货和避雨的会馆，门槛上有长期刮擦的白痕。',
    tags: ['商会'],
    fill: '#c4893a',
    sortOrder: 1,
    geometry: poly([
      [520, 90],
      [900, 70],
      [920, 400],
      [500, 380],
    ]),
  },
  {
    id: 'building_fogbell',
    parentId: 'group_fogbell',
    level: 'building',
    name: '雾钟楼',
    description: '三层木楼，钟绳从顶层垂到庭院。',
    tags: ['钟楼'],
    fill: '#355f86',
    sortOrder: 0,
    geometry: poly([
      [180, 160],
      [720, 140],
      [760, 700],
      [150, 720],
    ]),
  },
  {
    id: 'building_star_tower',
    parentId: 'group_starcourt',
    level: 'building',
    name: '观星塔',
    description: '星象院的主塔。楼梯靠墙，窗外能看见学院区的日晷。',
    tags: ['塔'],
    fill: '#314e86',
    sortOrder: 0,
    geometry: poly([
      [220, 120],
      [700, 100],
      [760, 760],
      [180, 740],
    ]),
  },
  {
    id: 'building_cold_forge',
    parentId: 'group_cinder',
    level: 'building',
    name: '冷炉工坊',
    description: '炉已经冷了，但工具还按热的时候的位置挂着。',
    tags: ['工坊'],
    fill: '#6a3a32',
    sortOrder: 0,
    geometry: poly([
      [160, 180],
      [760, 140],
      [800, 700],
      [140, 740],
    ]),
  },
  {
    id: 'building_tide_hall',
    parentId: 'group_shell',
    level: 'building',
    name: '潮市大厅',
    description: '贝壳市集的室内大厅，地面有一条引潮水的浅槽。',
    tags: ['大厅'],
    fill: '#2c6e78',
    sortOrder: 0,
    geometry: poly([
      [180, 160],
      [780, 120],
      [820, 720],
      [150, 700],
    ]),
  },
];

const places = [
  { id: 'place_north_altar', regionId: 'continent_frostsong', name: '北风祭坛', description: '大陆北缘的石环，冬天不积雪。', tags: ['祭坛'], kind: 'landmark', x: 180, y: 180 },
  { id: 'place_anchor', regionId: 'city_silverport', name: '断锚广场', description: '银港的空地，锚被从中锯开，当作路标。', tags: ['广场'], kind: 'landmark', x: 240, y: 300 },
  { id: 'place_tide_market', regionId: 'city_silverport', name: '潮汐市集', description: '只在涨潮前后各开一个时辰。', tags: ['市集'], kind: 'event', x: 620, y: 260 },
  { id: 'place_bench', regionId: 'district_lighthouse', name: '雾中长椅', description: '看不清海的时候，人们坐在这里听涛。', tags: ['休息'], kind: 'landmark', x: 300, y: 500 },
  { id: 'place_sundial', regionId: 'district_college', name: '青铜日晷', description: '被观星塔的影子盖住以后，就只在清晨准。', tags: ['学院'], kind: 'landmark', x: 700, y: 420 },
  { id: 'place_cinder_well', regionId: 'city_ash', name: '余烬井', description: '井水常年微温。', tags: ['水井'], kind: 'landmark', x: 360, y: 240 },
  { id: 'place_pearl_dock', regionId: 'city_coral', name: '珍珠码头', description: '珊瑚港卸货的主码头。', tags: ['码头'], kind: 'landmark', x: 480, y: 300 },
  { id: 'place_salt_sacks', regionId: 'group_tidemarket', name: '盐袋堆', description: '潮声坊靠墙的盐袋，雨天会结壳。', tags: ['货物'], kind: 'item', x: 700, y: 250 },
  { id: 'place_lighthouse_log', regionId: 'building_old_lighthouse', name: '灯塔日志', description: '放在门厅柜台后的值守记录。', tags: ['文书'], kind: 'item', x: 4, y: 5 },
];

const seedRoutes: RouteInput[] = [
  {
    id: 'route_silverport_ash_trade',
    regionId: 'continent_frostsong',
    name: '银港—灰烬镇商路',
    kind: 'road',
    geometry: { type: 'LineString', points: [{ x: 470, y: 505 }, { x: 520, y: 560 }, { x: 505, y: 620 }, { x: 480, y: 690 }] },
  },
  {
    id: 'route_lighthouse_salt_lane',
    regionId: 'city_silverport',
    name: '灯塔区盐路',
    kind: 'trail',
    geometry: { type: 'LineString', points: [{ x: 70, y: 350 }, { x: 160, y: 330 }, { x: 260, y: 370 }, { x: 380, y: 405 }, { x: 465, y: 450 }] },
  },
];

const hall = parseGrid([
  '##############',
  '#............#',
  '#............#',
  '#..DD........#',
  '#............#',
  '#....FFFF....#',
  '#....FFFF....#',
  '#............#',
  '#.....SS.....#',
  '#............#',
  '#............#',
  '##############',
]);

const lampRoom = parseGrid([
  '##############',
  '#,,,,,,,,,,,,#',
  '#,,WW,,,,WW,,#',
  '#,,,,,,,,,,,,#',
  '#,,,,,LL,,,,,#',
  '#,,,,LRRL,,,,#',
  '#,,,,LRRL,,,,#',
  '#,,,,,LL,,,,,#',
  '#,,,,,,,,,,,,#',
  '#,,WW,,,,WW,,#',
  '#,,,,,SS,,,,,#',
  '##############',
]);

function resetWorld(sqlite: { exec: (sql: string) => void }): void {
  sqlite.exec(`
    DELETE FROM indoor_tiles;
    DELETE FROM indoor_floors;
    DELETE FROM routes;
    DELETE FROM places;
    DELETE FROM regions WHERE level = 'building';
    DELETE FROM regions WHERE level = 'building_group';
    DELETE FROM regions WHERE level = 'district';
    DELETE FROM regions WHERE level = 'city';
    DELETE FROM regions WHERE level = 'continent';
    DELETE FROM snapshots;
    DELETE FROM audit_logs;
  `);
}

function ensureKeys(reset: boolean): void {
  const runtime = createRuntime();
  try {
    if (reset) {
      for (const key of runtime.keys.list()) {
        if (!key.revokedAt) runtime.keys.revoke(key.id);
      }
    }
    const active = runtime.keys.list().filter((key) => !key.revokedAt);
    if (active.length > 0 && !reset) {
      console.log('已有 API Key。明文无法再次显示，库里只有哈希和前缀：');
      for (const key of active) console.log(`  ${key.name}\t${key.scopes.join(',')}\t${key.keyPrefix}…`);
      console.log('丢失明文时：npm run key:create -- <名称> <read,write>  或  npm run seed -- --reset-keys');
      return;
    }
    const specs = [
      ['viewer', ['read']],
      ['editor', ['read', 'write', 'delete']],
      ['admin', ['read', 'write', 'delete', 'admin']],
    ] as const;
    console.log('已创建 API Key。明文只出现这一次，请立刻复制。数据库不保存明文：');
    for (const [name, scopes] of specs) {
      const created = runtime.keys.create({ name, scopes: [...scopes] });
      console.log(`  ${name}\t${scopes.join(',')}\t${created.token}`);
    }
  } finally {
    runtime.sqlite.close();
  }
}

const resetKeys = process.argv.includes('--reset-keys');
const runtime = createRuntime();
resetWorld(runtime.sqlite);

for (const region of regions) runtime.world.createRegion(region, actor);
for (const place of places) runtime.world.createPlace(place, actor);
for (const route of seedRoutes) runtime.world.createRoute(route, actor);

const ground = runtime.world.createFloor(
  { id: 'floor_lighthouse_0', regionId: 'building_old_lighthouse', floorIndex: 0, name: '门厅', width: hall.width, height: hall.height },
  actor,
);
const lamp = runtime.world.createFloor(
  { id: 'floor_lighthouse_1', regionId: 'building_old_lighthouse', floorIndex: 1, name: '灯室', width: lampRoom.width, height: lampRoom.height },
  actor,
);
runtime.world.setTiles(ground.id, hall.tiles, actor);
runtime.world.setTiles(lamp.id, lampRoom.tiles, actor);
const snapshot = runtime.world.createSnapshot(actor, '种子世界：折光海纪', 'manual');
runtime.sqlite.close();

ensureKeys(resetKeys);

console.log('');
console.log(`已写入种子世界「折光海纪」：${regions.length} 个区域，${places.length} 个地点，${seedRoutes.length} 条道路，旧灯塔 2 层室内 tile。`);
console.log(`快照 ${snapshot.id}  ${snapshot.label}`);
console.log('层级示例：霜歌大陆 → 银港 → 灯塔区 → 潮声坊 → 旧灯塔（室内）。');
