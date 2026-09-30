import * as THREE from 'three';
import { BLOCK_IDS, CHUNK_HEIGHT, CHUNK_SIZE, Chunk } from './chunk.js';
import { FlowingWater } from './objects/flowingWater.js';
import { FLUID_LEVELS, FLUID_TYPES, FluidSystem } from './fluids/fluidSystem.js';
import { SurfaceDetails } from './objects/surfaceDetails.js';
import { TREE_TYPES, TreeObject } from './objects/treeObject.js';
import { getCustomBlocks, getPlayerBuildingRecordsInBounds } from './saveStorage.js';
import {
  BIOME_IDS,
  LAVA_SOURCES,
  SURFACE_CODES,
  WATER_SOURCES,
  createChunkLight,
  generateChunkTerrain,
  getCodeAffinity,
  getColumnIndex,
  getTerrainIndex,
  getSurfaceCode,
} from './terrain/chunkTerrain.js';
import { PerlinNoise2D } from './terrain/perlinNoise2D.js';

const SOURCE_REGION_CHUNKS = 3;
const SOURCE_SCAN_SIZE = Object.freeze({ x: CHUNK_SIZE, y: CHUNK_HEIGHT, z: CHUNK_SIZE });
const CUSTOM_BLOCK_ID_MIN = 1000;
const CUSTOM_BLOCK_ID_MAX = 60000;

function createLavaTexture() {
  const texture = new THREE.TextureLoader().load('/assets/textureyanjiang4x16x16.png');
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = 8;

  return texture;
}

function createLavaMaterial() {
  const lavaTexture = createLavaTexture();

  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: lavaTexture,
    emissive: 0xff7a18,
    emissiveMap: lavaTexture,
    emissiveIntensity: 0.65,
    roughness: 0.58,
    metalness: 0,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

function isCustomBlockId(blockId) {
  return Number.isInteger(blockId) && blockId >= CUSTOM_BLOCK_ID_MIN && blockId <= CUSTOM_BLOCK_ID_MAX;
}

function normalizeCustomBlock(block) {
  const blockId = Math.trunc(Number(block?.blockId));

  if (!isCustomBlockId(blockId)) {
    return null;
  }

  const name = String(block.name ?? block.label ?? `custom-${blockId}`).trim().slice(0, 32) || `custom-${blockId}`;
  const label = String(block.label ?? name).trim().slice(0, 32) || name;
  const color = Math.trunc(Number(block.color));

  return {
    blockId,
    key: String(block.key ?? name).trim().slice(0, 80),
    name,
    label,
    usage: String(block.usage ?? '').trim().slice(0, 80),
    color: Number.isFinite(color) && color > 0 ? color : 0xd8d0c5,
    opaque: block.opaque === false ? false : true,
    opacity: Math.max(0.05, Math.min(1, Number(block.opacity ?? 1))),
    textureDataUrl: typeof block.textureDataUrl === 'string' && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(block.textureDataUrl)
      ? block.textureDataUrl
      : '',
    textureRegion: block.textureRegion && typeof block.textureRegion === 'object' ? block.textureRegion : null,
    textureSource: String(block.textureSource ?? '').trim().slice(0, 120),
    custom: true,
  };
}

function getRecordCustomBlocks(record) {
  return [
    ...(Array.isArray(record?.customBlocks) ? record.customBlocks : []),
    ...(Array.isArray(record?.meta?.customBlocks) ? record.meta.customBlocks : []),
  ];
}

function getLocalBlockCenter(chunk, x, y, z) {
  return new THREE.Vector3(
    (x - (chunk.size.x - 1) / 2) * chunk.blockSize,
    y * chunk.blockSize,
    (z - (chunk.size.z - 1) / 2) * chunk.blockSize,
  );
}

function createLavaLightGroup(chunk, lavaCells) {
  const group = new THREE.Group();
  const lights = [];
  const maxLights = 1;
  const selectedCells = lavaCells
    .filter((cell, index) => index % 3 === 0)
    .slice(0, maxLights);

  group.name = 'LavaLights';
  group.position.copy(chunk.position);

  selectedCells.forEach((cell, index) => {
    const light = new THREE.PointLight(0xff6a18, 1.45, 7.5, 2.1);
    const position = getLocalBlockCenter(chunk, cell.x, cell.y, cell.z);

    light.position.set(position.x, position.y + 0.25, position.z);
    light.userData.baseIntensity = light.intensity;
    light.userData.flickerPhase = index * 1.73 + cell.x * 0.31 + cell.z * 0.47;
    lights.push(light);
    group.add(light);
  });

  return { group, lights };
}

function updateLavaLights(lights, time) {
  lights.forEach((light) => {
    const flicker =
      Math.sin(time * 5.3 + light.userData.flickerPhase) * 0.16 +
      Math.sin(time * 9.7 + light.userData.flickerPhase * 1.4) * 0.07;

    light.intensity = light.userData.baseIntensity * (1 + flicker);
  });
}

function getChunkKey(chunkCoord) {
  return `${chunkCoord.x},${chunkCoord.z}`;
}

function getSurfaceY(surfaceHeights, chunk, x, z) {
  return surfaceHeights[getColumnIndex(chunk.size, x, z)];
}

function isInsideChunkColumn(chunk, x, z) {
  return x >= 0 && x < chunk.size.x && z >= 0 && z < chunk.size.z;
}

function toChunkCoord(value, size = CHUNK_SIZE) {
  return Math.floor((value + size / 2) / size);
}

function toLocalColumn(value, chunkCoord, size = CHUNK_SIZE) {
  return Math.max(0, Math.min(size - 1, Math.floor(value - chunkCoord * size + size / 2)));
}

function toBlockY(value, sizeY = CHUNK_SIZE) {
  return Math.max(0, Math.min(sizeY - 1, Math.floor(value + 0.5)));
}

function createFlowCell(chunk, surfaceHeights, x, z, depth) {
  const surfaceY = getSurfaceY(surfaceHeights, chunk, x, z);
  const y = surfaceY + 1;

  if (!chunk.contains(x, y, z) || chunk.getBlock(x, surfaceY, z) === BLOCK_IDS.AIR) {
    return null;
  }

  return {
    x,
    y,
    z,
    depth,
    surfaceY,
  };
}

function findLowerNeighbors(chunk, surfaceHeights, cell) {
  const directions = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
  ];
  const neighbors = [];

  for (const direction of directions) {
    const x = cell.x + direction.x;
    const z = cell.z + direction.z;

    if (!isInsideChunkColumn(chunk, x, z)) {
      continue;
    }

    const surfaceY = getSurfaceY(surfaceHeights, chunk, x, z);

    if (surfaceY <= cell.surfaceY) {
      neighbors.push({
        x,
        z,
        surfaceY,
        drop: cell.surfaceY - surfaceY,
      });
    }
  }

  return neighbors.sort((a, b) => b.drop - a.drop || a.surfaceY - b.surfaceY);
}

function createWaterFlowCells(chunk, surfaceHeights, sources, options = {}) {
  const maxCells = options.maxCells ?? 34;
  const maxDepth = options.maxDepth ?? 14;
  const queue = [];
  const cellMap = new Map();

  for (const source of sources) {
    const cell = createFlowCell(chunk, surfaceHeights, source.x, source.z, 0);

    if (!cell) {
      continue;
    }

    queue.push(cell);
    cellMap.set(`${cell.x},${cell.z}`, cell);
  }

  while (queue.length > 0 && cellMap.size < maxCells) {
    const cell = queue.shift();

    if (cell.depth >= maxDepth) {
      continue;
    }

    const nextCells = findLowerNeighbors(chunk, surfaceHeights, cell).slice(0, cell.depth < 5 ? 3 : 2);

    for (const next of nextCells) {
      if (cellMap.size >= maxCells) {
        break;
      }

      const key = `${next.x},${next.z}`;

      if (cellMap.has(key)) {
        continue;
      }

      const nextCell = createFlowCell(chunk, surfaceHeights, next.x, next.z, cell.depth + 1);

      if (!nextCell) {
        continue;
      }

      cellMap.set(key, nextCell);
      queue.push(nextCell);
    }
  }

  return [...cellMap.values()].sort((a, b) => a.depth - b.depth || a.x - b.x || a.z - b.z);
}

function createSourcePoolCells(chunk, surfaceHeights, sources, options = {}) {
  const radius = options.radius ?? 1;
  const avoidSpawnRadius = options.avoidSpawnRadius ?? 0;
  const cells = [];
  const seen = new Set();

  for (const source of sources) {
    for (let z = source.z - radius; z <= source.z + radius; z += 1) {
      for (let x = source.x - radius; x <= source.x + radius; x += 1) {
        if (!isInsideChunkColumn(chunk, x, z)) {
          continue;
        }

        const worldColumn = getWorldColumn({ x: chunk.position.x / CHUNK_SIZE, z: chunk.position.z / CHUNK_SIZE }, x, z);

        if (avoidSpawnRadius > 0 && isNearSpawn(worldColumn.x, worldColumn.z, avoidSpawnRadius)) {
          continue;
        }

        const key = `${x},${z}`;

        if (seen.has(key)) {
          continue;
        }

        const cell = createFlowCell(chunk, surfaceHeights, x, z, 0);

        if (!cell) {
          continue;
        }

        seen.add(key);
        cells.push(cell);
      }
    }
  }

  return cells;
}

function mergeCells(...cellGroups) {
  const seen = new Set();
  const merged = [];

  for (const cellGroup of cellGroups) {
    for (const cell of cellGroup) {
      const key = `${cell.x},${cell.z}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(cell);
    }
  }

  return merged.sort((a, b) => a.depth - b.depth || a.x - b.x || a.z - b.z);
}

function getTerrainColumn(chunkCoord, x, z) {
  return {
    x: chunkCoord.x * CHUNK_SIZE + x,
    z: chunkCoord.z * CHUNK_SIZE + z,
  };
}

function getWorldColumn(chunkCoord, x, z) {
  return {
    x: chunkCoord.x * CHUNK_SIZE + x - CHUNK_SIZE / 2 + 0.5,
    z: chunkCoord.z * CHUNK_SIZE + z - CHUNK_SIZE / 2 + 0.5,
  };
}

function isNearSpawn(worldX, worldZ, radius = 3.2) {
  return Math.hypot(worldX, worldZ) <= radius;
}

function createAffinitySources({
  chunkCoord,
  surfaceHeights,
  size,
  biomeNoise,
  targetCode,
  threshold,
  maxSources,
  minSpacing,
  avoidSpawn = false,
}) {
  const candidates = [];

  for (let z = 1; z < size.z - 1; z += 1) {
    for (let x = 1; x < size.x - 1; x += 1) {
      const worldColumn = getWorldColumn(chunkCoord, x, z);

      if (avoidSpawn && isNearSpawn(worldColumn.x, worldColumn.z)) {
        continue;
      }

      const terrainColumn = getTerrainColumn(chunkCoord, x, z);
      const noiseValue = biomeNoise.octaveNoise(terrainColumn.x * 0.045, terrainColumn.z * 0.045, {
        octaves: 3,
        persistence: 0.56,
        lacunarity: 2.2,
      });
      const code = getSurfaceCode(noiseValue);
      const affinity = getCodeAffinity(code, targetCode);
      const surfaceY = surfaceHeights[getColumnIndex(size, x, z)];

      if (affinity < threshold) {
        continue;
      }

      candidates.push({
        x,
        z,
        affinity,
        surfaceY,
      });
    }
  }

  return candidates
    .sort((a, b) => b.affinity - a.affinity || a.surfaceY - b.surfaceY)
    .reduce((sources, candidate) => {
      if (sources.length >= maxSources) {
        return sources;
      }

      const isTooClose = sources.some((source) => (
        Math.hypot(source.x - candidate.x, source.z - candidate.z) < minSpacing
      ));

      if (!isTooClose) {
        sources.push({ x: candidate.x, z: candidate.z });
      }

      return sources;
    }, []);
}

function mergeSources(...sourceGroups) {
  const seen = new Set();
  const merged = [];

  for (const sourceGroup of sourceGroups) {
    for (const source of sourceGroup) {
      const key = `${source.x},${source.z}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(source);
    }
  }

  return merged;
}

function getSourceRegionCoord(value) {
  return Math.floor(value / SOURCE_REGION_CHUNKS);
}

function getSourceRegionKey(regionCoord) {
  return `${regionCoord.x},${regionCoord.z}`;
}

function isSameChunkCoord(a, b) {
  return a.x === b.x && a.z === b.z;
}

function getTerrainBlock(blocks, size, x, y, z) {
  if (x < 0 || x >= size.x || y < 0 || y >= size.y || z < 0 || z >= size.z) {
    return BLOCK_IDS.AIR;
  }

  return blocks[getTerrainIndex(size, x, y, z)];
}

function toFluidSource(source) {
  return {
    x: source.x,
    y: source.y,
    z: source.z,
  };
}

function hashVegetationSeed(chunkCoord, x, z) {
  let hash = Math.imul(chunkCoord.x + 0x9e3779b9, 0x85ebca6b);
  hash ^= Math.imul(chunkCoord.z + 0x7f4a7c15, 0xc2b2ae35);
  hash ^= Math.imul(x + 0x27d4eb2d, 0x165667b1);
  hash ^= Math.imul(z + 0x94d049bb, 0xd3a2646c);
  hash ^= hash >>> 16;

  return hash >>> 0;
}

function getVegetationRandom(chunkCoord, x, z, salt = 0) {
  const seed = hashVegetationSeed(chunkCoord, x + salt * 13, z - salt * 17);

  return (seed & 0xffffff) / 0x1000000;
}

function canHostVegetation(surfaceBlock) {
  return (
    surfaceBlock !== BLOCK_IDS.AIR &&
    surfaceBlock !== BLOCK_IDS.WATER &&
    surfaceBlock !== BLOCK_IDS.LAVA &&
    surfaceBlock !== BLOCK_IDS.CAVE_STONE &&
    surfaceBlock !== BLOCK_IDS.STONE &&
    surfaceBlock !== BLOCK_IDS.SNOW_MOUNTAIN &&
    surfaceBlock !== BLOCK_IDS.ROCK_MOUNTAIN
  );
}

function getTreeTypeForColumn(chunkCoord, chunk, surfaceHeights, x, z) {
  const biomeId = chunk.getBiome(x, z);
  const surfaceY = getSurfaceY(surfaceHeights, chunk, x, z);
  const surfaceBlock = chunk.getBlock(x, surfaceY, z);
  const roll = getVegetationRandom(chunkCoord, x, z);
  const variantRoll = getVegetationRandom(chunkCoord, x, z, 3);
  const hasHeadroom = surfaceY < chunk.size.y - 12;

  if (!hasHeadroom || !canHostVegetation(surfaceBlock)) {
    return null;
  }

  if (surfaceBlock === BLOCK_IDS.SAND || biomeId === BIOME_IDS.DESERT) {
    return roll > 0.64 ? TREE_TYPES.CACTUS : null;
  }

  if (biomeId === BIOME_IDS.SNOWFIELD || biomeId === BIOME_IDS.HIGHLAND) {
    return roll > 0.72 ? TREE_TYPES.BIRCH : null;
  }

  if (biomeId === BIOME_IDS.FOREST || biomeId === BIOME_IDS.PLAINS || biomeId === BIOME_IDS.FOREST_MOUNTAIN) {
    if (surfaceBlock !== BLOCK_IDS.GRASS && surfaceBlock !== BLOCK_IDS.FOREST_MOUNTAIN && surfaceBlock !== BLOCK_IDS.DRY_GRASS) {
      return null;
    }

    if (roll <= 0.52) {
      return null;
    }

    return variantRoll > 0.76 ? TREE_TYPES.BIRCH : TREE_TYPES.OAK;
  }

  return null;
}

function createTreeCandidates(chunkCoord, chunk, surfaceHeights) {
  const candidates = [];

  for (let z = 2; z < chunk.size.z - 2; z += 2) {
    for (let x = 2; x < chunk.size.x - 2; x += 2) {
      const type = getTreeTypeForColumn(chunkCoord, chunk, surfaceHeights, x, z);

      if (!type) {
        continue;
      }

      const worldColumn = getWorldColumn(chunkCoord, x, z);

      if (isNearSpawn(worldColumn.x, worldColumn.z, 5)) {
        continue;
      }

      candidates.push({
        x,
        z,
        type,
        seed: hashVegetationSeed(chunkCoord, x, z),
        score: getVegetationRandom(chunkCoord, x, z, 7),
      });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .reduce((selected, candidate) => {
      const maxTrees = candidate.type === TREE_TYPES.CACTUS ? 5 : 4;

      if (selected.length >= maxTrees) {
        return selected;
      }

      const minSpacing = candidate.type === TREE_TYPES.OAK ? 5.5 : 4.2;
      const isTooClose = selected.some((tree) => Math.hypot(tree.x - candidate.x, tree.z - candidate.z) < minSpacing);

      if (!isTooClose) {
        selected.push(candidate);
      }

      return selected;
    }, []);
}

function createTrees(chunkCoord, chunk, surfaceHeights) {
  return createTreeCandidates(chunkCoord, chunk, surfaceHeights).map((treeConfig) => {
    const y = getSurfaceY(surfaceHeights, chunk, treeConfig.x, treeConfig.z) + 1;
    const tree = new TreeObject({
      ...treeConfig,
      y,
    });

    tree.place(chunk);

    return tree;
  });
}

function createSurfaceDetails(chunk, surfaceHeights) {
  const grassTufts = [];
  const rocks = [];
  const snowdrifts = [];
  const grassColumns = [
    [1, 2], [2, 5], [3, 7], [5, 2], [6, 5], [7, 3],
    [8, 7], [9, 5], [11, 2], [13, 6], [14, 4], [4, 14],
  ];
  const rockColumns = [
    [2, 9], [4, 6], [6, 11], [9, 8], [10, 13], [13, 10],
  ];
  const snowColumns = [
    [1, 1], [3, 4], [5, 9], [7, 2], [8, 12], [10, 5],
    [12, 9], [14, 3], [15, 13], [4, 15],
  ];

  grassColumns.forEach(([x, z], index) => {
    const surfaceY = getSurfaceY(surfaceHeights, chunk, x, z);

    const surfaceBlock = chunk.getBlock(x, surfaceY, z);

    if (surfaceBlock !== BLOCK_IDS.GRASS && surfaceBlock !== BLOCK_IDS.FOREST_MOUNTAIN) {
      return;
    }

    for (let blade = 0; blade < 3; blade += 1) {
      const seed = index * 3 + blade;

      grassTufts.push({
        x,
        y: surfaceY,
        z,
        offsetX: ((seed * 17) % 9 - 4) * 0.055,
        offsetZ: ((seed * 23) % 9 - 4) * 0.055,
        rotationY: seed * 0.9,
        tiltX: ((seed % 3) - 1) * 0.16,
        tiltZ: (((seed + 1) % 3) - 1) * 0.14,
        width: 0.64 + (seed % 3) * 0.14,
        height: 0.84 + (seed % 4) * 0.11,
      });
    }
  });

  rockColumns.forEach(([x, z], index) => {
    const surfaceY = getSurfaceY(surfaceHeights, chunk, x, z);
    const surfaceBlock = chunk.getBlock(x, surfaceY, z);

    if (surfaceBlock === BLOCK_IDS.AIR || surfaceBlock === BLOCK_IDS.WATER || surfaceBlock === BLOCK_IDS.LAVA) {
      return;
    }

    rocks.push({
      x,
      y: surfaceY,
      z,
      offsetX: ((index * 19) % 7 - 3) * 0.04,
      offsetZ: ((index * 29) % 7 - 3) * 0.04,
      rotationX: index * 0.37,
      rotationY: index * 0.71,
      rotationZ: index * 0.43,
      scaleX: surfaceBlock === BLOCK_IDS.CAVE_STONE || surfaceBlock === BLOCK_IDS.ROCK_MOUNTAIN ? 0.92 + (index % 3) * 0.2 : 0.72 + (index % 3) * 0.18,
      scaleY: surfaceBlock === BLOCK_IDS.CAVE_STONE || surfaceBlock === BLOCK_IDS.ROCK_MOUNTAIN ? 0.48 + (index % 2) * 0.14 : 0.35 + (index % 2) * 0.12,
      scaleZ: surfaceBlock === BLOCK_IDS.CAVE_STONE || surfaceBlock === BLOCK_IDS.ROCK_MOUNTAIN ? 0.78 + (index % 4) * 0.14 : 0.58 + (index % 4) * 0.12,
    });
  });

  snowColumns.forEach(([x, z], index) => {
    const surfaceY = getSurfaceY(surfaceHeights, chunk, x, z);

    const surfaceBlock = chunk.getBlock(x, surfaceY, z);

    if (surfaceBlock !== BLOCK_IDS.SNOW && surfaceBlock !== BLOCK_IDS.SNOW_MOUNTAIN) {
      return;
    }

    snowdrifts.push({
      x,
      y: surfaceY,
      z,
      offsetX: ((index * 13) % 9 - 4) * 0.045,
      offsetZ: ((index * 31) % 9 - 4) * 0.045,
      rotationY: index * 0.53,
      scaleX: 0.62 + (index % 4) * 0.08,
      scaleY: 0.14 + (index % 3) * 0.035,
      scaleZ: 0.5 + (index % 5) * 0.07,
    });
  });

  return new SurfaceDetails({
    chunk,
    grassTufts,
    rocks,
    snowdrifts,
  });
}

export class WorldManager {
  constructor({
    scene,
    viewDistance = 2,
    maxLoadsPerFrame = 2,
    playerBuildingProvider = null,
    currentUserId = null,
    currentPlayerId = null,
  }) {
    this.scene = scene;
    this.viewDistance = viewDistance;
    this.maxLoadsPerFrame = maxLoadsPerFrame;
    this.loadedChunks = new Map();
    this.terrainNoise = new PerlinNoise2D({ seed: 20260708 });
    this.biomeNoise = new PerlinNoise2D({ seed: 20260809 });
    this.caveNoise = new PerlinNoise2D({ seed: 20260910 });
    this.biologyState = null;
    this.fluidTickAccumulator = 0;
    this.fluidTickInterval = 0.18;
    this.sourceRegionCache = new Map();
    this.playerBuildingProvider = playerBuildingProvider ?? {
      listInBounds: getPlayerBuildingRecordsInBounds,
    };
    this.currentUserId = currentUserId;
    this.currentPlayerId = currentPlayerId;
    this.playerBuildingLoadPromises = new Map();
    this.appliedPlayerBuildingChunks = new Set();
    this.playerBuildingRecordsById = new Map();
    this.playerBuildingByWorldKey = new Map();
    this.clearedPlayerBuildingIds = new Set();
    this.customBlocksById = new Map();
    this.customBlockTextureIndexById = new Map();
    this.customBlocks = [];
    void this.loadCustomBlocks();
  }

  async loadCustomBlocks() {
    try {
      const customBlocks = await getCustomBlocks();
      this.registerCustomBlocks(customBlocks, { refreshMesh: true });
    } catch (error) {
      console.warn('Failed to load custom blocks.', error);
    }
  }

  registerCustomBlocks(customBlocks, { refreshMesh = true } = {}) {
    const normalized = Array.isArray(customBlocks)
      ? customBlocks.map(normalizeCustomBlock).filter(Boolean)
      : [];

    if (!normalized.length) {
      return 0;
    }

    let changed = 0;

    normalized.forEach((block) => {
      const previous = this.customBlocksById.get(block.blockId);

      if (!previous || JSON.stringify(previous) !== JSON.stringify(block)) {
        this.customBlocksById.set(block.blockId, block);
        changed += 1;
      }
    });

    this.customBlocks = [...this.customBlocksById.values()]
      .sort((left, right) => left.blockId - right.blockId);
    this.customBlockTextureIndexById = new Map(
      this.customBlocks.map((block, index) => [block.blockId, index]),
    );

    if (changed <= 0) {
      return 0;
    }

    for (const entity of this.loadedChunks.values()) {
      entity.chunk.setCustomBlocks(this.customBlocks);
      this.applyCustomBlockPalette(entity.chunk);
      if (refreshMesh) {
        entity.chunk.updateMesh();
      }
    }

    return changed;
  }

  applyCustomBlockPalette(chunk) {
    for (const block of this.customBlocks) {
      chunk.palette[block.blockId] = {
        name: block.label || block.name,
        color: block.color,
        opaque: block.opaque,
        opacity: block.opacity,
        custom: true,
        textureDataUrl: block.textureDataUrl,
        textureRegion: block.textureRegion,
        textureSource: block.textureSource,
        customTextureIndex: this.customBlockTextureIndexById.get(block.blockId) ?? -1,
        customBlock: block,
      };
    }
  }

  update(playerPosition) {
    const centerCoord = {
      x: toChunkCoord(playerPosition.x),
      z: toChunkCoord(playerPosition.z),
    };
    const desiredKeys = new Set();
    const loadQueue = [];

    for (let z = centerCoord.z - this.viewDistance; z <= centerCoord.z + this.viewDistance; z += 1) {
      for (let x = centerCoord.x - this.viewDistance; x <= centerCoord.x + this.viewDistance; x += 1) {
        const coord = { x, z };
        const key = getChunkKey(coord);
        desiredKeys.add(key);

        if (!this.loadedChunks.has(key)) {
          const distance = Math.max(Math.abs(centerCoord.x - x), Math.abs(centerCoord.z - z));
          loadQueue.push({ coord, distance });
        }
      }
    }

    this.getPinnedPlayerBuildingChunkKeys().forEach((key) => {
      desiredKeys.add(key);
    });

    this.unloadOutside(desiredKeys);
    loadQueue
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.maxLoadsPerFrame)
      .forEach(({ coord }) => this.loadChunk(coord));
  }

  getPinnedPlayerBuildingChunkKeys() {
    const keys = new Set();

    for (const record of this.playerBuildingRecordsById.values()) {
      if (!['preview', 'active'].includes(record?.status) || !Array.isArray(record.blocks)) {
        continue;
      }

      record.blocks.forEach((block) => {
        if (!block || !Number.isFinite(Number(block.x)) || !Number.isFinite(Number(block.z))) {
          return;
        }

        keys.add(getChunkKey({
          x: toChunkCoord(Number(block.x)),
          z: toChunkCoord(Number(block.z)),
        }));
      });
    }

    return keys;
  }

  loadAround(playerPosition) {
    const centerCoord = {
      x: toChunkCoord(playerPosition.x),
      z: toChunkCoord(playerPosition.z),
    };

    for (let z = centerCoord.z - this.viewDistance; z <= centerCoord.z + this.viewDistance; z += 1) {
      for (let x = centerCoord.x - this.viewDistance; x <= centerCoord.x + this.viewDistance; x += 1) {
        this.loadChunk({ x, z });
      }
    }
  }

  getChunkWorldBounds(chunkCoord) {
    return {
      minX: chunkCoord.x * CHUNK_SIZE - CHUNK_SIZE / 2,
      maxX: chunkCoord.x * CHUNK_SIZE + CHUNK_SIZE / 2 - 1,
      minZ: chunkCoord.z * CHUNK_SIZE - CHUNK_SIZE / 2,
      maxZ: chunkCoord.z * CHUNK_SIZE + CHUNK_SIZE / 2 - 1,
    };
  }

  loadPlayerBuildingsForLoadedChunks() {
    for (const entity of this.loadedChunks.values()) {
      void this.loadPlayerBuildingsForChunk(entity);
    }
  }

  async loadPlayerBuildingsForChunk(entity) {
    if (!this.playerBuildingProvider?.listInBounds) {
      return;
    }

    const key = getChunkKey(entity.chunkCoord);

    if (this.playerBuildingLoadPromises.has(key)) {
      return this.playerBuildingLoadPromises.get(key);
    }

    const bounds = this.getChunkWorldBounds(entity.chunkCoord);
    const promise = Promise.resolve()
      .then(() => this.playerBuildingProvider.listInBounds(bounds))
      .then((records) => {
        if (!this.loadedChunks.has(key)) {
          return;
        }

        records
          .filter((record) => record?.status !== 'cleared')
          .filter((record) => !this.clearedPlayerBuildingIds.has(record?.id))
          .forEach((record) => this.applyPlayerBuildingRecordToChunk(entity, record));
      })
      .catch((error) => {
        console.warn('Failed to load player buildings for chunk.', key, error);
      })
      .finally(() => {
        this.playerBuildingLoadPromises.delete(key);
      });

    this.playerBuildingLoadPromises.set(key, promise);
    return promise;
  }

  applyPlayerBuildingRecordToChunk(entity, record) {
    if (
      !record?.id ||
      record.status === 'cleared' ||
      this.clearedPlayerBuildingIds.has(record.id) ||
      !Array.isArray(record.blocks)
    ) {
      return 0;
    }

    const chunkKey = getChunkKey(entity.chunkCoord);
    const appliedKey = `${record.id}:${chunkKey}`;

    if (this.appliedPlayerBuildingChunks.has(appliedKey)) {
      return 0;
    }

    const bounds = this.getChunkWorldBounds(entity.chunkCoord);
    let changed = 0;

    this.registerCustomBlocks(getRecordCustomBlocks(record), { refreshMesh: false });
    this.playerBuildingRecordsById.set(record.id, record);

    for (const block of record.blocks) {
      if (
        !block ||
        !Number.isFinite(block.x) ||
        !Number.isFinite(block.y) ||
        !Number.isFinite(block.z) ||
        block.x < bounds.minX ||
        block.x > bounds.maxX ||
        block.z < bounds.minZ ||
        block.z > bounds.maxZ
      ) {
        continue;
      }

      const localX = toLocalColumn(block.x, entity.chunkCoord.x, entity.chunk.size.x);
      const localY = toBlockY(block.y, entity.chunk.size.y);
      const localZ = toLocalColumn(block.z, entity.chunkCoord.z, entity.chunk.size.z);
      const result = this.setBlockAtLocal(entity, localX, localY, localZ, Math.trunc(Number(block.blockId) || 0), {
        world: { x: block.x, y: block.y, z: block.z },
        refreshMesh: false,
      });

      if (result.changed) {
        changed += 1;
      }

      this.playerBuildingByWorldKey.set(`${block.x},${block.y},${block.z}`, {
        recordId: record.id,
        block: {
          x: block.x,
          y: block.y,
          z: block.z,
          blockId: Math.trunc(Number(block.blockId) || 0),
        },
      });
    }

    this.appliedPlayerBuildingChunks.add(appliedKey);

    if (changed > 0) {
      entity.chunk.updateMesh();
    }

    return changed;
  }

  unregisterPlayerBuildingRecord(recordId) {
    if (!recordId) {
      return;
    }

    this.playerBuildingRecordsById.delete(recordId);

    for (const [worldKey, entry] of [...this.playerBuildingByWorldKey.entries()]) {
      if (entry.recordId === recordId) {
        this.playerBuildingByWorldKey.delete(worldKey);
      }
    }

    for (const appliedKey of [...this.appliedPlayerBuildingChunks]) {
      if (appliedKey.startsWith(`${recordId}:`)) {
        this.appliedPlayerBuildingChunks.delete(appliedKey);
      }
    }
  }

  registerPlayerBuildingRecord(record) {
    if (
      !record?.id ||
      record.status === 'cleared' ||
      !Array.isArray(record.blocks)
    ) {
      return 0;
    }

    this.clearedPlayerBuildingIds.delete(record.id);
    this.registerCustomBlocks(getRecordCustomBlocks(record), { refreshMesh: true });
    this.unregisterPlayerBuildingRecord(record.id);
    this.playerBuildingRecordsById.set(record.id, record);

    let indexedBlocks = 0;

    for (const block of record.blocks) {
      if (
        !block ||
        !Number.isFinite(block.x) ||
        !Number.isFinite(block.y) ||
        !Number.isFinite(block.z)
      ) {
        continue;
      }

      this.playerBuildingByWorldKey.set(`${block.x},${block.y},${block.z}`, {
        recordId: record.id,
        block: {
          x: block.x,
          y: block.y,
          z: block.z,
          blockId: Math.trunc(Number(block.blockId) || 0),
        },
      });
      indexedBlocks += 1;
    }

    return indexedBlocks;
  }

  getPlayerBuildingRecord(recordId) {
    if (!recordId) {
      return null;
    }

    return this.playerBuildingRecordsById.get(recordId) ?? null;
  }

  getPlayerBuildingRecordAtWorld(worldX, worldY, worldZ) {
    const key = `${Math.trunc(worldX)},${Math.trunc(worldY)},${Math.trunc(worldZ)}`;
    const entry = this.playerBuildingByWorldKey.get(key);

    if (!entry) {
      return null;
    }

    const record = this.playerBuildingRecordsById.get(entry.recordId);

    if (!record || record.status === 'cleared') {
      return null;
    }

    const creator = record.creator ?? {};
    const currentUserId = this.currentUserId ?? null;
    const currentPlayerId = this.currentPlayerId ?? null;
    const isCreator = Boolean(
      (creator.userId && creator.userId === currentUserId) ||
      (record.userId && record.userId === currentUserId) ||
      (creator.playerId && creator.playerId === currentPlayerId) ||
      (record.playerId && record.playerId === currentPlayerId),
    );

    const blockId = Math.trunc(Number(entry.block?.blockId) || 0);
    const customBlock = this.customBlocksById.get(blockId) ?? null;

    return {
      ...record,
      isCreator,
      hoveredBlock: {
        ...entry.block,
        customBlock,
      },
      customBlock,
    };
  }

  clearPlayerBuildingRecord(recordId) {
    if (!recordId) {
      return 0;
    }

    this.clearedPlayerBuildingIds.add(recordId);
    const record = this.playerBuildingRecordsById.get(recordId);
    const blocksByWorldKey = new Map();

    for (const [worldKey, entry] of this.playerBuildingByWorldKey.entries()) {
      if (entry.recordId === recordId) {
        blocksByWorldKey.set(worldKey, entry.block);
      }
    }

    if (Array.isArray(record?.blocks)) {
      record.blocks.forEach((block) => {
        if (
          block &&
          Number.isFinite(Number(block.x)) &&
          Number.isFinite(Number(block.y)) &&
          Number.isFinite(Number(block.z))
        ) {
          const normalizedBlock = {
            x: Math.trunc(Number(block.x)),
            y: Math.trunc(Number(block.y)),
            z: Math.trunc(Number(block.z)),
            blockId: Math.trunc(Number(block.blockId) || 0),
          };
          const worldKey = `${normalizedBlock.x},${normalizedBlock.y},${normalizedBlock.z}`;

          if (!blocksByWorldKey.has(worldKey)) {
            blocksByWorldKey.set(worldKey, normalizedBlock);
          }
        }
      });
    }

    const touchedEntities = new Set();
    let clearedBlocks = 0;

    for (const [worldKey, block] of blocksByWorldKey.entries()) {
      const { x, y, z } = block;
      const entity = this.getLoadedChunkAtWorld(x, z);

      if (entity) {
        const localX = toLocalColumn(x, entity.chunkCoord.x, entity.chunk.size.x);
        const localY = toBlockY(y, entity.chunk.size.y);
        const localZ = toLocalColumn(z, entity.chunkCoord.z, entity.chunk.size.z);
        const blockId = entity.chunk.getBlock(localX, localY, localZ);

        if (blockId !== BLOCK_IDS.AIR) {
          entity.chunk.setBlock(localX, localY, localZ, BLOCK_IDS.AIR);
          touchedEntities.add(entity);
          clearedBlocks += 1;
        }
      }

      this.playerBuildingByWorldKey.delete(worldKey);
    }

    this.unregisterPlayerBuildingRecord(recordId);

    touchedEntities.forEach((entity) => entity.chunk.updateMesh());

    return clearedBlocks;
  }

  getFluidSourcesForChunk(chunkCoord) {
    const regionCoord = {
      x: getSourceRegionCoord(chunkCoord.x),
      z: getSourceRegionCoord(chunkCoord.z),
    };
    const regionKey = getSourceRegionKey(regionCoord);

    if (!this.sourceRegionCache.has(regionKey)) {
      this.sourceRegionCache.set(regionKey, this.createRegionalFluidSources(regionCoord));
    }

    const regionalSources = this.sourceRegionCache.get(regionKey);

    return {
      waterSources: regionalSources.water && isSameChunkCoord(regionalSources.water.chunkCoord, chunkCoord)
        ? [toFluidSource(regionalSources.water)]
        : [],
      lavaSources: regionalSources.lava && isSameChunkCoord(regionalSources.lava.chunkCoord, chunkCoord)
        ? [toFluidSource(regionalSources.lava)]
        : [],
    };
  }

  createRegionalFluidSources(regionCoord) {
    const startChunkX = regionCoord.x * SOURCE_REGION_CHUNKS;
    const startChunkZ = regionCoord.z * SOURCE_REGION_CHUNKS;
    const waterCandidates = [];
    const rockLavaCandidates = [];
    const caveLavaCandidates = [];

    for (let cz = startChunkZ; cz < startChunkZ + SOURCE_REGION_CHUNKS; cz += 1) {
      for (let cx = startChunkX; cx < startChunkX + SOURCE_REGION_CHUNKS; cx += 1) {
        const chunkCoord = { x: cx, z: cz };
        const { blocks, surfaceHeights, biomes } = generateChunkTerrain({
          chunkCoord,
          size: SOURCE_SCAN_SIZE,
          noise: this.terrainNoise,
          biomeNoise: this.biomeNoise,
          caveNoise: this.caveNoise,
        });

        for (let z = 1; z < SOURCE_SCAN_SIZE.z - 1; z += 1) {
          for (let x = 1; x < SOURCE_SCAN_SIZE.x - 1; x += 1) {
            const columnIndex = getColumnIndex(SOURCE_SCAN_SIZE, x, z);
            const biomeId = biomes[columnIndex];
            const surfaceY = surfaceHeights[columnIndex];
            const surfaceBlock = getTerrainBlock(blocks, SOURCE_SCAN_SIZE, x, surfaceY, z);
            const worldColumn = getWorldColumn(chunkCoord, x, z);

            if (biomeId === BIOME_IDS.SNOW_MOUNTAIN && surfaceBlock === BLOCK_IDS.SNOW_MOUNTAIN) {
              waterCandidates.push({
                chunkCoord,
                x,
                y: Math.min(SOURCE_SCAN_SIZE.y - 1, surfaceY + 1),
                z,
                score: surfaceY * 10 - Math.hypot(worldColumn.x + 22, worldColumn.z + 24),
              });
            }

            if (
              biomeId === BIOME_IDS.ROCK_MOUNTAIN &&
              surfaceBlock === BLOCK_IDS.ROCK_MOUNTAIN &&
              !isNearSpawn(worldColumn.x, worldColumn.z, 4.5)
            ) {
              rockLavaCandidates.push({
                chunkCoord,
                x,
                y: Math.min(SOURCE_SCAN_SIZE.y - 1, surfaceY + 1),
                z,
                score: surfaceY * 10 - Math.hypot(worldColumn.x - 24, worldColumn.z + 13),
              });
            }

            if (isNearSpawn(worldColumn.x, worldColumn.z, 4.5)) {
              continue;
            }

            const caveLimit = Math.min(10, surfaceY);

            for (let y = 2; y < caveLimit; y += 1) {
              const blockId = getTerrainBlock(blocks, SOURCE_SCAN_SIZE, x, y, z);
              const belowBlockId = getTerrainBlock(blocks, SOURCE_SCAN_SIZE, x, y - 1, z);

              if (
                blockId === BLOCK_IDS.AIR &&
                (belowBlockId === BLOCK_IDS.CAVE_STONE || belowBlockId === BLOCK_IDS.STONE)
              ) {
                caveLavaCandidates.push({
                  chunkCoord,
                  x,
                  y,
                  z,
                  score: (biomeId === BIOME_IDS.CAVE ? 40 : 0) + (10 - y) * 4 + surfaceY,
                });
                break;
              }
            }
          }
        }
      }
    }

    waterCandidates.sort((a, b) => b.score - a.score);
    rockLavaCandidates.sort((a, b) => b.score - a.score);
    caveLavaCandidates.sort((a, b) => b.score - a.score);

    return {
      water: waterCandidates[0] ?? null,
      lava: rockLavaCandidates[0] ?? caveLavaCandidates[0] ?? null,
    };
  }

  loadChunk(chunkCoord) {
    const key = getChunkKey(chunkCoord);

    if (this.loadedChunks.has(key)) {
      return this.loadedChunks.get(key);
    }

    const chunk = new Chunk({
      position: new THREE.Vector3(chunkCoord.x * CHUNK_SIZE, 0, chunkCoord.z * CHUNK_SIZE),
      customBlocks: this.customBlocks,
    });
    const { blocks, surfaceHeights, biomes } = generateChunkTerrain({
      chunkCoord,
      size: chunk.size,
      noise: this.terrainNoise,
      biomeNoise: this.biomeNoise,
      caveNoise: this.caveNoise,
    });

    chunk.blocks.set(blocks);
    chunk.light.set(createChunkLight(chunk.size));
    chunk.biomes.set(biomes);
    this.applyBiologyPalette(chunk);
    this.applyCustomBlockPalette(chunk);
    createTrees(chunkCoord, chunk, surfaceHeights);

    const { waterSources, lavaSources } = this.getFluidSourcesForChunk(chunkCoord);
    const fluidSystem = new FluidSystem({
      chunk,
      surfaceHeights,
      waterSources,
      lavaSources,
    });
    const waterCells = fluidSystem.getCellsByType(FLUID_TYPES.WATER);
    const lavaCells = fluidSystem.getCellsByType(FLUID_TYPES.LAVA);
    const water = new FlowingWater({
      chunk,
      cells: waterCells,
      useWorldSpaceUv: true,
      uvScale: 0.38,
      maxLevel: FLUID_LEVELS.MAX,
    });
    const lava = new FlowingWater({
      chunk,
      cells: lavaCells,
      height: 0.68,
      maxLevel: FLUID_LEVELS.MAX,
      flowSpeed: 0.62,
      waveAmplitude: 0.035,
      blockId: BLOCK_IDS.LAVA,
      material: createLavaMaterial(),
      useWorldSpaceUv: true,
      uvScale: 0.38,
    });
    const lavaLight = createLavaLightGroup(chunk, lavaCells);
    const details = createSurfaceDetails(chunk, surfaceHeights);
    const waterMesh = water.buildMesh();
    const lavaMesh = lava.buildMesh();
    lavaMesh.name = 'FlowingLava';
    const chunkMesh = chunk.buildMesh();
    const detailsGroup = details.buildGroup();
    this.applyBiologyToSurfaceDetails(details);
    const entity = {
      chunkCoord,
      chunk,
      surfaceHeights,
      details,
      detailsGroup,
      fluidSystem,
      fluidVersion: fluidSystem.version,
      lava,
      lavaLight,
      lavaMesh,
      water,
      waterMesh,
      chunkMesh,
    };

    chunkMesh.userData.terrainInspectable = true;
    chunkMesh.userData.chunkEntity = entity;
    this.scene.add(chunkMesh, detailsGroup, waterMesh, lavaMesh, lavaLight.group);
    this.loadedChunks.set(key, entity);
    void this.loadPlayerBuildingsForChunk(entity);

    return entity;
  }

  setBiologyState(biologyState) {
    this.biologyState = biologyState;

    for (const entity of this.loadedChunks.values()) {
      this.applyBiologyPalette(entity.chunk);
      entity.chunk.updateMesh();
      this.applyBiologyToSurfaceDetails(entity.details);
    }
  }

  setSeasonState(seasonState) {
    this.setBiologyState(seasonState);
  }

  applyBiologyPalette(chunk) {
    if (!this.biologyState) {
      return;
    }

    const { colors, seasonId, ecology } = this.biologyState;
    const wetSand = ecology?.moisture > 0.62 ? 0xc9b26f : 0xd9bf78;

    chunk.palette[BLOCK_IDS.GRASS].color = colors.grass;
    chunk.palette[BLOCK_IDS.LEAVES].color = colors.leaves;
    chunk.palette[BLOCK_IDS.DRY_GRASS].color = colors.dryGrass;
    chunk.palette[BLOCK_IDS.SAND].color = wetSand;
    chunk.palette[BLOCK_IDS.SNOW].color = seasonId === 'winter' || colors.snowCoverage > 0.45 ? 0xf4fffd : 0xeef6f3;
    chunk.palette[BLOCK_IDS.ICE].color = seasonId === 'winter' ? 0xb7ecf4 : 0x9fd8e8;
    chunk.palette[BLOCK_IDS.CAVE_STONE].color = ecology?.moisture > 0.62 ? 0x424a49 : 0x4e5453;
    chunk.palette[BLOCK_IDS.SNOW_MOUNTAIN].color = seasonId === 'winter' || colors.snowCoverage > 0.45 ? 0xfbfffd : 0xf0f8f5;
    chunk.palette[BLOCK_IDS.ROCK_MOUNTAIN].color = ecology?.moisture > 0.62 ? 0x59615f : 0x6f7674;
    chunk.palette[BLOCK_IDS.FOREST_MOUNTAIN].color = colors.grass;
  }

  applyBiologyToSurfaceDetails(details) {
    if (!this.biologyState) {
      return;
    }

    const { colors, ecology } = this.biologyState;

    if (details.grassMaterial) {
      details.grassMaterial.color.setHex(colors.grass);
    }

    if (details.grassMesh) {
      details.grassMesh.visible = ecology.vegetationActivity > 0.12;
    }

    if (details.rockMaterial) {
      details.rockMaterial.color.setHex(ecology.moisture > 0.68 ? 0x676f6d : 0x777c78);
    }

    if (details.snowdriftMaterial) {
      details.snowdriftMaterial.color.setHex(colors.snowCoverage > 0.45 ? 0xf7fffd : 0xe4eeec);
    }

    if (details.snowdriftMesh) {
      details.snowdriftMesh.visible = colors.snowCoverage > 0.08;
    }
  }

  unloadOutside(desiredKeys) {
    for (const [key, entity] of this.loadedChunks) {
      if (desiredKeys.has(key)) {
        continue;
      }

      entity.lava.dispose();
      this.scene.remove(entity.lavaLight.group);
      entity.water.dispose();
      entity.details.dispose();
      entity.chunk.dispose();
      this.loadedChunks.delete(key);
      for (const appliedKey of this.appliedPlayerBuildingChunks) {
        if (appliedKey.endsWith(`:${key}`)) {
          this.appliedPlayerBuildingChunks.delete(appliedKey);
        }
      }
    }
  }

  getChunkAtWorld(worldX, worldZ) {
    const chunkCoord = {
      x: toChunkCoord(worldX),
      z: toChunkCoord(worldZ),
    };
    const key = getChunkKey(chunkCoord);

    return this.loadedChunks.get(key) ?? this.loadChunk(chunkCoord);
  }

  getLoadedChunkAtWorld(worldX, worldZ) {
    const chunkCoord = {
      x: toChunkCoord(worldX),
      z: toChunkCoord(worldZ),
    };
    const key = getChunkKey(chunkCoord);

    return this.loadedChunks.get(key) ?? null;
  }

  getBlockAt(worldX, worldY, worldZ) {
    const entity = this.getChunkAtWorld(worldX, worldZ);
    const localX = toLocalColumn(worldX, entity.chunkCoord.x, entity.chunk.size.x);
    const localY = toBlockY(worldY, entity.chunk.size.y);
    const localZ = toLocalColumn(worldZ, entity.chunkCoord.z, entity.chunk.size.z);

    return entity.chunk.getBlock(localX, localY, localZ);
  }

  getBlockAtIfLoaded(worldX, worldY, worldZ) {
    const entity = this.getLoadedChunkAtWorld(worldX, worldZ);

    if (!entity) {
      return BLOCK_IDS.AIR;
    }

    const localX = toLocalColumn(worldX, entity.chunkCoord.x, entity.chunk.size.x);
    const localY = toBlockY(worldY, entity.chunk.size.y);
    const localZ = toLocalColumn(worldZ, entity.chunkCoord.z, entity.chunk.size.z);

    return entity.chunk.getBlock(localX, localY, localZ);
  }

  setBlockAt(worldX, worldY, worldZ, blockId) {
    const entity = this.getChunkAtWorld(worldX, worldZ);
    const localX = toLocalColumn(worldX, entity.chunkCoord.x, entity.chunk.size.x);
    const localY = toBlockY(worldY, entity.chunk.size.y);
    const localZ = toLocalColumn(worldZ, entity.chunkCoord.z, entity.chunk.size.z);
    const result = this.setBlockAtLocal(entity, localX, localY, localZ, blockId, {
      world: { x: worldX, y: worldY, z: worldZ },
      refreshMesh: true,
    });

    return result;
  }

  setBlockAtLocal(entity, localX, localY, localZ, blockId, { world = null, refreshMesh = true } = {}) {
    const previousBlockId = entity.chunk.getBlock(localX, localY, localZ);

    if (previousBlockId === blockId) {
      return {
        changed: false,
        blockId: previousBlockId,
        local: { x: localX, y: localY, z: localZ },
        world: world ?? {
          x: entity.chunkCoord.x * CHUNK_SIZE - CHUNK_SIZE / 2 + localX,
          y: localY,
          z: entity.chunkCoord.z * CHUNK_SIZE - CHUNK_SIZE / 2 + localZ,
        },
      };
    }

    entity.chunk.setBlock(localX, localY, localZ, blockId);

    if (refreshMesh) {
      entity.chunk.updateMesh();
    }

    return {
      changed: true,
      blockId: previousBlockId,
      local: { x: localX, y: localY, z: localZ },
      world: world ?? {
        x: entity.chunkCoord.x * CHUNK_SIZE - CHUNK_SIZE / 2 + localX,
        y: localY,
        z: entity.chunkCoord.z * CHUNK_SIZE - CHUNK_SIZE / 2 + localZ,
      },
    };
  }

  setBlocksAt(blocks, { refreshMesh = true } = {}) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return [];
    }

    const touchedEntities = new Set();
    const results = [];

    for (const block of blocks) {
      if (!block || !Number.isFinite(block.x) || !Number.isFinite(block.y) || !Number.isFinite(block.z)) {
        continue;
      }

      const entity = this.getChunkAtWorld(block.x, block.z);
      const localX = toLocalColumn(block.x, entity.chunkCoord.x, entity.chunk.size.x);
      const localY = toBlockY(block.y, entity.chunk.size.y);
      const localZ = toLocalColumn(block.z, entity.chunkCoord.z, entity.chunk.size.z);
      const result = this.setBlockAtLocal(entity, localX, localY, localZ, block.blockId, {
        world: { x: block.x, y: block.y, z: block.z },
        refreshMesh: false,
      });

      if (result.changed) {
        touchedEntities.add(entity);

        if (localX === 0 || localX === entity.chunk.size.x - 1 || localZ === 0 || localZ === entity.chunk.size.z - 1) {
          [
            { x: entity.chunkCoord.x - 1, z: entity.chunkCoord.z },
            { x: entity.chunkCoord.x + 1, z: entity.chunkCoord.z },
            { x: entity.chunkCoord.x, z: entity.chunkCoord.z - 1 },
            { x: entity.chunkCoord.x, z: entity.chunkCoord.z + 1 },
          ].forEach((coord) => {
            const neighbor = this.loadedChunks.get(getChunkKey(coord));

            if (neighbor) {
              touchedEntities.add(neighbor);
            }
          });
        }
      }

      results.push(result);
    }

    if (refreshMesh) {
      touchedEntities.forEach((entity) => entity.chunk.updateMesh());
    }

    return results;
  }

  destroyBlockAt(worldX, worldY, worldZ) {
    const blockId = this.getBlockAt(worldX, worldY, worldZ);

    if (blockId === BLOCK_IDS.AIR || blockId === BLOCK_IDS.WATER || blockId === BLOCK_IDS.LAVA) {
      return {
        changed: false,
        blockId,
        world: { x: worldX, y: worldY, z: worldZ },
      };
    }

    return this.setBlockAt(worldX, worldY, worldZ, BLOCK_IDS.AIR);
  }

  damageSphere(center, radius, {
    protectedBlockIds = new Set([BLOCK_IDS.WATER, BLOCK_IDS.LAVA]),
  } = {}) {
    const changedBlocks = [];
    const minX = Math.floor(center.x - radius);
    const maxX = Math.ceil(center.x + radius);
    const minY = Math.max(0, Math.floor(center.y - radius));
    const maxY = Math.ceil(center.y + radius);
    const minZ = Math.floor(center.z - radius);
    const maxZ = Math.ceil(center.z + radius);
    const touchedEntities = new Set();

    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const distance = Math.hypot(x - center.x, y - center.y, z - center.z);

          if (distance > radius) {
            continue;
          }

          const entity = this.getChunkAtWorld(x, z);
          const localX = toLocalColumn(x, entity.chunkCoord.x, entity.chunk.size.x);
          const localY = toBlockY(y, entity.chunk.size.y);
          const localZ = toLocalColumn(z, entity.chunkCoord.z, entity.chunk.size.z);
          const blockId = entity.chunk.getBlock(localX, localY, localZ);

          if (blockId === BLOCK_IDS.AIR || protectedBlockIds.has(blockId)) {
            continue;
          }

          entity.chunk.setBlock(localX, localY, localZ, BLOCK_IDS.AIR);
          touchedEntities.add(entity);
          changedBlocks.push({
            blockId,
            world: { x, y, z },
          });
        }
      }
    }

    touchedEntities.forEach((entity) => entity.chunk.updateMesh());

    return changedBlocks;
  }

  isSolidAt(worldX, worldY, worldZ) {
    const blockId = this.getBlockAt(worldX, worldY, worldZ);

    return blockId !== BLOCK_IDS.AIR && blockId !== BLOCK_IDS.WATER && blockId !== BLOCK_IDS.LAVA;
  }

  isWaterAt(worldX, worldY, worldZ) {
    return this.getBlockAt(worldX, worldY, worldZ) === BLOCK_IDS.WATER;
  }

  isLavaAt(worldX, worldY, worldZ) {
    return this.getBlockAt(worldX, worldY, worldZ) === BLOCK_IDS.LAVA;
  }

  getBodyFluidSamplePoints(body) {
    const sampleHeights = [
      body.position.y + 0.08,
      body.position.y + 0.58,
    ];
    const horizontalOffsets = [
      [0, 0],
      [body.radius, 0],
      [-body.radius, 0],
      [0, body.radius],
      [0, -body.radius],
    ];

    return sampleHeights.flatMap((y) => horizontalOffsets.map(([offsetX, offsetZ]) => [
      body.position.x + offsetX,
      y,
      body.position.z + offsetZ,
    ]));
  }

  isBodyInWater(body) {
    return this.getBodyFluidSamplePoints(body).some(([x, y, z]) => this.isWaterAt(x, y, z));
  }

  isBodyInLava(body) {
    return this.getBodyFluidSamplePoints(body).some(([x, y, z]) => this.isLavaAt(x, y, z));
  }

  getHighestSolidBelow(worldX, worldY, worldZ) {
    const entity = this.getChunkAtWorld(worldX, worldZ);
    const localX = toLocalColumn(worldX, entity.chunkCoord.x, entity.chunk.size.x);
    const localZ = toLocalColumn(worldZ, entity.chunkCoord.z, entity.chunk.size.z);
    const startY = toBlockY(worldY, entity.chunk.size.y);

    for (let y = startY; y >= 0; y -= 1) {
      const blockId = entity.chunk.getBlock(localX, y, localZ);

      if (blockId !== BLOCK_IDS.AIR && blockId !== BLOCK_IDS.WATER && blockId !== BLOCK_IDS.LAVA) {
        return y + 0.52;
      }
    }

    return null;
  }

  getSurfaceHeightAt(worldX, worldZ) {
    const entity = this.getChunkAtWorld(worldX, worldZ);
    const localX = toLocalColumn(worldX, entity.chunkCoord.x, entity.chunk.size.x);
    const localZ = toLocalColumn(worldZ, entity.chunkCoord.z, entity.chunk.size.z);

    for (let y = entity.chunk.size.y - 1; y >= 0; y -= 1) {
      const blockId = entity.chunk.getBlock(localX, y, localZ);

      if (blockId !== BLOCK_IDS.AIR && blockId !== BLOCK_IDS.WATER && blockId !== BLOCK_IDS.LAVA) {
        return y;
      }
    }

    return getSurfaceY(entity.surfaceHeights, entity.chunk, localX, localZ);
  }

  updateWater(deltaTime) {
    this.fluidTickAccumulator += deltaTime;
    const shouldTickFluid = this.fluidTickAccumulator >= this.fluidTickInterval;

    if (shouldTickFluid) {
      this.fluidTickAccumulator %= this.fluidTickInterval;
    }

    for (const entity of this.loadedChunks.values()) {
      if (shouldTickFluid) {
        entity.fluidSystem.tick();
      }

      if (entity.fluidVersion !== entity.fluidSystem.version) {
        entity.water.updateCells(entity.fluidSystem.getCellsByType(FLUID_TYPES.WATER));
        entity.lava.updateCells(entity.fluidSystem.getCellsByType(FLUID_TYPES.LAVA));
        entity.chunk.updateMesh();
        entity.fluidVersion = entity.fluidSystem.version;
      }

      entity.water.update(deltaTime);
      entity.lava.update(deltaTime);
      updateLavaLights(entity.lavaLight.lights, entity.lava.time);
    }
  }

  dispose() {
    for (const entity of this.loadedChunks.values()) {
      entity.lava.dispose();
      this.scene.remove(entity.lavaLight.group);
      entity.water.dispose();
      entity.details.dispose();
      entity.chunk.dispose();
    }

    this.loadedChunks.clear();
  }
}
