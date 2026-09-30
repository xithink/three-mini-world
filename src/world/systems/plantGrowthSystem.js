import * as THREE from 'three';
import { BLOCK_IDS } from '../chunk.js';
import { DAYS_PER_YEAR, SECONDS_PER_YEAR_DAY } from './timeSystem.js';

export const PLANT_GROWTH_STAGES = Object.freeze([
  { id: 'seed', label: '种子', texture: '/assets/textwaterzongzi.png', threshold: 0, scale: 0.22 },
  { id: 'sprout', label: '发芽', texture: '/assets/textwaterfaya.png', threshold: 0.06, scale: 0.32 },
  { id: 'seedling', label: '幼苗', texture: '/assets/textwateryoumiao.png', threshold: 0.16, scale: 0.44 },
  { id: 'growing', label: '成长', texture: '/assets/textwaterchenzhang.png', threshold: 0.30, scale: 0.58 },
  { id: 'tall', label: '拔高', texture: '/assets/textwaterbagao.png', threshold: 0.48, scale: 0.72 },
  { id: 'heading', label: '抽穗', texture: '/assets/textwaterchousui.png', threshold: 0.66, scale: 0.82 },
  { id: 'golden', label: '金黄', texture: '/assets/textwaterjinhuang.png', threshold: 0.82, scale: 0.90 },
  { id: 'mature', label: '成熟', texture: '/assets/textwaterchengshu.png', threshold: 0.94, scale: 0.96 },
]);

const HOST_BLOCK_PROFILES = new Map([
  [BLOCK_IDS.GRASS, { soil: 1, density: 0.34 }],
  [BLOCK_IDS.DRY_GRASS, { soil: 0.72, density: 0.24 }],
  [BLOCK_IDS.DIRT, { soil: 0.76, density: 0.22 }],
  [BLOCK_IDS.FOREST_MOUNTAIN, { soil: 0.68, density: 0.30 }],
  [BLOCK_IDS.SNOW, { soil: 0.36, density: 0.12 }],
  [BLOCK_IDS.SNOW_MOUNTAIN, { soil: 0.42, density: 0.18 }],
]);
const PLANT_TYPE_PROFILES = Object.freeze({
  grain: {
    id: 'grain',
    label: '谷物',
    cycle: '谷物生长季',
    lifecycleDays: 180,
    tint: 0xffffff,
    scaleMultiplier: 1,
    idealTemperature: 0.70,
    idealMoisture: 0.62,
    coldTolerance: 0.18,
    hostWeights: {
      [BLOCK_IDS.GRASS]: 1,
      [BLOCK_IDS.DRY_GRASS]: 0.62,
      [BLOCK_IDS.DIRT]: 0.82,
      [BLOCK_IDS.FOREST_MOUNTAIN]: 0.28,
    },
  },
  wildGrass: {
    id: 'wildGrass',
    label: '野草',
    cycle: '草本周期',
    lifecycleDays: 90,
    tint: 0x9fe374,
    scaleMultiplier: 0.78,
    idealTemperature: 0.62,
    idealMoisture: 0.54,
    coldTolerance: 0.34,
    hostWeights: {
      [BLOCK_IDS.GRASS]: 1,
      [BLOCK_IDS.DRY_GRASS]: 0.78,
      [BLOCK_IDS.DIRT]: 0.52,
      [BLOCK_IDS.FOREST_MOUNTAIN]: 0.72,
    },
  },
  alpineHerb: {
    id: 'alpineHerb',
    label: '高山草本',
    cycle: '高山生长期',
    lifecycleDays: 140,
    tint: 0xc8f0cf,
    scaleMultiplier: 0.72,
    idealTemperature: 0.38,
    idealMoisture: 0.58,
    coldTolerance: 0.86,
    hostWeights: {
      [BLOCK_IDS.FOREST_MOUNTAIN]: 0.92,
      [BLOCK_IDS.SNOW]: 0.56,
      [BLOCK_IDS.SNOW_MOUNTAIN]: 1,
    },
  },
  wetlandReed: {
    id: 'wetlandReed',
    label: '水边芦草',
    cycle: '湿地生长期',
    lifecycleDays: 120,
    tint: 0xd6d083,
    scaleMultiplier: 1.12,
    idealTemperature: 0.66,
    idealMoisture: 0.82,
    coldTolerance: 0.24,
    minWater: 0.26,
    hostWeights: {
      [BLOCK_IDS.GRASS]: 0.78,
      [BLOCK_IDS.DIRT]: 0.62,
      [BLOCK_IDS.DRY_GRASS]: 0.22,
      [BLOCK_IDS.FOREST_MOUNTAIN]: 0.34,
    },
  },
});
const BLOCKED_ABOVE_IDS = new Set([BLOCK_IDS.WATER, BLOCK_IDS.LAVA, BLOCK_IDS.WOOD, BLOCK_IDS.LEAVES]);
const SEASON_TEMPERATURE = Object.freeze({
  spring: 0.78,
  summer: 0.95,
  autumn: 0.62,
  winter: 0.18,
});
const WEATHER_TEMPERATURE_OFFSET = Object.freeze({
  clear: 0.04,
  rain: -0.06,
  snow: -0.24,
  aurora: -0.10,
});
const WEATHER_MOISTURE_OFFSET = Object.freeze({
  clear: -0.04,
  rain: 0.28,
  snow: 0.12,
  aurora: 0.02,
});
const DAYLIGHT_STAGE_FACTORS = Object.freeze({
  preDawn: 0.18,
  dawn: 0.52,
  morning: 0.92,
  noon: 1,
  afternoon: 0.90,
  dusk: 0.42,
  night: 0.12,
});
const COLUMN_SCAN_STEP = 1;
const MIN_INITIAL_PLANTS_PER_CHUNK = 6;
const MAX_INITIAL_PLANTS_PER_CHUNK = 36;
const WATER_SCAN_RADIUS = 4;
const HEALTH_RECOVERY_RATE = 0.05;
const HEALTH_STRESS_RATE = 0.03;
const PROPAGATION_INTERVAL = 3.5;
const PROPAGATION_CHANCE = 0.08;
const HOST_BLOCK_LABELS = Object.freeze({
  [BLOCK_IDS.GRASS]: '草地',
  [BLOCK_IDS.DRY_GRASS]: '枯草地',
  [BLOCK_IDS.DIRT]: '泥土',
  [BLOCK_IDS.FOREST_MOUNTAIN]: '森林高山',
  [BLOCK_IDS.SNOW]: '雪地',
  [BLOCK_IDS.SNOW_MOUNTAIN]: '雪山',
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hashPlantSeed(chunkCoord, x, z, salt = 0) {
  let hash = Math.imul(chunkCoord.x + 0x9e3779b9 + salt, 0x85ebca6b);
  hash ^= Math.imul(chunkCoord.z + 0x7f4a7c15 - salt, 0xc2b2ae35);
  hash ^= Math.imul(x + 0x27d4eb2d + salt * 17, 0x165667b1);
  hash ^= Math.imul(z + 0x94d049bb - salt * 31, 0xd3a2646c);
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

  for (let index = 0; index < PLANT_GROWTH_STAGES.length; index += 1) {
    if (growth >= PLANT_GROWTH_STAGES[index].threshold) {
      stageIndex = index;
    }
  }

  return stageIndex;
}

function getEnvironmentStatus(record, environment) {
  if (record.health < 0.32 || environment.stress > 0.68) {
    return '受压';
  }

  if (environment.suitability >= 0.72 && record.health >= 0.72) {
    return '旺盛';
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
    (y + 0.52) * chunk.blockSize,
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

function getTemperatureFactor(biologyState, weatherId) {
  const seasonId = biologyState?.seasonId ?? 'summer';
  const base = SEASON_TEMPERATURE[seasonId] ?? SEASON_TEMPERATURE.summer;
  const weatherOffset = WEATHER_TEMPERATURE_OFFSET[weatherId] ?? 0;
  const snowPenalty = (biologyState?.ecology?.snowCoverage ?? 0) * 0.28;

  return clamp01(base + weatherOffset - snowPenalty);
}

function getDaylightFactor(timeState) {
  const stageFactor = DAYLIGHT_STAGE_FACTORS[timeState?.stage?.id] ?? 0.72;
  const daylightHours = timeState?.solarProfile?.daylightHours ?? 12;
  const seasonDaylightFactor = clamp01((daylightHours - 7) / 8);

  return clamp01(stageFactor * (0.78 + seasonDaylightFactor * 0.22));
}

function getHumidityFactor(biologyState, weatherId) {
  const moisture = biologyState?.ecology?.moisture ?? 0.48;
  const weatherOffset = WEATHER_MOISTURE_OFFSET[weatherId] ?? 0;

  return clamp01(moisture + weatherOffset);
}

function getPlantTypeProfile(typeId) {
  return PLANT_TYPE_PROFILES[typeId] ?? PLANT_TYPE_PROFILES.grain;
}

function getPlantTypeSuitability(profile, environment, surfaceBlockId) {
  const hostWeight = profile.hostWeights[surfaceBlockId] ?? 0;

  if (hostWeight <= 0) {
    return 0;
  }

  if (profile.minWater && Math.max(environment.water, environment.humidity) < profile.minWater) {
    return 0;
  }

  const moisture = Math.max(environment.water, environment.humidity);
  const temperatureMatch = 1 - Math.abs(environment.temperature - profile.idealTemperature);
  const moistureMatch = 1 - Math.abs(moisture - profile.idealMoisture);
  const coldPenalty = clamp01((0.34 - environment.temperature) * (1 - profile.coldTolerance));

  return clamp01(
    hostWeight * 0.38 +
    clamp01(temperatureMatch) * 0.24 +
    clamp01(moistureMatch) * 0.22 +
    environment.daylight * 0.10 +
    environment.vegetation * 0.06 -
    coldPenalty * 0.18,
  );
}

function formatCycleDay(growth, lifecycleDays) {
  return Math.max(1, Math.min(lifecycleDays, Math.round(growth * lifecycleDays)));
}

function canHostPlant(surfaceBlockId, aboveBlockId) {
  if (!HOST_BLOCK_PROFILES.has(surfaceBlockId)) {
    return false;
  }

  return aboveBlockId === BLOCK_IDS.AIR && !BLOCKED_ABOVE_IDS.has(aboveBlockId);
}

export class PlantGrowthSystem {
  constructor({ scene, eventBus, worldManager }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.worldManager = worldManager;
    this.chunkStates = new Map();
    this.plantMemory = new Map();
    this.elapsedTime = 0;
    this.timeState = null;
    this.lastWorldDayScalar = null;
    this.pendingWorldDays = 0;
    this.biologyState = null;
    this.weatherId = 'clear';
    this.stageTextures = PLANT_GROWTH_STAGES.map((stage) => this.createTexture(stage.texture));
    this.stageMaterialsByType = new Map(
      Object.values(PLANT_TYPE_PROFILES).map((profile) => [
        profile.id,
        this.stageTextures.map((texture) => new THREE.SpriteMaterial({
          map: texture,
          color: profile.tint,
          transparent: true,
          alphaTest: 0.08,
          depthWrite: false,
          sizeAttenuation: true,
        })),
      ]),
    );
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
      this.updateChunkPlants(state, worldDays);
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
    group.name = `PlantGrowth(${key})`;
    const state = {
      key,
      entity,
      group,
      plants: [],
      nextPropagationTime: this.elapsedTime + seededUnit(hashPlantSeed(entity.chunkCoord, 0, 0), 3) * PROPAGATION_INTERVAL,
    };
    const candidates = this.createInitialCandidates(key, entity);

    for (const candidate of candidates) {
      this.addPlantToChunkState(state, candidate);
    }

    this.scene.add(group);

    return state;
  }

  createInitialCandidates(chunkKey, entity) {
    const candidates = [];

    for (let z = 1; z < entity.chunk.size.z - 1; z += COLUMN_SCAN_STEP) {
      for (let x = 1; x < entity.chunk.size.x - 1; x += COLUMN_SCAN_STEP) {
        const candidate = this.createPlantCandidate(chunkKey, entity, x, z);

        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    if (candidates.length < MIN_INITIAL_PLANTS_PER_CHUNK) {
      for (let z = 1; z < entity.chunk.size.z - 1; z += COLUMN_SCAN_STEP) {
        for (let x = 1; x < entity.chunk.size.x - 1; x += COLUMN_SCAN_STEP) {
          if (candidates.some((candidate) => candidate.x === x && candidate.z === z)) {
            continue;
          }

          const candidate = this.createPlantCandidate(chunkKey, entity, x, z, { force: true });

          if (candidate) {
            candidates.push(candidate);
          }
        }
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_INITIAL_PLANTS_PER_CHUNK);
  }

  createPlantCandidate(chunkKey, entity, x, z, options = {}) {
    if (x < 1 || x >= entity.chunk.size.x - 1 || z < 1 || z >= entity.chunk.size.z - 1) {
      return null;
    }

    const surfaceY = entity.surfaceHeights[entity.chunk.getColumnIndex(x, z)];
    const surfaceBlockId = entity.chunk.getBlock(x, surfaceY, z);
    const aboveBlockId = entity.chunk.getBlock(x, surfaceY + 1, z);

    if (!canHostPlant(surfaceBlockId, aboveBlockId)) {
      return null;
    }

    const seed = hashPlantSeed(entity.chunkCoord, x, z);
    const profile = HOST_BLOCK_PROFILES.get(surfaceBlockId);
    const environment = this.sampleEnvironment(entity, x, surfaceY, z, surfaceBlockId);
    const typeProfile = this.selectPlantType(surfaceBlockId, environment, seed, options.preferredTypeId);

    if (!typeProfile) {
      return null;
    }

    const biologyDensity = 0.42 + (this.biologyState?.ecology?.vegetationActivity ?? 0.72) * 0.58;
    const typeSuitability = getPlantTypeSuitability(typeProfile, environment, surfaceBlockId);
    const chance = clamp01(profile.density * environment.suitability * typeSuitability * biologyDensity * 1.9);

    if (!options.force && seededUnit(seed, 5) > chance) {
      return null;
    }

    return {
      key: `${chunkKey}:${typeProfile.id}:${x},${z}`,
      chunkKey,
      typeId: typeProfile.id,
      x,
      y: surfaceY,
      z,
      surfaceBlockId,
      seed,
      score: chance + typeSuitability * 0.24 + seededUnit(seed, 11) * 0.25,
      environment,
      worldPosition: getWorldPosition(entity, x, surfaceY, z),
    };
  }

  selectPlantType(surfaceBlockId, environment, seed, preferredTypeId = null) {
    if (preferredTypeId) {
      const preferredProfile = getPlantTypeProfile(preferredTypeId);
      return getPlantTypeSuitability(preferredProfile, environment, surfaceBlockId) > 0 ? preferredProfile : null;
    }

    const weightedProfiles = Object.values(PLANT_TYPE_PROFILES)
      .map((profile) => ({
        profile,
        weight: getPlantTypeSuitability(profile, environment, surfaceBlockId),
      }))
      .filter(({ weight }) => weight > 0);

    const totalWeight = weightedProfiles.reduce((sum, { weight }) => sum + weight, 0);

    if (totalWeight <= 0) {
      return null;
    }

    let roll = seededUnit(seed, 29) * totalWeight;

    for (const { profile, weight } of weightedProfiles) {
      roll -= weight;

      if (roll <= 0) {
        return profile;
      }
    }

    return weightedProfiles[weightedProfiles.length - 1].profile;
  }

  sampleEnvironment(entity, x, y, z, surfaceBlockId) {
    const soil = HOST_BLOCK_PROFILES.get(surfaceBlockId)?.soil ?? 0;
    const water = this.sampleWaterFactor(entity, x, y, z);
    const daylight = getDaylightFactor(this.timeState);
    const temperature = getTemperatureFactor(this.biologyState, this.weatherId);
    const humidity = getHumidityFactor(this.biologyState, this.weatherId);
    const vegetation = this.biologyState?.ecology?.vegetationActivity ?? 0.72;
    const snowCoverage = this.biologyState?.ecology?.snowCoverage ?? 0;
    const droughtStress = clamp01(0.48 - Math.max(water, humidity));
    const coldStress = clamp01(0.42 - temperature);
    const snowStress = clamp01(snowCoverage - 0.34);
    const suitability = clamp01(
      soil * 0.18 +
      Math.max(water, humidity * 0.76) * 0.30 +
      daylight * 0.16 +
      temperature * 0.22 +
      vegetation * 0.14 -
      droughtStress * 0.18 -
      coldStress * 0.16 -
      snowStress * 0.18,
    );

    return {
      soil,
      water,
      daylight,
      temperature,
      humidity,
      vegetation,
      stress: clamp01(droughtStress + coldStress + snowStress),
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
      return clamp01(1 - nearestDistance / (WATER_SCAN_RADIUS + 1));
    }

    return clamp01((this.biologyState?.ecology?.moisture ?? 0.48) * 0.62);
  }

  addPlantToChunkState(state, candidate) {
    const record = this.getOrCreatePlantRecord(candidate);
    const stageMaterials = this.stageMaterialsByType.get(record.typeId) ?? this.stageMaterialsByType.get('grain');
    const sprite = new THREE.Sprite(stageMaterials[record.stageIndex]);
    const plant = {
      ...candidate,
      record,
      sprite,
      latestEnvironment: candidate.environment,
    };

    sprite.name = `Plant:${record.typeId}:${PLANT_GROWTH_STAGES[record.stageIndex].id}`;
    sprite.center.set(0.5, 0);
    sprite.position.copy(candidate.worldPosition);
    sprite.userData.ecosystemInspectable = true;
    sprite.userData.getEcosystemState = () => this.getPlantInspectionState(plant);
    this.applySpriteScale(sprite, record);
    state.group.add(sprite);
    state.plants.push(plant);
  }

  getPlantInspectionState(plant) {
    const stage = PLANT_GROWTH_STAGES[plant.record.stageIndex];
    const typeProfile = getPlantTypeProfile(plant.record.typeId);
    const environment = plant.latestEnvironment ?? plant.environment;

    return {
      type: 'plant',
      title: typeProfile.label,
      stage: stage.label,
      cycle: typeProfile.cycle,
      cycleDay: formatCycleDay(plant.record.growth, typeProfile.lifecycleDays),
      cycleDays: typeProfile.lifecycleDays,
      cycleProgress: plant.record.growth,
      status: getEnvironmentStatus(plant.record, environment),
      host: HOST_BLOCK_LABELS[plant.surfaceBlockId] ?? '未知地表',
      growth: plant.record.growth,
      health: plant.record.health,
      plantHeight: plant.sprite.scale.y,
      water: environment.water,
      daylight: environment.daylight,
      temperature: environment.temperature,
      humidity: environment.humidity,
      suitability: environment.suitability,
      stress: environment.stress,
    };
  }

  getOrCreatePlantRecord(candidate) {
    if (this.plantMemory.has(candidate.key)) {
      return this.plantMemory.get(candidate.key);
    }

    const growth = clamp01(
      seededUnit(candidate.seed, 17) * 0.02 +
      candidate.environment.suitability * 0.03,
    );
    const record = {
      key: candidate.key,
      typeId: candidate.typeId,
      growth,
      health: clamp01(0.72 + candidate.environment.suitability * 0.22),
      vigor: 0.76 + seededUnit(candidate.seed, 23) * 0.42,
      stageIndex: getStageIndexForGrowth(growth),
      lastPropagation: 0,
    };

    this.plantMemory.set(candidate.key, record);

    return record;
  }

  updateChunkPlants(state, worldDays) {
    for (const plant of state.plants) {
      const environment = this.sampleEnvironment(
        state.entity,
        plant.x,
        plant.y,
        plant.z,
        plant.surfaceBlockId,
      );

      plant.latestEnvironment = environment;
      this.updatePlantGrowth(plant, environment, worldDays);
    }

    if (this.elapsedTime >= state.nextPropagationTime) {
      this.tryPropagatePlants(state);
      state.nextPropagationTime = this.elapsedTime + PROPAGATION_INTERVAL;
    }
  }

  updatePlantGrowth(plant, environment, worldDays) {
    const record = plant.record;
    const typeProfile = getPlantTypeProfile(record.typeId);
    const effectiveDays = Math.max(0, worldDays);
    const healthDays = Math.min(effectiveDays, 8);
    const typeSuitability = getPlantTypeSuitability(typeProfile, environment, plant.surfaceBlockId);
    const chanceNoise = 0.82 + seededUnit(record.key.length + plant.seed, Math.floor((this.timeState?.dayOfYear ?? this.elapsedTime) * 2)) * 0.36;
    const sunlight = 0.25 + environment.daylight * 0.75;
    const moistureBoost = 0.45 + Math.max(environment.water, environment.humidity) * 0.55;
    const growthPotential = environment.suitability * typeSuitability * sunlight * moistureBoost * record.vigor * chanceNoise;
    const stressPenalty = environment.stress * (1.05 - environment.water * 0.35);
    const healthDelta = (growthPotential * HEALTH_RECOVERY_RATE - stressPenalty * HEALTH_STRESS_RATE) * healthDays;

    record.health = clamp01(record.health + healthDelta);

    if (record.health > 0.18) {
      const growthFactor = 0.64 + clamp01(growthPotential) * 0.52;
      const growthDelta = (effectiveDays / typeProfile.lifecycleDays) * growthFactor * (0.58 + record.health * 0.42);
      record.growth = clamp01(record.growth + growthDelta);
    } else {
      record.growth = clamp01(record.growth - (effectiveDays / typeProfile.lifecycleDays) * environment.stress * 0.08);
    }

    const nextStageIndex = getStageIndexForGrowth(record.growth);

    if (nextStageIndex !== record.stageIndex) {
      record.stageIndex = nextStageIndex;
      const stageMaterials = this.stageMaterialsByType.get(record.typeId) ?? this.stageMaterialsByType.get('grain');
      plant.sprite.material = stageMaterials[nextStageIndex];
      plant.sprite.name = `Plant:${record.typeId}:${PLANT_GROWTH_STAGES[nextStageIndex].id}`;
    }

    this.applySpriteScale(plant.sprite, record);
  }

  applySpriteScale(sprite, record) {
    const stage = PLANT_GROWTH_STAGES[record.stageIndex];
    const typeProfile = getPlantTypeProfile(record.typeId);
    const healthScale = 0.82 + record.health * 0.18;
    const width = stage.scale * typeProfile.scaleMultiplier * (0.74 + record.vigor * 0.14) * healthScale;
    const height = stage.scale * typeProfile.scaleMultiplier * 1.25 * healthScale;

    sprite.scale.set(width, height, 1);
  }

  tryPropagatePlants(state) {
    const maturePlants = state.plants.filter((plant) => plant.record.stageIndex >= PLANT_GROWTH_STAGES.length - 1);

    for (const plant of maturePlants) {
      if (this.elapsedTime - plant.record.lastPropagation < PROPAGATION_INTERVAL * 2) {
        continue;
      }

      const environment = this.sampleEnvironment(state.entity, plant.x, plant.y, plant.z, plant.surfaceBlockId);
      const chance = PROPAGATION_CHANCE * environment.suitability * plant.record.health;

      if (seededUnit(plant.seed, Math.floor(this.elapsedTime / PROPAGATION_INTERVAL) + 101) > chance) {
        continue;
      }

      plant.record.lastPropagation = this.elapsedTime;
      this.spawnNearbySeed(state, plant);
    }
  }

  spawnNearbySeed(state, plant) {
    const directionSeed = seededUnit(plant.seed, Math.floor(this.elapsedTime) + 211);
    const angle = directionSeed * Math.PI * 2;
    const distance = 1 + Math.floor(seededUnit(plant.seed, Math.floor(this.elapsedTime) + 223) * 3);
    const x = Math.round(plant.x + Math.cos(angle) * distance);
    const z = Math.round(plant.z + Math.sin(angle) * distance);
    const candidate = this.createPlantCandidate(state.key, state.entity, x, z, { preferredTypeId: plant.record.typeId });

    if (!candidate || state.plants.some((existing) => existing.x === candidate.x && existing.z === candidate.z)) {
      return;
    }

    const record = {
      key: candidate.key,
      typeId: candidate.typeId,
      growth: 0,
      health: 0.74,
      vigor: 0.76 + seededUnit(candidate.seed, 23) * 0.42,
      stageIndex: 0,
      lastPropagation: 0,
    };

    this.plantMemory.set(candidate.key, record);
    this.addPlantToChunkState(state, candidate);
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
    this.stageMaterialsByType.forEach((materials) => {
      materials.forEach((material) => material.dispose());
    });
    this.stageTextures.forEach((texture) => texture.dispose());
    this.plantMemory.clear();
  }
}
