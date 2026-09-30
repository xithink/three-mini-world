import * as THREE from 'three';
import { BLOCK_IDS, CHUNK_HEIGHT, CHUNK_SIZE } from '../chunk.js';
import { generateChunkTerrain, getColumnIndex } from '../terrain/chunkTerrain.js';
import { createRasterSvgTexture } from '../utils/svgTexture.js';
import { DAYS_PER_YEAR, SECONDS_PER_YEAR_DAY } from './timeSystem.js';

export const SNOW_LOTUS_GROWTH_STAGES = Object.freeze([
  {
    id: 'seed',
    label: '休眠种子',
    texture: '/assets/textwatersnowlotus-seed.svg',
    minAgeDays: 0,
    scale: 0.22,
    effect: '低温休眠，等待融雪水分',
  },
  {
    id: 'sprout',
    label: '萌发芽',
    texture: '/assets/textwatersnowlotus-sprout.svg',
    minAgeDays: 35,
    scale: 0.34,
    effect: '幼根形成，怕干旱与夜冻',
  },
  {
    id: 'young_rosette',
    label: '幼年莲座',
    texture: '/assets/textwatersnowlotus-rosette-young.svg',
    minAgeDays: 120,
    scale: 0.52,
    effect: '贴地莲座，缓慢积累根系',
  },
  {
    id: 'mature_rosette',
    label: '成熟莲座',
    texture: '/assets/textwatersnowlotus-rosette-mature.svg',
    minAgeDays: DAYS_PER_YEAR * 2,
    scale: 0.70,
    effect: '多年生蓄能，冬季休眠',
  },
  {
    id: 'bud',
    label: '花苞期',
    texture: '/assets/textwatersnowlotus-bud.png',
    minAgeDays: DAYS_PER_YEAR * 6,
    scale: 0.82,
    effect: '达到 6-8 年繁殖年龄后，仅在 7-9 月推进',
  },
  {
    id: 'bloom',
    label: '开花期',
    texture: '/assets/textwatersnowlotus-bloom.png',
    minAgeDays: DAYS_PER_YEAR * 6 + 28,
    scale: 0.94,
    effect: '授粉窗口，冷凉晴昼最优',
  },
  {
    id: 'fruit',
    label: '结实散种',
    texture: '/assets/textwatersnowlotus-fruit.svg',
    minAgeDays: DAYS_PER_YEAR * 6 + 70,
    scale: 0.86,
    effect: '种子成熟并向附近雪山格扩散',
  },
  {
    id: 'dead',
    label: '枯死残株',
    texture: '/assets/textwatersnowlotus-dead.svg',
    minAgeDays: DAYS_PER_YEAR * 6 + 126,
    scale: 0.66,
    effect: '繁殖后衰老或环境胁迫死亡',
  },
]);

const HOST_BLOCK_LABELS = Object.freeze({
  [BLOCK_IDS.SNOW_MOUNTAIN]: '雪山',
});
const SNOW_LOTUS_HOST_PROFILE = Object.freeze({
  soil: 0.44,
  drainage: 0.84,
  density: 0.22,
});
const DAYLIGHT_STAGE_FACTORS = Object.freeze({
  preDawn: 0.12,
  dawn: 0.48,
  morning: 0.94,
  noon: 1,
  afternoon: 0.88,
  dusk: 0.34,
  night: 0.06,
});
const SEASON_BASE_TEMPERATURE_C = Object.freeze({
  spring: 2,
  summer: 10,
  autumn: 0,
  winter: -15,
});
const WEATHER_TEMPERATURE_OFFSET_C = Object.freeze({
  clear: 2,
  rain: -3,
  snow: -7,
  aurora: -5,
});
const WEATHER_MOISTURE_OFFSET = Object.freeze({
  clear: -0.04,
  rain: 0.24,
  snow: 0.14,
  aurora: 0.02,
});
const STAGE_TEMPERATURE_BANDS_C = Object.freeze({
  seed: [-8, 8],
  sprout: [1, 12],
  young_rosette: [-4, 14],
  mature_rosette: [-8, 15],
  bud: [2, 14],
  bloom: [3, 16],
  fruit: [2, 13],
  dead: [-40, 30],
});
const STAGE_DAILY_PROGRESS = Object.freeze({
  seed: 0.045,
  sprout: 0.040,
  young_rosette: 0.012,
  mature_rosette: 0.0045,
  bud: 0.080,
  bloom: 0.095,
  fruit: 0.070,
});
const STAGE_ADVANCE_CHANCE_PER_DAY = Object.freeze({
  seed: 0.080,
  sprout: 0.060,
  young_rosette: 0.018,
  mature_rosette: 0.006,
  bud: 0.120,
  bloom: 0.160,
  fruit: 0.100,
});
const COLUMN_SCAN_STEP = 2;
const MAX_INITIAL_SNOW_LOTUSES_PER_CHUNK = 7;
const FORCED_PEAK_SNOW_LOTUSES_PER_CHUNK = 2;
const WATER_SCAN_RADIUS = 6;
const HEALTH_RECOVERY_RATE = 0.030;
const HEALTH_STRESS_RATE = 0.052;
const PROPAGATION_INTERVAL = 6.5;
const PROPAGATION_CHANCE = 0.055;
const FLOWERING_MIN_DAYS = DAYS_PER_YEAR * 6;
const FLOWERING_MAX_DAYS = DAYS_PER_YEAR * 8;
const GERMINATION_START_DAY = 121;
const GERMINATION_END_DAY = 181;
const FLOWERING_START_DAY = 182;
const FLOWERING_END_DAY = 273;
const MIN_ALTITUDE_M = 2400;
const OPTIMAL_ALTITUDE_MIN_M = 3000;
const OPTIMAL_ALTITUDE_MAX_M = 4100;
const MAX_ALTITUDE_M = 4300;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bandScore(value, min, max, falloff = 0.35) {
  if (value >= min && value <= max) {
    return 1;
  }

  const width = Math.max(0.0001, max - min);

  if (value < min) {
    return clamp01(1 - (min - value) / (width * falloff));
  }

  return clamp01(1 - (value - max) / (width * falloff));
}

function hashSnowLotusSeed(chunkCoord, x, z, salt = 0) {
  let hash = Math.imul(chunkCoord.x + 0x8f1bbcdc + salt, 0x85ebca6b);
  hash ^= Math.imul(chunkCoord.z + 0x632be59b - salt, 0xc2b2ae35);
  hash ^= Math.imul(x + 0x94d049bb + salt * 31, 0x165667b1);
  hash ^= Math.imul(z + 0x27d4eb2d - salt * 17, 0xd3a2646c);
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

function getWorldPosition(entity, x, y, z) {
  const { chunk } = entity;

  return new THREE.Vector3(
    entity.chunk.position.x + (x - (chunk.size.x - 1) / 2) * chunk.blockSize,
    (y + 0.54) * chunk.blockSize,
    entity.chunk.position.z + (z - (chunk.size.z - 1) / 2) * chunk.blockSize,
  );
}

function getWorldColumn(entity, x, z) {
  const { chunk } = entity;

  return {
    x: entity.chunk.position.x + (x - (chunk.size.x - 1) / 2) * chunk.blockSize,
    z: entity.chunk.position.z + (z - (chunk.size.z - 1) / 2) * chunk.blockSize,
  };
}

function getDirectionLabel(dx, dz) {
  if (Math.hypot(dx, dz) < 0.8) {
    return '当前位置';
  }

  const angle = Math.atan2(dx, -dz);
  const labels = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const index = Math.round((((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * labels.length) % labels.length;

  return labels[index];
}

function getChunkCoordFromWorld(value) {
  return Math.floor((value + CHUNK_SIZE / 2) / CHUNK_SIZE);
}

function getDaylightFactor(timeState) {
  const stageFactor = DAYLIGHT_STAGE_FACTORS[timeState?.stage?.id] ?? 0.72;
  const daylightHours = timeState?.solarProfile?.daylightHours ?? 12;
  const seasonalDaylight = clamp01((daylightHours - 7) / 8);

  return clamp01(stageFactor * (0.78 + seasonalDaylight * 0.22));
}

function estimateAltitudeM(surfaceY) {
  if (surfaceY >= 100) {
    return Math.round(2400 + clamp01((surfaceY - 100) / 150) * 1900);
  }

  return Math.round(1800 + surfaceY * 6);
}

function normalizeTemperature(temperatureCelsius) {
  return clamp01((temperatureCelsius + 25) / 45);
}

function isGerminationWindow(dayOfYear) {
  return dayOfYear >= GERMINATION_START_DAY && dayOfYear <= GERMINATION_END_DAY;
}

function isFloweringWindow(dayOfYear) {
  return dayOfYear >= FLOWERING_START_DAY && dayOfYear <= FLOWERING_END_DAY;
}

function getStageIndexById(stageId) {
  return SNOW_LOTUS_GROWTH_STAGES.findIndex((stage) => stage.id === stageId);
}

function getAgeProgress(record) {
  if (record.stageIndex >= getStageIndexById('bud')) {
    return clamp01(0.86 + record.stageProgress * 0.14);
  }

  return clamp01(record.ageDays / record.flowerReadyDays);
}

function getInitialStageIndex(ageDays, flowerReadyDays, dayOfYear, seed) {
  if (ageDays < SNOW_LOTUS_GROWTH_STAGES[1].minAgeDays) return 0;
  if (ageDays < SNOW_LOTUS_GROWTH_STAGES[2].minAgeDays) return 1;
  if (ageDays < SNOW_LOTUS_GROWTH_STAGES[3].minAgeDays) return 2;
  if (ageDays < flowerReadyDays || !isFloweringWindow(dayOfYear)) return 3;

  const flowerPhase = clamp01((dayOfYear - FLOWERING_START_DAY) / (FLOWERING_END_DAY - FLOWERING_START_DAY));
  const offset = (seededUnit(seed, 53) - 0.5) * 0.12;
  const phase = clamp01(flowerPhase + offset);

  if (phase < 0.30) return 4;
  if (phase < 0.68) return 5;
  if (phase < 0.93) return 6;

  return seededUnit(seed, 59) > 0.28 ? 6 : 7;
}

function getEnvironmentStatus(record, environment) {
  if (record.stageIndex === getStageIndexById('dead')) {
    return '枯死';
  }

  if (environment.typeRejected) {
    return '地形不符';
  }

  if (record.health < 0.30 || environment.stress > 0.72) {
    return '环境胁迫';
  }

  if (record.stageIndex >= getStageIndexById('bud') && !environment.floweringWindow) {
    return '等待花期';
  }

  if (environment.suitability >= 0.72 && record.health >= 0.70) {
    return '高山适生';
  }

  if (environment.suitability >= 0.48) {
    return '缓慢生长';
  }

  return '休眠';
}

function getStageAdvanceProbability(record, environment, worldDays, tickSerial) {
  const stage = SNOW_LOTUS_GROWTH_STAGES[record.stageIndex];
  const dailyChance = STAGE_ADVANCE_CHANCE_PER_DAY[stage.id] ?? 0.02;
  const randomGate = 0.86 + seededUnit(record.seed, tickSerial + 311) * 0.28;
  const dayChance = dailyChance * environment.suitability * record.health * record.vigor * randomGate;

  return clamp01(1 - (1 - clamp01(dayChance)) ** Math.max(0, worldDays));
}

export class SnowLotusGrowthSystem {
  constructor({ scene, eventBus, worldManager, player = null }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.worldManager = worldManager;
    this.player = player;
    this.chunkStates = new Map();
    this.snowLotusMemory = new Map();
    this.elapsedTime = 0;
    this.tickSerial = 0;
    this.timeState = null;
    this.lastWorldDayScalar = null;
    this.pendingWorldDays = 0;
    this.biologyState = null;
    this.weatherId = 'clear';
    this.finderBeacon = this.createFinderBeacon();
    this.stageTextures = SNOW_LOTUS_GROWTH_STAGES.map((stage) => this.createTexture(stage.texture));
    this.stageMaterials = this.stageTextures.map((texture) => new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.08,
      depthWrite: false,
      sizeAttenuation: true,
    }));
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
      eventBus.on('snowLotus:find-nearest', () => this.handleFindNearestRequest()),
    ];
    this.scene.add(this.finderBeacon);
  }

  createFinderBeacon() {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.025, 8, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffd46b,
        transparent: true,
        opacity: 0.95,
      }),
    );
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.25, 8),
      new THREE.MeshBasicMaterial({
        color: 0xfff0ad,
        transparent: true,
        opacity: 0.72,
      }),
    );

    group.name = 'SnowLotusFinderBeacon';
    group.visible = false;
    ring.rotation.x = Math.PI * 0.5;
    stem.position.y = 0.62;
    group.add(ring, stem);

    return group;
  }

  createTexture(url) {
    const texture = url.toLowerCase().endsWith('.svg')
      ? createRasterSvgTexture(url, {
        width: 256,
        height: 256,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      })
      : new THREE.TextureLoader().load(url);

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    return texture;
  }

  update(deltaTime) {
    this.elapsedTime += deltaTime;
    this.tickSerial += 1;
    const worldDays = this.consumeWorldDays(deltaTime);
    this.syncLoadedChunks();

    if (this.finderBeacon.visible) {
      this.finderBeacon.rotation.y += deltaTime * 1.8;
    }

    for (const state of this.chunkStates.values()) {
      this.updateChunkSnowLotuses(state, worldDays);
    }
  }

  handleFindNearestRequest() {
    this.syncLoadedChunks();

    const snowLotuses = [...this.chunkStates.values()]
      .flatMap((state) => state.snowLotuses)
      .filter((snowLotus) => snowLotus.record.stageIndex !== getStageIndexById('dead'));

    const playerPosition = this.player?.position ?? new THREE.Vector3();
    let nearest = snowLotuses
      .map((snowLotus) => ({
        target: this.normalizeSnowLotusTarget({
          position: snowLotus.sprite.position,
          y: snowLotus.y,
          record: snowLotus.record,
          sprite: snowLotus.sprite,
        }),
        distance: snowLotus.sprite.position.distanceTo(playerPosition),
      }))
      .sort((a, b) => a.distance - b.distance)[0] ?? null;

    if (!nearest) {
      nearest = this.findNearestGeneratedPeakCandidate(playerPosition);
    }

    if (!nearest) {
      this.finderBeacon.visible = false;
      this.eventBus.emit('snowLotus:finder-update', {
        found: false,
        message: '附近没有可见雪莲',
      });
      return;
    }

    this.highlightSnowLotus(nearest.target);
    this.eventBus.emit('snowLotus:finder-update', {
      found: true,
      message: this.formatFinderMessage(nearest.target, nearest.distance, playerPosition),
    });
  }

  normalizeSnowLotusTarget(target) {
    if (target?.sprite) {
      return target;
    }

    return {
      position: target.position.clone(),
      y: target.y,
      record: target.record ?? null,
      sprite: {
        position: target.position,
        scale: { y: 0.9 },
      },
    };
  }

  findNearestGeneratedPeakCandidate(playerPosition) {
    const playerChunkCoord = {
      x: getChunkCoordFromWorld(playerPosition.x),
      z: getChunkCoordFromWorld(playerPosition.z),
    };
    const searchRadius = 3;
    let best = null;

    for (let chunkZ = playerChunkCoord.z - searchRadius; chunkZ <= playerChunkCoord.z + searchRadius; chunkZ += 1) {
      for (let chunkX = playerChunkCoord.x - searchRadius; chunkX <= playerChunkCoord.x + searchRadius; chunkX += 1) {
        const chunkCoord = { x: chunkX, z: chunkZ };
        const terrain = generateChunkTerrain({
          chunkCoord,
          size: { x: CHUNK_SIZE, y: CHUNK_HEIGHT, z: CHUNK_SIZE },
          noise: this.worldManager.terrainNoise,
          biomeNoise: this.worldManager.biomeNoise,
          caveNoise: this.worldManager.caveNoise,
        });

        for (let z = 0; z < CHUNK_SIZE; z += 1) {
          for (let x = 0; x < CHUNK_SIZE; x += 1) {
            const columnIndex = getColumnIndex({ x: CHUNK_SIZE, y: CHUNK_HEIGHT, z: CHUNK_SIZE }, x, z);
            const y = terrain.surfaceHeights[columnIndex];
            const blockId = terrain.blocks[x + CHUNK_SIZE * (z + CHUNK_SIZE * y)];
            const aboveBlockId = terrain.blocks[x + CHUNK_SIZE * (z + CHUNK_SIZE * Math.min(CHUNK_HEIGHT - 1, y + 1))];

            if (blockId !== BLOCK_IDS.SNOW_MOUNTAIN || aboveBlockId !== BLOCK_IDS.AIR) {
              continue;
            }

            const position = new THREE.Vector3(
              chunkCoord.x * CHUNK_SIZE + (x - (CHUNK_SIZE - 1) / 2),
              y + 0.54,
              chunkCoord.z * CHUNK_SIZE + (z - (CHUNK_SIZE - 1) / 2),
            );
            const distance = position.distanceTo(playerPosition);

            if (!best || distance < best.distance) {
              best = {
                target: this.normalizeSnowLotusTarget({
                  position,
                  y,
                  record: null,
                  sprite: {
                    position,
                    scale: { y: 1.0 },
                  },
                }),
                distance,
              };
            }
          }
        }
      }
    }

    return best;
  }

  highlightSnowLotus(snowLotus) {
    this.finderBeacon.position.copy(snowLotus.sprite.position);
    this.finderBeacon.position.y += snowLotus.sprite.scale.y + 0.22;
    this.finderBeacon.visible = true;
  }

  formatFinderMessage(snowLotus, distance, playerPosition) {
    const dx = snowLotus.sprite.position.x - playerPosition.x;
    const dz = snowLotus.sprite.position.z - playerPosition.z;
    const direction = getDirectionLabel(dx, dz);
    const stage = snowLotus.record
      ? SNOW_LOTUS_GROWTH_STAGES[snowLotus.record.stageIndex]
      : { label: '峰顶候选' };

    return `${direction} ${Math.round(distance)}格 · ${stage.label} · 高${snowLotus.y}格`;
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
    group.name = `SnowLotusGrowth(${key})`;
    const state = {
      key,
      entity,
      group,
      snowLotuses: [],
      nextPropagationTime: this.elapsedTime + seededUnit(hashSnowLotusSeed(entity.chunkCoord, 0, 0), 3) * PROPAGATION_INTERVAL,
    };
    const candidates = this.createInitialCandidates(key, entity);

    for (const candidate of candidates) {
      this.addSnowLotusToChunkState(state, candidate);
    }

    this.scene.add(group);

    return state;
  }

  createInitialCandidates(chunkKey, entity) {
    const candidatesByKey = new Map();

    for (let z = 1; z < entity.chunk.size.z - 1; z += COLUMN_SCAN_STEP) {
      for (let x = 1; x < entity.chunk.size.x - 1; x += COLUMN_SCAN_STEP) {
        const candidate = this.createSnowLotusCandidate(chunkKey, entity, x, z);

        if (candidate) {
          candidatesByKey.set(candidate.key, candidate);
        }
      }
    }

    for (const candidate of this.createPeakSnowLotusCandidates(chunkKey, entity)) {
      candidatesByKey.set(candidate.key, candidate);
    }

    return [...candidatesByKey.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_INITIAL_SNOW_LOTUSES_PER_CHUNK);
  }

  createPeakSnowLotusCandidates(chunkKey, entity) {
    const peakColumns = [];

    for (let z = 0; z < entity.chunk.size.z; z += 1) {
      for (let x = 0; x < entity.chunk.size.x; x += 1) {
        const surfaceY = entity.surfaceHeights[entity.chunk.getColumnIndex(x, z)];
        const surfaceBlockId = entity.chunk.getBlock(x, surfaceY, z);
        const aboveBlockId = entity.chunk.getBlock(x, surfaceY + 1, z);

        if (surfaceBlockId !== BLOCK_IDS.SNOW_MOUNTAIN || aboveBlockId !== BLOCK_IDS.AIR) {
          continue;
        }

        peakColumns.push({ x, z, surfaceY });
      }
    }

    return peakColumns
      .sort((a, b) => b.surfaceY - a.surfaceY || Math.abs(a.x - 7.5) + Math.abs(a.z - 7.5) - (Math.abs(b.x - 7.5) + Math.abs(b.z - 7.5)))
      .slice(0, FORCED_PEAK_SNOW_LOTUSES_PER_CHUNK)
      .map(({ x, z }) => this.createSnowLotusCandidate(chunkKey, entity, x, z, { force: true, peak: true }))
      .filter(Boolean);
  }

  createSnowLotusCandidate(chunkKey, entity, x, z, options = {}) {
    if (x < 0 || x >= entity.chunk.size.x || z < 0 || z >= entity.chunk.size.z) {
      return null;
    }

    const surfaceY = entity.surfaceHeights[entity.chunk.getColumnIndex(x, z)];
    const surfaceBlockId = entity.chunk.getBlock(x, surfaceY, z);
    const aboveBlockId = entity.chunk.getBlock(x, surfaceY + 1, z);

    if (surfaceBlockId !== BLOCK_IDS.SNOW_MOUNTAIN || aboveBlockId !== BLOCK_IDS.AIR) {
      return null;
    }

    const seed = hashSnowLotusSeed(entity.chunkCoord, x, z);
    const environment = this.sampleEnvironment(entity, x, surfaceY, z, surfaceBlockId);
    const biologyDensity = 0.28 + (this.biologyState?.ecology?.vegetationActivity ?? 0.72) * 0.32;
    const chance = clamp01(SNOW_LOTUS_HOST_PROFILE.density * environment.suitability * biologyDensity * 1.8);

    if (!options.force && seededUnit(seed, 5) > chance) {
      return null;
    }

    return {
      key: `${chunkKey}:snowLotus:${x},${z}`,
      chunkKey,
      x,
      y: surfaceY,
      z,
      surfaceBlockId,
      seed,
      score: (options.peak ? 10 : 0) + chance + environment.suitability * 0.30 + seededUnit(seed, 11) * 0.20,
      environment,
      worldPosition: getWorldPosition(entity, x, surfaceY, z),
    };
  }

  sampleEnvironment(entity, x, y, z, surfaceBlockId) {
    if (surfaceBlockId !== BLOCK_IDS.SNOW_MOUNTAIN) {
      return {
        typeRejected: true,
        water: 0,
        daylight: 0,
        temperature: 0,
        temperatureCelsius: 0,
        humidity: 0,
        soilMoisture: 0,
        snowCoverage: 0,
        drainage: 0,
        altitudeScore: 0,
        waterDistance: Infinity,
        floweringWindow: false,
        germinationWindow: false,
        stress: 1,
        suitability: 0,
      };
    }

    const dayOfYear = this.timeState?.dayOfYear ?? 206;
    const seasonId = this.biologyState?.seasonId ?? 'summer';
    const weatherOffset = WEATHER_TEMPERATURE_OFFSET_C[this.weatherId] ?? 0;
    const weatherMoistureOffset = WEATHER_MOISTURE_OFFSET[this.weatherId] ?? 0;
    const daylight = getDaylightFactor(this.timeState);
    const isDay = daylight > 0.35;
    const altitudeM = estimateAltitudeM(y);
    const altitudeCooling = (altitudeM - 3000) / 260;
    const diurnalOffset = isDay ? 3.2 : -5.8;
    const snowCoverage = clamp01(
      (this.biologyState?.ecology?.snowCoverage ?? 0.18) +
      (altitudeM > 3400 ? 0.18 : 0) +
      (this.weatherId === 'snow' ? 0.20 : 0),
    );
    const temperatureCelsius = (
      (SEASON_BASE_TEMPERATURE_C[seasonId] ?? SEASON_BASE_TEMPERATURE_C.summer) +
      weatherOffset +
      diurnalOffset -
      altitudeCooling -
      snowCoverage * 4
    );
    const waterSample = this.sampleWaterFactor(entity, x, y, z);
    const humidity = clamp01(
      (this.biologyState?.ecology?.moisture ?? 0.48) +
      weatherMoistureOffset +
      waterSample.water * 0.22 +
      snowCoverage * 0.12 -
      clamp01((temperatureCelsius - 16) / 12) * 0.18,
    );
    const springMelt = isGerminationWindow(dayOfYear) ? snowCoverage * 0.28 : snowCoverage * 0.08;
    const soilMoisture = clamp01(
      0.22 +
      waterSample.water * 0.36 +
      humidity * 0.28 +
      springMelt -
      SNOW_LOTUS_HOST_PROFILE.drainage * 0.08,
    );
    const waterScore = waterSample.waterDistance === 0
      ? 0.08
      : bandScore(waterSample.waterDistance, 1, 5, 0.72);
    const altitudeScore = bandScore(altitudeM, OPTIMAL_ALTITUDE_MIN_M, OPTIMAL_ALTITUDE_MAX_M, 0.62);
    const realAltitudeScore = bandScore(altitudeM, MIN_ALTITUDE_M, MAX_ALTITUDE_M, 0.35);
    const humidityScore = bandScore(humidity, 0.55, 0.86, 0.90);
    const soilMoistureScore = bandScore(soilMoisture, 0.42, 0.75, 0.75);
    const drainageScore = bandScore(SNOW_LOTUS_HOST_PROFILE.drainage, 0.58, 0.92, 0.65);
    const seasonScore = (seasonId === 'winter' || seasonId === 'autumn')
      ? 0.22
      : (isGerminationWindow(dayOfYear) || isFloweringWindow(dayOfYear) ? 1 : 0.74);
    const temperatureScore = bandScore(temperatureCelsius, -8, 16, 0.65);
    const suitability = clamp01(
      realAltitudeScore *
      (
        altitudeScore * 0.12 +
        waterScore * 0.14 +
        humidityScore * 0.14 +
        soilMoistureScore * 0.16 +
        daylight * 0.10 +
        drainageScore * 0.08 +
        seasonScore * 0.12 +
        temperatureScore * 0.14
      )
    );

    const droughtStress = clamp01(0.22 - Math.max(humidity, soilMoisture));
    const wetStress = clamp01(soilMoisture - 0.92) + (waterSample.waterDistance === 0 ? 0.40 : 0);
    const heatStress = clamp01((temperatureCelsius - 20) / 12);
    const coldStress = clamp01((-30 - temperatureCelsius) / 14);
    const altitudeStress = clamp01(1 - realAltitudeScore);

    return {
      typeRejected: false,
      water: waterSample.water,
      daylight,
      temperature: normalizeTemperature(temperatureCelsius),
      temperatureCelsius,
      humidity,
      soilMoisture,
      snowCoverage,
      drainage: SNOW_LOTUS_HOST_PROFILE.drainage,
      altitudeM,
      altitudeScore,
      waterDistance: waterSample.waterDistance,
      floweringWindow: isFloweringWindow(dayOfYear),
      germinationWindow: isGerminationWindow(dayOfYear),
      stress: clamp01(droughtStress + wetStress + heatStress + coldStress + altitudeStress),
      suitability,
    };
  }

  sampleWaterFactor(entity, localX, surfaceY, localZ) {
    let nearestDistance = Infinity;

    for (let z = localZ - WATER_SCAN_RADIUS; z <= localZ + WATER_SCAN_RADIUS; z += 1) {
      for (let x = localX - WATER_SCAN_RADIUS; x <= localX + WATER_SCAN_RADIUS; x += 1) {
        const distance = Math.hypot(x - localX, z - localZ);

        if (distance > WATER_SCAN_RADIUS) {
          continue;
        }

        const worldColumn = getWorldColumn(entity, x, z);

        for (let y = surfaceY - 2; y <= surfaceY + 1; y += 1) {
          const blockId = typeof this.worldManager.getBlockAtIfLoaded === 'function'
            ? this.worldManager.getBlockAtIfLoaded(worldColumn.x, y, worldColumn.z)
            : entity.chunk.getBlock(x, y, z);

          if (blockId === BLOCK_IDS.WATER) {
            nearestDistance = Math.min(nearestDistance, distance);
          }
        }
      }
    }

    if (nearestDistance !== Infinity) {
      return {
        water: clamp01(1 - nearestDistance / (WATER_SCAN_RADIUS + 1)),
        waterDistance: nearestDistance,
      };
    }

    return {
      water: clamp01((this.biologyState?.ecology?.moisture ?? 0.48) * 0.46),
      waterDistance: WATER_SCAN_RADIUS + 1,
    };
  }

  addSnowLotusToChunkState(state, candidate) {
    const record = this.getOrCreateSnowLotusRecord(candidate);
    const sprite = new THREE.Sprite(this.stageMaterials[record.stageIndex]);
    const snowLotus = {
      ...candidate,
      record,
      sprite,
      latestEnvironment: candidate.environment,
    };

    sprite.name = `SnowLotus:${SNOW_LOTUS_GROWTH_STAGES[record.stageIndex].id}`;
    sprite.center.set(0.5, 0);
    sprite.position.copy(candidate.worldPosition);
    sprite.userData.ecosystemInspectable = true;
    sprite.userData.getEcosystemState = () => this.getSnowLotusInspectionState(snowLotus);
    this.applySpriteScale(sprite, record);
    state.group.add(sprite);
    state.snowLotuses.push(snowLotus);
  }

  getSnowLotusInspectionState(snowLotus) {
    const stage = SNOW_LOTUS_GROWTH_STAGES[snowLotus.record.stageIndex];
    const environment = snowLotus.latestEnvironment ?? snowLotus.environment;

    return {
      type: 'snowLotus',
      title: '天山雪莲',
      stage: `${stage.label} · ${stage.effect}`,
      cycle: '6-8 年高山周期',
      cycleDay: Math.max(1, Math.round(snowLotus.record.ageDays)),
      cycleDays: Math.round(snowLotus.record.flowerReadyDays),
      cycleProgress: getAgeProgress(snowLotus.record),
      status: getEnvironmentStatus(snowLotus.record, environment),
      host: HOST_BLOCK_LABELS[snowLotus.surfaceBlockId] ?? '非雪山',
      growth: getAgeProgress(snowLotus.record),
      health: snowLotus.record.health,
      plantHeight: snowLotus.sprite.scale.y,
      water: environment.water,
      daylight: environment.daylight,
      temperature: environment.temperature,
      temperatureCelsius: environment.temperatureCelsius,
      humidity: environment.humidity,
      soilMoisture: environment.soilMoisture,
      snowCoverage: environment.snowCoverage,
      suitability: environment.suitability,
      stress: environment.stress,
    };
  }

  getOrCreateSnowLotusRecord(candidate) {
    if (this.snowLotusMemory.has(candidate.key)) {
      return this.snowLotusMemory.get(candidate.key);
    }

    const dayOfYear = this.timeState?.dayOfYear ?? 206;
    const flowerReadyDays = FLOWERING_MIN_DAYS + seededUnit(candidate.seed, 17) * (FLOWERING_MAX_DAYS - FLOWERING_MIN_DAYS);
    const initialAgeDays = seededUnit(candidate.seed, 23) ** 1.85 * (FLOWERING_MAX_DAYS + 120);
    const stageIndex = getInitialStageIndex(initialAgeDays, flowerReadyDays, dayOfYear, candidate.seed);
    const record = {
      key: candidate.key,
      seed: candidate.seed,
      ageDays: initialAgeDays,
      flowerReadyDays,
      stageProgress: clamp01(candidate.environment.suitability * 0.24 + seededUnit(candidate.seed, 29) * 0.22),
      health: clamp01(0.66 + candidate.environment.suitability * 0.28),
      vigor: 0.76 + seededUnit(candidate.seed, 31) * 0.34,
      stageIndex,
      lastPropagation: 0,
    };

    this.snowLotusMemory.set(candidate.key, record);

    return record;
  }

  updateChunkSnowLotuses(state, worldDays) {
    for (const snowLotus of state.snowLotuses) {
      const surfaceY = state.entity.surfaceHeights[state.entity.chunk.getColumnIndex(snowLotus.x, snowLotus.z)];
      const surfaceBlockId = state.entity.chunk.getBlock(snowLotus.x, surfaceY, snowLotus.z);
      const environment = this.sampleEnvironment(
        state.entity,
        snowLotus.x,
        surfaceY,
        snowLotus.z,
        surfaceBlockId,
      );

      snowLotus.y = surfaceY;
      snowLotus.surfaceBlockId = surfaceBlockId;
      snowLotus.latestEnvironment = environment;
      this.updateSnowLotusGrowth(snowLotus, environment, worldDays);
    }

    if (this.elapsedTime >= state.nextPropagationTime) {
      this.tryPropagateSnowLotuses(state);
      state.nextPropagationTime = this.elapsedTime + PROPAGATION_INTERVAL;
    }
  }

  updateSnowLotusGrowth(snowLotus, environment, worldDays) {
    const record = snowLotus.record;
    const stage = SNOW_LOTUS_GROWTH_STAGES[record.stageIndex];
    const effectiveDays = Math.max(0, worldDays);
    const healthDays = Math.min(effectiveDays, 8);

    if (stage.id === 'dead') {
      this.applySpriteScale(snowLotus.sprite, record);
      return;
    }

    if (environment.typeRejected) {
      record.health = 0;
      record.stageIndex = getStageIndexById('dead');
      this.applyStageMaterial(snowLotus);
      this.applySpriteScale(snowLotus.sprite, record);
      return;
    }

    const stageTemperatureBand = STAGE_TEMPERATURE_BANDS_C[stage.id] ?? STAGE_TEMPERATURE_BANDS_C.mature_rosette;
    const stageTemperatureScore = bandScore(
      environment.temperatureCelsius,
      stageTemperatureBand[0],
      stageTemperatureBand[1],
      0.62,
    );
    const germinationGate = stage.id === 'seed' ? (environment.germinationWindow ? 1 : 0.22) : 1;
    const floweringGate = ['bud', 'bloom', 'fruit'].includes(stage.id)
      ? (environment.floweringWindow ? 1 : 0.10)
      : 1;
    const growthPotential = (
      environment.suitability *
      stageTemperatureScore *
      germinationGate *
      floweringGate *
      record.vigor
    );
    const stressPenalty = environment.stress * (1.08 - environment.snowCoverage * 0.18);
    const healthDelta = (growthPotential * HEALTH_RECOVERY_RATE - stressPenalty * HEALTH_STRESS_RATE) * healthDays;

    record.ageDays += effectiveDays;
    record.health = clamp01(record.health + healthDelta);

    if (record.health <= 0.06 || environment.temperatureCelsius > 25 || environment.temperatureCelsius < -38) {
      record.stageIndex = getStageIndexById('dead');
      record.stageProgress = 1;
      this.applyStageMaterial(snowLotus);
      this.applySpriteScale(snowLotus.sprite, record);
      return;
    }

    if (record.health > 0.20) {
      record.stageProgress = clamp01(
        record.stageProgress +
        effectiveDays *
        (STAGE_DAILY_PROGRESS[stage.id] ?? 0.01) *
        clamp01(growthPotential) *
        (0.64 + record.health * 0.36),
      );
    } else {
      record.stageProgress = clamp01(record.stageProgress - effectiveDays * environment.stress * 0.010);
    }

    this.tryAdvanceStage(snowLotus, environment, effectiveDays);
    this.applySpriteScale(snowLotus.sprite, record);
  }

  tryAdvanceStage(snowLotus, environment, worldDays) {
    const record = snowLotus.record;
    const stage = SNOW_LOTUS_GROWTH_STAGES[record.stageIndex];
    const nextStage = SNOW_LOTUS_GROWTH_STAGES[record.stageIndex + 1];

    if (!nextStage || record.stageProgress < 1) {
      return;
    }

    if (nextStage.id === 'bud' && (record.ageDays < record.flowerReadyDays || !environment.floweringWindow)) {
      return;
    }

    if (['bloom', 'fruit'].includes(nextStage.id) && !environment.floweringWindow) {
      return;
    }

    if (nextStage.id !== 'bud' && record.ageDays < nextStage.minAgeDays) {
      return;
    }

    const chance = getStageAdvanceProbability(record, environment, worldDays, this.tickSerial);

    if (seededUnit(record.seed, this.tickSerial + record.stageIndex * 97) > chance) {
      return;
    }

    record.stageIndex += 1;
    record.stageProgress = 0;
    this.applyStageMaterial(snowLotus);

    if (stage.id === 'fruit') {
      record.lastPropagation = Math.min(record.lastPropagation, this.elapsedTime - PROPAGATION_INTERVAL);
    }
  }

  applyStageMaterial(snowLotus) {
    snowLotus.sprite.material = this.stageMaterials[snowLotus.record.stageIndex];
    snowLotus.sprite.name = `SnowLotus:${SNOW_LOTUS_GROWTH_STAGES[snowLotus.record.stageIndex].id}`;
  }

  applySpriteScale(sprite, record) {
    const stage = SNOW_LOTUS_GROWTH_STAGES[record.stageIndex];
    const healthScale = 0.74 + record.health * 0.26;
    const width = stage.scale * (0.82 + record.vigor * 0.12) * healthScale;
    const height = stage.scale * 1.20 * healthScale;

    sprite.scale.set(width, height, 1);
  }

  tryPropagateSnowLotuses(state) {
    const fruitingPlants = state.snowLotuses.filter((snowLotus) => (
      snowLotus.record.stageIndex === getStageIndexById('fruit') &&
      snowLotus.record.health > 0.52
    ));

    for (const snowLotus of fruitingPlants) {
      if (this.elapsedTime - snowLotus.record.lastPropagation < PROPAGATION_INTERVAL * 2) {
        continue;
      }

      const environment = this.sampleEnvironment(
        state.entity,
        snowLotus.x,
        snowLotus.y,
        snowLotus.z,
        snowLotus.surfaceBlockId,
      );
      const chance = PROPAGATION_CHANCE * environment.suitability * snowLotus.record.health;

      if (seededUnit(snowLotus.seed, Math.floor(this.elapsedTime / PROPAGATION_INTERVAL) + 101) > chance) {
        continue;
      }

      snowLotus.record.lastPropagation = this.elapsedTime;
      this.spawnNearbySeed(state, snowLotus);
    }
  }

  spawnNearbySeed(state, snowLotus) {
    const angle = seededUnit(snowLotus.seed, Math.floor(this.elapsedTime) + 211) * Math.PI * 2;
    const distance = 1 + Math.floor(seededUnit(snowLotus.seed, Math.floor(this.elapsedTime) + 223) * 3);
    const x = Math.round(snowLotus.x + Math.cos(angle) * distance);
    const z = Math.round(snowLotus.z + Math.sin(angle) * distance);
    const candidate = this.createSnowLotusCandidate(state.key, state.entity, x, z, { force: true });

    if (!candidate || state.snowLotuses.some((existing) => existing.x === candidate.x && existing.z === candidate.z)) {
      return;
    }

    if (candidate.environment.suitability < 0.52 || candidate.environment.waterDistance === 0) {
      return;
    }

    const record = {
      key: candidate.key,
      seed: candidate.seed,
      ageDays: 0,
      flowerReadyDays: FLOWERING_MIN_DAYS + seededUnit(candidate.seed, 17) * (FLOWERING_MAX_DAYS - FLOWERING_MIN_DAYS),
      stageProgress: 0,
      health: 0.72,
      vigor: 0.76 + seededUnit(candidate.seed, 31) * 0.34,
      stageIndex: 0,
      lastPropagation: 0,
    };

    this.snowLotusMemory.set(candidate.key, record);
    this.addSnowLotusToChunkState(state, candidate);
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
    this.scene.remove(this.finderBeacon);
    this.finderBeacon.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose?.();
      }

      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose?.());
        } else {
          object.material.dispose?.();
        }
      }
    });
    this.stageMaterials.forEach((material) => material.dispose());
    this.stageTextures.forEach((texture) => texture.dispose());
    this.snowLotusMemory.clear();
  }
}
