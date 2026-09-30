import * as THREE from 'three';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function createMoonTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;

  const context = canvas.getContext('2d');
  const glow = context.createRadialGradient(64, 64, 18, 64, 64, 62);
  glow.addColorStop(0, 'rgba(245, 249, 255, 1)');
  glow.addColorStop(0.54, 'rgba(203, 214, 225, 0.92)');
  glow.addColorStop(0.7, 'rgba(154, 177, 198, 0.34)');
  glow.addColorStop(1, 'rgba(154, 177, 198, 0)');

  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.globalAlpha = 0.24;
  context.fillStyle = '#7f8fa1';
  [
    { x: 48, y: 44, radius: 7 },
    { x: 78, y: 54, radius: 5 },
    { x: 60, y: 78, radius: 9 },
    { x: 86, y: 82, radius: 4 },
  ].forEach((crater) => {
    context.beginPath();
    context.arc(crater.x, crater.y, crater.radius, 0, Math.PI * 2);
    context.fill();
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

export class MoonSystem {
  constructor({ scene, eventBus, camera = null, radius = 66 }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.camera = camera;
    this.radius = radius;
    this.weatherId = 'clear';
    this.direction = new THREE.Vector3(-0.35, 0.72, -0.28).normalize();
    this.position = new THREE.Vector3();
    this.moonMesh = this.createMoonMesh();
    this.unsubscribe = [
      eventBus.on('time:update', (timeState) => this.updateFromTime(timeState)),
      eventBus.on('weather:update', (weatherState) => {
        this.weatherId = weatherState.weatherId;
      }),
    ];

    scene.add(this.moonMesh);
  }

  createMoonMesh() {
    const material = new THREE.SpriteMaterial({
      map: createMoonTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Sprite(material);
    mesh.name = 'MoonDisc';
    mesh.scale.set(5.8, 5.8, 1);
    mesh.renderOrder = 49;

    return mesh;
  }

  getNightProgress(timeState) {
    const { sunriseHour, sunsetHour } = timeState.solarProfile;
    const currentHour = timeState.normalizedDay * 24;
    const nightDuration = 24 - sunsetHour + sunriseHour;

    if (currentHour >= sunsetHour) {
      return clamp((currentHour - sunsetHour) / nightDuration, 0, 1);
    }

    if (currentHour <= sunriseHour) {
      return clamp((currentHour + 24 - sunsetHour) / nightDuration, 0, 1);
    }

    return 0;
  }

  getStageProgress(timeState, stageId) {
    return timeState.stage.id === stageId ? smoothStep(clamp(timeState.stageProgress, 0, 1)) : null;
  }

  updateFromTime(timeState) {
    const currentHour = timeState.normalizedDay * 24;
    const isNight = currentHour <= timeState.solarProfile.sunriseHour || currentHour >= timeState.solarProfile.sunsetHour;
    const moonProgress = this.getNightProgress(timeState);
    const arc = Math.PI * smoothStep(moonProgress);
    const belowGroundElevation = -0.2;
    const dawnProgress = this.getStageProgress(timeState, 'dawn');
    const duskProgress = this.getStageProgress(timeState, 'dusk');
    let elevation = isNight ? Math.sin(arc) : belowGroundElevation;
    let horizontal = Math.cos(arc);
    let visibility = isNight ? 1 : 0;
    const weatherOpacityScale = this.weatherId === 'rain' || this.weatherId === 'snow' ? 0.58 : 1;

    if (dawnProgress !== null) {
      elevation = lerp(0, belowGroundElevation, dawnProgress);
      horizontal = -1;
      visibility = lerp(1, 0.12, dawnProgress);
    } else if (duskProgress !== null) {
      elevation = lerp(belowGroundElevation, Math.sin(arc), duskProgress);
      visibility = lerp(0.16, 1, duskProgress);
    }

    this.direction.set(-horizontal * 0.76, elevation, -0.64).normalize();
    this.position.copy(this.direction).multiplyScalar(this.radius);

    if (this.camera) {
      this.position.add(this.camera.position);
    }

    this.moonMesh.position.copy(this.position);
    this.moonMesh.visible = visibility > 0.02;
    this.moonMesh.material.opacity = (0.62 + clamp(elevation, 0, 1) * 0.28) * weatherOpacityScale * visibility;

    this.eventBus.emit('moon:update', {
      direction: this.direction.clone(),
      position: this.position.clone(),
      elevation,
      intensity: isNight ? clamp(elevation, 0, 1) : 0,
      isNight,
    });
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.moonMesh.material.map.dispose();
    this.moonMesh.material.dispose();
    this.scene.remove(this.moonMesh);
  }
}
