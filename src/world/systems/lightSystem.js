import * as THREE from 'three';

const SEASON_LIGHT_TINT = Object.freeze({
  spring: 0xf5fff0,
  summer: 0xffffff,
  autumn: 0xffe1bd,
  winter: 0xeaf7ff,
});

export class LightSystem {
  constructor({ scene, eventBus, player = null }) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.player = player;
    this.seasonId = 'summer';
    this.weatherId = 'clear';
    this.ambientLight = new THREE.AmbientLight(0xf3fbff, 0.78);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.8);
    this.sunTarget = new THREE.Object3D();
    this.moonLight = new THREE.DirectionalLight(0xbdd7ff, 0.18);
    this.rimLight = new THREE.DirectionalLight(0xb9e6ff, 0.58);
    this.waterHighlight = new THREE.PointLight(0xbfefff, 1.5, 18, 2);
    this.unsubscribe = [
      eventBus.on('sun:update', (sunState) => this.updateFromSun(sunState)),
      eventBus.on('moon:update', (moonState) => this.updateFromMoon(moonState)),
      eventBus.on('biology:update', (biologyState) => {
        this.seasonId = biologyState.seasonId;
      }),
      eventBus.on('weather:update', (weatherState) => {
        this.weatherId = weatherState.weatherId;
      }),
    ];

    this.configureShadows();
    this.moonLight.position.set(-18, 18, -14);
    this.rimLight.position.set(-12, 8, -10);
    this.waterHighlight.position.set(-2, 6.5, 1);
    this.sunTarget.name = 'SunLightTarget';
    this.updateShadowTarget();
    this.sunLight.target = this.sunTarget;
    scene.add(this.ambientLight, this.sunLight, this.sunTarget, this.moonLight, this.rimLight, this.waterHighlight);
  }

  configureShadows() {
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -44;
    this.sunLight.shadow.camera.right = 44;
    this.sunLight.shadow.camera.top = 44;
    this.sunLight.shadow.camera.bottom = -44;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 78;
    this.sunLight.shadow.bias = -0.0008;
  }

  updateShadowTarget() {
    if (this.player) {
      this.sunTarget.position.set(
        this.player.position.x,
        this.player.position.y + 1,
        this.player.position.z,
      );
      return;
    }

    this.sunTarget.position.set(0, 3, 0);
  }

  updateFromSun(sunState) {
    const tint = new THREE.Color(SEASON_LIGHT_TINT[this.seasonId] ?? 0xffffff);
    const weatherScale = this.weatherId === 'clear' || this.weatherId === 'aurora' ? 1 : 0.68;
    const ambientWeatherScale = this.weatherId === 'snow' ? 1.08 : weatherScale;
    const sunColor = sunState.color ? sunState.color.clone() : new THREE.Color(0xffffff);
    const groundIllumination = sunState.groundIllumination ?? sunState.intensity;

    sunColor.lerp(tint, 0.32);
    this.updateShadowTarget();
    this.sunLight.position.copy(sunState.direction).multiplyScalar(42).add(this.sunTarget.position);
    this.sunLight.color.copy(sunColor);
    this.sunLight.intensity = (0.08 + groundIllumination * 3.35) * weatherScale;
    this.sunLight.castShadow = sunState.isDaytime;
    this.ambientLight.color.copy(sunColor).lerp(new THREE.Color(0xdbeeff), sunState.isDaytime ? 0.4 : 0.78);
    this.ambientLight.intensity = (sunState.isDaytime ? 0.28 + groundIllumination * 0.52 : 0.18) * ambientWeatherScale;
    this.rimLight.color.copy(sunColor).lerp(new THREE.Color(0xb9e6ff), 0.55);
    this.rimLight.intensity = sunState.isDaytime ? 0.18 + (sunState.horizonGlow ?? 0) * 0.38 : 0.15;
  }

  updateFromMoon(moonState) {
    const weatherScale = this.weatherId === 'rain' || this.weatherId === 'snow' ? 0.5 : 1;

    this.moonLight.position.copy(moonState.direction).multiplyScalar(28);
    this.moonLight.intensity = moonState.isNight ? moonState.intensity * 0.34 * weatherScale : 0;
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.scene.remove(this.ambientLight, this.sunLight, this.sunTarget, this.moonLight, this.rimLight, this.waterHighlight);
  }
}
