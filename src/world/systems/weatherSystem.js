import * as THREE from 'three';

const WEATHER_BY_SEASON = Object.freeze({
  spring: ['clear', 'rain', 'clear', 'rain'],
  summer: ['clear', 'clear', 'rain', 'clear'],
  autumn: ['clear', 'rain', 'clear', 'clear'],
  winter: ['snow', 'clear', 'snow', 'aurora'],
});

function createParticlePoints({ color, count, size }) {
  const positions = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (Math.random() - 0.5) * 34;
    positions[index * 3 + 1] = Math.random() * 16 + 4;
    positions[index * 3 + 2] = (Math.random() - 0.5) * 34;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}

export class WeatherSystem {
  constructor({ scene, eventBus, player }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.player = player;
    this.weatherId = 'clear';
    this.seasonId = 'summer';
    this.biologyState = null;
    this.rain = createParticlePoints({ color: 0x8fc7ff, count: 280, size: 0.035 });
    this.snow = createParticlePoints({ color: 0xf2fbff, count: 230, size: 0.08 });
    this.aurora = this.createAurora();
    this.unsubscribe = [
      eventBus.on('time:update', (timeState) => this.updateWeatherChoice(timeState)),
      eventBus.on('biology:update', (biologyState) => {
        this.biologyState = biologyState;
        this.seasonId = biologyState.seasonId;
      }),
    ];

    this.rain.name = 'RainParticles';
    this.snow.name = 'SnowParticles';
    this.rain.visible = false;
    this.snow.visible = false;
    this.aurora.visible = false;
    scene.add(this.rain, this.snow, this.aurora);
  }

  createAurora() {
    const geometry = new THREE.PlaneGeometry(48, 10, 16, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0x56ffd2,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'AuroraBand';
    mesh.position.set(0, 22, 28);
    mesh.rotation.x = -0.38;

    return mesh;
  }

  updateWeatherChoice(timeState) {
    const weatherId = this.resolveWeatherId(timeState);
    const isNight = timeState.stage.id === 'night' || timeState.stage.id === 'preDawn';
    const resolvedWeatherId = weatherId === 'aurora' && !isNight ? 'clear' : weatherId;

    if (resolvedWeatherId !== this.weatherId) {
      this.weatherId = resolvedWeatherId;
      this.rain.visible = resolvedWeatherId === 'rain';
      this.snow.visible = resolvedWeatherId === 'snow';
      this.aurora.visible = resolvedWeatherId === 'aurora';
      this.eventBus.emit('weather:update', {
        weatherId: resolvedWeatherId,
        seasonId: this.seasonId,
      });
      if (!timeState.isManualTimeChange && (resolvedWeatherId === 'rain' || resolvedWeatherId === 'snow')) {
        this.eventBus.emit('weather:alert', {
          weatherId: resolvedWeatherId,
          center: {
            x: this.player.position.x,
            y: this.player.position.y,
            z: this.player.position.z,
          },
          radius: 18,
        });
      }
    }
  }

  resolveWeatherId(timeState) {
    const options = WEATHER_BY_SEASON[this.seasonId] ?? WEATHER_BY_SEASON.summer;
    const weatherSlot = Math.floor(timeState.secondsInDay / 190);
    const ecology = this.biologyState?.ecology;
    const seasonalWeatherId = options[(timeState.dayOfYear + weatherSlot) % options.length];

    if (!ecology) {
      return seasonalWeatherId;
    }

    const isNight = timeState.stage.id === 'night' || timeState.stage.id === 'preDawn';

    if (this.seasonId === 'winter' && isNight && (timeState.dayOfYear + weatherSlot) % 5 === 0) {
      return 'aurora';
    }

    if (ecology.snowCoverage > 0.58 && (timeState.dayOfYear + weatherSlot) % 2 === 0) {
      return 'snow';
    }

    if (ecology.moisture > 0.64 && (timeState.dayOfYear + weatherSlot) % 3 !== 0) {
      return 'rain';
    }

    return seasonalWeatherId;
  }

  update(deltaTime) {
    this.updateParticles(this.rain, deltaTime, 15);
    this.updateParticles(this.snow, deltaTime, 4.2);
    this.aurora.material.opacity = this.weatherId === 'aurora'
      ? 0.22 + Math.sin(performance.now() * 0.0012) * 0.06
      : 0;
  }

  updateParticles(points, deltaTime, fallSpeed) {
    if (!points.visible) {
      return;
    }

    const positions = points.geometry.getAttribute('position');
    const playerPosition = this.player?.position ?? new THREE.Vector3();
    points.position.set(playerPosition.x, playerPosition.y, playerPosition.z);

    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index) - deltaTime * fallSpeed;

      if (y < 0) {
        positions.setY(index, 18);
        positions.setX(index, (Math.random() - 0.5) * 34);
        positions.setZ(index, (Math.random() - 0.5) * 34);
      } else {
        positions.setY(index, y);
      }
    }

    positions.needsUpdate = true;
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    [this.rain, this.snow, this.aurora].forEach((object) => {
      this.scene.remove(object);
      object.geometry.dispose();
      object.material.dispose();
    });
  }
}
