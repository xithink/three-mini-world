import * as THREE from 'three';
import { BLOCK_IDS } from '../chunk.js';
import { DAYS_PER_YEAR, SECONDS_PER_YEAR_DAY } from './timeSystem.js';

export const TULIP_GROWTH_STAGES = Object.freeze([
  { id: 'seedling', label: '幼苗', texture: '/assets/textwatertulipyoumiao.png', threshold: 0, scale: 0.42 },
  { id: 'bud', label: '花苞', texture: '/assets/textwatertuliphuabao.png', threshold: 0.22, scale: 0.60 },
  { id: 'bloom', label: '绽放', texture: '/assets/textwatertulipzhanfang.png', threshold: 0.30, scale: 0.78 },
  { id: 'wilt', label: '凋零', texture: '/assets/textwatertulipdiaoling.png', threshold: 0.40, scale: 0.68 },
]);

const TULIP_HOST_PROFILES = new Map([
  [BLOCK_IDS.FOREST_MOUNTAIN, { soil: 0.84, density: 0.18, drainage: 0.86, coldReserve: 0.58 }],
  [BLOCK_IDS.SNOW_MOUNTAIN, { soil: 0.54, density: 0.16, drainage: 0.78, coldReserve: 0.90 }],
]);
const HOST_BLOCK_LABELS = Object.freeze({
  [BLOCK_IDS.FOREST_MOUNTAIN]: '森林高山',
  [BLOCK_IDS.SNOW_MOUNTAIN]: '雪山',
});
const DAYLIGHT_STAGE_FACTORS = Object.freeze({
  preDawn: 0.16,
  dawn: 0.48,
  morning: 0.94,
  noon: 1,
  afternoon: 0.88,
  dusk: 0.36,
  night: 0.08,
});
const SEASON_TEMPERATURE = Object.freeze({
  spring: 0.56,
  summer: 0.82,
  autumn: 0.46,
  winter: 0.18,
});
const WEATHER_TEMPERATURE_OFFSET = Object.freeze({
  clear: 0.04,
  rain: -0.05,
  snow: -0.16,
  aurora: -0.08,
});
const WEATHER_MOISTURE_OFFSET = Object.freeze({
  clear: -0.04,
  rain: 0.28,
  snow: 0.14,
  aurora: 0.02,
});
const COLUMN_SCAN_STEP = 2;
const MAX_INITIAL_TULIPS_PER_CHUNK = 9;
const WATER_SCAN_RADIUS = 5;
const TULIP_LIFECYCLE_DAYS = DAYS_PER_YEAR;
const HEALTH_RECOVERY_RATE = 0.038;
const HEALTH_STRESS_RATE = 0.044;
const PROPAGATION_INTERVAL = 7.5;
const PROPAGATION_CHANCE = 0.035;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hashTulipSeed(chunkCoord, x, z, salt = 0) {
  let hash = Math.imul(chunkCoord.x + 0x7f4a7c15 + salt, 0x94d049bb);
  hash ^= Math.imul(chunkCoord.z + 0x632be59b - salt, 0x85157af5);
  hash ^= Math.imul(x + 0x9e3779b9 + salt * 23, 0x165667b1);
  hash ^= Math.imul(z + 0x27d4eb2d - salt * 37, 0xd3a2646c);
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

  for (let index = 0; index < TULIP_GROWTH_STAGES.length; index += 1) {
    if (growth >= TULIP_GROWTH_STAGES[index].threshold) {
      stageIndex = index;
    }
  }

  return stageIndex;
}

function getSeasonWindowFactor(dayOfYear, stageIndex, coldUnits) {
  const isSpringBloomWindow = dayOfYear >= 58 && dayOfYear <= 145;
  const isFoliageRechargeWindow = dayOfYear > 120 && dayOfYear <= 185;
  const isWinterOrFallRootWindow = dayOfYear >= 285 || dayOfYear <= 70;

  if (stageIndex === 0) {
    return isWinterOrFallRootWindow || dayOfYear <= 115 ? 0.95 : 0.36;
  }

  if (stageIndex === 1 || stageIndex === 2) {
    return isSpringBloomWindow && coldUnits >= 0.55 ? 1 : 0.14;
  }

  return isFoliageRechargeWindow ? 0.86 : 0.48;
}

function getEnvironmentStatus(record, environment) {
  if (record.coldUnits < 0.40 && record.stageIndex < 2) {
    return '低温不足';
  }

  if (record.stageIndex === TULIP_GROWTH_STAGES.length - 1) {
    return environment.recharge > 0.52 ? '回养球根' : '凋零休眠';
  }

  if (record.health < 0.34 || environment.stress > 0.68) {
    return '受压';
  }

  if (record.stageIndex === 2 && environment.suitability >= 0.62) {
    return '春季盛放';
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

  return clamp01(stageFactor * (0.76 + seasonalDaylight * 0.24));
}

function getTemperatureFactor(biologyState, weatherId, hostProfile) {
  const seasonId = biologyState?.seasonId ?? 'summer';
  const base = SEASON_TEMPERATURE[seasonId] ?? SEASON_TEMPERATURE.spring;
  const weatherOffset = WEATHER_TEMPERATURE_OFFSET[weatherId] ?? 0;
  const snowPenalty = (biologyState?.ecology?.snowCoverage ?? 0) * (0.22 * (1 - hostProfile.coldReserve));

  return clamp01(base + weatherOffset - snowPenalty + hostProfile.coldReserve * 0.08);
}

function getHumidityFactor(biologyState, weatherId) {
  const moisture = biologyState?.ecology?.moisture ?? 0.48;
  const weatherOffset = WEATHER_MOISTURE_OFFSET[weatherId] ?? 0;

  return clamp01(moisture + weatherOffset);
}

function getInitialGrowthForDay(dayOfYear, seed) {
  const offset = (seededUnit(seed, 17) - 0.5) * 0.06;

  if (dayOfYear < 58) {
    return clamp01(0.04 + (dayOfYear / 58) * 0.16 + offset);
  }

  if (dayOfYear < 100) {
    return clamp01(0.20 + ((dayOfYear - 58) / 42) * 0.12 + offset);
  }

  if (dayOfYear < 145) {
    return clamp01(0.32 + ((dayOfYear - 100) / 45) * 0.10 + offset);
  }

  if (dayOfYear < 190) {
    return clamp01(0.42 + ((dayOfYear - 145) / 45) * 0.16 + offset);
  }

  return clamp01(0.58 + ((dayOfYear - 190) / 175) * 0.38 + offset);
}

export class TulipGrowthSystem {
  constructor({ scene, eventBus, worldManager }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.worldManager = worldManager;
    this.chunkStates = new Map();
    this.tulipMemory = new Map();
    this.elapsedTime = 0;
    this.timeState = null;
    this.lastWorldDayScalar = null;
    this.pendingWorldDays = 0;
    this.biologyState = null;
    this.weatherId = 'clear';
    this.stageTextures = TULIP_GROWTH_STAGES.map((stage) => this.createTexture(stage.texture));
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
      this.updateChunkTulips(state, worldDays);
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
    group.name = `TulipGrowth(${key})`;
    const state = {
      key,
      entity,
      group,
      tulips: [],
      nextPropagationTime: this.elapsedTime + seededUnit(hashTulipSeed(entity.chunkCoord, 0, 0), 3) * PROPAGATION_INTERVAL,
    };
    const candidates = this.createInitialCandidates(key, entity);

    for (const candidate of candidates) {
      this.addTulipToChunkState(state, candidate);
    }

    this.scene.add(group);

    return state;
  }

  createInitialCandidates(chunkKey, entity) {
    const candidates = [];

    for (let z = 1; z < entity.chunk.size.z - 1; z += COLUMN_SCAN_STEP) {
      for (let x = 1; x < entity.chunk.size.x - 1; x += COLUMN_SCAN_STEP) {
        const candidate = this.createTulipCandidate(chunkKey, entity, x, z);

        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_INITIAL_TULIPS_PER_CHUNK);
  }

  createTulipCandidate(chunkKey, entity, x, z) {
    if (x < 1 || x >= entity.chunk.size.x - 1 || z < 1 || z >= entity.chunk.size.z - 1) {
      return null;
    }

    const surfaceY = entity.surfaceHeights[entity.chunk.getColumnIndex(x, z)];
    const surfaceBlockId = entity.chunk.getBlock(x, surfaceY, z);
    const aboveBlockId = entity.chunk.getBlock(x, surfaceY + 1, z);
    const hostProfile = TULIP_HOST_PROFILES.get(surfaceBlockId);

    if (!hostProfile || aboveBlockId !== BLOCK_IDS.AIR) {
      return null;
    }

    const seed = hashTulipSeed(entity.chunkCoord, x, z);
    const environment = this.sampleEnvironment(entity, x, surfaceY, z, surfaceBlockId);
    const biologyDensity = 0.34 + (this.biologyState?.ecology?.vegetationActivity ?? 0.72) * 0.48;
    const chance = clamp01(hostProfile.density * environment.suitability * biologyDensity * 1.35);

    if (seededUnit(seed, 5) > chance) {
      return null;
    }

    return {
      key: `${chunkKey}:tulip:${x},${z}`,
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
    const hostProfile = TULIP_HOST_PROFILES.get(surfaceBlockId) ?? TULIP_HOST_PROFILES.get(BLOCK_IDS.FOREST_MOUNTAIN);
    const soil = hostProfile.soil;
    const water = this.sampleWaterFactor(entity, x, y, z);
    const daylight = getDaylightFactor(this.timeState);
    const temperature = getTemperatureFactor(this.biologyState, this.weatherId, hostProfile);
    const humidity = getHumidityFactor(this.biologyState, this.weatherId);
    const vegetation = this.biologyState?.ecology?.vegetationActivity ?? 0.72;
    const moisture = Math.max(water, humidity);
    const moistureSuitability = 1 - Math.abs(moisture - 0.58) / 0.58;
    const temperatureSuitability = 1 - Math.abs(temperature - 0.50) / 0.50;
    const droughtStress = clamp01(0.34 - moisture);
    const wetRotStress = clamp01(moisture - 0.86) * (1 - hostProfile.drainage * 0.55);
    const heatStress = clamp01(temperature - 0.78);
    const freezeStress = clamp01((0.12 - temperature) * 0.9);
    const recharge = clamp01(daylight * 0.45 + moisture * 0.25 + soil * 0.30);
    const suitability = clamp01(
      soil * 0.18 +
      hostProfile.drainage * 0.12 +
      clamp01(moistureSuitability) * 0.22 +
      clamp01(temperatureSuitability) * 0.24 +
      daylight * 0.14 +
      vegetation * 0.10 -
      droughtStress * 0.14 -
      wetRotStress * 0.18 -
      heatStress * 0.20 -
      freezeStress * 0.12,
    );

    return {
      soil,
      water,
      daylight,
      temperature,
      humidity,
      vegetation,
      recharge,
      stress: clamp01(droughtStress + wetRotStress + heatStress + freezeStress),
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

    return clamp01((this.biologyState?.ecology?.moisture ?? 0.48) * 0.62);
  }

  addTulipToChunkState(state, candidate) {
    const record = this.getOrCreateTulipRecord(candidate);
    const sprite = new THREE.Sprite(this.stageMaterials[record.stageIndex]);
    const tulip = {
      ...candidate,
      record,
      sprite,
      latestEnvironment: candidate.environment,
    };

    sprite.name = `Tulip:${TULIP_GROWTH_STAGES[record.stageIndex].id}`;
    sprite.center.set(0.5, 0);
    sprite.position.copy(candidate.worldPosition);
    sprite.userData.ecosystemInspectable = true;
    sprite.userData.getEcosystemState = () => this.getTulipInspectionState(tulip);
    this.applySpriteScale(sprite, record);
    state.group.add(sprite);
    state.tulips.push(tulip);
  }

  getTulipInspectionState(tulip) {
    const stage = TULIP_GROWTH_STAGES[tulip.record.stageIndex];
    const environment = tulip.latestEnvironment ?? tulip.environment;
    const cycleDay = Math.max(1, Math.min(TULIP_LIFECYCLE_DAYS, Math.round(tulip.record.growth * TULIP_LIFECYCLE_DAYS)));

    return {
      type: 'tulip',
      title: '郁金香',
      stage: stage.label,
      cycle: '1年球根周期',
      cycleDay,
      cycleDays: TULIP_LIFECYCLE_DAYS,
      cycleProgress: tulip.record.growth,
      status: getEnvironmentStatus(tulip.record, environment),
      host: HOST_BLOCK_LABELS[tulip.surfaceBlockId] ?? '未知地表',
      growth: tulip.record.growth,
      health: tulip.record.health,
      plantHeight: tulip.sprite.scale.y,
      water: environment.water,
      daylight: environment.daylight,
      temperature: environment.temperature,
      humidity: environment.humidity,
      suitability: environment.suitability,
      stress: environment.stress,
    };
  }

  getOrCreateTulipRecord(candidate) {
    if (this.tulipMemory.has(candidate.key)) {
      return this.tulipMemory.get(candidate.key);
    }

    const dayOfYear = this.timeState?.dayOfYear ?? 95;
    const growth = getInitialGrowthForDay(dayOfYear, candidate.seed);
    const record = {
      key: candidate.key,
      growth,
      coldUnits: clamp01(candidate.environment.soil * 0.18 + (dayOfYear < 172 ? 0.74 : 0.52)),
      health: clamp01(0.70 + candidate.environment.suitability * 0.22),
      vigor: 0.76 + seededUnit(candidate.seed, 23) * 0.32,
      stageIndex: getStageIndexForGrowth(growth),
      lastPropagation: 0,
    };

    this.tulipMemory.set(candidate.key, record);

    return record;
  }

  updateChunkTulips(state, worldDays) {
    for (const tulip of state.tulips) {
      const environment = this.sampleEnvironment(
        state.entity,
        tulip.x,
        tulip.y,
        tulip.z,
        tulip.surfaceBlockId,
      );

      tulip.latestEnvironment = environment;
      this.updateTulipGrowth(tulip, environment, worldDays);
    }

    if (this.elapsedTime >= state.nextPropagationTime) {
      this.tryPropagateTulips(state);
      state.nextPropagationTime = this.elapsedTime + PROPAGATION_INTERVAL;
    }
  }

  updateTulipGrowth(tulip, environment, worldDays) {
    const record = tulip.record;
    const effectiveDays = Math.max(0, worldDays);
    const healthDays = Math.min(effectiveDays, 8);
    const dayOfYear = this.timeState?.dayOfYear ?? 95;
    const hostProfile = TULIP_HOST_PROFILES.get(tulip.surfaceBlockId) ?? TULIP_HOST_PROFILES.get(BLOCK_IDS.FOREST_MOUNTAIN);
    const coldGain = (environment.temperature < 0.38 || dayOfYear >= 300 || dayOfYear <= 60) ? effectiveDays / 98 : 0;
    const coldLoss = environment.temperature > 0.72 ? effectiveDays / 260 : 0;
    const phaseFactor = getSeasonWindowFactor(dayOfYear, record.stageIndex, record.coldUnits);
    const coldFactor = 0.38 + record.coldUnits * 0.62;
    const moistureBoost = 0.42 + Math.max(environment.water, environment.humidity) * 0.58;
    const growthPotential = environment.suitability * phaseFactor * coldFactor * moistureBoost * record.vigor;
    const stressPenalty = environment.stress * (1.08 - hostProfile.drainage * 0.22);
    const healthDelta = (growthPotential * HEALTH_RECOVERY_RATE - stressPenalty * HEALTH_STRESS_RATE) * healthDays;

    record.coldUnits = clamp01(record.coldUnits + coldGain - coldLoss);
    record.health = clamp01(record.health + healthDelta);

    if (record.health > 0.22) {
      const growthDelta = (effectiveDays / TULIP_LIFECYCLE_DAYS) * (0.58 + clamp01(growthPotential) * 0.52);
      record.growth += growthDelta;
    } else {
      record.growth += (effectiveDays / TULIP_LIFECYCLE_DAYS) * 0.18;
    }

    if (record.growth >= 1) {
      record.growth %= 1;
      record.coldUnits = clamp01(record.coldUnits * 0.45);
    }

    const nextStageIndex = getStageIndexForGrowth(record.growth);

    if (nextStageIndex !== record.stageIndex) {
      record.stageIndex = nextStageIndex;
      tulip.sprite.material = this.stageMaterials[nextStageIndex];
      tulip.sprite.name = `Tulip:${TULIP_GROWTH_STAGES[nextStageIndex].id}`;
    }

    this.applySpriteScale(tulip.sprite, record);
  }

  applySpriteScale(sprite, record) {
    const stage = TULIP_GROWTH_STAGES[record.stageIndex];
    const healthScale = 0.78 + record.health * 0.22;
    const width = stage.scale * (0.80 + record.vigor * 0.12) * healthScale;
    const height = stage.scale * 1.24 * healthScale;

    sprite.scale.set(width, height, 1);
  }

  tryPropagateTulips(state) {
    const rechargeTulips = state.tulips.filter((tulip) => tulip.record.stageIndex === 3 && tulip.record.health > 0.58);

    for (const tulip of rechargeTulips) {
      if (this.elapsedTime - tulip.record.lastPropagation < PROPAGATION_INTERVAL * 2) {
        continue;
      }

      const environment = this.sampleEnvironment(state.entity, tulip.x, tulip.y, tulip.z, tulip.surfaceBlockId);
      const chance = PROPAGATION_CHANCE * environment.suitability * environment.recharge * tulip.record.health;

      if (seededUnit(tulip.seed, Math.floor(this.elapsedTime / PROPAGATION_INTERVAL) + 101) > chance) {
        continue;
      }

      tulip.record.lastPropagation = this.elapsedTime;
      this.spawnNearbyBulb(state, tulip);
    }
  }

  spawnNearbyBulb(state, tulip) {
    const angle = seededUnit(tulip.seed, Math.floor(this.elapsedTime) + 211) * Math.PI * 2;
    const distance = 1 + Math.floor(seededUnit(tulip.seed, Math.floor(this.elapsedTime) + 223) * 2);
    const x = Math.round(tulip.x + Math.cos(angle) * distance);
    const z = Math.round(tulip.z + Math.sin(angle) * distance);
    const candidate = this.createTulipCandidate(state.key, state.entity, x, z);

    if (!candidate || state.tulips.some((existing) => existing.x === candidate.x && existing.z === candidate.z)) {
      return;
    }

    const record = {
      key: candidate.key,
      growth: 0,
      coldUnits: 0.24,
      health: 0.72,
      vigor: 0.76 + seededUnit(candidate.seed, 23) * 0.32,
      stageIndex: 0,
      lastPropagation: 0,
    };

    this.tulipMemory.set(candidate.key, record);
    this.addTulipToChunkState(state, candidate);
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
    this.tulipMemory.clear();
  }
}
