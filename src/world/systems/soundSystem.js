import { BLOCK_IDS } from '../chunk.js';

const SOUND_ASSETS = Object.freeze({
  background: {
    forest: '/assets/musi/linjian.mp3',
    snow: '/assets/musi/xuedi.mp3',
    water: '/assets/musi/shuiliu.mp3',
    lava: '/assets/musi/yangjiang.mp3',
    cave: '/assets/musi/dongxue.mp3',
    snowMountain: '/assets/musi/xueshannv02.mp3',
    rockMountain: '/assets/musi/yanshishan.mp3',
    forestMountain: '/assets/musi/shanlin02.mp3',
    skyGlide: '/assets/musi/xueshannv02.mp3',
    grass: '/assets/musi/caodi.mp3',
    sand: '/assets/musi/shadi.mp3',
    dirt: '/assets/musi/feixiang.mp3',
    village: '/assets/musi/cunzhuang.mp3',
    villageHealing: '/assets/musi/tianjian.mp3',
    villageField: '/assets/musi/tianjian.mp3',
    villageCafe: '/assets/musi/cafe9.mp3',
    villageTheatre: '/assets/musi/haibiangechang.mp3',
  },
  ambient: {},
  events: {},
  voices: {},
});

const BACKGROUND_TRACK_CONFIG = Object.freeze({
  forest: { volume: 0.42 },
  snow: { volume: 0.46 },
  water: { volume: 0.44 },
  lava: { volume: 0.48 },
  cave: { volume: 0.43 },
  snowMountain: { volume: 0.48 },
  rockMountain: { volume: 0.46 },
  forestMountain: { volume: 0.45 },
  skyGlide: { volume: 0.48 },
  grass: { volume: 0.43 },
  sand: { volume: 0.43 },
  dirt: { volume: 0.43 },
  village: { volume: 0.46 },
  villageHealing: { volume: 0.46 },
  villageField: { volume: 0.46 },
  villageCafe: { volume: 0.45 },
  villageTheatre: { volume: 0.47 },
});

const AMBIENT_PROFILES = Object.freeze({
  forest: { volume: 0.11, filterFrequency: 950, filterQ: 0.7 },
  snow: { volume: 0.16, filterFrequency: 1800, filterQ: 1.4 },
  cave: { volume: 0.13, filterFrequency: 260, filterQ: 1.1 },
  snowMountain: { volume: 0.15, filterFrequency: 1750, filterQ: 1.3 },
  rockMountain: { volume: 0.12, filterFrequency: 360, filterQ: 1.05 },
  forestMountain: { volume: 0.12, filterFrequency: 880, filterQ: 0.75 },
});

const MOUNTAIN_BLOCK_PROFILES = new Map([
  [BLOCK_IDS.SNOW_MOUNTAIN, 'snowMountain'],
  [BLOCK_IDS.ROCK_MOUNTAIN, 'rockMountain'],
  [BLOCK_IDS.FOREST_MOUNTAIN, 'forestMountain'],
]);
const SURFACE_BLOCK_PROFILES = new Map([
  [BLOCK_IDS.GRASS, 'grass'],
  [BLOCK_IDS.DRY_GRASS, 'grass'],
  [BLOCK_IDS.SAND, 'sand'],
  [BLOCK_IDS.DIRT, 'dirt'],
]);
const TREE_BLOCK_IDS = new Set([BLOCK_IDS.WOOD, BLOCK_IDS.LEAVES]);
const SNOW_BLOCK_IDS = new Set([BLOCK_IDS.SNOW, BLOCK_IDS.ICE]);
const CAVE_BLOCK_IDS = new Set([BLOCK_IDS.CAVE_STONE]);
const WATER_BLOCK_IDS = new Set([BLOCK_IDS.WATER]);
const LAVA_BLOCK_IDS = new Set([BLOCK_IDS.LAVA]);
const AIRBORNE_BLOCK_SCAN_DISTANCE = 12;
const VOLUME_KEYS = Object.freeze([
  'backgroundVolume',
  'ambientVolume',
  'eventVolume',
  'voiceVolume',
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class LoopingMediaTrack {
  constructor(src, { volume = 0.4, fadeSpeed = 1.4 } = {}) {
    this.audio = new Audio(src);
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.volume = 0;
    this.baseVolume = volume;
    this.fadeSpeed = fadeSpeed;
    this.currentVolume = 0;
    this.targetVolume = 0;
    this.pendingPlay = null;
  }

  activate() {
    this.targetVolume = this.baseVolume;
  }

  deactivate() {
    this.targetVolume = 0;
    this.currentVolume = 0;
    this.audio.volume = 0;

    if (!this.audio.paused) {
      this.audio.pause();
    }
  }

  update(deltaTime, canPlay, masterVolume) {
    const step = this.fadeSpeed * deltaTime;

    if (this.currentVolume < this.targetVolume) {
      this.currentVolume = Math.min(this.targetVolume, this.currentVolume + step);
    } else if (this.currentVolume > this.targetVolume) {
      this.currentVolume = Math.max(this.targetVolume, this.currentVolume - step);
    }

    this.audio.volume = this.currentVolume * masterVolume;

    if (this.targetVolume > 0 && canPlay) {
      this.ensurePlaying();
    }

    if (this.targetVolume === 0 && this.currentVolume <= 0.001 && !this.audio.paused) {
      this.audio.pause();
    }
  }

  ensurePlaying() {
    if (!this.audio.paused || this.pendingPlay) {
      return;
    }

    this.pendingPlay = this.audio.play()
      .catch(() => {})
      .finally(() => {
        this.pendingPlay = null;
      });
  }

  dispose() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }
}

export class SoundSystem {
  constructor({
    eventBus = null,
    masterVolume = 1,
    backgroundVolume = 1,
    ambientVolume = 1,
    eventVolume = 1,
    voiceVolume = 1,
  } = {}) {
    this.eventBus = eventBus;
    this.masterVolume = masterVolume;
    this.backgroundVolume = backgroundVolume;
    this.ambientVolume = ambientVolume;
    this.eventVolume = eventVolume;
    this.voiceVolume = voiceVolume;
    this.hasUserGesture = false;
    this.isDisposed = false;
    this.activeBackgroundId = null;
    this.activeAmbientId = null;
    this.currentAmbientVolume = 0;
    this.targetAmbientVolume = 0;
    this.lastFootstepTime = 0;
    this.elapsedTime = 0;
    this.audioContext = null;
    this.ambientSource = null;
    this.ambientFilter = null;
    this.ambientGain = null;
    this.eventGain = null;
    this.voiceGain = null;
    this.activeVoiceAudios = new Set();
    this.unsubscribe = [];

    this.backgroundTracks = new Map(
      Object.entries(SOUND_ASSETS.background).map(([id, src]) => [
        id,
        new LoopingMediaTrack(src, BACKGROUND_TRACK_CONFIG[id]),
      ]),
    );

    this.handleUserGesture = this.handleUserGesture.bind(this);

    window.addEventListener('pointerdown', this.handleUserGesture, { passive: true });
    window.addEventListener('keydown', this.handleUserGesture);

    if (this.eventBus) {
      this.unsubscribe.push(
        this.eventBus.on('sound:event', (payload) => this.playEvent(payload?.id, payload)),
        this.eventBus.on('sound:voice', (payload) => this.playVoice(payload?.id, payload)),
        this.eventBus.on('sound:stop-voice', () => this.stopVoice()),
        this.eventBus.on('sound:set-volume', (payload) => this.setVolume(payload?.key, payload?.value)),
        this.eventBus.on('sound:request-volume-state', () => this.emitVolumeState()),
      );
    }
  }

  handleUserGesture() {
    this.hasUserGesture = true;

    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  update(deltaTime, player, worldManager, villageSystem = null) {
    if (this.isDisposed) {
      return;
    }

    this.elapsedTime += deltaTime;

    const terrainProfile = this.getPlaybackProfile(player, worldManager, villageSystem);

    this.setBackground(this.backgroundTracks.has(terrainProfile) ? terrainProfile : null);
    this.setAmbient(terrainProfile);
    this.updateBackground(deltaTime);
    this.updateAmbient(deltaTime);
    this.updateFootsteps(player, terrainProfile);
  }

  getPlaybackProfile(player, worldManager, villageSystem = null) {
    const position = player?.body?.position ?? player?.position ?? null;
    const villageProfile = villageSystem?.getMusicProfileAt?.(position, {
      radius: player?.body?.radius ?? 0.36,
    });

    if (villageProfile) {
      return villageProfile;
    }

    if (player?.isGliding && !player.body?.grounded) {
      return 'skyGlide';
    }

    const topBlockId = this.getTopBlockBelowPlayer(player, worldManager);

    return this.getTerrainProfile(topBlockId);
  }

  getTopBlockBelowPlayer(player, worldManager) {
    if (!player?.body) {
      return BLOCK_IDS.AIR;
    }

    const body = player.body;

    if (worldManager.isBodyInLava(body)) {
      return BLOCK_IDS.LAVA;
    }

    if (worldManager.isBodyInWater(body)) {
      return BLOCK_IDS.WATER;
    }

    const startY = body.position.y - 0.52;
    const endY = startY - AIRBORNE_BLOCK_SCAN_DISTANCE;
    const samplePoints = [
      [body.position.x, body.position.z],
      [body.position.x + body.radius * 0.55, body.position.z],
      [body.position.x - body.radius * 0.55, body.position.z],
      [body.position.x, body.position.z + body.radius * 0.55],
      [body.position.x, body.position.z - body.radius * 0.55],
    ];

    for (let y = startY; y >= endY; y -= 1) {
      for (const [x, z] of samplePoints) {
        const blockId = worldManager.getBlockAt(x, y, z);

        if (blockId !== BLOCK_IDS.AIR) {
          return blockId;
        }
      }
    }

    return BLOCK_IDS.AIR;
  }

  getTerrainProfile(blockId) {
    if (LAVA_BLOCK_IDS.has(blockId)) {
      return 'lava';
    }

    if (WATER_BLOCK_IDS.has(blockId)) {
      return 'water';
    }

    if (MOUNTAIN_BLOCK_PROFILES.has(blockId)) {
      return MOUNTAIN_BLOCK_PROFILES.get(blockId);
    }

    if (SURFACE_BLOCK_PROFILES.has(blockId)) {
      return SURFACE_BLOCK_PROFILES.get(blockId);
    }

    if (SNOW_BLOCK_IDS.has(blockId)) {
      return 'snow';
    }

    if (TREE_BLOCK_IDS.has(blockId)) {
      return 'forest';
    }

    if (CAVE_BLOCK_IDS.has(blockId)) {
      return 'cave';
    }

    return null;
  }

  setBackground(trackId) {
    if (this.activeBackgroundId === trackId) {
      return;
    }

    this.backgroundTracks.get(this.activeBackgroundId)?.deactivate();
    this.activeBackgroundId = trackId;
    this.backgroundTracks.get(trackId)?.activate();
  }

  updateBackground(deltaTime) {
    const canPlay = this.hasUserGesture;

    for (const track of this.backgroundTracks.values()) {
      track.update(deltaTime, canPlay, this.masterVolume * this.backgroundVolume);
    }
  }

  setVolume(key, value) {
    if (!VOLUME_KEYS.includes(key)) {
      return;
    }

    this[key] = clamp(Number(value), 0, 1);
    this.emitVolumeState();
  }

  getVolumeState() {
    return {
      backgroundVolume: this.backgroundVolume,
      ambientVolume: this.ambientVolume,
      eventVolume: this.eventVolume,
      voiceVolume: this.voiceVolume,
    };
  }

  emitVolumeState() {
    this.eventBus?.emit('sound:volume-state', this.getVolumeState());
  }

  setAmbient(profileId) {
    this.activeAmbientId = AMBIENT_PROFILES[profileId] ? profileId : null;
  }

  updateAmbient(deltaTime) {
    if (!this.hasUserGesture || !this.ensureAudioGraph()) {
      return;
    }

    const profile = AMBIENT_PROFILES[this.activeAmbientId];
    this.targetAmbientVolume = profile ? profile.volume : 0;

    if (profile) {
      this.ambientFilter.frequency.setTargetAtTime(profile.filterFrequency, this.audioContext.currentTime, 0.18);
      this.ambientFilter.Q.setTargetAtTime(profile.filterQ, this.audioContext.currentTime, 0.18);
    }

    const step = 0.45 * deltaTime;

    if (this.currentAmbientVolume < this.targetAmbientVolume) {
      this.currentAmbientVolume = Math.min(this.targetAmbientVolume, this.currentAmbientVolume + step);
    } else if (this.currentAmbientVolume > this.targetAmbientVolume) {
      this.currentAmbientVolume = Math.max(this.targetAmbientVolume, this.currentAmbientVolume - step);
    }

    this.ambientGain.gain.setTargetAtTime(
      this.currentAmbientVolume * this.masterVolume * this.ambientVolume,
      this.audioContext.currentTime,
      0.08,
    );
  }

  updateFootsteps(player, terrainProfile) {
    if (!player?.body?.grounded || !terrainProfile) {
      return;
    }

    const horizontalSpeed = Math.hypot(player.velocity.x, player.velocity.z);

    if (horizontalSpeed < 0.25) {
      return;
    }

    const interval = clamp(0.48 - horizontalSpeed * 0.035, 0.2, 0.48);

    if (this.elapsedTime - this.lastFootstepTime < interval) {
      return;
    }

    this.lastFootstepTime = this.elapsedTime;
    this.playEvent(`footstep:${terrainProfile}`, { strength: clamp(horizontalSpeed / player.speed, 0.35, 1) });
  }

  playEvent(eventId, payload = {}) {
    if (!eventId || !this.hasUserGesture || !this.ensureAudioGraph()) {
      return;
    }

    if (eventId === 'animal:bird-chirp') {
      this.playChirp({ volume: 0.06 * (payload.strength ?? 1), baseFrequency: 980, calls: 3 });
      return;
    }

    if (eventId === 'animal:bird-caw') {
      this.playChirp({ volume: 0.055 * (payload.strength ?? 1), baseFrequency: 520, calls: 2, type: 'square' });
      return;
    }

    if (eventId === 'animal:owl-hoot') {
      this.playHoot({ volume: 0.08 * (payload.strength ?? 1), baseFrequency: 230 });
      return;
    }

    if (eventId === 'animal:reptile-hiss') {
      this.playFilteredNoise({ duration: 0.38, volume: 0.055 * (payload.strength ?? 1), filterFrequency: 3600, filterType: 'highpass' });
      return;
    }

    if (eventId === 'animal:wolf-howl') {
      this.playHowl({ volume: 0.09 * (payload.strength ?? 1), baseFrequency: 310 });
      return;
    }

    if (eventId === 'animal:bigcat-growl') {
      this.playGrowl({ volume: 0.095 * (payload.strength ?? 1), baseFrequency: 82 });
      return;
    }

    if (eventId === 'footstep:snow') {
      this.playNoiseBurst({ duration: 0.08, volume: 0.08 * (payload.strength ?? 1), filterFrequency: 2100 });
      return;
    }

    if (eventId === 'footstep:forest') {
      this.playTone({ frequency: 150, duration: 0.075, volume: 0.055 * (payload.strength ?? 1), type: 'triangle' });
      return;
    }

    if (eventId === 'footstep:cave') {
      this.playTone({ frequency: 96, duration: 0.11, volume: 0.065 * (payload.strength ?? 1), type: 'sine' });
      return;
    }

    this.playTone({ frequency: 260, duration: 0.08, volume: 0.04, type: 'sine' });
  }

  playVoice(voiceId, payload = {}) {
    if (!voiceId || !this.hasUserGesture) {
      return;
    }

    const src = SOUND_ASSETS.voices[voiceId];

    if (src) {
      const voice = new Audio(src);
      voice.volume = this.masterVolume * this.voiceVolume * (payload.volume ?? 0.75);
      this.activeVoiceAudios.add(voice);
      voice.addEventListener('ended', () => this.activeVoiceAudios.delete(voice), { once: true });
      voice.play().catch(() => {
        this.activeVoiceAudios.delete(voice);
      });
      return;
    }

    if (!('speechSynthesis' in window)) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(payload.text ?? String(voiceId));
    utterance.volume = clamp(this.masterVolume * this.voiceVolume * (payload.volume ?? 0.7), 0, 1);
    utterance.rate = payload.rate ?? 1;
    utterance.pitch = payload.pitch ?? 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  stopVoice() {
    for (const voice of this.activeVoiceAudios) {
      voice.pause();
      voice.currentTime = 0;
    }

    this.activeVoiceAudios.clear();

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  ensureAudioGraph() {
    if (this.audioContext) {
      return true;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return false;
    }

    this.audioContext = new AudioContextClass();
    this.ambientGain = this.audioContext.createGain();
    this.eventGain = this.audioContext.createGain();
    this.voiceGain = this.audioContext.createGain();
    this.ambientFilter = this.audioContext.createBiquadFilter();
    this.ambientFilter.type = 'bandpass';
    this.ambientFilter.frequency.value = 950;
    this.ambientFilter.Q.value = 0.7;
    this.ambientGain.gain.value = 0;
    this.eventGain.gain.value = 1;
    this.voiceGain.gain.value = 1;

    this.ambientSource = this.createLoopingNoiseSource();
    this.ambientSource.connect(this.ambientFilter);
    this.ambientFilter.connect(this.ambientGain);
    this.ambientGain.connect(this.audioContext.destination);
    this.eventGain.connect(this.audioContext.destination);
    this.voiceGain.connect(this.audioContext.destination);
    this.ambientSource.start();

    return true;
  }

  createLoopingNoiseSource() {
    const duration = 2;
    const sampleRate = this.audioContext.sampleRate;
    const buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate);
    const channel = buffer.getChannelData(0);
    let value = 0;

    for (let i = 0; i < channel.length; i += 1) {
      value = value * 0.84 + (Math.random() * 2 - 1) * 0.16;
      channel[i] = value;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    return source;
  }

  playNoiseBurst({ duration, volume, filterFrequency }) {
    const sampleRate = this.audioContext.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = this.audioContext.createBuffer(1, length, sampleRate);
    const channel = buffer.getChannelData(0);

    for (let i = 0; i < length; i += 1) {
      const envelope = 1 - i / length;
      channel[i] = (Math.random() * 2 - 1) * envelope;
    }

    const source = this.audioContext.createBufferSource();
    const filter = this.audioContext.createBiquadFilter();
    const gain = this.audioContext.createGain();
    const now = this.audioContext.currentTime;

    filter.type = 'highpass';
    filter.frequency.value = filterFrequency;
    gain.gain.setValueAtTime(volume * this.masterVolume * this.eventVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.eventGain);
    source.start(now);
    source.stop(now + duration);
  }

  playFilteredNoise({ duration, volume, filterFrequency, filterType = 'bandpass' }) {
    const sampleRate = this.audioContext.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = this.audioContext.createBuffer(1, length, sampleRate);
    const channel = buffer.getChannelData(0);
    let value = 0;

    for (let i = 0; i < length; i += 1) {
      const envelope = Math.sin((i / length) * Math.PI);
      value = value * 0.62 + (Math.random() * 2 - 1) * 0.38;
      channel[i] = value * envelope;
    }

    const source = this.audioContext.createBufferSource();
    const filter = this.audioContext.createBiquadFilter();
    const gain = this.audioContext.createGain();
    const now = this.audioContext.currentTime;

    filter.type = filterType;
    filter.frequency.value = filterFrequency;
    filter.Q.value = 1.8;
    gain.gain.setValueAtTime(volume * this.masterVolume * this.eventVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.eventGain);
    source.start(now);
    source.stop(now + duration);
  }

  playChirp({ volume, baseFrequency, calls, type = 'sine' }) {
    for (let index = 0; index < calls; index += 1) {
      this.playScheduledTone({
        frequency: baseFrequency + index * 70,
        endFrequency: baseFrequency * 1.22 + index * 50,
        startTime: this.audioContext.currentTime + index * 0.085,
        duration: 0.065,
        volume: volume * (1 - index * 0.12),
        type,
      });
    }
  }

  playHoot({ volume, baseFrequency }) {
    this.playScheduledTone({
      frequency: baseFrequency,
      endFrequency: baseFrequency * 0.82,
      startTime: this.audioContext.currentTime,
      duration: 0.42,
      volume,
      type: 'sine',
    });
    this.playScheduledTone({
      frequency: baseFrequency * 0.72,
      endFrequency: baseFrequency * 0.68,
      startTime: this.audioContext.currentTime + 0.18,
      duration: 0.36,
      volume: volume * 0.74,
      type: 'triangle',
    });
  }

  playHowl({ volume, baseFrequency }) {
    this.playScheduledTone({
      frequency: baseFrequency * 0.72,
      endFrequency: baseFrequency * 1.16,
      startTime: this.audioContext.currentTime,
      duration: 0.92,
      volume,
      type: 'sine',
    });
  }

  playGrowl({ volume, baseFrequency }) {
    this.playFilteredNoise({
      duration: 0.52,
      volume: volume * 0.74,
      filterFrequency: 180,
      filterType: 'lowpass',
    });
    this.playScheduledTone({
      frequency: baseFrequency,
      endFrequency: baseFrequency * 0.86,
      startTime: this.audioContext.currentTime,
      duration: 0.55,
      volume,
      type: 'sawtooth',
    });
  }

  playScheduledTone({ frequency, endFrequency = frequency, startTime, duration, volume, type }) {
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), startTime + duration);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * this.masterVolume * this.eventVolume), startTime + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    oscillator.connect(gain);
    gain.connect(this.eventGain);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
  }

  playTone({ frequency, duration, volume, type }) {
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const now = this.audioContext.currentTime;

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume * this.masterVolume * this.eventVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.eventGain);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  dispose() {
    this.isDisposed = true;
    window.removeEventListener('pointerdown', this.handleUserGesture);
    window.removeEventListener('keydown', this.handleUserGesture);
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.backgroundTracks.forEach((track) => track.dispose());
    this.stopVoice();

    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}
