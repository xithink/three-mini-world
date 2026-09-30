import * as THREE from 'three';

const DEFAULT_KICK_ZONE_SIZE = new THREE.Vector3(1.5, 1, 1);
const DEFAULT_UP = new THREE.Vector3(0, 1, 0);
const SCRATCH_FORWARD = new THREE.Vector3();
const SCRATCH_RIGHT = new THREE.Vector3();
const SCRATCH_CENTER = new THREE.Vector3();
const SCRATCH_HALF_SIZE = new THREE.Vector3();
const SCRATCH_ZONE_SIZE = new THREE.Vector3();
const SCRATCH_FORCE = new THREE.Vector3();

function absComponent(value) {
  return Math.abs(value);
}

/**
 * Handles active melee-style impulses without owning physics or animation data.
 *
 * Attackers and victims are expected to be VoxelPhysicsEntity-compatible objects:
 * they expose `mesh`, `aabb`, `updateAABB()`, and `applyImpulse(force)`.
 */
export class CombatController {
  /**
   * @param {object} [options]
   * @param {number} [options.horizontalForce=14] Forward kick impulse.
   * @param {number} [options.verticalLift=3.5] Upward kick impulse.
   * @param {number} [options.knockdownForceThreshold=13] Force magnitude that knocks victims down.
   * @param {THREE.Vector3} [options.kickZoneSize] Width, height, depth of kick hit box.
   * @param {number} [options.cooldownSeconds=0.45] Minimum time between kicks.
   */
  constructor(options = {}) {
    this.horizontalForce = options.horizontalForce ?? 14;
    this.verticalLift = options.verticalLift ?? 3.5;
    this.knockdownForceThreshold = options.knockdownForceThreshold ?? 13;
    this.kickZoneSize = options.kickZoneSize?.clone?.() ?? DEFAULT_KICK_ZONE_SIZE.clone();
    this.cooldownSeconds = options.cooldownSeconds ?? 0.45;
    this.cooldownTimer = 0;
    this.lastKickZone = new THREE.Box3();
  }

  /**
   * Advances internal cooldowns. Call once per frame from the game loop.
   *
   * @param {number} deltaTime Seconds since last frame.
   */
  update(deltaTime) {
    this.cooldownTimer = Math.max(0, this.cooldownTimer - Math.max(0, deltaTime));
  }

  /**
   * Performs a kick: plays the attacker's kick animation, builds an AABB hit zone
   * in front of the attacker, applies impulse to every victim inside, and starts
   * knockdown animation/state when the kick force crosses the threshold.
   *
   * @param {import('../physics/VoxelPhysicsEntity.js').VoxelPhysicsEntity} attacker
   * @param {Array<import('../physics/VoxelPhysicsEntity.js').VoxelPhysicsEntity>} entitiesList
   * @returns {Array<{ victim: object, force: THREE.Vector3, forceMagnitude: number }>} Hit records.
   */
  kick(attacker, entitiesList) {
    if (this.cooldownTimer > 0 || attacker?.isStunned || attacker?.isKnockedDown) {
      return [];
    }

    this.cooldownTimer = this.cooldownSeconds;
    attacker.animationController?.playKick?.();
    attacker.mesh.userData.animationController?.playKick?.();

    const forward = this.getForward(attacker);
    const kickZone = this.buildKickZone(attacker, forward);
    const hits = [];

    SCRATCH_FORCE
      .copy(forward)
      .multiplyScalar(this.horizontalForce)
      .addScaledVector(DEFAULT_UP, this.verticalLift);

    const forceMagnitude = SCRATCH_FORCE.length();

    for (const victim of entitiesList) {
      if (!victim || victim === attacker || victim.isKnockedDown) {
        continue;
      }

      victim.updateAABB?.();

      if (!victim.aabb || !kickZone.intersectsBox(victim.aabb)) {
        continue;
      }

      const force = SCRATCH_FORCE.clone();

      victim.applyImpulse(force);
      hits.push({ victim, force, forceMagnitude });

      if (forceMagnitude >= this.knockdownForceThreshold) {
        victim.isKnockedDown = true;
        victim.isStunned = true;

        if (!victim.animationController?.playKnockdown?.()) {
          victim.mesh.userData.animationController?.playKnockdown?.();
        }
      }
    }

    return hits;
  }

  /**
   * Builds an axis-aligned approximation of a forward-facing kick volume.
   *
   * Box3 is always world-axis aligned, so the oriented forward/right basis is
   * converted into equivalent world half extents. This keeps broad-phase checks
   * cheap while still allowing the kick to follow character facing.
   *
   * @param {import('../physics/VoxelPhysicsEntity.js').VoxelPhysicsEntity} attacker
   * @param {THREE.Vector3} forward Normalized horizontal facing direction.
   * @returns {THREE.Box3}
   */
  buildKickZone(attacker, forward) {
    const width = this.kickZoneSize.x;
    const height = this.kickZoneSize.y;
    const depth = this.kickZoneSize.z;
    const attackerDepth = attacker.size?.z ?? 0.7;

    SCRATCH_RIGHT.set(forward.z, 0, -forward.x).normalize();
    SCRATCH_CENTER
      .copy(attacker.mesh.position)
      .addScaledVector(DEFAULT_UP, height * 0.5)
      .addScaledVector(forward, attackerDepth * 0.5 + depth * 0.5);

    SCRATCH_HALF_SIZE.set(
      absComponent(SCRATCH_RIGHT.x) * width * 0.5 + absComponent(forward.x) * depth * 0.5,
      height * 0.5,
      absComponent(SCRATCH_RIGHT.z) * width * 0.5 + absComponent(forward.z) * depth * 0.5,
    );

    SCRATCH_ZONE_SIZE.copy(SCRATCH_HALF_SIZE).multiplyScalar(2);
    this.lastKickZone.setFromCenterAndSize(SCRATCH_CENTER, SCRATCH_ZONE_SIZE);
    return this.lastKickZone;
  }

  getForward(entity) {
    if (typeof entity.getForward === 'function') {
      SCRATCH_FORWARD.copy(entity.getForward());
      SCRATCH_FORWARD.y = 0;

      if (SCRATCH_FORWARD.lengthSq() >= 0.0001) {
        return SCRATCH_FORWARD.normalize();
      }
    }

    entity.mesh.getWorldDirection(SCRATCH_FORWARD);
    SCRATCH_FORWARD.y = 0;

    if (SCRATCH_FORWARD.lengthSq() < 0.0001) {
      SCRATCH_FORWARD.set(0, 0, 1);
    }

    return SCRATCH_FORWARD.normalize();
  }
}
