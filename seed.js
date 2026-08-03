// ============================================================
// seed.js - 种子数据脚本 (v2)
// 修复清单:
//   1. 直接调数据层, 不走 HTTP (绕开鉴权引导的鸡生蛋问题)
//   2. 修复 "carve" 残留拼写
//   3. clean 分支: 先建目录, 重建密钥文件, 错误处理
//   4. 移除硬编码 API_KEY 和无意义的 sleep(100)
//   5. 引擎要求 Node >=18 (package.json 已更新)
// ============================================================

const fs = require('fs');
const path = require('path');
const db = require('./db');

// ---- 示例区域 ----
const REGIONS = [
  {
    type: 'Feature',
    properties: { name: '冰封荒原', id: 'frozen_wastes', type: 'tundra', color: 'rgba(100, 150, 200, 0.25)' },
    geometry: { type: 'Polygon', coordinates: [[[80,800],[300,820],[550,810],[800,820],[950,800],[940,880],[750,895],[550,890],[300,900],[100,880]]] }
  },
  {
    type: 'Feature',
    properties: { name: '龙脊山脉', id: 'dragon_spine', type: 'mountain', color: 'rgba(80, 60, 50, 0.4)' },
    geometry: { type: 'Polygon', coordinates: [[[100,620],[300,640],[550,625],[750,640],[940,620],[930,720],[750,745],[550,730],[300,755],[110,725]]] }
  },
  {
    type: 'Feature',
    properties: { name: '翠绿平原', id: 'verdant_plains', type: 'plains', color: 'rgba(30, 80, 50, 0.35)' },
    geometry: { type: 'Polygon', coordinates: [[[300,350],[550,335],[750,350],[760,460],[750,560],[730,620],[550,640],[370,625],[330,560],[340,460]]] }
  },
  {
    type: 'Feature',
    properties: { name: '迷雾森林', id: 'mist_forest', type: 'forest', color: 'rgba(20, 60, 30, 0.45)' },
    geometry: { type: 'Polygon', coordinates: [[[750,350],[930,330],[950,450],[960,560],[940,640],[830,655],[730,620],[750,560],[760,460]]] }
  },
  {
    type: 'Feature',
    properties: { name: '古代遗迹区', id: 'ancient_ruins', type: 'desert', color: 'rgba(100, 80, 50, 0.35)' },
    geometry: { type: 'Polygon', coordinates: [[[110,360],[300,350],[330,460],[340,560],[320,640],[290,720],[120,710],[70,560],[60,460]]] }
  },
  {
    type: 'Feature',
    properties: { name: '深渊海域', id: 'abyssal_sea', type: 'ocean', color: 'rgba(20, 40, 80, 0.4)' },
    geometry: { type: 'Polygon', coordinates: [[[120,100],[290,90],[320,170],[370,175],[550,180],[730,170],[830,185],[940,170],[950,50],[930,10],[600,5],[300,10],[80,25],[60,150]]] }
  },
  {
    type: 'Feature',
    properties: { name: '火焰之地', id: 'land_of_fire', type: 'volcanic', color: 'rgba(120, 40, 20, 0.4)' },
    geometry: { type: 'Polygon', coordinates: [[[760,60],[870,55],[900,130],[860,180],[770,175],[735,110]]] }
  },
];

// ---- 示例地点 ----
const LOCATIONS = [
  {
    name: '王城艾尔德里亚', coordinates: [545, 470], type: 'city', regionId: 'verdant_plains',
    description: '艾尔德里亚王国的宏伟都城，围绕远古光之树而建。白色尖塔直插云霄，市集上聚集了来自已知世界各地的商人。城墙由精灵石匠加固，据说能抵御龙焰。',
    tags: ['首都', '王国', '光之树'], relatedCharacters: ['国王阿尔伯特', '大法师梅林', '骑士团长莱恩'],
    history: [
      { time: '纪元1年', event: '光之树苗发芽，游牧民族在此定居' },
      { time: '纪元500年', event: '王国统一战争胜利，艾尔德里亚成为首都' },
      { time: '纪元997年', event: '暗影军团围城三月未果，史称"光之围城"' },
    ],
    context: '初始世界观设定 - 创建首都'
  },
  {
    name: '暗影村', coordinates: [845, 490], type: 'village', regionId: 'mist_forest',
    description: '隐藏在迷雾森林深处的神秘村庄。据说村民拥有与暗影沟通的能力，误入此地的旅人往往会忘记来路。',
    tags: ['神秘', '暗影', '隐秘'], relatedCharacters: ['暗影长老莫甘娜'],
    history: [{ time: '纪元300年', event: '暗影法师在此建立隐居地' }],
    context: '初始世界观设定 - 创建神秘村庄'
  },
  {
    name: '龙骨要塞', coordinates: [545, 680], type: 'fortress', regionId: 'dragon_spine',
    description: '嵌入龙脊山脉的坚不可摧的要塞，以古龙骸骨为基建成。守护北方通道，抵御冰封荒原的凶兽南下。',
    tags: ['军事', '要塞', '龙骨'], relatedCharacters: ['要塞指挥官索拉'],
    history: [{ time: '纪元200年', event: '屠龙英雄以龙骨筑城' }],
    context: '初始世界观设定 - 创建军事要塞'
  },
  {
    name: '海港城塞勒姆', coordinates: [400, 130], type: 'port', regionId: 'abyssal_sea',
    description: '王国最大的港口城市，塞勒姆港湾终年不冻。以鱼市、海军学院和神秘的潮汐灯塔闻名。来自远方大陆的商船在此停泊。',
    tags: ['港口', '贸易', '海军'], relatedCharacters: ['港务长达莉娅', '灯塔守望者芬恩'],
    history: [
      { time: '纪元150年', event: '渔村发展为贸易港' },
      { time: '纪元800年', event: '潮汐灯塔建成，照亮整个海湾' },
    ],
    context: '初始世界观设定 - 创建港口城市'
  },
  {
    name: '远古神殿', coordinates: [195, 530], type: 'ruins', regionId: 'ancient_ruins',
    description: '被遗忘文明的遗迹。神殿墙壁上的符文在月光下微微发光，学者们认为它藏有世界创生的秘密。',
    tags: ['遗迹', '远古', '符文'], relatedCharacters: ['考古学家艾琳'],
    history: [{ time: '纪元前', event: '未知文明建造此神殿' }],
    context: '初始世界观设定 - 创建远古遗迹'
  },
  {
    name: '冰晶塔', coordinates: [545, 860], type: 'tower', regionId: 'frozen_wastes',
    description: '完全由永恒之冰构成的塔，矗立在冰封荒原之上。据说是冰贤者的居所，他已在此守护千年秘密。',
    tags: ['冰', '塔楼', '贤者'], relatedCharacters: ['冰贤者弗罗斯特'],
    history: [{ time: '纪元1年', event: '冰贤者在此筑塔修行' }],
    context: '初始世界观设定 - 创建冰晶塔'
  },
  {
    name: '熔岩熔炉', coordinates: [820, 110], type: 'forge', regionId: 'land_of_fire',
    description: '由火山活动驱动的巨型熔炉。这里的工匠大师打造品质无与伦比的武器和护甲，注入火焰之力。',
    tags: ['锻造', '火山', '工匠'], relatedCharacters: ['锻造大师格鲁姆'],
    history: [{ time: '纪元400年', event: '矮人迁徙至此，建立熔炉' }],
    context: '初始世界观设定 - 创建熔岩熔炉'
  },
];

// ============================================================
// 填充种子数据 - 直接调数据层, 不走 HTTP
// ============================================================
function seed() {
  console.log('开始填充种子数据...\n');

  // 创建区域
  console.log(`创建 ${REGIONS.length} 个区域...`);
  for (const region of REGIONS) {
    // 检查是否已存在 (避免重复运行时产生重复)
    if (db.map.featureIdExists(region.properties.id)) {
      console.log(`  - ${region.properties.name} (已存在, 跳过)`);
      continue;
    }
    db.map.addFeature(region);
    console.log(`  + ${region.properties.name}`);
  }

  // 创建地点
  console.log(`\n创建 ${LOCATIONS.length} 个地点...`);
  for (const loc of LOCATIONS) {
    // 检查名称是否已存在 (避免重复运行时产生重复)
    const existing = db.locations.getAll().find((l) => l.name === loc.name);
    if (existing) {
      console.log(`  - ${loc.name} (已存在, 跳过)`);
      continue;
    }
    db.locations.create(loc, 'seed-script');
    console.log(`  + ${loc.name}`);
  }

  // 创建初始版本快照
  db.versions.createSnapshot('种子数据初始化 - 含示例区域和地点', 'seed-script', true);
  console.log(`\n已创建里程碑版本快照`);

  console.log('\n种子数据填充完成！');
  console.log('访问 http://localhost:3000 查看地图');
}

// ============================================================
// 清空数据 - 建目录, 清文件, 重建密钥
// ============================================================
function clean() {
  console.log('清空所有数据...\n');

  const dataDir = path.join(__dirname, 'data');
  const snapshotDir = path.join(dataDir, 'snapshots');

  // 1. 确保目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('  创建 data 目录');
  }
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  // 2. 清空快照文件
  if (fs.existsSync(snapshotDir)) {
    const snapshots = fs.readdirSync(snapshotDir);
    for (const f of snapshots) {
      fs.unlinkSync(path.join(snapshotDir, f));
    }
    console.log(`  清除 ${snapshots.length} 个快照文件`);
  }

  // 3. 写入空数据文件
  fs.writeFileSync(path.join(dataDir, 'locations.json'), '[]', 'utf-8');
  fs.writeFileSync(path.join(dataDir, 'map.geojson.json'), JSON.stringify({ type: 'FeatureCollection', features: [] }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(dataDir, 'logs.json'), '[]', 'utf-8');
  fs.writeFileSync(path.join(dataDir, 'versions.json'), '[]', 'utf-8');
  console.log('  数据文件已重置 (locations, map, logs, versions)');

  // 4. 删除 api-keys.json, 下次启动时 bootstrap 会重建
  const keysFile = path.join(dataDir, 'api-keys.json');
  if (fs.existsSync(keysFile)) {
    fs.unlinkSync(keysFile);
    console.log('  已删除 api-keys.json (下次启动自动重建)');
  }

  // 5. 清理临时和备份文件
  for (const ext of ['.tmp', '.bak']) {
    for (const name of ['locations.json', 'map.geojson.json', 'logs.json', 'versions.json', 'api-keys.json']) {
      const p = path.join(dataDir, name + ext);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }

  console.log('\n数据已清空。请重启服务器 (npm start) 后重新填充数据 (npm run seed)。');
}

// ============================================================
// 命令行入口
// ============================================================
try {
  if (process.argv.includes('--clean')) {
    clean();
  } else {
    seed();
  }
} catch (err) {
  console.error('\n执行失败:', err.message);
  process.exit(1);
}
