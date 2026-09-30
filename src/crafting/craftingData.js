const PERIODIC_ELEMENTS = Object.freeze([
  ['H', '氢'], ['He', '氦'], ['Li', '锂'], ['Be', '铍'], ['B', '硼'], ['C', '碳'], ['N', '氮'],
  ['O', '氧'], ['F', '氟'], ['Ne', '氖'], ['Na', '钠'], ['Mg', '镁'], ['Al', '铝'], ['Si', '硅'],
  ['P', '磷'], ['S', '硫'], ['Cl', '氯'], ['Ar', '氩'], ['K', '钾'], ['Ca', '钙'], ['Fe', '铁'],
  ['Cu', '铜'], ['Zn', '锌'], ['Ag', '银'], ['Sn', '锡'], ['W', '钨'], ['Au', '金'], ['Hg', '汞'],
  ['Pb', '铅'], ['U', '铀'],
]);

const NATURAL_MATERIALS = Object.freeze([
  ['grass_block', '草地方块', '温暖或湿润地表的基础方块，可作为植物采集和土壤合成材料。'],
  ['dry_grass_block', '枯草地方块', '干燥地表的草地方块，适合耐旱植物和干燥合成环境。'],
  ['dirt_block', '泥土方块', '草地下层和普通地表常见，可承载植物与基础建筑。'],
  ['stone', '石头', '岩层、山地、洞穴周边都能发现。'],
  ['cave_stone', '洞穴石', '洞穴内部生成的暗色石材，压力类和矿物类合成常用。'],
  ['rock_mountain_stone', '岩山石', '岩山地形中的高硬度石材，可用于重型建材合成。'],
  ['forest_mountain_block', '森林山体方块', '森林高山表层方块，兼具岩土和植物环境特性。'],
  ['snow_block', '雪块', '雪山和寒冷湿润区域会自然堆积。'],
  ['snow_mountain_block', '雪山方块', '雪山山体的压实雪岩，可用于寒冷和保温材料合成。'],
  ['ice', '冰块', '低温高湿环境中的水面和雪原边缘生成。'],
  ['sand', '沙子', '干燥平原和沙地分布较多。'],
  ['clay', '黏土', '水边低洼湿地更常见。'],
  ['wood', '木材', '森林和树木附近采集。'],
  ['birch_wood', '白桦木', '寒冷或高地森林中的浅色木材。'],
  ['charcoal', '木炭', '木材在高热低湿环境下炭化。'],
  ['flint', '打火石', '砂砾、岩石碎块和工具台加工产物。'],
  ['gunpowder', '火药粉', '硫、硝石和木炭混合得到。'],
  ['potion', '药水', '植物汁液、矿物粉和水调制。'],
  ['niter', '硝石', '干燥洞穴和岩壁盐霜附近出现。'],
  ['resin', '树脂', '森林树木和温暖季节采集。'],
  ['leaves', '树叶', '树冠上可采集，湿度高时更适合植物类合成。'],
  ['cactus', '仙人掌', '干燥区域可采集，能参与药水和耐旱材料合成。'],
]);

const BUILDING_MATERIALS = Object.freeze([
  ['stone_slab', '石板', '平整石头切割压制后的建筑板材。'],
  ['steel_ingot', '钢锭', '铁、碳和高热锻造得到。'],
  ['steel_plate', '钢板', '钢锭在压力下轧制成型。'],
  ['steel_beam', '钢材', '钢板和钢锭组合成承重结构。'],
  ['concrete', '混凝土', '砂、石、水和黏结粉混合凝固。'],
  ['glass_panel', '玻璃板', '沙子高热熔融后压平成板。'],
  ['brick', '砖块', '黏土受热烧结后形成。'],
  ['insulated_panel', '保温板', '木材、树脂和雪块复合。'],
]);

const TOOL_MATERIALS = Object.freeze([
  ['forklift', '叉车', '用于搬运重型材料的工具机械，需要钢材和动力部件。'],
  ['excavator', '挖掘机', '用于大规模挖掘和破坏岩土的工程机械。'],
  ['drill', '钻机', '高压旋转工具，可开采深层矿石。'],
  ['forge', '锻炉', '提高合成热量，是金属类合成的核心设备。'],
  ['press', '压力机', '提供稳定压力，用于钢板、石板和机械件成型。'],
  ['workbench', '工具台', '基础合成点，可完成木石和低阶机械合成。'],
]);

const CODEX_PAGE_MATERIALS = Object.freeze([
  ['codex_page_tnt', 'TNT 图鉴页', '散落地图上的爆破合成图鉴页，记录 TNT 的材料和环境条件。'],
  ['codex_page_tools', '工具图鉴页', '散落地图上的工具类图鉴页，记录打火石、叉车和挖掘机等合成。'],
  ['codex_page_building', '建材图鉴页', '散落地图上的建筑材料图鉴页，记录石板、钢材和混凝土等合成。'],
  ['codex_page_elements', '元素图鉴页', '散落地图上的元素图鉴页，记录周期元素材料信息和分布。'],
]);

const FEATURED_RECIPES = Object.freeze([
  {
    id: 'tnt',
    name: 'TNT',
    category: '能源爆炸',
    description: '把火药粉、沙子、硫和硝石压紧封装，得到可被打火石点燃的爆炸方块。',
    ingredients: [
      { itemId: 'gunpowder', count: 5 },
      { itemId: 'sand', count: 4 },
      { itemId: 'S', count: 1 },
      { itemId: 'niter', count: 2 },
    ],
    station: '工具台 / 爆破合成点',
    conditions: { heat: [18, 42], humidity: [0.12, 0.48], pressure: [0.72, 1.25] },
    resultItemId: 'tnt_block',
  },
  {
    id: 'flint_tool',
    name: '打火石',
    category: '工具类',
    description: '用打火石和铁片组合成点火工具。手持后按 C 可点燃 TNT，或破坏准星指向的普通方块。',
    ingredients: [
      { itemId: 'flint', count: 1 },
      { itemId: 'Fe', count: 1 },
    ],
    station: '工具台',
    conditions: { heat: [0, 55], humidity: [0, 0.8], pressure: [0.8, 1.3] },
    resultItemId: 'flint_tool',
  },
  {
    id: 'forklift',
    name: '叉车',
    category: '工具机械',
    description: '钢材、轮组和动力组件组合成搬运机械，适合移动大批建材。',
    ingredients: [
      { itemId: 'steel_beam', count: 8 },
      { itemId: 'steel_plate', count: 6 },
      { itemId: 'Cu', count: 4 },
      { itemId: 'resin', count: 2 },
    ],
    station: '机械合成点',
    conditions: { heat: [30, 85], humidity: [0.18, 0.62], pressure: [1.1, 2.4] },
    resultItemId: 'forklift',
  },
  {
    id: 'excavator',
    name: '挖掘机',
    category: '工具机械',
    description: '重型钢架、钻机和液压结构合成大型挖掘设备。',
    ingredients: [
      { itemId: 'steel_beam', count: 16 },
      { itemId: 'drill', count: 2 },
      { itemId: 'glass_panel', count: 4 },
      { itemId: 'W', count: 2 },
    ],
    station: '机械合成点 / 高压合成点',
    conditions: { heat: [45, 120], humidity: [0.12, 0.55], pressure: [1.8, 3.6] },
    resultItemId: 'excavator',
  },
  {
    id: 'steel_beam',
    name: '钢材',
    category: '建筑材料',
    description: '钢板和钢锭在压力机中复合成高强度承重建材。',
    ingredients: [
      { itemId: 'steel_plate', count: 2 },
      { itemId: 'steel_ingot', count: 2 },
    ],
    station: '压力机 / 建材合成点',
    conditions: { heat: [60, 160], humidity: [0, 0.42], pressure: [1.6, 3.2] },
    resultItemId: 'steel_beam',
  },
  {
    id: 'stone_slab',
    name: '石板',
    category: '建筑材料',
    description: '石头经切割、研磨和加压后制成平整铺装材料。',
    ingredients: [
      { itemId: 'stone', count: 3 },
      { itemId: 'sand', count: 1 },
    ],
    station: '工具台 / 建材合成点',
    conditions: { heat: [-20, 80], humidity: [0, 0.72], pressure: [1.1, 2.8] },
    resultItemId: 'stone_slab',
  },
]);

const CATEGORY_SEQUENCE = Object.freeze(['基础元素', '自然物质', '化工物质', '建筑材料', '工具机械', '能源爆炸', '合成设备']);
const GENERATED_RESULTS = Object.freeze([
  ['alloy', '合金'], ['plate', '板材'], ['powder', '粉末'], ['crystal', '晶体'], ['tube', '管件'],
  ['core', '核心'], ['gear', '齿轮'], ['frame', '框架'], ['catalyst', '催化剂'], ['module', '模块'],
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashString(input) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function hslColor(seed, lightnessOffset = 0) {
  const hue = seed % 360;
  const saturation = 42 + (seed % 37);
  const lightness = clamp(44 + ((seed >>> 8) % 24) + lightnessOffset, 22, 78);

  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function getSvgKind(itemId, category) {
  if (category === '基础元素') {
    return 'element';
  }

  if (category === '图鉴页' || itemId.startsWith('codex_page_')) {
    return 'codex';
  }

  if (category === '建筑材料' || itemId.includes('block') || itemId.includes('stone') || itemId.includes('slab')) {
    return 'block';
  }

  if (category === '工具机械' || category === '工具类' || itemId.includes('tool')) {
    return 'tool';
  }

  return 'item';
}

function createSvgBody(kind, mark, primary, secondary, seed) {
  if (kind === 'element') {
    return [
      '<circle cx="48" cy="48" r="32" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.34)" stroke-width="3"/>',
      `<ellipse cx="48" cy="48" rx="38" ry="13" fill="none" stroke="${secondary}" stroke-width="4" transform="rotate(${seed % 180} 48 48)"/>`,
      `<ellipse cx="48" cy="48" rx="38" ry="13" fill="none" stroke="${secondary}" stroke-width="3" opacity=".72" transform="rotate(${(seed % 180) + 62} 48 48)"/>`,
      '<circle cx="48" cy="48" r="7" fill="rgba(255,255,255,.88)"/>',
    ].join('');
  }

  if (kind === 'codex') {
    return [
      '<rect x="18" y="10" width="60" height="76" rx="6" fill="rgba(255,246,214,.88)" stroke="rgba(72,45,18,.42)" stroke-width="3"/>',
      '<path d="M28 28 H68 M28 40 H62 M28 52 H68 M28 64 H56" stroke="rgba(70,45,26,.52)" stroke-width="4" stroke-linecap="round"/>',
      `<path d="M19 16 C32 8 44 20 57 13 C62 10 69 11 77 16 V28 C64 22 51 30 40 24 C32 20 26 20 19 24 Z" fill="${secondary}" opacity=".55"/>`,
    ].join('');
  }

  if (kind === 'block') {
    return [
      `<path d="M16 33 L48 16 L80 33 V67 L48 84 L16 67 Z" fill="${secondary}" opacity=".88"/>`,
      '<path d="M16 33 L48 50 L80 33 M48 50 V84" fill="none" stroke="rgba(0,0,0,.24)" stroke-width="4"/>',
      '<path d="M24 39 L48 27 L72 39 L48 51 Z" fill="rgba(255,255,255,.18)"/>',
    ].join('');
  }

  if (kind === 'tool') {
    return [
      '<circle cx="48" cy="48" r="26" fill="rgba(0,0,0,.2)"/>',
      `<path d="M48 18 L55 32 L70 30 L64 44 L76 54 L60 58 L58 74 L48 62 L38 74 L36 58 L20 54 L32 44 L26 30 L41 32 Z" fill="${secondary}" opacity=".9"/>`,
      '<circle cx="48" cy="48" r="10" fill="rgba(255,255,255,.68)"/>',
    ].join('');
  }

  return [
    `<path d="M12 72 L32 24 L54 54 L70 18 L84 72 Z" fill="${secondary}" opacity=".72"/>`,
    '<circle cx="26" cy="26" r="8" fill="rgba(255,255,255,.32)"/>',
    '<rect x="13" y="75" width="70" height="8" rx="4" fill="rgba(0,0,0,.22)"/>',
  ].join('');
}

export function createMaterialSvg(itemId, label = itemId, category = '物品') {
  const seed = hashString(itemId);
  const primary = hslColor(seed);
  const secondary = hslColor(seed >>> 3, 14);
  const kind = getSvgKind(itemId, category);
  const mark = label.slice(0, 2).toUpperCase();

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">',
    `<rect width="96" height="96" rx="12" fill="${primary}"/>`,
    createSvgBody(kind, mark, primary, secondary, seed),
    `<text x="48" y="56" text-anchor="middle" font-size="24" font-family="Arial, sans-serif" font-weight="700" fill="rgba(255,255,255,.92)">${mark}</text>`,
    '</svg>',
  ].join('');
}

export function createMaterialSvgDataUri(itemId, label, category) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(createMaterialSvg(itemId, label, category))}`;
}

function toMaterial(entry, category, index) {
  const [id, name, description] = entry;

  return {
    id,
    name,
    category,
    description: description ?? `${name}可参与元素、建材、工具和化工合成。`,
    distribution: {
      biome: category === '基础元素' ? '矿脉、洞穴、岩层样本' : '地图资源点和合成点周边',
      rarity: ['常见', '较常见', '稀有', '高价值'][index % 4],
      heatAffinity: ['低温', '常温', '高热'][index % 3],
      humidityAffinity: ['干燥', '均衡', '湿润'][(index + 1) % 3],
      pressureAffinity: ['低压', '标准压', '高压'][(index + 2) % 3],
      mapSeed: hashString(id),
    },
    svg: createMaterialSvgDataUri(id, name, category),
  };
}

function buildMaterials() {
  const elementMaterials = PERIODIC_ELEMENTS.map(([id, name], index) => toMaterial([id, `${name}元素`, `${name}是元素周期表基础元素，可作为化工、金属、能源和药剂合成的基础材料。`], '基础元素', index));
  const natural = NATURAL_MATERIALS.map((entry, index) => toMaterial(entry, '自然物质', index));
  const building = BUILDING_MATERIALS.map((entry, index) => toMaterial(entry, '建筑材料', index));
  const tools = TOOL_MATERIALS.map((entry, index) => toMaterial(entry, '工具机械', index));
  const codexPages = CODEX_PAGE_MATERIALS.map((entry, index) => toMaterial(entry, '图鉴页', index));
  const resultMaterials = [];

  for (let index = 0; index < 260; index += 1) {
    const element = PERIODIC_ELEMENTS[index % PERIODIC_ELEMENTS.length];
    const result = GENERATED_RESULTS[index % GENERATED_RESULTS.length];
    const id = `${element[0].toLowerCase()}_${result[0]}_${index + 1}`;
    resultMaterials.push(toMaterial([
      id,
      `${element[1]}${result[1]}-${String(index + 1).padStart(3, '0')}`,
      `由${element[1]}系材料参与生成的${result[1]}，用于高阶图鉴配方扩展。`,
    ], CATEGORY_SEQUENCE[(index + 2) % CATEGORY_SEQUENCE.length], index));
  }

  return [...elementMaterials, ...natural, ...building, ...tools, ...codexPages, ...resultMaterials, toMaterial(['tnt_block', 'TNT 方块', '爆破合成产物，可被打火石点燃。'], '能源爆炸', 0), toMaterial(['flint_tool', '打火石', '手持工具，可点燃 TNT 或破坏准星目标。'], '工具类', 1)];
}

function buildGeneratedRecipes(materials) {
  const sourceItems = materials.filter((item) => item.category !== '工具机械');
  const recipes = [...FEATURED_RECIPES];

  for (let index = recipes.length; index < 1000; index += 1) {
    const category = CATEGORY_SEQUENCE[index % CATEGORY_SEQUENCE.length];
    const element = PERIODIC_ELEMENTS[index % PERIODIC_ELEMENTS.length];
    const result = GENERATED_RESULTS[index % GENERATED_RESULTS.length];
    const resultMaterial = materials[(index * 7) % materials.length];
    const a = sourceItems[(index * 3) % sourceItems.length];
    const b = sourceItems[(index * 5 + 11) % sourceItems.length];
    const c = sourceItems[(index * 13 + 17) % sourceItems.length];
    const heatBase = -20 + (index % 10) * 18;
    const humidityBase = (index % 6) * 0.12;
    const pressureBase = 0.6 + (index % 7) * 0.32;

    recipes.push({
      id: `recipe_${String(index + 1).padStart(4, '0')}`,
      name: `${element[1]}${result[1]}合成-${String(index + 1).padStart(4, '0')}`,
      category,
      description: `第 ${index + 1} 条合成图鉴。以${a.name}、${b.name}和${c.name}为基础，受热量、湿度和压力共同影响，产出${resultMaterial.name}或同系材料。`,
      ingredients: [
        { itemId: a.id, count: 1 + (index % 3) },
        { itemId: b.id, count: 1 + (index % 2) },
        { itemId: c.id, count: 1 },
      ],
      station: ['工具台', '建材合成点', '机械合成点', '高压合成点'][index % 4],
      conditions: {
        heat: [heatBase, heatBase + 48],
        humidity: [clamp(humidityBase, 0, 0.88), clamp(humidityBase + 0.36, 0.18, 1)],
        pressure: [pressureBase, pressureBase + 0.92],
      },
      resultItemId: resultMaterial.id,
    });
  }

  return recipes;
}

export const MATERIALS = Object.freeze(buildMaterials());
export const MATERIAL_BY_ID = Object.freeze(Object.fromEntries(MATERIALS.map((item) => [item.id, item])));
export const RECIPES = Object.freeze(buildGeneratedRecipes(MATERIALS));
export const RECIPE_BY_ID = Object.freeze(Object.fromEntries(RECIPES.map((recipe) => [recipe.id, recipe])));

export function getMaterial(itemId) {
  return MATERIAL_BY_ID[itemId] ?? {
    id: itemId,
    name: itemId,
    category: '未知',
    description: '未登记材料。',
    distribution: {
      biome: '未知',
      rarity: '未知',
      heatAffinity: '未知',
      humidityAffinity: '未知',
      pressureAffinity: '未知',
      mapSeed: hashString(itemId),
    },
    svg: createMaterialSvgDataUri(itemId, itemId, '未知'),
  };
}

export function getRecipeEnvironmentScore(recipe, environment) {
  const heat = environment.heatCelsius ?? 20;
  const humidity = environment.humidity ?? 0.45;
  const pressure = environment.pressure ?? 1;
  const heatOk = heat >= recipe.conditions.heat[0] && heat <= recipe.conditions.heat[1];
  const humidityOk = humidity >= recipe.conditions.humidity[0] && humidity <= recipe.conditions.humidity[1];
  const pressureOk = pressure >= recipe.conditions.pressure[0] && pressure <= recipe.conditions.pressure[1];

  return {
    ok: heatOk && humidityOk && pressureOk,
    heatOk,
    humidityOk,
    pressureOk,
  };
}
