import * as THREE from 'three';

const SKY_COLORS = Object.freeze({
  preDawn: { sky: 0x111827, fog: 0x243040 },
  dawn: { sky: 0xb76f55, fog: 0xc89272 },
  morning: { sky: 0x83b9dc, fog: 0xaac6d7 },
  noon: { sky: 0x73b9f2, fog: 0xb8dced },
  afternoon: { sky: 0x8fb7d6, fog: 0xc1d1d6 },
  dusk: { sky: 0xb66343, fog: 0xa56e5c },
  night: { sky: 0x070b16, fog: 0x111827 },
});

const WEATHER_TINTS = Object.freeze({
  clear: { sky: 0xffffff, fog: 0xffffff, strength: 0 },
  rain: { sky: 0x73818b, fog: 0x6f7c84, strength: 0.42 },
  snow: { sky: 0xd8e5ea, fog: 0xdce8eb, strength: 0.36 },
  aurora: { sky: 0x16334a, fog: 0x24495a, strength: 0.28 },
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function lerpColor(startHex, endHex, amount) {
  return new THREE.Color(startHex).lerp(new THREE.Color(endHex), amount);
}

function getSkyStageBlend(timeState) {
  const currentHour = timeState.normalizedDay * 24;

  if (timeState.stage.id === 'afternoon') {
    const transitionStart = Math.max(timeState.solarProfile.sunriseHour, timeState.solarProfile.sunsetHour - 1);
    const transitionDuration = Math.max(0.01, timeState.solarProfile.sunsetHour - transitionStart);

    return smoothStep(clamp((currentHour - transitionStart) / transitionDuration, 0, 1));
  }

  if (timeState.stage.id === 'preDawn') {
    const transitionStart = Math.max(0, timeState.solarProfile.sunriseHour - 1);
    const transitionDuration = Math.max(0.01, timeState.solarProfile.sunriseHour - transitionStart);

    return smoothStep(clamp((currentHour - transitionStart) / transitionDuration, 0, 1));
  }

  return timeState.stageProgress;
}

export class SkySystem {
  constructor({ scene, eventBus }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.weatherId = 'clear';
    this.sunState = null;
    this.unsubscribe = [
      eventBus.on('time:update', (timeState) => this.updateFromTime(timeState)),
      eventBus.on('sun:update', (sunState) => {
        this.sunState = sunState;
      }),
      eventBus.on('weather:update', (weatherState) => {
        this.weatherId = weatherState.weatherId;
      }),
    ];

    this.scene.fog = new THREE.FogExp2(0x9fb5bf, 0.018);
  }

  updateFromTime(timeState) {
    const currentColors = SKY_COLORS[timeState.stage.id];
    const nextColors = SKY_COLORS[timeState.nextStage.id];
    const weatherTint = WEATHER_TINTS[this.weatherId] ?? WEATHER_TINTS.clear;
    const stageBlend = getSkyStageBlend(timeState);
    const sky = lerpColor(currentColors.sky, nextColors.sky, stageBlend);
    const fog = lerpColor(currentColors.fog, nextColors.fog, stageBlend);
    const sunsetAmount = this.sunState?.isDaytime
      ? smoothStep(clamp((0.42 - this.sunState.elevation) / 0.42, 0, 1))
      : 0;

    sky.lerp(new THREE.Color(0xf08a4b), sunsetAmount * 0.46);
    fog.lerp(new THREE.Color(0xd19162), sunsetAmount * 0.5);
    sky.lerp(new THREE.Color(weatherTint.sky), weatherTint.strength);
    fog.lerp(new THREE.Color(weatherTint.fog), weatherTint.strength);
    this.scene.background = sky;
    this.scene.fog.color.copy(fog);
    this.scene.fog.density = this.weatherId === 'snow' ? 0.026 : this.weatherId === 'rain' ? 0.023 : 0.018;
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
  }
}
