import * as THREE from 'three';
import { BLOCK_IDS } from '../chunk.js';

const TNT_BLAST_RADIUS = 3.2;
const SMOKE_DURATION_SECONDS = 10;
const SMOKE_PARTICLE_COUNT = 520;
const SMOKE_RADIUS = 5.2;
const SHARD_DURATION_SECONDS = 3;
const LEAF_DURATION_SECONDS = 6;
const BLINDNESS_DURATION_SECONDS = 3;
const STAMINA_DRAIN_DURATION_SECONDS = 3;
const STAMINA_DRAIN_PER_SECOND = 16;
const WEATHER_ALERT_RADIUS = 18;
const WEATHER_KNOCKBACK_DISTANCE = 10;
const TNT_CHAIN_DELAY_SECONDS = 0.18;
const DEFAULT_UP = new THREE.Vector3(0, 1, 0);

function getBlastDirection(from, center, fallback = new THREE.Vector3(1, 0, 0)) {
  const direction = from.clone().sub(center);

  direction.y = 0;
  if (direction.lengthSq() < 0.0001) {
    direction.copy(fallback);
  }

  return direction.normalize();
}

function scanBlocks(worldManager, center, radius, blockId) {
  const blocks = [];
  const minX = Math.floor(center.x - radius);
  const maxX = Math.ceil(center.x + radius);
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.ceil(center.y + radius);
  const minZ = Math.floor(center.z - radius);
  const maxZ = Math.ceil(center.z + radius);

  for (let y = minY; y <= maxY; y += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (Math.hypot(x - center.x, y - center.y, z - center.z) > radius) {
          continue;
        }

        if (worldManager.getBlockAtIfLoaded(x, y, z) === blockId) {
          blocks.push({ x, y, z, blockId });
        }
      }
    }
  }

  return blocks;
}

function createSmokeCloud(center) {
  const positions = new Float32Array(SMOKE_PARTICLE_COUNT * 3);
  const velocities = new Float32Array(SMOKE_PARTICLE_COUNT * 3);

  for (let index = 0; index < SMOKE_PARTICLE_COUNT; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SMOKE_RADIUS;
    const height = Math.random() * 3.2 - 0.35;
    const offset = index * 3;

    positions[offset] = Math.cos(angle) * radius;
    positions[offset + 1] = height;
    positions[offset + 2] = Math.sin(angle) * radius;
    velocities[offset] = Math.cos(angle) * (0.14 + Math.random() * 0.35);
    velocities[offset + 1] = 0.18 + Math.random() * 0.28;
    velocities[offset + 2] = Math.sin(angle) * (0.14 + Math.random() * 0.35);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xf7f7f1,
    size: 0.42,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);

  points.name = 'TntWhiteSmoke';
  points.position.copy(center);

  return {
    object: points,
    velocities,
    elapsed: 0,
    duration: SMOKE_DURATION_SECONDS,
    center: center.clone(),
    radius: SMOKE_RADIUS,
  };
}

function createBurstPoints({ blocks, center, color, count, duration, size, lift = 2.6, spread = 6.5 }) {
  const particleCount = Math.max(1, count);
  const positions = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount * 3);

  for (let index = 0; index < particleCount; index += 1) {
    const source = blocks[index % Math.max(1, blocks.length)] ?? center;
    const sourcePosition = new THREE.Vector3(source.x, source.y, source.z);
    const direction = getBlastDirection(sourcePosition, center, new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5));
    const offset = index * 3;
    const sideways = (Math.random() - 0.5) * 1.7;

    positions[offset] = sourcePosition.x + (Math.random() - 0.5) * 0.6;
    positions[offset + 1] = sourcePosition.y + (Math.random() - 0.5) * 0.6;
    positions[offset + 2] = sourcePosition.z + (Math.random() - 0.5) * 0.6;
    velocities[offset] = direction.x * (spread * (0.45 + Math.random())) + direction.z * sideways;
    velocities[offset + 1] = lift * (0.45 + Math.random());
    velocities[offset + 2] = direction.z * (spread * (0.45 + Math.random())) - direction.x * sideways;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });

  return {
    object: new THREE.Points(geometry, material),
    velocities,
    elapsed: 0,
    duration,
  };
}

export class ExplosionEffectSystem {
  constructor({ scene, container, eventBus, worldManager, player, npcSystem }) {
    this.scene = scene;
    this.container = container;
    this.eventBus = eventBus;
    this.worldManager = worldManager;
    this.player = player;
    this.npcSystem = npcSystem;
    this.smokeClouds = [];
    this.bursts = [];
    this.pendingTntExplosions = [];
    this.playerStaminaDrainTimer = 0;
    this.blindnessTimer = 0;
    this.overlay = this.createOverlay();
    this.unsubscribe = [
      eventBus.on('tnt:explode', ({ center, radius = TNT_BLAST_RADIUS, damageWorld = true } = {}) => {
        if (center) {
          this.handleTntExplosion(new THREE.Vector3(center.x, center.y, center.z), radius, { damageWorld });
        }
      }),
      eventBus.on('weather:alert', ({ center, radius = WEATHER_ALERT_RADIUS } = {}) => {
        if (center) {
          this.applyWeatherAlert(new THREE.Vector3(center.x, center.y, center.z), radius);
        }
      }),
    ];

    this.container.append(this.overlay);
  }

  createOverlay() {
    const element = document.createElement('div');

    element.className = 'explosion-blindness';
    element.setAttribute('aria-hidden', 'true');

    return element;
  }

  handleTntExplosion(center, radius, { damageWorld = true } = {}) {
    this.queueChainedTnt(center, radius);

    const glassBlocks = scanBlocks(this.worldManager, center, radius, BLOCK_IDS.GLASS);
    const leafBlocks = scanBlocks(this.worldManager, center, radius + 1.2, BLOCK_IDS.LEAVES);

    this.breakSpecialBlocks(glassBlocks, BLOCK_IDS.GLASS);
    this.breakSpecialBlocks(leafBlocks, BLOCK_IDS.LEAVES);
    this.spawnSmoke(center);

    if (glassBlocks.length) {
      this.spawnGlassShards(glassBlocks, center);
      this.hitEntities(center, radius + 1.2, {
        knockdownSeconds: 3,
        knockbackDistance: 4.5,
        drainPlayerStamina: true,
      });
    } else {
      this.hitEntities(center, radius, {
        knockdownSeconds: 2.2,
        knockbackDistance: 3.2,
      });
    }

    if (leafBlocks.length) {
      this.spawnFallingLeaves(leafBlocks, center);
      if (this.player.position.distanceTo(center) <= radius + 4) {
        this.blindnessTimer = Math.max(this.blindnessTimer, BLINDNESS_DURATION_SECONDS);
      }
    }

    if (damageWorld) {
      this.worldManager.damageSphere(center, radius);
    }
  }

  queueChainedTnt(center, radius) {
    const tntBlocks = scanBlocks(this.worldManager, center, radius, BLOCK_IDS.TNT);

    if (!tntBlocks.length) {
      return;
    }

    tntBlocks.forEach((block) => {
      this.worldManager.setBlockAt(block.x, block.y, block.z, BLOCK_IDS.AIR);
      this.pendingTntExplosions.push({
        center: new THREE.Vector3(block.x, block.y, block.z),
        radius: TNT_BLAST_RADIUS,
        delay: TNT_CHAIN_DELAY_SECONDS + Math.random() * 0.12,
      });
    });
  }

  breakSpecialBlocks(blocks, replacementBlockId) {
    if (!blocks.length) {
      return;
    }

    this.worldManager.setBlocksAt(blocks.map((block) => ({
      x: block.x,
      y: block.y,
      z: block.z,
      blockId: BLOCK_IDS.AIR,
      replacedBlockId: replacementBlockId,
    })));
  }

  spawnSmoke(center) {
    const smoke = createSmokeCloud(center);

    this.smokeClouds.push(smoke);
    this.scene.add(smoke.object);
  }

  spawnGlassShards(blocks, center) {
    const burst = createBurstPoints({
      blocks,
      center,
      color: 0xcff7ff,
      count: Math.min(220, Math.max(40, blocks.length * 12)),
      duration: SHARD_DURATION_SECONDS,
      size: 0.09,
      lift: 3.4,
      spread: 8.5,
    });

    burst.object.name = 'GlassShards';
    this.bursts.push(burst);
    this.scene.add(burst.object);
  }

  spawnFallingLeaves(blocks, center) {
    const burst = createBurstPoints({
      blocks,
      center,
      color: 0x54b957,
      count: Math.min(520, Math.max(220, blocks.length * 18)),
      duration: LEAF_DURATION_SECONDS,
      size: 0.13,
      lift: 2.2,
      spread: 5.2,
    });

    burst.object.name = 'FallingLeafFragments';
    this.bursts.push(burst);
    this.scene.add(burst.object);
  }

  hitEntities(center, radius, { knockdownSeconds, knockbackDistance, drainPlayerStamina = false } = {}) {
    if (this.player.position.distanceTo(center) <= radius) {
      this.knockPlayerFrom(center, knockdownSeconds, knockbackDistance);
      if (drainPlayerStamina) {
        this.playerStaminaDrainTimer = Math.max(this.playerStaminaDrainTimer, STAMINA_DRAIN_DURATION_SECONDS);
      }
    }

    this.npcSystem.getCombatEntities().forEach((entity) => {
      const npcPosition = entity.mesh.position;

      if (npcPosition.distanceTo(center) > radius) {
        return;
      }

      const direction = getBlastDirection(npcPosition, center);

      entity.applyImpulse?.(direction.multiplyScalar(knockbackDistance * 1.6).addScaledVector(DEFAULT_UP, 2.5));
      entity.knockDown?.(knockdownSeconds);
      entity.animationController?.playKnockdown?.();
    });
  }

  knockPlayerFrom(center, seconds = 3, distance = 4) {
    const direction = getBlastDirection(this.player.position, center);

    this.player.position.addScaledVector(direction, distance);
    this.player.body.velocity.copy(direction.multiplyScalar(9)).addScaledVector(DEFAULT_UP, 3.2);
    this.player.body.grounded = false;
    this.player.knockDown?.(seconds);
  }

  applyWeatherAlert(center, radius) {
    this.hitEntities(center, radius, {
      knockdownSeconds: 3,
      knockbackDistance: WEATHER_KNOCKBACK_DISTANCE,
    });
  }

  update(deltaTime) {
    this.updatePendingTntExplosions(deltaTime);
    this.updateSmoke(deltaTime);
    this.updateBursts(deltaTime);
    this.updatePlayerEffects(deltaTime);
  }

  updatePendingTntExplosions(deltaTime) {
    const ready = [];

    this.pendingTntExplosions = this.pendingTntExplosions.filter((explosion) => {
      explosion.delay -= deltaTime;

      if (explosion.delay > 0) {
        return true;
      }

      ready.push(explosion);
      return false;
    });

    ready.forEach((explosion) => {
      this.handleTntExplosion(explosion.center, explosion.radius, { damageWorld: true });
    });
  }

  updateSmoke(deltaTime) {
    let isPlayerInSmoke = false;

    this.smokeClouds = this.smokeClouds.filter((smoke) => {
      smoke.elapsed += deltaTime;
      const positions = smoke.object.geometry.getAttribute('position');
      const fade = 1 - smoke.elapsed / smoke.duration;

      for (let index = 0; index < positions.count; index += 1) {
        const offset = index * 3;
        positions.setX(index, positions.getX(index) + smoke.velocities[offset] * deltaTime);
        positions.setY(index, positions.getY(index) + smoke.velocities[offset + 1] * deltaTime);
        positions.setZ(index, positions.getZ(index) + smoke.velocities[offset + 2] * deltaTime);
      }

      positions.needsUpdate = true;
      smoke.object.material.opacity = Math.max(0, 0.86 * fade);

      if (this.player.position.distanceTo(smoke.center) <= smoke.radius && smoke.elapsed <= smoke.duration) {
        isPlayerInSmoke = true;
      }

      if (smoke.elapsed < smoke.duration) {
        return true;
      }

      this.scene.remove(smoke.object);
      smoke.object.geometry.dispose();
      smoke.object.material.dispose();
      return false;
    });

    this.container.classList.toggle('is-smoke-obscured', isPlayerInSmoke);
  }

  updateBursts(deltaTime) {
    this.bursts = this.bursts.filter((burst) => {
      burst.elapsed += deltaTime;
      const positions = burst.object.geometry.getAttribute('position');
      const fade = 1 - burst.elapsed / burst.duration;

      for (let index = 0; index < positions.count; index += 1) {
        const offset = index * 3;
        burst.velocities[offset + 1] -= 5.8 * deltaTime;
        positions.setX(index, positions.getX(index) + burst.velocities[offset] * deltaTime);
        positions.setY(index, positions.getY(index) + burst.velocities[offset + 1] * deltaTime);
        positions.setZ(index, positions.getZ(index) + burst.velocities[offset + 2] * deltaTime);
      }

      positions.needsUpdate = true;
      burst.object.material.opacity = Math.max(0, 0.9 * fade);

      if (burst.elapsed < burst.duration) {
        return true;
      }

      this.scene.remove(burst.object);
      burst.object.geometry.dispose();
      burst.object.material.dispose();
      return false;
    });
  }

  updatePlayerEffects(deltaTime) {
    if (this.playerStaminaDrainTimer > 0) {
      this.playerStaminaDrainTimer = Math.max(0, this.playerStaminaDrainTimer - deltaTime);
      this.player.consumeStamina?.(STAMINA_DRAIN_PER_SECOND * deltaTime);
    }

    this.blindnessTimer = Math.max(0, this.blindnessTimer - deltaTime);
    this.overlay.classList.toggle('is-active', this.blindnessTimer > 0);
    this.overlay.style.opacity = this.blindnessTimer > 0
      ? String(Math.min(0.84, 0.32 + this.blindnessTimer / BLINDNESS_DURATION_SECONDS * 0.52))
      : '0';
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.container.classList.remove('is-smoke-obscured');
    this.overlay.remove();
    [...this.smokeClouds, ...this.bursts].forEach((effect) => {
      this.scene.remove(effect.object);
      effect.object.geometry.dispose();
      effect.object.material.dispose();
    });
    this.smokeClouds = [];
    this.bursts = [];
    this.pendingTntExplosions = [];
  }
}
