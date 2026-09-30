import {
  buildYearStageCalendar,
  getSeasonId,
  getSolarProfile,
} from './timeSystem.js';

export const SEASON_ECOLOGY = Object.freeze({
  spring: {
    label: '春季',
    colors: { grass: 0x55b86b, leaves: 0x319657, dryGrass: 0xa7a866, snowCoverage: 0.18 },
    vegetationActivity: 0.86,
    wildlifeActivity: 0.76,
    moisture: 0.68,
    snowCoverage: 0.18,
    bloom: 0.9,
    leafDrop: 0.08,
    hibernation: 0.12,
  },
  summer: {
    label: '夏季',
    colors: { grass: 0x4fb06d, leaves: 0x2f8f4e, dryGrass: 0x9d9a55, snowCoverage: 0.04 },
    vegetationActivity: 1,
    wildlifeActivity: 0.94,
    moisture: 0.46,
    snowCoverage: 0.04,
    bloom: 0.36,
    leafDrop: 0.02,
    hibernation: 0.02,
  },
  autumn: {
    label: '秋季',
    colors: { grass: 0x8aa85a, leaves: 0x9a6f35, dryGrass: 0xb09a56, snowCoverage: 0.12 },
    vegetationActivity: 0.58,
    wildlifeActivity: 0.66,
    moisture: 0.52,
    snowCoverage: 0.12,
    bloom: 0.08,
    leafDrop: 0.78,
    hibernation: 0.28,
  },
  winter: {
    label: '冬季',
    colors: { grass: 0xc4d7c8, leaves: 0x6f8d78, dryGrass: 0xd5ddd0, snowCoverage: 0.72 },
    vegetationActivity: 0.2,
    wildlifeActivity: 0.34,
    moisture: 0.38,
    snowCoverage: 0.72,
    bloom: 0.02,
    leafDrop: 0.2,
    hibernation: 0.82,
  },
});

const WEATHER_ECOLOGY_EFFECTS = Object.freeze({
  clear: { moisture: 0, snowCoverage: 0, wildlifeActivity: 0.04, vegetationActivity: 0.02 },
  rain: { moisture: 0.22, snowCoverage: 0, wildlifeActivity: -0.08, vegetationActivity: 0.08 },
  snow: { moisture: 0.08, snowCoverage: 0.2, wildlifeActivity: -0.16, vegetationActivity: -0.08 },
  aurora: { moisture: 0, snowCoverage: 0.04, wildlifeActivity: -0.04, vegetationActivity: 0 },
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function getDaylightActivityFactor(solarProfile) {
  return clamp01((solarProfile.daylightHours - 8) / 8);
}

function buildBiomeTransitions(ecology) {
  return {
    plains: {
      grassDensity: clamp01(ecology.vegetationActivity * 0.92 + ecology.moisture * 0.18),
      flowerDensity: clamp01(ecology.bloom),
      dormantRatio: clamp01(ecology.hibernation * 0.35 + ecology.leafDrop * 0.2),
    },
    forest: {
      leafDensity: clamp01(1 - ecology.leafDrop * 0.55 - ecology.snowCoverage * 0.18),
      canopyTint: ecology.colors.leaves,
      wildlifeActivity: ecology.wildlifeActivity,
    },
    desert: {
      dryGrassRatio: clamp01(0.78 - ecology.moisture * 0.28),
      oasisGrowth: clamp01(ecology.moisture * 0.7 + ecology.vegetationActivity * 0.2),
      heatDormancy: clamp01(1 - ecology.moisture),
    },
    highland: {
      rockExposure: clamp01(0.58 + ecology.snowCoverage * 0.2),
      mossGrowth: clamp01(ecology.moisture * ecology.vegetationActivity),
      windHardiness: clamp01(0.5 + ecology.hibernation * 0.34),
    },
    snowfield: {
      snowCoverage: ecology.snowCoverage,
      exposedGrass: clamp01((1 - ecology.snowCoverage) * ecology.vegetationActivity),
      hibernation: ecology.hibernation,
    },
    cave: {
      humidity: clamp01(ecology.moisture * 0.85 + 0.12),
      darkness: 0.88,
      wildlifeActivity: clamp01(ecology.wildlifeActivity * 0.35),
    },
  };
}

function applyWeatherEffect(baseEcology, weatherId) {
  const effect = WEATHER_ECOLOGY_EFFECTS[weatherId] ?? WEATHER_ECOLOGY_EFFECTS.clear;

  return {
    ...baseEcology,
    moisture: clamp01(baseEcology.moisture + effect.moisture),
    snowCoverage: clamp01(baseEcology.snowCoverage + effect.snowCoverage),
    wildlifeActivity: clamp01(baseEcology.wildlifeActivity + effect.wildlifeActivity),
    vegetationActivity: clamp01(baseEcology.vegetationActivity + effect.vegetationActivity),
  };
}

export class BiologySystem {
  constructor({ eventBus, latitude = 35 }) {
    this.eventBus = eventBus;
    this.latitude = latitude;
    this.yearStageCalendar = buildYearStageCalendar(latitude);
    this.currentWeatherId = 'clear';
    this.lastStateKey = '';
    this.latestTimeState = null;
    this.unsubscribe = [
      eventBus.on('time:update', (timeState) => this.handleTimeUpdate(timeState)),
      eventBus.on('time:new-day', (timeState) => this.emitBiologyState(timeState, true)),
      eventBus.on('weather:update', (weatherState) => this.handleWeatherUpdate(weatherState)),
      eventBus.on('biology:request-state', () => {
        if (this.latestTimeState) {
          this.emitBiologyState(this.latestTimeState, true);
        }
      }),
    ];
  }

  handleTimeUpdate(timeState) {
    this.latestTimeState = timeState;
    this.emitBiologyState(timeState, false);
  }

  handleWeatherUpdate(weatherState) {
    this.currentWeatherId = weatherState.weatherId;

    if (this.latestTimeState) {
      this.emitBiologyState(this.latestTimeState, true);
    }
  }

  getDayProfile(dayOfYear) {
    return this.yearStageCalendar[(dayOfYear - 1 + this.yearStageCalendar.length) % this.yearStageCalendar.length];
  }

  createBiologyState(timeState) {
    const dayProfile = this.getDayProfile(timeState.dayOfYear);
    const seasonId = getSeasonId(timeState.dayOfYear);
    const seasonEcology = SEASON_ECOLOGY[seasonId];
    const solarProfile = getSolarProfile(timeState.dayOfYear, this.latitude);
    const daylightActivityFactor = getDaylightActivityFactor(solarProfile);
    const ecology = applyWeatherEffect({
      ...seasonEcology,
      wildlifeActivity: clamp01(seasonEcology.wildlifeActivity * (0.72 + daylightActivityFactor * 0.28)),
      vegetationActivity: clamp01(seasonEcology.vegetationActivity * (0.82 + daylightActivityFactor * 0.18)),
    }, this.currentWeatherId);

    return {
      seasonId,
      seasonLabel: seasonEcology.label,
      dayOfYear: timeState.dayOfYear,
      weatherId: this.currentWeatherId,
      solarProfile,
      stageProfile: dayProfile.stages,
      yearStageCalendar: this.yearStageCalendar,
      colors: {
        ...seasonEcology.colors,
        snowCoverage: ecology.snowCoverage,
      },
      ecology,
      biomeTransitions: buildBiomeTransitions({
        ...ecology,
        colors: seasonEcology.colors,
      }),
    };
  }

  emitBiologyState(timeState, force) {
    const stateKey = `${timeState.dayOfYear}:${getSeasonId(timeState.dayOfYear)}:${this.currentWeatherId}`;

    if (!force && stateKey === this.lastStateKey) {
      return;
    }

    const biologyState = this.createBiologyState(timeState);
    this.lastStateKey = stateKey;
    this.eventBus.emit('biology:update', biologyState);
    this.eventBus.emit('biomeSeason:update', biologyState);
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
  }
}
