import * as THREE from 'three';
import { BLOCK_IDS } from '../chunk.js';
import { DAYS_PER_YEAR, SECONDS_PER_YEAR_DAY } from './timeSystem.js';

const TREE_GROWTH_STAGES = Object.freeze([
  { id: 'seed', label: '种子', threshold: 0, texture: '/assets/texturetree-seed.svg', scale: 0.28 },
  { id: 'sapling', label: '幼苗', threshold: 0.03, texture: '/assets/texturetree-sapling.svg', scale: 0.55 },
  { id: 'young', label: '幼树', threshold: 0.16, texture: '/assets/texturetree-young.svg', scale: 0.92 },
  { id: 'mature', label: '成树', threshold: 0.42, texture: '/assets/texturetree-mature.svg', scale: 1.25 },
  { id: 'old', label: '老树', threshold: 0.78, texture: '/assets/texturetree-old.svg', scale: 1.18 },
  { id: 'decay', label: '朽木更新', threshold: 0.94, texture: '/assets/texturetree-decay.svg', scale: 0.82 },
]);

const TREE_PROFILES = Object.freeze({
  oak: {
    id: 'oak',
    label: '橡树',
    lifecycleDays: 120 * DAYS_PER_YEAR,
    seedlingDays: 60,
    matureDays: 40 * DAYS_PER_YEAR,
    idealTemperature: 0.64,
    idealMoisture: 0.58,
    coldTolerance: 0.42,
    density: 0.12,
    tint: 0xffffff,
    hostWeights: {
      [BLOCK_IDS.GRASS]: 1,
      [BLOCK_IDS.DRY_GRASS]: 0.42,
      [BLOCK_IDS.FOREST_MOUNTAIN]: 0.78,
      [BLOCK_IDS.DIRT]: 0.48,
    },
  },
  birch: {
    id: 'birch',
    label: '白桦',
    lifecycleDays: 120 * DAYS_PER_YEAR,
    seedlingDays: 45,
    matureDays: 60 * DAYS_PER_YEAR,
    idealTemperature: 0.52,
    idealMoisture: 0.54,
    coldTolerance: 0.72,
    density: 0.10,
    tint: 0xf2f8e9,
    hostWeights: {
      [BLOCK_IDS.GRASS]: 0.74,
      [BLOCK_IDS.DRY_GRASS]: 0.36,
      [BLOCK_IDS.FOREST_MOUNTAIN]: 1,
      [BLOCK_IDS.SNOW]: 0.34,
      [BLOCK_IDS.SNOW_MOUNTAIN]: 0.24,
    },
  },
  cactus: {
    id: 'cactus',
    label: '仙人掌',
    lifecycleDays: 45 * DAYS_PER_YEAR,
    seedlingDays: 90,
    matureDays: 6 * DAYS_PER_YEAR,
    idealTemperature: 0.9,
    idealMoisture: 0.18,
    coldTolerance: 0.08,
    density: 0.08,
    tint: 0xeaffdf,
    hostWeights: {
      [BLOCK_IDS.SAND]: 1,
      [BLOCK_IDS.DRY_GRASS]: 0.32,
    },
  },
});

const ANIMAL_PROFILES = Object.freeze({
  sparrow: {
    id: 'sparrow',
    label: '麻雀',
    category: 'bird',
    texture: '/assets/textureanimal-bird-sparrow.svg',
    soundId: 'animal:bird-chirp',
    lifecycleDays: 4 * DAYS_PER_YEAR,
    juvenileDays: 35,
    reproductionDays: 14,
    lifespanLabel: '野外约3-5年',
    growthBasis: '孵化约12天，离巢约2-3周',
    activity: 'diurnal',
    baseDensity: 0.42,
    maxPerChunk: 5,
    size: 0.52,
    speed: 1.18,
    flightHeight: 2.4,
    tint: 0xffffff,
    idealTemperature: 0.64,
    idealMoisture: 0.46,
    coldTolerance: 0.55,
    habitatWeights: {
      [BLOCK_IDS.GRASS]: 1,
      [BLOCK_IDS.DRY_GRASS]: 0.72,
      [BLOCK_IDS.FOREST_MOUNTAIN]: 0.86,
      [BLOCK_IDS.DIRT]: 0.44,
    },
  },
  magpie: {
    id: 'magpie',
    label: '喜鹊',
    category: 'bird',
    texture: '/assets/textureanimal-bird-magpie.svg',
    soundId: 'animal:bird-caw',
    lifecycleDays: 10 * DAYS_PER_YEAR,
    juvenileDays: 55,
    reproductionDays: 20,
    lifespanLabel: '野外约6-12年',
    growthBasis: '孵化约18天，育雏约4周',
    activity: 'diurnal',
    baseDensity: 0.22,
    maxPerChunk: 3,
    size: 0.68,
    speed: 0.94,
    flightHeight: 3.1,
    tint: 0xffffff,
    idealTemperature: 0.56,
    idealMoisture: 0.48,
    coldTolerance: 0.66,
    habitatWeights: {
      [BLOCK_IDS.GRASS]: 0.72,
      [BLOCK_IDS.FOREST_MOUNTAIN]: 1,
      [BLOCK_IDS.DRY_GRASS]: 0.48,
    },
  },
  owl: {
    id: 'owl',
    label: '猫头鹰',
    category: 'bird',
    texture: '/assets/textureanimal-bird-owl.svg',
    soundId: 'animal:owl-hoot',
    lifecycleDays: 8 * DAYS_PER_YEAR,
    juvenileDays: 70,
    reproductionDays: 32,
    lifespanLabel: '野外约5-10年',
    growthBasis: '孵化约30-35天，幼鸟约6-8周离巢',
    activity: 'nocturnal',
    baseDensity: 0.08,
    maxPerChunk: 1,
    size: 0.78,
    speed: 0.64,
    flightHeight: 3.6,
    tint: 0xffffff,
    idealTemperature: 0.46,
    idealMoisture: 0.50,
    coldTolerance: 0.78,
    habitatWeights: {
      [BLOCK_IDS.FOREST_MOUNTAIN]: 1,
      [BLOCK_IDS.GRASS]: 0.38,
      [BLOCK_IDS.SNOW]: 0.22,
    },
  },
  lizard: {
    id: 'lizard',
    label: '蜥蜴',
    category: 'reptile',
    texture: '/assets/textureanimal-reptile-lizard.svg',
    soundId: 'animal:reptile-hiss',
    lifecycleDays: 7 * DAYS_PER_YEAR,
    juvenileDays: 120,
    reproductionDays: 60,
    lifespanLabel: '野外约5-8年',
    growthBasis: '卵孵化常见45-90天，幼体约数月成长',
    activity: 'diurnal',
    baseDensity: 0.20,
    maxPerChunk: 3,
    size: 0.58,
    speed: 0.82,
    tint: 0xffffff,
    idealTemperature: 0.82,
    idealMoisture: 0.32,
    coldTolerance: 0.08,
    habitatWeights: {
      [BLOCK_IDS.SAND]: 0.92,
      [BLOCK_IDS.DRY_GRASS]: 1,
      [BLOCK_IDS.GRASS]: 0.28,
      [BLOCK_IDS.ROCK_MOUNTAIN]: 0.56,
    },
  },
  snake: {
    id: 'snake',
    label: '蛇',
    category: 'reptile',
    texture: '/assets/textureanimal-reptile-snake.svg',
    soundId: 'animal:reptile-hiss',
    lifecycleDays: 12 * DAYS_PER_YEAR,
    juvenileDays: 180,
    reproductionDays: 70,
    lifespanLabel: '野外约8-15年',
    growthBasis: '卵孵化常见50-90天，依温度变动',
    activity: 'crepuscular',
    baseDensity: 0.12,
    maxPerChunk: 2,
    size: 0.66,
    speed: 0.62,
    tint: 0xffffff,
    idealTemperature: 0.76,
    idealMoisture: 0.42,
    coldTolerance: 0.14,
    habitatWeights: {
      [BLOCK_IDS.DRY_GRASS]: 1,
      [BLOCK_IDS.GRASS]: 0.52,
      [BLOCK_IDS.SAND]: 0.70,
      [BLOCK_IDS.FOREST_MOUNTAIN]: 0.34,
    },
  },
  tiger: {
    id: 'tiger',
    label: '老虎',
    category: 'predator',
    texture: '/assets/textureanimal-tiger.svg',
    soundId: 'animal:bigcat-growl',
    lifecycleDays: 16 * DAYS_PER_YEAR,
    juvenileDays: 3 * DAYS_PER_YEAR,
    reproductionDays: 105,
    lifespanLabel: '平均约16年',
    growthBasis: '妊娠约103-110天，幼虎约3-6年性成熟',
    activity: 'crepuscular',
    baseDensity: 0.018,
    maxPerChunk: 1,
    size: 1.18,
    speed: 0.78,
    tint: 0xffffff,
    idealTemperature: 0.70,
    idealMoisture: 0.58,
    coldTolerance: 0.32,
    habitatWeights: {
      [BLOCK_IDS.FOREST_MOUNTAIN]: 1,
      [BLOCK_IDS.GRASS]: 0.34,
      [BLOCK_IDS.DRY_GRASS]: 0.20,
    },
  },
  lion: {
    id: 'lion',
    label: '狮子',
    category: 'predator',
    texture: '/assets/textureanimal-lion.svg',
    soundId: 'animal:bigcat-growl',
    lifecycleDays: 14 * DAYS_PER_YEAR,
    juvenileDays: 3.5 * DAYS_PER_YEAR,
    reproductionDays: 110,
    lifespanLabel: '野外约10-14年',
    growthBasis: '妊娠约110天，雌狮约3-4年进入繁殖成熟',
    activity: 'crepuscular',
    baseDensity: 0.016,
    maxPerChunk: 1,
    size: 1.16,
    speed: 0.72,
    tint: 0xffffff,
    idealTemperature: 0.78,
    idealMoisture: 0.30,
    coldTolerance: 0.16,
    habitatWeights: {
      [BLOCK_IDS.DRY_GRASS]: 1,
      [BLOCK_IDS.GRASS]: 0.52,
      [BLOCK_IDS.SAND]: 0.24,
    },
  },
  wolf: {
    id: 'wolf',
    label: '狼',
    category: 'predator',
    texture: '/assets/textureanimal-wolf.svg',
    soundId: 'animal:wolf-howl',
    lifecycleDays: 9 * DAYS_PER_YEAR,
    juvenileDays: 365,
    reproductionDays: 63,
    lifespanLabel: '野外约6-13年',
    growthBasis: '妊娠约63天，幼狼约10-12个月接近成年',
    activity: 'crepuscular',
    baseDensity: 0.045,
    maxPerChunk: 2,
    size: 0.92,
    speed: 0.95,
    tint: 0xffffff,
    idealTemperature: 0.46,
    idealMoisture: 0.42,
    coldTolerance: 0.82,
    habitatWeights: {
      [BLOCK_IDS.SNOW]: 0.82,
      [BLOCK_IDS.SNOW_MOUNTAIN]: 0.74,
      [BLOCK_IDS.FOREST_MOUNTAIN]: 1,
      [BLOCK_IDS.GRASS]: 0.42,
    },
  },
});

const HOST_LABELS = Object.freeze({
  [BLOCK_IDS.GRASS]: '草地',
  [BLOCK_IDS.DRY_GRASS]: '干草地',
  [BLOCK_IDS.DIRT]: '泥土',
  [BLOCK_IDS.SAND]: '沙地',
  [BLOCK_IDS.SNOW]: '雪地',
  [BLOCK_IDS.SNOW_MOUNTAIN]: '雪山',
  [BLOCK_IDS.ROCK_MOUNTAIN]: '岩山',
  [BLOCK_IDS.FOREST_MOUNTAIN]: '森林山地',
});

const SEASON_TEMPERATURE = Object.freeze({
  spring: 0.68,
  summer: 0.9,
  autumn: 0.58,
  winter: 0.2,
});
const WEATHER_TEMPERATURE_OFFSET = Object.freeze({ clear: 0.03, rain: -0.05, snow: -0.22, aurora: -0.08 });
const WEATHER_MOISTURE_OFFSET = Object.freeze({ clear: -0.04, rain: 0.30, snow: 0.14, aurora: 0.02 });
const DAYLIGHT_STAGE_FACTORS = Object.freeze({
  preDawn: 0.18,
  dawn: 0.58,
  morning: 0.95,
  noon: 1,
  afternoon: 0.86,
  dusk: 0.46,
  night: 0.12,
});
const ACTIVITY_STAGE_FACTORS = Object.freeze({
  diurnal: { preDawn: 0.18, dawn: 0.65, morning: 1, noon: 0.92, afternoon: 0.88, dusk: 0.42, night: 0.08 },
  nocturnal: { preDawn: 0.82, dawn: 0.36, morning: 0.08, noon: 0.04, afternoon: 0.08, dusk: 0.58, night: 1 },
  crepuscular: { preDawn: 0.58, dawn: 1, morning: 0.36, noon: 0.18, afternoon: 0.34, dusk: 1, night: 0.54 },
});
const BLOCKED_SURFACE_IDS = new Set([BLOCK_IDS.AIR, BLOCK_IDS.WATER, BLOCK_IDS.LAVA, BLOCK_IDS.CAVE_STONE, BLOCK_IDS.STONE]);
const TREE_SCAN_STEP = 2;
const ANIMAL_SCAN_STEP = 2;
const MAX_TREE_RECORDS_PER_CHUNK = 12;
const MAX_ANIMALS_TOTAL = 64;
const WANDER_INTERVAL = 2.8;
const ECOLOGY_TICK_SECONDS = 0.25;
const BREEDING_INTERVAL_SECONDS = 12;
const SOUND_INTERVAL_SECONDS = 6;
const RENDER_DISTANCE = 28;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hashSeed(...values) {
  let hash = 0x811c9dc5;

  for (const value of values) {
    const text = String(value);

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return hash >>> 0;
}

function seededUnit(seed, salt = 0) {
  let hash = Math.imul(seed ^ (salt + 0x9e3779b9), 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return (hash >>> 0) / 0xffffffff;
}

function getWorldPosition(entity, x, y, z, heightOffset = 0.62) {
  const { chunk } = entity;

  return new THREE.Vector3(
    entity.chunk.position.x + (x - (chunk.size.x - 1) / 2) * chunk.blockSize,
    (y + heightOffset) * chunk.blockSize,
    entity.chunk.position.z + (z - (chunk.size.z - 1) / 2) * chunk.blockSize,
  );
}

function getSurfaceY(entity, x, z) {
  return entity.surfaceHeights[entity.chunk.getColumnIndex(x, z)] ?? 0;
}

function getTemperatureFactor(biologyState, weatherId) {
  const base = SEASON_TEMPERATURE[biologyState?.seasonId ?? 'summer'] ?? SEASON_TEMPERATURE.summer;
  const weatherOffset = WEATHER_TEMPERATURE_OFFSET[weatherId] ?? 0;
  const snowPenalty = (biologyState?.ecology?.snowCoverage ?? 0) * 0.24;

  return clamp01(base + weatherOffset - snowPenalty);
}

function getMoistureFactor(biologyState, weatherId) {
  return clamp01((biologyState?.ecology?.moisture ?? 0.48) + (WEATHER_MOISTURE_OFFSET[weatherId] ?? 0));
}

function getDaylightFactor(timeState) {
  return DAYLIGHT_STAGE_FACTORS[timeState?.stage?.id] ?? 0.72;
}

function getActivityFactor(profile, timeState) {
  const stageId = timeState?.stage?.id ?? 'noon';

  return ACTIVITY_STAGE_FACTORS[profile.activity]?.[stageId] ?? 0.65;
}

function getStageIndexForGrowth(stages, growth) {
  let stageIndex = 0;

  for (let index = 0; index < stages.length; index += 1) {
    if (growth >= stages[index].threshold) {
      stageIndex = index;
    }
  }

  return stageIndex;
}

function getLifeStage(record, profile) {
  const ageDays = record.ageDays;

  if (ageDays < profile.reproductionDays) {
    return '繁殖/孵化期';
  }

  if (ageDays < profile.juvenileDays) {
    return '幼体';
  }

  if (ageDays < profile.lifecycleDays * 0.76) {
    return '成年';
  }

  return '老年';
}

function formatYearDays(days) {
  if (days >= DAYS_PER_YEAR) {
    return `${Math.round(days / DAYS_PER_YEAR)}年`;
  }

  return `${Math.max(1, Math.round(days))}天`;
}

function chooseWeighted(items, seed) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);

  if (total <= 0) {
    return null;
  }

  let roll = seededUnit(seed, 31) * total;

  for (const item of items) {
    roll -= item.weight;

    if (roll <= 0) {
      return item.profile;
    }
  }

  return items[items.length - 1].profile;
}

function drawLeafBlob(context, x, y, radius, color) {
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function drawTreeTexture(context, stageId) {
  context.clearRect(0, 0, 128, 128);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (stageId === 'seed') {
    context.fillStyle = '#7a4f2c';
    context.beginPath();
    context.ellipse(64, 94, 22, 13, -0.15, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#9e7443';
    context.beginPath();
    context.ellipse(60, 90, 10, 6, -0.2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#63a94e';
    context.beginPath();
    context.ellipse(75, 78, 24, 11, -0.45, 0, Math.PI * 2);
    context.fill();
    return;
  }

  if (stageId === 'sapling') {
    context.strokeStyle = '#7b4f2b';
    context.lineWidth = 9;
    context.beginPath();
    context.moveTo(64, 112);
    context.lineTo(64, 56);
    context.stroke();
    drawLeafBlob(context, 47, 58, 20, '#4d9d3f');
    drawLeafBlob(context, 79, 51, 23, '#73bd57');
    drawLeafBlob(context, 57, 78, 17, '#3f8536');
    return;
  }

  const old = stageId === 'old';
  const decay = stageId === 'decay';
  const trunkColor = decay ? '#4b372c' : old ? '#60422f' : '#754827';
  const darkTrunk = decay ? '#2d211c' : '#50311f';
  const canopyA = decay ? '#8f813f' : old ? '#6f8f43' : '#4e9b43';
  const canopyB = decay ? '#777b3f' : old ? '#7e9b4d' : '#62ae4a';
  const canopyC = decay ? '#a58a44' : old ? '#507638' : '#317c35';

  context.fillStyle = trunkColor;
  context.fillRect(55, 49, 18, 72);
  context.fillStyle = darkTrunk;
  context.beginPath();
  context.moveTo(48, 121);
  context.lineTo(64, 82);
  context.lineTo(79, 121);
  context.closePath();
  context.fill();

  if (stageId === 'young') {
    drawLeafBlob(context, 61, 48, 26, '#4d9a43');
    drawLeafBlob(context, 42, 62, 20, '#3f8738');
    drawLeafBlob(context, 82, 61, 22, '#63ad4e');
    drawLeafBlob(context, 70, 38, 22, '#74bd57');
    return;
  }

  drawLeafBlob(context, 44, 60, decay ? 22 : 30, canopyC);
  drawLeafBlob(context, 84, 58, decay ? 19 : 32, canopyA);
  drawLeafBlob(context, 64, 38, decay ? 25 : 34, canopyB);
  drawLeafBlob(context, 36, 81, decay ? 15 : 22, canopyC);
  drawLeafBlob(context, 94, 82, decay ? 15 : 23, canopyA);

  if (old || decay) {
    context.fillStyle = 'rgba(178, 139, 70, 0.64)';
    context.beginPath();
    context.ellipse(67, 84, 34, 12, -0.12, 0, Math.PI * 2);
    context.fill();
  }
}

function drawAnimalTexture(context, animalId) {
  context.clearRect(0, 0, 128, 128);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  const drawEye = (x, y, color = '#101010') => {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, 3.4, 0, Math.PI * 2);
    context.fill();
  };

  if (animalId === 'sparrow' || animalId === 'magpie') {
    const isMagpie = animalId === 'magpie';
    context.fillStyle = isMagpie ? '#121720' : '#8d6a48';
    context.beginPath();
    context.ellipse(58, 72, 40, 18, -0.12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = isMagpie ? '#f2f6f3' : '#c6aa79';
    context.beginPath();
    context.ellipse(63, 68, 31, 10, -0.08, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = isMagpie ? '#10141c' : '#6e5138';
    context.beginPath();
    context.moveTo(23, 74);
    context.lineTo(5, 62);
    context.lineTo(26, 61);
    context.closePath();
    context.fill();
    context.beginPath();
    context.arc(99, 62, 12, 0, Math.PI * 2);
    context.fill();
    drawEye(104, 58, isMagpie ? '#ffffff' : '#151515');
    context.fillStyle = isMagpie ? '#2c2c2c' : '#d4ad45';
    context.beginPath();
    context.moveTo(111, 64);
    context.lineTo(126, 68);
    context.lineTo(111, 72);
    context.closePath();
    context.fill();
    return;
  }

  if (animalId === 'owl') {
    context.fillStyle = '#8a6846';
    context.beginPath();
    context.ellipse(64, 70, 36, 43, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#5d422d';
    context.beginPath();
    context.moveTo(34, 34);
    context.lineTo(55, 47);
    context.lineTo(28, 50);
    context.closePath();
    context.moveTo(94, 34);
    context.lineTo(73, 47);
    context.lineTo(100, 50);
    context.closePath();
    context.fill();
    drawLeafBlob(context, 50, 61, 15, '#e2c96f');
    drawLeafBlob(context, 78, 61, 15, '#e2c96f');
    drawEye(50, 61);
    drawEye(78, 61);
    context.fillStyle = '#d9902f';
    context.beginPath();
    context.moveTo(64, 67);
    context.lineTo(73, 78);
    context.lineTo(55, 78);
    context.closePath();
    context.fill();
    return;
  }

  if (animalId === 'lizard' || animalId === 'snake') {
    if (animalId === 'snake') {
      context.strokeStyle = '#6b8f43';
      context.lineWidth = 18;
      context.beginPath();
      context.moveTo(14, 84);
      context.bezierCurveTo(32, 44, 51, 103, 77, 70);
      context.bezierCurveTo(91, 52, 103, 50, 119, 66);
      context.stroke();
      context.strokeStyle = '#a8c35c';
      context.lineWidth = 7;
      context.stroke();
      drawLeafBlob(context, 116, 66, 10, '#6b8f43');
      drawEye(119, 62);
      return;
    }

    context.fillStyle = '#5fa053';
    context.beginPath();
    context.ellipse(59, 75, 43, 17, -0.12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#a4cf65';
    context.beginPath();
    context.ellipse(65, 70, 30, 8, -0.08, 0, Math.PI * 2);
    context.fill();
    drawLeafBlob(context, 105, 60, 11, '#5fa053');
    drawEye(110, 57);
    context.strokeStyle = '#487d3d';
    context.lineWidth = 6;
    [[48, 84, 34, 106], [75, 82, 93, 103], [45, 63, 28, 45], [78, 62, 98, 45]].forEach(([a, b, c, d]) => {
      context.beginPath();
      context.moveTo(a, b);
      context.lineTo(c, d);
      context.stroke();
    });
    return;
  }

  const palette = {
    tiger: ['#d8842f', '#19130e', '#efc28b'],
    lion: ['#c99a4a', '#8d5d32', '#e4bb79'],
    wolf: ['#7f8588', '#c9d0cf', '#6f7678'],
  }[animalId] ?? ['#8a8a8a', '#202020', '#eeeeee'];

  context.fillStyle = palette[0];
  context.beginPath();
  context.ellipse(62, 76, 45, 22, -0.08, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = animalId === 'wolf' ? palette[1] : animalId === 'lion' ? palette[1] : palette[0];
  context.beginPath();
  context.arc(103, 58, animalId === 'lion' ? 23 : 15, 0, Math.PI * 2);
  context.fill();
  if (animalId === 'lion') {
    context.fillStyle = palette[0];
    context.beginPath();
    context.arc(103, 58, 13, 0, Math.PI * 2);
    context.fill();
  }
  if (animalId === 'tiger') {
    context.strokeStyle = palette[1];
    context.lineWidth = 5;
    [38, 55, 74, 91].forEach((x) => {
      context.beginPath();
      context.moveTo(x, 56);
      context.lineTo(x - 8, 91);
      context.stroke();
    });
  }
  if (animalId === 'wolf') {
    context.fillStyle = '#6c7275';
    context.beginPath();
    context.moveTo(91, 38);
    context.lineTo(101, 52);
    context.lineTo(113, 37);
    context.lineTo(115, 58);
    context.closePath();
    context.fill();
  }
  drawEye(110, 55);
  context.fillStyle = palette[2];
  context.beginPath();
  context.moveTo(116, 62);
  context.lineTo(127, 66);
  context.lineTo(116, 70);
  context.closePath();
  context.fill();
}

function createProceduralTexture(kind, id) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = 128;
  canvas.height = 128;
  context.imageSmoothingEnabled = false;

  if (kind === 'tree') {
    drawTreeTexture(context, id);
  } else {
    drawAnimalTexture(context, id);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

export class EcologySystem {
  constructor({ scene, eventBus, worldManager, player }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.worldManager = worldManager;
    this.player = player;
    this.chunkStates = new Map();
    this.treeMemory = new Map();
    this.animalMemory = new Map();
    this.treeTextures = TREE_GROWTH_STAGES.map((stage) => createProceduralTexture('tree', stage.id));
    this.animalTextures = new Map(Object.values(ANIMAL_PROFILES).map((profile) => [profile.id, createProceduralTexture('animal', profile.id)]));
    this.treeMaterials = new Map(Object.values(TREE_PROFILES).map((profile) => [
      profile.id,
      this.treeTextures.map((texture) => new THREE.SpriteMaterial({
        map: texture,
        color: profile.tint,
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
        sizeAttenuation: true,
      })),
    ]));
    this.animalMaterials = new Map(Object.values(ANIMAL_PROFILES).map((profile) => [
      profile.id,
      new THREE.SpriteMaterial({
        map: this.animalTextures.get(profile.id),
        color: profile.tint,
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    ]));
    this.elapsedTime = 0;
    this.tickAccumulator = 0;
    this.breedingAccumulator = 0;
    this.pendingWorldDays = 0;
    this.lastWorldDayScalar = null;
    this.timeState = null;
    this.biologyState = null;
    this.weatherId = 'clear';
    this.unsubscribe = [
      eventBus.on('time:update', (timeState) => {
        this.queueWorldDays(timeState);
        this.timeState = timeState;
      }),
      eventBus.on('biology:update', (biologyState) => {
        this.biologyState = biologyState;
        this.weatherId = biologyState.weatherId ?? this.weatherId;
      }),
      eventBus.on('weather:update', (weatherState) => {
        this.weatherId = weatherState.weatherId ?? this.weatherId;
      }),
    ];
  }

  update(deltaTime) {
    this.elapsedTime += deltaTime;
    this.tickAccumulator += deltaTime;
    this.breedingAccumulator += deltaTime;
    const worldDays = this.consumeWorldDays(deltaTime);

    this.syncLoadedChunks();

    if (this.tickAccumulator < ECOLOGY_TICK_SECONDS) {
      return;
    }

    const tickDelta = this.tickAccumulator;
    this.tickAccumulator = 0;

    for (const state of this.chunkStates.values()) {
      this.updateTrees(state, worldDays);
      this.updateAnimals(state, worldDays, tickDelta);
    }

    if (this.breedingAccumulator >= BREEDING_INTERVAL_SECONDS) {
      this.tryBreedAnimals(worldDays + this.breedingAccumulator / SECONDS_PER_YEAR_DAY);
      this.breedingAccumulator = 0;
    }
  }

  queueWorldDays(timeState) {
    const nextWorldDayScalar = (timeState.dayOfYear - 1) + timeState.normalizedDay;

    if (this.lastWorldDayScalar === null) {
      this.lastWorldDayScalar = nextWorldDayScalar;
      return;
    }

    let dayDelta = nextWorldDayScalar - this.lastWorldDayScalar;

    if (dayDelta < -DAYS_PER_YEAR / 2) {
      dayDelta += DAYS_PER_YEAR;
    } else if (dayDelta > DAYS_PER_YEAR / 2) {
      dayDelta -= DAYS_PER_YEAR;
    }

    if (dayDelta > 0) {
      this.pendingWorldDays += dayDelta;
    }

    this.lastWorldDayScalar = nextWorldDayScalar;
  }

  consumeWorldDays(deltaTime) {
    if (this.pendingWorldDays > 0) {
      const worldDays = this.pendingWorldDays;
      this.pendingWorldDays = 0;
      return worldDays;
    }

    return deltaTime / SECONDS_PER_YEAR_DAY;
  }

  syncLoadedChunks() {
    const loadedKeys = new Set(this.worldManager.loadedChunks.keys());

    for (const [key, entity] of this.worldManager.loadedChunks) {
      if (!this.chunkStates.has(key)) {
        this.chunkStates.set(key, this.createChunkState(key, entity));
      }
    }

    for (const [key, state] of this.chunkStates) {
      if (!loadedKeys.has(key)) {
        this.disposeChunkState(state);
        this.chunkStates.delete(key);
      }
    }
  }

  createChunkState(key, entity) {
    const group = new THREE.Group();
    group.name = `Ecology(${key})`;
    const state = {
      key,
      entity,
      group,
      trees: [],
      animals: [],
    };

    this.createTreeCandidates(key, entity).forEach((candidate) => this.addTree(state, candidate));
    this.createAnimalCandidates(key, entity).forEach((candidate) => this.addAnimal(state, candidate));
    this.scene.add(group);

    return state;
  }

  createTreeCandidates(chunkKey, entity) {
    const candidates = [];

    for (let z = 1; z < entity.chunk.size.z - 1; z += TREE_SCAN_STEP) {
      for (let x = 1; x < entity.chunk.size.x - 1; x += TREE_SCAN_STEP) {
        const surfaceY = getSurfaceY(entity, x, z);
        const surfaceBlockId = entity.chunk.getBlock(x, surfaceY, z);
        const aboveBlockId = entity.chunk.getBlock(x, surfaceY + 1, z);

        if (BLOCKED_SURFACE_IDS.has(surfaceBlockId) || aboveBlockId !== BLOCK_IDS.AIR) {
          continue;
        }

        const seed = hashSeed(chunkKey, x, z, 'tree');
        const environment = this.sampleEnvironment(surfaceBlockId);
        const profile = this.selectTreeProfile(surfaceBlockId, environment, seed);

        if (!profile) {
          continue;
        }

        const suitability = this.getTreeSuitability(profile, surfaceBlockId, environment);
        const chance = clamp01(profile.density * suitability * (0.42 + environment.vegetation * 0.58));

        if (seededUnit(seed, 9) > chance) {
          continue;
        }

        candidates.push({
          key: `${chunkKey}:tree:${profile.id}:${x},${z}`,
          chunkKey,
          profileId: profile.id,
          x,
          y: surfaceY,
          z,
          surfaceBlockId,
          seed,
          suitability,
          environment,
          score: suitability + seededUnit(seed, 13) * 0.24,
          worldPosition: getWorldPosition(entity, x, surfaceY, z, 0.78),
        });
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_TREE_RECORDS_PER_CHUNK);
  }

  createAnimalCandidates(chunkKey, entity) {
    const candidates = [];
    const counts = new Map();

    for (let z = 1; z < entity.chunk.size.z - 1; z += ANIMAL_SCAN_STEP) {
      for (let x = 1; x < entity.chunk.size.x - 1; x += ANIMAL_SCAN_STEP) {
        if (this.getRenderedAnimalCount() + candidates.length >= MAX_ANIMALS_TOTAL) {
          return candidates;
        }

        const surfaceY = getSurfaceY(entity, x, z);
        const surfaceBlockId = entity.chunk.getBlock(x, surfaceY, z);
        const aboveBlockId = entity.chunk.getBlock(x, surfaceY + 1, z);

        if (BLOCKED_SURFACE_IDS.has(surfaceBlockId) || aboveBlockId !== BLOCK_IDS.AIR) {
          continue;
        }

        const seed = hashSeed(chunkKey, x, z, 'animal');
        const environment = this.sampleEnvironment(surfaceBlockId);
        const profile = this.selectAnimalProfile(surfaceBlockId, environment, seed);

        if (!profile) {
          continue;
        }

        const currentCount = counts.get(profile.id) ?? 0;

        if (currentCount >= profile.maxPerChunk) {
          continue;
        }

        const suitability = this.getAnimalSuitability(profile, surfaceBlockId, environment);
        const wildlifeActivity = this.biologyState?.ecology?.wildlifeActivity ?? 0.72;
        const activity = getActivityFactor(profile, this.timeState);
        const predatorPenalty = profile.category === 'predator' ? 0.42 : 1;
        const chance = clamp01(profile.baseDensity * suitability * wildlifeActivity * (0.55 + activity * 0.45) * predatorPenalty);

        if (seededUnit(seed, 15) > chance) {
          continue;
        }

        counts.set(profile.id, currentCount + 1);
        candidates.push({
          key: `${chunkKey}:animal:${profile.id}:${x},${z}`,
          chunkKey,
          profileId: profile.id,
          x,
          y: surfaceY,
          z,
          surfaceBlockId,
          seed,
          suitability,
          environment,
          worldPosition: getWorldPosition(entity, x, surfaceY, z, profile.category === 'bird' ? profile.flightHeight : 0.72),
        });
      }
    }

    return candidates;
  }

  selectTreeProfile(surfaceBlockId, environment, seed) {
    const weighted = Object.values(TREE_PROFILES)
      .map((profile) => ({
        profile,
        weight: this.getTreeSuitability(profile, surfaceBlockId, environment),
      }))
      .filter((entry) => entry.weight > 0);

    return chooseWeighted(weighted, seed);
  }

  selectAnimalProfile(surfaceBlockId, environment, seed) {
    const weighted = Object.values(ANIMAL_PROFILES)
      .map((profile) => ({
        profile,
        weight: this.getAnimalSuitability(profile, surfaceBlockId, environment),
      }))
      .filter((entry) => entry.weight > 0);

    return chooseWeighted(weighted, seed);
  }

  sampleEnvironment(surfaceBlockId) {
    const temperature = getTemperatureFactor(this.biologyState, this.weatherId);
    const moisture = getMoistureFactor(this.biologyState, this.weatherId);
    const daylight = getDaylightFactor(this.timeState);
    const vegetation = this.biologyState?.ecology?.vegetationActivity ?? 0.72;
    const wildlife = this.biologyState?.ecology?.wildlifeActivity ?? 0.72;
    const snow = this.biologyState?.ecology?.snowCoverage ?? 0;

    return {
      surfaceBlockId,
      temperature,
      moisture,
      daylight,
      vegetation,
      wildlife,
      snow,
    };
  }

  getTreeSuitability(profile, surfaceBlockId, environment) {
    const host = profile.hostWeights[surfaceBlockId] ?? 0;

    if (host <= 0) {
      return 0;
    }

    const temperatureMatch = 1 - Math.abs(environment.temperature - profile.idealTemperature);
    const moistureMatch = 1 - Math.abs(environment.moisture - profile.idealMoisture);
    const coldPenalty = clamp01((0.34 - environment.temperature) * (1 - profile.coldTolerance));
    const snowPenalty = profile.id === 'cactus' ? environment.snow * 0.75 : environment.snow * 0.18;

    return clamp01(
      host * 0.34 +
      clamp01(temperatureMatch) * 0.22 +
      clamp01(moistureMatch) * 0.20 +
      environment.daylight * 0.12 +
      environment.vegetation * 0.12 -
      coldPenalty * 0.20 -
      snowPenalty,
    );
  }

  getAnimalSuitability(profile, surfaceBlockId, environment) {
    const host = profile.habitatWeights[surfaceBlockId] ?? 0;

    if (host <= 0) {
      return 0;
    }

    const temperatureMatch = 1 - Math.abs(environment.temperature - profile.idealTemperature);
    const moistureMatch = 1 - Math.abs(environment.moisture - profile.idealMoisture);
    const coldPenalty = clamp01((0.36 - environment.temperature) * (1 - profile.coldTolerance));
    const reptileColdPenalty = profile.category === 'reptile' ? clamp01(0.48 - environment.temperature) * 0.55 : 0;
    const foodWeb = profile.category === 'predator'
      ? environment.wildlife * 0.34 + environment.vegetation * 0.08
      : environment.vegetation * 0.26 + environment.wildlife * 0.16;

    return clamp01(
      host * 0.34 +
      clamp01(temperatureMatch) * 0.20 +
      clamp01(moistureMatch) * 0.12 +
      foodWeb +
      getActivityFactor(profile, this.timeState) * 0.10 -
      coldPenalty * 0.18 -
      reptileColdPenalty,
    );
  }

  addTree(state, candidate) {
    const record = this.getOrCreateTreeRecord(candidate);
    const materials = this.treeMaterials.get(record.profileId) ?? this.treeMaterials.get('oak');
    const sprite = new THREE.Sprite(materials[record.stageIndex]);
    const tree = {
      ...candidate,
      record,
      sprite,
      latestEnvironment: candidate.environment,
    };

    sprite.name = `EcologyTree:${record.profileId}:${TREE_GROWTH_STAGES[record.stageIndex].id}`;
    sprite.center.set(0.5, 0);
    sprite.position.copy(candidate.worldPosition);
    sprite.userData.ecosystemInspectable = true;
    sprite.userData.getEcosystemState = () => this.getTreeInspectionState(tree);
    this.applyTreeScale(sprite, record);
    state.group.add(sprite);
    state.trees.push(tree);
  }

  addAnimal(state, candidate) {
    const record = this.getOrCreateAnimalRecord(candidate);
    const profile = ANIMAL_PROFILES[record.profileId];
    const sprite = new THREE.Sprite(this.animalMaterials.get(record.profileId));
    const animal = {
      ...candidate,
      record,
      sprite,
      latestEnvironment: candidate.environment,
      target: candidate.worldPosition.clone(),
      nextWanderTime: this.elapsedTime + seededUnit(candidate.seed, 41) * WANDER_INTERVAL,
      lastSoundTime: this.elapsedTime + seededUnit(candidate.seed, 43) * SOUND_INTERVAL_SECONDS,
      wingPhase: seededUnit(candidate.seed, 47) * Math.PI * 2,
    };

    sprite.name = `EcologyAnimal:${record.profileId}`;
    sprite.center.set(0.5, 0);
    sprite.position.copy(candidate.worldPosition);
    const visibleSize = profile.size * 1.35;

    sprite.scale.set(visibleSize, visibleSize * (profile.category === 'bird' ? 1.05 : 0.72), 1);
    sprite.userData.ecosystemInspectable = true;
    sprite.userData.getEcosystemState = () => this.getAnimalInspectionState(animal);
    state.group.add(sprite);
    state.animals.push(animal);
  }

  getOrCreateTreeRecord(candidate) {
    if (this.treeMemory.has(candidate.key)) {
      return this.treeMemory.get(candidate.key);
    }

    const profile = TREE_PROFILES[candidate.profileId];
    const initialAgeDays = seededUnit(candidate.seed, 51) * profile.lifecycleDays * 0.82;
    const growth = clamp01(initialAgeDays / profile.lifecycleDays);
    const record = {
      key: candidate.key,
      profileId: candidate.profileId,
      ageDays: initialAgeDays,
      growth,
      health: clamp01(0.62 + candidate.suitability * 0.32),
      vigor: 0.74 + seededUnit(candidate.seed, 53) * 0.38,
      stageIndex: getStageIndexForGrowth(TREE_GROWTH_STAGES, growth),
    };

    this.treeMemory.set(candidate.key, record);

    return record;
  }

  getOrCreateAnimalRecord(candidate) {
    if (this.animalMemory.has(candidate.key)) {
      return this.animalMemory.get(candidate.key);
    }

    const profile = ANIMAL_PROFILES[candidate.profileId];
    const ageDays = seededUnit(candidate.seed, 61) * profile.lifecycleDays * 0.42;
    const record = {
      key: candidate.key,
      profileId: candidate.profileId,
      ageDays,
      health: clamp01(0.58 + candidate.suitability * 0.34),
      vigor: 0.74 + seededUnit(candidate.seed, 67) * 0.44,
      direction: seededUnit(candidate.seed, 71) * Math.PI * 2,
      isHidden: false,
    };

    this.animalMemory.set(candidate.key, record);

    return record;
  }

  updateTrees(state, worldDays) {
    for (const tree of state.trees) {
      const profile = TREE_PROFILES[tree.record.profileId];
      const environment = this.sampleEnvironment(tree.surfaceBlockId);
      const suitability = this.getTreeSuitability(profile, tree.surfaceBlockId, environment);
      const effectiveDays = Math.max(0, worldDays);
      const growthRate = (0.42 + suitability * 0.64) * tree.record.vigor;
      const stress = clamp01(0.45 - suitability);

      tree.latestEnvironment = { ...environment, suitability, stress };
      tree.record.ageDays = Math.min(profile.lifecycleDays, tree.record.ageDays + effectiveDays * growthRate);
      tree.record.growth = clamp01(tree.record.ageDays / profile.lifecycleDays);
      tree.record.health = clamp01(tree.record.health + (suitability * 0.03 - stress * 0.05) * Math.min(effectiveDays, 8));

      const nextStageIndex = getStageIndexForGrowth(TREE_GROWTH_STAGES, tree.record.growth);

      if (nextStageIndex !== tree.record.stageIndex) {
        tree.record.stageIndex = nextStageIndex;
        const materials = this.treeMaterials.get(tree.record.profileId) ?? this.treeMaterials.get('oak');
        tree.sprite.material = materials[nextStageIndex];
        tree.sprite.name = `EcologyTree:${tree.record.profileId}:${TREE_GROWTH_STAGES[nextStageIndex].id}`;
      }

      this.applyTreeScale(tree.sprite, tree.record);
    }
  }

  updateAnimals(state, worldDays, deltaTime) {
    const playerPosition = this.player?.position ?? this.player?.body?.position ?? null;

    for (const animal of state.animals) {
      const profile = ANIMAL_PROFILES[animal.record.profileId];
      const environment = this.sampleEnvironment(animal.surfaceBlockId);
      const suitability = this.getAnimalSuitability(profile, animal.surfaceBlockId, environment);
      const effectiveDays = Math.max(0, worldDays);
      const stress = clamp01(0.42 - suitability);
      const activity = getActivityFactor(profile, this.timeState);

      animal.latestEnvironment = { ...environment, suitability, stress, activity };
      animal.record.ageDays = Math.min(profile.lifecycleDays, animal.record.ageDays + effectiveDays * (0.72 + suitability * 0.38));
      animal.record.health = clamp01(animal.record.health + (suitability * 0.025 - stress * 0.045) * Math.min(effectiveDays, 6));
      animal.record.isHidden = activity < 0.16 || animal.record.health < 0.12;

      const distanceToPlayer = playerPosition ? animal.sprite.position.distanceTo(playerPosition) : 0;
      animal.sprite.visible = !animal.record.isHidden && (!playerPosition || distanceToPlayer <= RENDER_DISTANCE);

      if (!animal.sprite.visible) {
        continue;
      }

      this.updateAnimalMovement(state, animal, profile, deltaTime);
      this.maybePlayAnimalSound(animal, profile, distanceToPlayer);
    }
  }

  updateAnimalMovement(state, animal, profile, deltaTime) {
    if (this.elapsedTime >= animal.nextWanderTime || animal.sprite.position.distanceTo(animal.target) < 0.18) {
      const seed = hashSeed(animal.record.key, Math.floor(this.elapsedTime / WANDER_INTERVAL), 'wander');
      const angle = seededUnit(seed, 3) * Math.PI * 2;
      const radius = 1.4 + seededUnit(seed, 5) * (profile.category === 'bird' ? 5.2 : 3.1);
      const x = Math.max(1, Math.min(state.entity.chunk.size.x - 2, Math.round(animal.x + Math.cos(angle) * radius)));
      const z = Math.max(1, Math.min(state.entity.chunk.size.z - 2, Math.round(animal.z + Math.sin(angle) * radius)));
      const y = getSurfaceY(state.entity, x, z);

      animal.target = getWorldPosition(state.entity, x, y, z, profile.category === 'bird' ? profile.flightHeight : 0.72);
      animal.nextWanderTime = this.elapsedTime + WANDER_INTERVAL * (0.72 + seededUnit(seed, 7) * 0.9);
      animal.record.direction = angle;
    }

    const direction = animal.target.clone().sub(animal.sprite.position);
    const distance = direction.length();

    if (distance > 0.001) {
      direction.multiplyScalar(1 / distance);
      animal.sprite.position.addScaledVector(direction, Math.min(distance, profile.speed * deltaTime));
    }

    if (profile.category === 'bird') {
      animal.wingPhase += deltaTime * 5.2;
      animal.sprite.position.y += Math.sin(animal.wingPhase) * 0.012;
    }

    animal.sprite.material.rotation = Math.sin(animal.record.direction) > 0 ? 0.04 : -0.04;
  }

  maybePlayAnimalSound(animal, profile, distanceToPlayer) {
    if (distanceToPlayer > 18 || this.elapsedTime - animal.lastSoundTime < SOUND_INTERVAL_SECONDS) {
      return;
    }

    const chance = profile.category === 'predator' ? 0.22 : 0.36;
    const seed = hashSeed(animal.record.key, Math.floor(this.elapsedTime), 'sound');

    if (seededUnit(seed, 11) > chance) {
      return;
    }

    animal.lastSoundTime = this.elapsedTime;
    this.eventBus.emit('sound:event', {
      id: profile.soundId,
      strength: clamp01(1 - distanceToPlayer / 20) * 0.8,
    });
  }

  tryBreedAnimals(worldDays) {
    if (worldDays <= 0) {
      return;
    }

    for (const state of this.chunkStates.values()) {
      const bySpecies = new Map();

      for (const animal of state.animals) {
        const profile = ANIMAL_PROFILES[animal.record.profileId];

        if (animal.record.ageDays < profile.juvenileDays || animal.record.health < 0.48) {
          continue;
        }

        const list = bySpecies.get(profile.id) ?? [];
        list.push(animal);
        bySpecies.set(profile.id, list);
      }

      for (const [profileId, animals] of bySpecies) {
        const profile = ANIMAL_PROFILES[profileId];

        if (animals.length < 2 || animals.length >= profile.maxPerChunk) {
          continue;
        }

        const environment = this.sampleEnvironment(animals[0].surfaceBlockId);
        const suitability = this.getAnimalSuitability(profile, animals[0].surfaceBlockId, environment);
        const chance = clamp01((worldDays / Math.max(1, profile.reproductionDays)) * suitability * 0.28);
        const seed = hashSeed(state.key, profileId, Math.floor(this.elapsedTime / BREEDING_INTERVAL_SECONDS), 'breed');

        if (seededUnit(seed, 19) > chance) {
          continue;
        }

        this.spawnYoungAnimal(state, animals[0], profile);
      }
    }
  }

  spawnYoungAnimal(state, parent, profile) {
    const seed = hashSeed(parent.record.key, this.elapsedTime, 'young');
    const offsetX = Math.round((seededUnit(seed, 3) - 0.5) * 3);
    const offsetZ = Math.round((seededUnit(seed, 5) - 0.5) * 3);
    const x = Math.max(1, Math.min(state.entity.chunk.size.x - 2, parent.x + offsetX));
    const z = Math.max(1, Math.min(state.entity.chunk.size.z - 2, parent.z + offsetZ));
    const y = getSurfaceY(state.entity, x, z);
    const surfaceBlockId = state.entity.chunk.getBlock(x, y, z);
    const environment = this.sampleEnvironment(surfaceBlockId);
    const suitability = this.getAnimalSuitability(profile, surfaceBlockId, environment);

    if (suitability <= 0.22) {
      return;
    }

    const candidate = {
      key: `${state.key}:animal:${profile.id}:young:${Math.floor(this.elapsedTime * 10)}:${x},${z}`,
      chunkKey: state.key,
      profileId: profile.id,
      x,
      y,
      z,
      surfaceBlockId,
      seed,
      suitability,
      environment,
      worldPosition: getWorldPosition(state.entity, x, y, z, profile.category === 'bird' ? profile.flightHeight : 0.72),
    };
    const record = {
      key: candidate.key,
      profileId: profile.id,
      ageDays: 0,
      health: 0.68,
      vigor: 0.76 + seededUnit(seed, 67) * 0.34,
      direction: seededUnit(seed, 71) * Math.PI * 2,
      isHidden: false,
    };

    this.animalMemory.set(candidate.key, record);
    this.addAnimal(state, candidate);
  }

  applyTreeScale(sprite, record) {
    const stage = TREE_GROWTH_STAGES[record.stageIndex];
    const healthScale = 0.78 + record.health * 0.22;
    const vigorScale = 0.86 + record.vigor * 0.12;
    const scale = Math.max(0.42, stage.scale * healthScale * vigorScale);

    sprite.scale.set(scale, scale * 1.22, 1);
  }

  getTreeInspectionState(tree) {
    const profile = TREE_PROFILES[tree.record.profileId];
    const stage = TREE_GROWTH_STAGES[tree.record.stageIndex];
    const environment = tree.latestEnvironment ?? tree.environment;

    return {
      type: 'tree',
      title: profile.label,
      stage: stage.label,
      cycle: `真实参考: 幼苗约${profile.seedlingDays}天，成熟约${formatYearDays(profile.matureDays)}，完整生态周期约${formatYearDays(profile.lifecycleDays)}`,
      cycleDay: Math.round(tree.record.ageDays),
      cycleDays: profile.lifecycleDays,
      cycleProgress: tree.record.growth,
      status: environment.suitability >= 0.62 ? '适宜生长' : environment.suitability >= 0.38 ? '缓慢生长' : '环境受压',
      host: HOST_LABELS[tree.surfaceBlockId] ?? '未知地表',
      health: tree.record.health,
      water: environment.moisture,
      daylight: environment.daylight,
      temperature: environment.temperature,
      humidity: environment.moisture,
      suitability: environment.suitability,
      stress: environment.stress,
    };
  }

  getAnimalInspectionState(animal) {
    const profile = ANIMAL_PROFILES[animal.record.profileId];
    const environment = animal.latestEnvironment ?? animal.environment;

    return {
      type: 'animal',
      title: profile.label,
      stage: getLifeStage(animal.record, profile),
      cycle: `${profile.growthBasis}；${profile.lifespanLabel}`,
      cycleDay: Math.round(animal.record.ageDays),
      cycleDays: profile.lifecycleDays,
      cycleProgress: clamp01(animal.record.ageDays / profile.lifecycleDays),
      status: animal.record.isHidden ? '隐蔽休息' : environment.suitability >= 0.56 ? '活跃觅食' : '迁移观望',
      host: HOST_LABELS[animal.surfaceBlockId] ?? '未知栖息地',
      health: animal.record.health,
      water: environment.moisture,
      daylight: environment.daylight,
      temperature: environment.temperature,
      humidity: environment.moisture,
      suitability: environment.suitability,
      stress: environment.stress,
    };
  }

  getRenderedAnimalCount() {
    let count = 0;

    for (const state of this.chunkStates.values()) {
      count += state.animals.length;
    }

    return count;
  }

  disposeChunkState(state) {
    if (state.group.parent) {
      state.group.parent.remove(state.group);
    }

    state.group.clear();
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.chunkStates.forEach((state) => this.disposeChunkState(state));
    this.chunkStates.clear();
    this.treeMaterials.forEach((materials) => materials.forEach((material) => material.dispose()));
    this.animalMaterials.forEach((material) => material.dispose());
    this.treeTextures.forEach((texture) => texture.dispose());
    this.animalTextures.forEach((texture) => texture.dispose());
    this.treeMemory.clear();
    this.animalMemory.clear();
  }
}
