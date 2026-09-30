import * as THREE from 'three';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function mixColor(startHex, endHex, amount) {
  return new THREE.Color(startHex).lerp(new THREE.Color(endHex), clamp(amount, 0, 1));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function createSunTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255, 255, 246, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 226, 128, 0.96)');
  gradient.addColorStop(0.68, 'rgba(255, 166, 55, 0.38)');
  gradient.addColorStop(1, 'rgba(255, 166, 55, 0)');

  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

export class SunSystem {
  constructor({ scene, eventBus, camera = null, radius = 68 }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.camera = camera;
    this.radius = radius;
    this.direction = new THREE.Vector3(0.35, 0.8, 0.25).normalize();
    this.position = new THREE.Vector3();
    this.sunMesh = this.createSunMesh();
    this.unsubscribe = eventBus.on('time:update', (timeState) => this.updateFromTime(timeState));

    scene.add(this.sunMesh);
  }

  createSunMesh() {
    const material = new THREE.SpriteMaterial({
      map: createSunTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Sprite(material);
    mesh.name = 'SunDisc';
    mesh.scale.set(8, 8, 1);
    mesh.renderOrder = 50;

    return mesh;
  }

  getSunProgress(timeState) {
    const { sunriseHour, sunsetHour } = timeState.solarProfile;
    const currentHour = timeState.normalizedDay * 24;
    const daylightDuration = Math.max(0.01, sunsetHour - sunriseHour);

    return clamp((currentHour - sunriseHour) / daylightDuration, 0, 1);
  }

  getStageProgress(timeState, stageId) {
    return timeState.stage.id === stageId ? smoothStep(clamp(timeState.stageProgress, 0, 1)) : null;
  }

  updateFromTime(timeState) {
    const sunProgress = this.getSunProgress(timeState);
    const currentHour = timeState.normalizedDay * 24;
    const { sunriseHour, sunsetHour } = timeState.solarProfile;
    const isDaytime = currentHour >= sunriseHour && currentHour <= sunsetHour;
    const arc = Math.PI * smoothStep(sunProgress);
    const daylightElevation = isDaytime ? Math.sin(arc) : 0;
    const belowGroundElevation = -0.2;
    const dawnProgress = this.getStageProgress(timeState, 'dawn');
    const duskProgress = this.getStageProgress(timeState, 'dusk');
    let elevation = isDaytime ? daylightElevation : belowGroundElevation;
    let visibility = isDaytime ? 1 : 0;

    if (dawnProgress !== null) {
      elevation = lerp(belowGroundElevation, daylightElevation, dawnProgress);
      visibility = lerp(0.18, 1, dawnProgress);
    } else if (duskProgress !== null) {
      elevation = lerp(0, belowGroundElevation, duskProgress);
      visibility = lerp(1, 0.14, duskProgress);
    }

    const horizontal = Math.cos(arc);

    this.direction.set(horizontal * 0.82, elevation, -0.58).normalize();
    this.position.copy(this.direction).multiplyScalar(this.radius);

    if (this.camera) {
      this.position.add(this.camera.position);
    }

    this.sunMesh.position.copy(this.position);
    this.sunMesh.visible = visibility > 0.02;
    this.sunMesh.material.opacity = (0.72 + clamp(elevation, 0, 1) * 0.26) * visibility;

    const horizonGlow = 1 - smoothStep(clamp(Math.abs(sunProgress - 0.5) * 2, 0, 1));
    const noonBlend = smoothStep(clamp(elevation, 0, 1));
    const color = mixColor(0xff9f4f, 0xfff4d0, noonBlend);
    const groundIllumination = isDaytime ? smoothStep(clamp(elevation * 1.18, 0, 1)) : 0;

    this.eventBus.emit('sun:update', {
      direction: this.direction.clone(),
      position: this.position.clone(),
      elevation,
      color,
      horizonGlow: isDaytime ? horizonGlow : 0,
      groundIllumination,
      intensity: isDaytime ? clamp(elevation, 0.05, 1) : 0,
      isDaytime,
    });
  }

  dispose() {
    this.unsubscribe();
    this.sunMesh.material.map.dispose();
    this.sunMesh.material.dispose();
    this.scene.remove(this.sunMesh);
  }
}
