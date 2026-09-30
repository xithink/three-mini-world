import * as THREE from 'three';
import { BLOCK_IDS } from '../chunk.js';
import { DAYS_PER_YEAR, SECONDS_PER_YEAR_DAY } from './timeSystem.js';

export const ROSE_GROWTH_STAGES = Object.freeze([
  { id: 'seedling', label: '幼苗', texture: '/assets/textwaterroseyoumiao.png', threshold: 0, scale: 0.42 },
  { id: 'bud', label: '花苞', texture: '/assets/textwaterrosehuabao.png', threshold: 0.30, scale: 0.62 },
  { id: 'bloom', label: '绽放', texture: '/assets/textwaterrosezhanfang.png', threshold: 0.62, scale: 0.82 },
  { id: 'wilt', label: '凋零', texture: '/assets/textwaterrosediaoling.png', threshold: 0.92, scale: 0.72 },
]);

const ROSE_HOST_PROFILES = new Map([
  [BLOCK_IDS.FOREST_MOUNTAIN, { soil: 0.92, density: 0.24, coldHardiness: 0.52 }],
  [BLOCK_IDS.SNOW_MOUNTAIN, { soil: 0.58, density: 0.13, coldHardiness: 0.86 }],
]);
const DAYLIGHT_STAGE_FACTORS = Object.freeze({
  preDawn: 0.18,
  dawn: 0.50,
  morning: 0.92,
  noon: 1,
  afternoon: 0.88,
  dusk: 0.36,
  night: 0.08,
});
const SEASON_TEMPERATURE = Object.freeze({
  spring: 0.62,
  summer: 0.78,
  autumn: 0.50,
  winter: 0.22,
});
const WEATHER_TEMPERATURE_OFFSET = Object.freeze({
  clear: 0.04,
  rain: -0.05,
  snow: -0.18,
  aurora: -0.08,
});
const WEATHER_MOISTURE_OFFSET = Object.freeze({
  clear: -0.03,
  rain: 0.30,
  snow: 0.14,
  aurora: 0.02,
});
const COLUMN_SCAN_STEP = 2;
const MAX_INITIAL_ROSES_PER_CHUNK = 10;
const WATER_SCAN_RADIUS = 5;
const ROSE_LIFECYCLE_DAYS = DAYS_PER_YEAR;
const MIN_DAILY_GROWTH_FACTOR = 0.86;
const HEALTH_RECOVERY_RATE = 0.044;
const HEALTH_STRESS_RATE = 0.036;
const PROPAGATION_INTERVAL = 5.5;
const PROPAGATION_CHANCE = 0.045;
const HOST_BLOCK_LABELS = Object.freeze({
  [BLOCK_IDS.SNOW_MOUNTAIN]: '雪山',
  [BLOCK_IDS.FOREST_MOUNTAIN]: '森林高山',
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hashRoseSeed(chunkCoord, x, z, salt = 0) {
  let hash = Math.imul(chunkCoord.x + 0x632be59b + salt, 0x85157af5);
  hash ^= Math.imul(chunkCoord.z + 0x9e3779b9 - salt, 0x94d049bb);
  hash ^= Math.imul(x + 0x27d4eb2d + salt * 19, 0x165667b1);
  hash ^= Math.imul(z + 0x7f4a7c15 - salt * 29, 0xd3a2646c);
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

function getStageIndexForGrowth(growth) {
  let stageIndex = 0;

  for (let index = 0; index < ROSE_GROWTH_STAGES.length; index += 1) {
    if (growth >= ROSE_GROWTH_STAGES[index].threshold) {
      stageIndex = index;
    }
  }

  return stageIndex;
}

function getEnvironmentStatus(record, environment) {
  if (record.stageIndex === ROSE_GROWTH_STAGES.length - 1) {
    return '凋零';
  }

  if (record.health < 0.34 || environment.stress > 0.68) {
    return '受压';
  }

  if (environment.suitability >= 0.70 && record.health >= 0.70) {
    return '盛放条件';
  }

  if (environment.suitability >= 0.48) {
    return '稳定';
  }

  return '缓慢';
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

function getDaylightFactor(timeState) {
  const stageFactor = DAYLIGHT_STAGE_FACTORS[timeState?.stage?.id] ?? 0.72;
  const daylightHours = timeState?.solarProfile?.daylightHours ?? 12;
  const seasonalDaylight = clamp01((daylightHours - 7) / 8);

  return clamp01(stageFactor * (0.78 + seasonalDaylight * 0.22));
}

function getTemperatureFactor(biologyState, weatherId, hostProfile) {
  const seasonId = biologyState?.seasonId ?? 'summer';
  const base = SEASON_TEMPERATURE[seasonId] ?? SEASON_TEMPERATURE.summer;
  const weatherOffset = WEATHER_TEMPERATURE_OFFSET[weatherId] ?? 0;
  const snowPenalty = (biologyState?.ecology?.snowCoverage ?? 0) * (0.26 * (1 - hostProfile.coldHardiness));

  return clamp01(base + weatherOffset - snowPenalty + hostProfile.coldHardiness * 0.10);
}

function getHumidityFactor(biologyState, weatherId) {
  const moisture = biologyState?.ecology?.moisture ?? 0.48;
  const weatherOffset = WEATHER_MOISTURE_OFFSET[weatherId] ?? 0;

  return clamp01(moisture + weatherOffset);
}

export class RoseGrowthSystem {
  constructor({ scene, eventBus, worldManager }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.worldManager = worldManager;
    this.chunkStates = new Map();
    this.roseMemory = new Map();
    this.elapsedTime = 0;
    this.timeState = null;
    this.lastWorldDayScalar = null;
    this.pendingWorldDays = 0;
    this.biologyState = null;
    this.weatherId = 'clear';
    this.stageTextures = ROSE_GROWTH_STAGES.map((stage) => this.createTexture(stage.texture));
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
    ];
  }

  createTexture(url) {
    const texture = new THREE.TextureLoader().load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapNearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    return texture;
  }

  update(deltaTime) {
    this.elapsedTime += deltaTime;
    const worldDays = this.consumeWorldDays(deltaTime);
    this.syncLoadedChunks();

    for (const state of this.chunkStates.values()) {
      this.updateChunkRoses(state, worldDays);
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
    group.name = `RoseGrowth(${key})`;
    const state = {
      key,
      entity,
      group,
      roses: [],
      nextPropagationTime: this.elapsedTime + seededUnit(hashRoseSeed(entity.chunkCoord, 0, 0), 3) * PROPAGATION_INTERVAL,
    };
    const candidates = this.createInitialCandidates(key, entity);

    for (const candidate of candidates) {
      this.addRoseToChunkState(state, candidate);
    }

    this.scene.add(group);

    return state;
  }

  createInitialCandidates(chunkKey, entity) {
    const candidates = [];

    for (let z = 1; z < entity.chunk.size.z - 1; z += COLUMN_SCAN_STEP) {
      for (let x = 1; x < entity.chunk.size.x - 1; x += COLUMN_SCAN_STEP) {
        const candidate = this.createRoseCandidate(chunkKey, entity, x, z);

        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_INITIAL_ROSES_PER_CHUNK);
  }

  createRoseCandidate(chunkKey, entity, x, z) {
    if (x < 1 || x >= entity.chunk.size.x - 1 || z < 1 || z >= entity.chunk.size.z - 1) {
      return null;
    }

    const surfaceY = entity.surfaceHeights[entity.chunk.getColumnIndex(x, z)];
    const surfaceBlockId = entity.chunk.getBlock(x, surfaceY, z);
    const aboveBlockId = entity.chunk.getBlock(x, surfaceY + 1, z);
    const hostProfile = ROSE_HOST_PROFILES.get(surfaceBlockId);

    if (!hostProfile || aboveBlockId !== BLOCK_IDS.AIR) {
      return null;
    }

    const seed = hashRoseSeed(entity.chunkCoord, x, z);
    const environment = this.sampleEnvironment(entity, x, surfaceY, z, surfaceBlockId);
    const biologyDensity = 0.35 + (this.biologyState?.ecology?.vegetationActivity ?? 0.72) * 0.55;
    const chance = clamp01(hostProfile.density * environment.suitability * biologyDensity);

    if (seededUnit(seed, 5) > chance) {
      return null;
    }

    return {
      key: `${chunkKey}:rose:${x},${z}`,
      chunkKey,
      x,
      y: surfaceY,
      z,
      surfaceBlockId,
      seed,
      score: chance + seededUnit(seed, 11) * 0.24,
      environment,
      worldPosition: getWorldPosition(entity, x, surfaceY, z),
    };
  }

  sampleEnvironment(entity, x, y, z, surfaceBlockId) {
    const hostProfile = ROSE_HOST_PROFILES.get(surfaceBlockId) ?? ROSE_HOST_PROFILES.get(BLOCK_IDS.FOREST_MOUNTAIN);
    const soil = hostProfile.soil;
    const water = this.sampleWaterFactor(entity, x, y, z);
    const daylight = getDaylightFactor(this.timeState);
    const temperature = getTemperatureFactor(this.biologyState, this.weatherId, hostProfile);
    const humidity = getHumidityFactor(this.biologyState, this.weatherId);
    const vegetation = this.biologyState?.ecology?.vegetationActivity ?? 0.72;
    const snowCoverage = this.biologyState?.ecology?.snowCoverage ?? 0;
    const waterSuitability = 1 - Math.abs(Math.max(water, humidity) - 0.66) / 0.66;
    const temperatureSuitability = 1 - Math.abs(temperature - 0.58) / 0.58;
    const droughtStress = clamp01(0.42 - Math.max(water, humidity));
    const heatStress = clamp01(temperature - 0.88);
    const coldStress = clamp01((0.34 - temperature) * (1 - hostProfile.coldHardiness * 0.72));
    const snowStress = clamp01((snowCoverage - 0.62) * (1 - hostProfile.coldHardiness * 0.58));
    const suitability = clamp01(
      soil * 0.20 +
      clamp01(waterSuitability) * 0.24 +
      daylight * 0.18 +
      clamp01(temperatureSuitability) * 0.22 +
      vegetation * 0.16 -
      droughtStress * 0.16 -
      heatStress * 0.16 -
      coldStress * 0.14 -
      snowStress * 0.12,
    );

    return {
      soil,
      water,
      daylight,
      temperature,
      humidity,
      vegetation,
      stress: clamp01(droughtStress + heatStress + coldStress + snowStress),
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

        for (let y = surfaceY - 1; y <= surfaceY + 1; y += 1) {
          const blockId = this.worldManager.getBlockAtIfLoaded(worldColumn.x, y, worldColumn.z);

          if (blockId === BLOCK_IDS.WATER) {
            nearestDistance = Math.min(nearestDistance, distance);
          }
        }
      }
    }

    if (nearestDistance !== Infinity) {
      return clamp01(1 - nearestDistance / (WATER_SCAN_RADIUS + 1));
    }

    return clamp01((this.biologyState?.ecology?.moisture ?? 0.48) * 0.64);
  }

  addRoseToChunkState(state, candidate) {
    const record = this.getOrCreateRoseRecord(candidate);
    const sprite = new THREE.Sprite(this.stageMaterials[record.stageIndex]);
    const rose = {
      ...candidate,
      record,
      sprite,
      latestEnvironment: candidate.environment,
    };

    sprite.name = `Rose:${ROSE_GROWTH_STAGES[record.stageIndex].id}`;
    sprite.center.set(0.5, 0);
    sprite.position.copy(candidate.worldPosition);
    sprite.userData.ecosystemInspectable = true;
    sprite.userData.getEcosystemState = () => this.getRoseInspectionState(rose);
    this.applySpriteScale(sprite, record);
    state.group.add(sprite);
    state.roses.push(rose);
  }

  getRoseInspectionState(rose) {
    const stage = ROSE_GROWTH_STAGES[rose.record.stageIndex];
    const environment = rose.latestEnvironment ?? rose.environment;
    const cycleDay = Math.max(1, Math.min(ROSE_LIFECYCLE_DAYS, Math.round(rose.record.growth * ROSE_LIFECYCLE_DAYS)));

    return {
      type: 'rose',
      title: '玫瑰花',
      stage: stage.label,
      cycle: '1年花期',
      cycleDay,
      cycleDays: ROSE_LIFECYCLE_DAYS,
      cycleProgress: rose.record.growth,
      status: getEnvironmentStatus(rose.record, environment),
      host: HOST_BLOCK_LABELS[rose.surfaceBlockId] ?? '未知地表',
      growth: rose.record.growth,
      health: rose.record.health,
      plantHeight: rose.sprite.scale.y,
      water: environment.water,
      daylight: environment.daylight,
      temperature: environment.temperature,
      humidity: environment.humidity,
      suitability: environment.suitability,
      stress: environment.stress,
    };
  }

  getOrCreateRoseRecord(candidate) {
    if (this.roseMemory.has(candidate.key)) {
      return this.roseMemory.get(candidate.key);
    }

    const growth = clamp01(
      seededUnit(candidate.seed, 17) * 0.015 +
      candidate.environment.suitability * 0.025,
    );
    const record = {
      key: candidate.key,
      growth,
      health: clamp01(0.70 + candidate.environment.suitability * 0.24),
      vigor: 0.78 + seededUnit(candidate.seed, 23) * 0.36,
      stageIndex: getStageIndexForGrowth(growth),
      lastPropagation: 0,
    };

    this.roseMemory.set(candidate.key, record);

    return record;
  }

  updateChunkRoses(state, worldDays) {
    for (const rose of state.roses) {
      const environment = this.sampleEnvironment(
        state.entity,
        rose.x,
        rose.y,
        rose.z,
        rose.surfaceBlockId,
      );

      rose.latestEnvironment = environment;
      this.updateRoseGrowth(rose, environment, worldDays);
    }

    if (this.elapsedTime >= state.nextPropagationTime) {
      this.tryPropagateRoses(state);
      state.nextPropagationTime = this.elapsedTime + PROPAGATION_INTERVAL;
    }
  }

  updateRoseGrowth(rose, environment, worldDays) {
    const record = rose.record;
    const effectiveDays = Math.max(0, worldDays);
    const healthDays = Math.min(effectiveDays, 8);
    const weatherNoise = 0.82 + seededUnit(rose.seed, Math.floor((this.timeState?.dayOfYear ?? this.elapsedTime) * 2) + 37) * 0.36;
    const daylightBoost = 0.22 + environment.daylight * 0.78;
    const moistureBoost = 0.35 + Math.max(environment.water, environment.humidity) * 0.65;
    const growthPotential = environment.suitability * daylightBoost * moistureBoost * record.vigor * weatherNoise;
    const stressPenalty = environment.stress * (1.08 - environment.water * 0.34);
    const healthDelta = (growthPotential * HEALTH_RECOVERY_RATE - stressPenalty * HEALTH_STRESS_RATE) * healthDays;

    record.health = clamp01(record.health + healthDelta);

    if (record.health > 0.20) {
      const lifecycleFactor = MIN_DAILY_GROWTH_FACTOR + clamp01(growthPotential) * 0.28;
      const healthFactor = 0.84 + record.health * 0.16;
      const growthDelta = (effectiveDays / ROSE_LIFECYCLE_DAYS) * lifecycleFactor * healthFactor;
      record.growth = clamp01(record.growth + growthDelta);
    } else {
      record.growth = clamp01(record.growth + (effectiveDays / ROSE_LIFECYCLE_DAYS) * 0.16);
    }

    if (environment.stress > 0.72 && record.growth >= ROSE_GROWTH_STAGES[2].threshold) {
      record.growth = clamp01(record.growth + (effectiveDays / ROSE_LIFECYCLE_DAYS) * environment.stress * 0.45);
    }

    const nextStageIndex = getStageIndexForGrowth(record.growth);

    if (nextStageIndex !== record.stageIndex) {
      record.stageIndex = nextStageIndex;
      rose.sprite.material = this.stageMaterials[nextStageIndex];
      rose.sprite.name = `Rose:${ROSE_GROWTH_STAGES[nextStageIndex].id}`;
    }

    this.applySpriteScale(rose.sprite, record);
  }

  applySpriteScale(sprite, record) {
    const stage = ROSE_GROWTH_STAGES[record.stageIndex];
    const healthScale = 0.78 + record.health * 0.22;
    const width = stage.scale * (0.78 + record.vigor * 0.12) * healthScale;
    const height = stage.scale * 1.22 * healthScale;

    sprite.scale.set(width, height, 1);
  }

  tryPropagateRoses(state) {
    const bloomingRoses = state.roses.filter((rose) => rose.record.stageIndex === 2 && rose.record.health > 0.62);

    for (const rose of bloomingRoses) {
      if (this.elapsedTime - rose.record.lastPropagation < PROPAGATION_INTERVAL * 2) {
        continue;
      }

      const environment = this.sampleEnvironment(state.entity, rose.x, rose.y, rose.z, rose.surfaceBlockId);
      const chance = PROPAGATION_CHANCE * environment.suitability * rose.record.health;

      if (seededUnit(rose.seed, Math.floor(this.elapsedTime / PROPAGATION_INTERVAL) + 101) > chance) {
        continue;
      }

      rose.record.lastPropagation = this.elapsedTime;
      this.spawnNearbySeedling(state, rose);
    }
  }

  spawnNearbySeedling(state, rose) {
    const angle = seededUnit(rose.seed, Math.floor(this.elapsedTime) + 211) * Math.PI * 2;
    const distance = 1 + Math.floor(seededUnit(rose.seed, Math.floor(this.elapsedTime) + 223) * 3);
    const x = Math.round(rose.x + Math.cos(angle) * distance);
    const z = Math.round(rose.z + Math.sin(angle) * distance);
    const candidate = this.createRoseCandidate(state.key, state.entity, x, z);

    if (!candidate || state.roses.some((existing) => existing.x === candidate.x && existing.z === candidate.z)) {
      return;
    }

    const record = {
      key: candidate.key,
      growth: 0,
      health: 0.76,
      vigor: 0.78 + seededUnit(candidate.seed, 23) * 0.36,
      stageIndex: 0,
      lastPropagation: 0,
    };

    this.roseMemory.set(candidate.key, record);
    this.addRoseToChunkState(state, candidate);
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
    this.stageMaterials.forEach((material) => material.dispose());
    this.stageTextures.forEach((texture) => texture.dispose());
    this.roseMemory.clear();
  }
}
