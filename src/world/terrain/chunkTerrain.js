import { BLOCK_IDS, CHUNK_HEIGHT, CHUNK_SIZE } from '../chunk.js';
import { PerlinNoise2D } from './perlinNoise2D.js';

export const GRASS_RANGE = 3;
export const TREE_CONFIGS = Object.freeze([
  { x: 3, z: 3, trunkHeight: 4 },
  { x: 12, z: 4, trunkHeight: 5 },
  { x: 5, z: 12, trunkHeight: 4 },
]);
export const WATER_SOURCES = Object.freeze([
  { x: 3, z: 10 },
  { x: 11, z: 3 },
]);
export const LAVA_SOURCES = Object.freeze([
  { x: 9, z: 8 },
  { x: 13, z: 12 },
]);

export const SURFACE_CODES = Object.freeze({
  GRASS: 1,
  WATER: 2,
  LAVA: 4,
  SAND: 5,
  SNOW: 9,
});

export const BIOME_IDS = Object.freeze({
  PLAINS: 0,
  FOREST: 1,
  DESERT: 2,
  HIGHLAND: 3,
  SNOWFIELD: 4,
  CAVE: 5,
  SNOW_MOUNTAIN: 6,
  ROCK_MOUNTAIN: 7,
  FOREST_MOUNTAIN: 8,
});

export const TERRAIN_RULES = Object.freeze({
  seed: 20260708,
  baseHeight: 3,
  heightScale: 5,
  noiseScale: 0.095,
  biomeScale: 0.045,
  snowline: 7,
  mountainline: 7,
  caveScale: 0.145,
  caveThreshold: 0.23,
  caveBiomeScale: 0.052,
  caveBiomeThreshold: 0.62,
  caveMouthThreshold: 0.18,
  octaves: 4,
  persistence: 0.48,
  lacunarity: 2.05,
  dirtDepth: 3,
});

const DESIGNED_MOUNTAINS = Object.freeze([
  {
    x: -22,
    z: -24,
    radius: 30,
    innerRadius: 8,
    minHeight: 190,
    maxHeight: 250,
    biomeId: BIOME_IDS.SNOW_MOUNTAIN,
    slope: { direction: { x: 1, z: 0.76 }, length: 140, width: 8.5, risePerBlock: 1.8, footHeight: 4 },
  },
  {
    x: 24,
    z: -13,
    radius: 28,
    innerRadius: 7,
    minHeight: 42,
    maxHeight: 58,
    biomeId: BIOME_IDS.ROCK_MOUNTAIN,
    slope: { direction: { x: 1, z: -0.15 }, length: 112, width: 7.8, risePerBlock: 0.5, footHeight: 3 },
  },
  {
    x: -18,
    z: 22,
    radius: 27,
    innerRadius: 7,
    minHeight: 38,
    maxHeight: 54,
    biomeId: BIOME_IDS.FOREST_MOUNTAIN,
    slope: { direction: { x: -0.75, z: 0.7 }, length: 102, width: 7.5, risePerBlock: 0.5, footHeight: 3 },
  },
]);

const DESIGNED_RIVERBEDS = Object.freeze([
  {
    width: 3.4,
    carveDepth: 2,
    points: [
      { x: -21, z: -19 },
      { x: -17, z: -10 },
      { x: -10, z: -3 },
      { x: -1, z: 2 },
      { x: 10, z: 5 },
      { x: 20, z: 10 },
    ],
  },
  {
    width: 2.8,
    carveDepth: 1,
    points: [
      { x: -19, z: 17 },
      { x: -13, z: 14 },
      { x: -5, z: 13 },
      { x: 4, z: 15 },
    ],
  },
]);

function normalizeChunkCoord(chunkCoord = { x: 0, z: 0 }) {
  return {
    x: chunkCoord.x ?? 0,
    z: chunkCoord.z ?? 0,
  };
}

function normalizeSize(size = { x: CHUNK_SIZE, y: CHUNK_HEIGHT, z: CHUNK_SIZE }) {
  if (typeof size === 'number') {
    return { x: size, y: size, z: size };
  }

  return {
    x: size.x ?? CHUNK_SIZE,
    y: size.y ?? CHUNK_HEIGHT,
    z: size.z ?? CHUNK_SIZE,
  };
}

export function getTerrainIndex(size, x, y, z) {
  return x + size.x * (z + size.z * y);
}

export function getColumnIndex(size, x, z) {
  return x + size.x * z;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);

  return t * t * (3 - 2 * t);
}

function getDistanceToSegment(pointX, pointZ, start, end) {
  const segmentX = end.x - start.x;
  const segmentZ = end.z - start.z;
  const segmentLengthSq = segmentX * segmentX + segmentZ * segmentZ;

  if (segmentLengthSq <= 0.0001) {
    return Math.hypot(pointX - start.x, pointZ - start.z);
  }

  const t = clamp(
    ((pointX - start.x) * segmentX + (pointZ - start.z) * segmentZ) / segmentLengthSq,
    0,
    1,
  );
  const closestX = start.x + segmentX * t;
  const closestZ = start.z + segmentZ * t;

  return Math.hypot(pointX - closestX, pointZ - closestZ);
}

function getRiverbedCarve(worldX, worldZ) {
  let carve = 0;

  for (const riverbed of DESIGNED_RIVERBEDS) {
    let minDistance = Infinity;

    for (let index = 0; index < riverbed.points.length - 1; index += 1) {
      minDistance = Math.min(
        minDistance,
        getDistanceToSegment(worldX, worldZ, riverbed.points[index], riverbed.points[index + 1]),
      );
    }

    if (minDistance > riverbed.width) {
      continue;
    }

    const bedStrength = 1 - smoothstep(riverbed.width * 0.42, riverbed.width, minDistance);
    carve = Math.max(carve, Math.round(riverbed.carveDepth * bedStrength));
  }

  return carve;
}

function getMountainSlopeProfile(mountain, worldX, worldZ) {
  if (!mountain.slope) {
    return null;
  }

  const length = Math.max(1, mountain.slope.length);
  const width = Math.max(1, mountain.slope.width);
  const directionLength = Math.hypot(mountain.slope.direction.x, mountain.slope.direction.z) || 1;
  const directionX = mountain.slope.direction.x / directionLength;
  const directionZ = mountain.slope.direction.z / directionLength;
  const offsetX = worldX - mountain.x;
  const offsetZ = worldZ - mountain.z;
  const axisDistance = offsetX * directionX + offsetZ * directionZ;

  if (axisDistance < -mountain.innerRadius || axisDistance > length) {
    return null;
  }

  const lateralDistance = Math.abs(offsetX * -directionZ + offsetZ * directionX);

  if (lateralDistance > width) {
    return null;
  }

  const lateralStrength = 1 - smoothstep(width * 0.58, width, lateralDistance);
  const climbDistance = length - clamp(axisDistance, 0, length);
  const rampHeight = Math.min(
    mountain.maxHeight,
    mountain.slope.footHeight + climbDistance * mountain.slope.risePerBlock,
  );

  return {
    height: Math.round(rampHeight),
    strength: lateralStrength,
  };
}

function getDesignedMountain(worldX, worldZ) {
  let bestMountain = null;
  let bestScore = 0;

  for (const mountain of DESIGNED_MOUNTAINS) {
    const distance = Math.hypot(worldX - mountain.x, worldZ - mountain.z);
    const slope = getMountainSlopeProfile(mountain, worldX, worldZ);
    let radialStrength = 0;

    if (distance <= mountain.radius) {
      const falloff = 1 - smoothstep(mountain.innerRadius, mountain.radius, distance);
      radialStrength = clamp(falloff, 0, 1);
    }

    if (radialStrength <= 0 && !slope) {
      continue;
    }

    const slopeStrength = slope?.strength ?? 0;
    const strength = Math.max(radialStrength, slopeStrength);
    const score = Math.max(radialStrength, slopeStrength * 0.92);

    if (score > bestScore) {
      bestScore = score;
      bestMountain = {
        ...mountain,
        radialStrength,
        slope,
        slopeStrength,
        strength,
      };
    }
  }

  return bestMountain;
}

export function getDesignedMountainSummary(worldX, worldZ, size = { x: CHUNK_SIZE, y: CHUNK_HEIGHT, z: CHUNK_SIZE }) {
  const mountain = getDesignedMountain(worldX, worldZ);

  if (!mountain) {
    return null;
  }

  const normalizedSize = normalizeSize(size);

  return {
    x: mountain.x,
    z: mountain.z,
    biomeId: mountain.biomeId,
    peakHeight: clamp(mountain.maxHeight, 1, normalizedSize.y - 8),
    radius: mountain.radius,
    strength: mountain.strength,
  };
}

function isWithinGridRange(x, z, target, range) {
  return Math.max(Math.abs(x - target.x), Math.abs(z - target.z)) <= range;
}

export function getSurfaceCode(value) {
  const normalized = clamp((value + 1) * 0.5, 0, 0.999);

  return Math.floor(normalized * 9) + 1;
}

export function getCodeAffinity(code, targetCode) {
  return Math.max(0, 1 - Math.abs(code - targetCode) / 4);
}

function isDesignedSnowfield(worldX, worldZ, biomeValue) {
  const code = getSurfaceCode(biomeValue);
  const visibleFrontPatch = worldZ >= 5 && worldX >= -18 && worldX <= 8;
  const broadNorthPatch = worldZ <= -3 && worldX >= -18 && worldX <= 20;
  const coldPocket = worldZ <= 4 && getCodeAffinity(code, SURFACE_CODES.SNOW) > 0.5;

  return visibleFrontPatch || broadNorthPatch || coldPocket;
}

function isIceColumn(worldX, worldZ, surfaceHeight, biomeValue) {
  const localPattern = Math.abs(Math.sin(worldX * 0.63) * Math.cos(worldZ * 0.47));

  return surfaceHeight <= 4 && (biomeValue > 0.18 || localPattern > 0.78);
}

function getCaveBiomeValue(biomeNoise, worldX, worldZ, rules) {
  return biomeNoise.octaveNoise(worldX * rules.caveBiomeScale + 83.1, worldZ * rules.caveBiomeScale - 57.4, {
    octaves: 3,
    persistence: 0.58,
    lacunarity: 2.05,
  });
}

function isDesignedCave(worldX, worldZ) {
  const nearSpawnCave = worldX >= 8 && worldX <= 22 && worldZ >= -8 && worldZ <= 8;
  const northRidgeCave = worldX >= -30 && worldX <= -8 && worldZ >= -22 && worldZ <= -8;

  return nearSpawnCave || northRidgeCave;
}

export function isSandColumn(x, z, height, biomeId = BIOME_IDS.PLAINS) {
  const southBeach = z >= 10 && x >= 7;
  const streamBank = x <= 4 && z >= 8 && z <= 13;
  const lowShelf = height <= 3 && x >= 9;

  return biomeId !== BIOME_IDS.SNOWFIELD && (biomeId === BIOME_IDS.DESERT || southBeach || streamBank || lowShelf);
}

function toLocalChunkColumn(value, chunkSize) {
  return ((value % chunkSize) + chunkSize) % chunkSize;
}

export function isNearGrassAnchor(worldX, worldZ, size = CHUNK_SIZE) {
  const localX = toLocalChunkColumn(worldX, size);
  const localZ = toLocalChunkColumn(worldZ, size);

  return (
    TREE_CONFIGS.some((treeConfig) => isWithinGridRange(localX, localZ, treeConfig, GRASS_RANGE)) ||
    WATER_SOURCES.some((source) => isWithinGridRange(localX, localZ, source, GRASS_RANGE))
  );
}

export function isGrassColumn(worldX, worldZ, height, biomeId, size = CHUNK_SIZE) {
  return !isSandColumn(worldX, worldZ, height, biomeId) && isNearGrassAnchor(worldX, worldZ, size);
}

function getSurfaceHeight(noise, worldX, worldZ, size, rules) {
  const value = noise.octaveNoise(worldX * rules.noiseScale, worldZ * rules.noiseScale, rules);
  const normalized = (value + 1) * 0.5;
  const designedMountain = getDesignedMountain(worldX, worldZ);
  const riverbedCarve = getRiverbedCarve(worldX, worldZ) * (1 - (designedMountain?.strength ?? 0) * 0.65);
  const baseHeight = rules.baseHeight + Math.floor(normalized * rules.heightScale) - riverbedCarve;

  if (designedMountain) {
    const targetHeight = Math.round(
      designedMountain.minHeight +
      normalized * (designedMountain.maxHeight - designedMountain.minHeight),
    );
    let height = Math.round(
      baseHeight * (1 - designedMountain.radialStrength) + targetHeight * designedMountain.radialStrength,
    );

    if (designedMountain.slope) {
      const slopeHeight = Math.max(baseHeight, designedMountain.slope.height);

      height = Math.round(
        height * (1 - designedMountain.slopeStrength) + slopeHeight * designedMountain.slopeStrength,
      );
    }

    return clamp(height, 1, size.y - 8);
  }

  return clamp(baseHeight, 1, size.y - 8);
}

function getBiomeId(biomeNoise, worldX, worldZ, surfaceHeight, rules) {
  const value = biomeNoise.octaveNoise(worldX * rules.biomeScale, worldZ * rules.biomeScale, {
    octaves: 3,
    persistence: 0.56,
    lacunarity: 2.2,
  });
  const caveValue = getCaveBiomeValue(biomeNoise, worldX, worldZ, rules);
  const surfaceCode = getSurfaceCode(value);
  const snowAffinity = getCodeAffinity(surfaceCode, SURFACE_CODES.SNOW);
  const sandAffinity = getCodeAffinity(surfaceCode, SURFACE_CODES.SAND);
  const grassAffinity = getCodeAffinity(surfaceCode, SURFACE_CODES.GRASS);
  const designedMountain = getDesignedMountain(worldX, worldZ);

  if (designedMountain && surfaceHeight >= designedMountain.minHeight) {
    return designedMountain.biomeId;
  }

  if (surfaceHeight >= 4 && (caveValue > rules.caveBiomeThreshold || isDesignedCave(worldX, worldZ))) {
    return BIOME_IDS.CAVE;
  }

  if (surfaceHeight >= 100) {
    if (surfaceHeight >= 160 && (snowAffinity >= 0.45 || (worldZ <= -4 && surfaceCode >= 6))) {
      return BIOME_IDS.SNOW_MOUNTAIN;
    }

    if (grassAffinity >= 0.45 || value <= 0.11 || (worldZ >= 0 && surfaceCode <= 5)) {
      return BIOME_IDS.FOREST_MOUNTAIN;
    }

    return BIOME_IDS.ROCK_MOUNTAIN;
  }

  if (surfaceHeight >= rules.snowline || snowAffinity >= 0.75 || isDesignedSnowfield(worldX, worldZ, value)) {
    return BIOME_IDS.SNOWFIELD;
  }

  if (grassAffinity >= 0.75) {
    return BIOME_IDS.FOREST;
  }

  if (surfaceHeight >= rules.baseHeight + rules.heightScale - 1 || value < -0.34) {
    return BIOME_IDS.HIGHLAND;
  }

  if (sandAffinity >= 0.9 || value > 0.28) {
    return BIOME_IDS.DESERT;
  }

  if (grassAffinity >= 0.5 || value > -0.08) {
    return BIOME_IDS.FOREST;
  }

  return BIOME_IDS.PLAINS;
}

function getCaveValue(caveNoise, worldX, y, worldZ, rules) {
  const scale = rules.caveScale;
  const xy = caveNoise.octaveNoise(worldX * scale, y * scale, {
    octaves: 3,
    persistence: 0.52,
    lacunarity: 2.1,
  });
  const zy = caveNoise.octaveNoise(worldZ * scale + 41.7, y * scale - 19.3, {
    octaves: 3,
    persistence: 0.52,
    lacunarity: 2.1,
  });
  const xz = caveNoise.octaveNoise(worldX * scale - 13.5, worldZ * scale + 27.9, {
    octaves: 2,
    persistence: 0.5,
    lacunarity: 2,
  });

  return (xy + zy + xz * 0.65) / 2.65;
}

function shouldCarveCave(caveNoise, worldX, y, worldZ, surfaceHeight, biomeId, rules) {
  if (y <= 1) {
    return false;
  }

  const caveValue = getCaveValue(caveNoise, worldX, y, worldZ, rules);

  if (biomeId === BIOME_IDS.CAVE) {
    if (y >= surfaceHeight - 1) {
      return caveValue > rules.caveMouthThreshold || isDesignedCave(worldX, worldZ);
    }

    return caveValue > rules.caveThreshold - 0.1;
  }

  if (y >= surfaceHeight - 2) {
    return biomeId === BIOME_IDS.HIGHLAND && caveValue > rules.caveThreshold + 0.08;
  }

  return caveValue > rules.caveThreshold;
}

function isCaveWall(caveNoise, worldX, y, worldZ, surfaceHeight, biomeId, rules) {
  if (biomeId === BIOME_IDS.CAVE) {
    return y <= surfaceHeight && y > 1;
  }

  if (surfaceHeight - y < rules.dirtDepth) {
    return false;
  }

  return getCaveValue(caveNoise, worldX, y, worldZ, rules) > rules.caveThreshold - 0.18;
}

function getBlockIdForLayer({
  x,
  y,
  z,
  worldX,
  worldZ,
  surfaceHeight,
  biomeId,
  caveNoise,
  size,
  rules,
}) {
  // 地层规则：
  // 1. surfaceHeight 以上保持 AIR。
  // 2. 用 3D 洞穴噪声雕刻 AIR；高地允许洞穴接近表层，形成可见洞口。
  // 3. 表层由 2D 生物群落噪声决定：DESERT 生成 SAND，山地生成对应山体方块。
  // 4. 非沙地表层只有在水源或树木 3 格范围内生成 GRASS，否则生成 DIRT 或 DRY_GRASS。
  // 5. 表层以下 dirtDepth 层为 DIRT，用于过渡，更深层统一为 STONE。
  if (y > surfaceHeight) {
    return BLOCK_IDS.AIR;
  }

  if (shouldCarveCave(caveNoise, worldX, y, worldZ, surfaceHeight, biomeId, rules)) {
    return BLOCK_IDS.AIR;
  }

  if (y === surfaceHeight) {
    if (biomeId === BIOME_IDS.SNOW_MOUNTAIN) {
      return BLOCK_IDS.SNOW_MOUNTAIN;
    }

    if (biomeId === BIOME_IDS.ROCK_MOUNTAIN) {
      return BLOCK_IDS.ROCK_MOUNTAIN;
    }

    if (biomeId === BIOME_IDS.FOREST_MOUNTAIN) {
      return BLOCK_IDS.FOREST_MOUNTAIN;
    }

    if (biomeId === BIOME_IDS.SNOWFIELD) {
      const biomeValue = getCaveBiomeValue(caveNoise, worldX, worldZ, rules);

      if (isIceColumn(worldX, worldZ, surfaceHeight, biomeValue)) {
        return BLOCK_IDS.ICE;
      }

      return BLOCK_IDS.SNOW;
    }

    if (biomeId === BIOME_IDS.CAVE) {
      return BLOCK_IDS.CAVE_STONE;
    }

    if (isSandColumn(x, z, surfaceHeight, biomeId)) {
      return BLOCK_IDS.SAND;
    }

    if (biomeId === BIOME_IDS.HIGHLAND) {
      return surfaceHeight >= rules.snowline ? BLOCK_IDS.SNOW : BLOCK_IDS.STONE;
    }

    if (biomeId === BIOME_IDS.FOREST && isGrassColumn(worldX, worldZ, surfaceHeight, biomeId, size.x)) {
      return BLOCK_IDS.GRASS;
    }

    if (biomeId === BIOME_IDS.PLAINS && isGrassColumn(worldX, worldZ, surfaceHeight, biomeId, size.x)) {
      return BLOCK_IDS.GRASS;
    }

    return biomeId === BIOME_IDS.PLAINS ? BLOCK_IDS.DRY_GRASS : BLOCK_IDS.DIRT;
  }

  if (biomeId === BIOME_IDS.SNOW_MOUNTAIN && surfaceHeight - y < 3) {
    return surfaceHeight - y <= 1 ? BLOCK_IDS.SNOW_MOUNTAIN : BLOCK_IDS.STONE;
  }

  if (biomeId === BIOME_IDS.ROCK_MOUNTAIN && surfaceHeight - y < 3) {
    return BLOCK_IDS.ROCK_MOUNTAIN;
  }

  if (biomeId === BIOME_IDS.FOREST_MOUNTAIN && surfaceHeight - y < 2) {
    return surfaceHeight - y === 1 ? BLOCK_IDS.DIRT : BLOCK_IDS.STONE;
  }

  if (biomeId === BIOME_IDS.SNOWFIELD && surfaceHeight - y < 2) {
    return surfaceHeight - y === 1 ? BLOCK_IDS.SNOW : BLOCK_IDS.DIRT;
  }

  if (surfaceHeight - y < rules.dirtDepth) {
    if (biomeId === BIOME_IDS.CAVE) {
      return BLOCK_IDS.CAVE_STONE;
    }

    return BLOCK_IDS.DIRT;
  }

  if (isCaveWall(caveNoise, worldX, y, worldZ, surfaceHeight, biomeId, rules)) {
    return BLOCK_IDS.CAVE_STONE;
  }

  return BLOCK_IDS.STONE;
}

function buildTerrainData({
  chunkCoord = { x: 0, z: 0 },
  size = { x: CHUNK_SIZE, y: CHUNK_HEIGHT, z: CHUNK_SIZE },
  rules = TERRAIN_RULES,
  noise = new PerlinNoise2D({ seed: rules.seed }),
  biomeNoise = new PerlinNoise2D({ seed: rules.seed + 101 }),
  caveNoise = new PerlinNoise2D({ seed: rules.seed + 202 }),
} = {}) {
  const normalizedSize = normalizeSize(size);
  const normalizedCoord = normalizeChunkCoord(chunkCoord);
  const blocks = new Uint8Array(normalizedSize.x * normalizedSize.y * normalizedSize.z);
  const surfaceHeights = new Uint8Array(normalizedSize.x * normalizedSize.z);
  const biomes = new Uint8Array(normalizedSize.x * normalizedSize.z);

  for (let z = 0; z < normalizedSize.z; z += 1) {
    for (let x = 0; x < normalizedSize.x; x += 1) {
      const worldX = normalizedCoord.x * normalizedSize.x + x;
      const worldZ = normalizedCoord.z * normalizedSize.z + z;
      const surfaceHeight = getSurfaceHeight(noise, worldX, worldZ, normalizedSize, rules);
      const columnIndex = getColumnIndex(normalizedSize, x, z);
      const biomeId = getBiomeId(biomeNoise, worldX, worldZ, surfaceHeight, rules);
      surfaceHeights[columnIndex] = surfaceHeight;
      biomes[columnIndex] = biomeId;

      for (let y = 0; y < normalizedSize.y; y += 1) {
        blocks[getTerrainIndex(normalizedSize, x, y, z)] = getBlockIdForLayer({
          x,
          y,
          z,
          worldX,
          worldZ,
          surfaceHeight,
          biomeId,
          caveNoise,
          size: normalizedSize,
          rules,
        });
      }
    }
  }

  return {
    blocks,
    surfaceHeights,
    biomes,
  };
}

export function generateChunkBlocks(options = {}) {
  // 对外核心接口：输入 Chunk 坐标，输出方块体素 Uint8Array。
  return buildTerrainData(options).blocks;
}

export function generateChunkTerrain(options = {}) {
  return buildTerrainData(options);
}

export function createChunkLight(size = { x: CHUNK_SIZE, y: CHUNK_HEIGHT, z: CHUNK_SIZE }) {
  const normalizedSize = normalizeSize(size);
  const light = new Uint8Array(normalizedSize.x * normalizedSize.y * normalizedSize.z);

  for (let y = 0; y < normalizedSize.y; y += 1) {
    const lightLevel = Math.min(255, 110 + y * 9);

    for (let z = 0; z < normalizedSize.z; z += 1) {
      for (let x = 0; x < normalizedSize.x; x += 1) {
        light[getTerrainIndex(normalizedSize, x, y, z)] = lightLevel;
      }
    }
  }

  return light;
}
