import * as THREE from 'three';

const DEFAULT_BODY_SIZE = new THREE.Vector3(0.7, 1.8, 0.7);
const DEFAULT_GRAVITY = new THREE.Vector3(0, -18, 0);
const DEFAULT_UP = new THREE.Vector3(0, 1, 0);
const SCRATCH_CENTER_A = new THREE.Vector3();
const SCRATCH_CENTER_B = new THREE.Vector3();
const SCRATCH_NORMAL = new THREE.Vector3();
const SCRATCH_RELATIVE_VELOCITY = new THREE.Vector3();

function clampDeltaTime(deltaTime) {
  return Math.max(0, Math.min(deltaTime, 0.1));
}

function getAxisSign(delta, fallbackVelocity) {
  if (Math.abs(delta) > 0.0001) {
    return Math.sign(delta);
  }

  if (Math.abs(fallbackVelocity) > 0.0001) {
    return -Math.sign(fallbackVelocity);
  }

  return 1;
}

/**
 * Lightweight kinetic body for voxel/block games.
 *
 * The mesh position is treated as the entity foot position. The collision box is
 * a stable, voxel-style AABB derived from `size` and `centerOffset`; this avoids
 * expensive skinned-mesh bounds recalculation every frame while still allowing a
 * GLTF character or NPC `THREE.Object3D` to be driven by custom physics.
 */
export class VoxelPhysicsEntity {
  /**
   * @param {THREE.Object3D} mesh Object controlled by this physics wrapper.
   * @param {object} [options]
   * @param {number} [options.mass=1] Entity mass used by impulse and momentum transfer.
   * @param {THREE.Vector3} [options.size] AABB size in meters.
   * @param {THREE.Vector3} [options.centerOffset] Offset from mesh position to AABB center.
   * @param {number} [options.friction=0.98] Velocity-retention coefficient per 60 Hz frame.
   * @param {THREE.Vector3} [options.gravity] Gravity acceleration vector in meters/s^2.
   * @param {number | null} [options.groundY=0] Flat fallback ground height; null disables snap.
   * @param {(position: THREE.Vector3) => number | null | undefined} [options.groundResolver]
   * Returns a terrain height for the current position.
   * @param {number} [options.restitution=0.35] Elasticity for body-vs-body collisions.
   * @param {number} [options.knockdownEnergyThreshold=220] Impact energy that marks this body knocked down.
   */
  constructor(mesh, options = {}) {
    if (!mesh?.isObject3D) {
      throw new TypeError('VoxelPhysicsEntity requires a THREE.Object3D mesh.');
    }

    this.mesh = mesh;
    this.mass = Math.max(options.mass ?? 1, 0.0001);
    this.velocity = options.velocity?.clone?.() ?? new THREE.Vector3();
    this.isGrounded = false;
    this.friction = options.friction ?? 0.98;
    this.aabb = new THREE.Box3();
    this.isStunned = false;
    this.isKnockedDown = false;

    this.size = options.size?.clone?.() ?? DEFAULT_BODY_SIZE.clone();
    this.centerOffset =
      options.centerOffset?.clone?.() ??
      new THREE.Vector3(0, this.size.y * 0.5, 0);
    this.gravity = options.gravity?.clone?.() ?? DEFAULT_GRAVITY.clone();
    this.groundY = options.groundY ?? 0;
    this.groundResolver = options.groundResolver ?? null;
    this.restitution = options.restitution ?? 0.35;
    this.knockdownEnergyThreshold = options.knockdownEnergyThreshold ?? 220;

    this.updateAABB();
  }

  /**
   * Rebuilds the voxel AABB from the current mesh position.
   *
   * @returns {THREE.Box3}
   */
  updateAABB() {
    SCRATCH_CENTER_A.copy(this.mesh.position).add(this.centerOffset);
    this.aabb.setFromCenterAndSize(SCRATCH_CENTER_A, this.size);
    return this.aabb;
  }

  /**
   * Integrates velocity using delta time, applies gravity, snaps to the terrain,
   * updates the AABB, and applies frame-rate independent friction.
   *
   * Animation code should read `isGrounded`, `velocity`, `isStunned`, and
   * `isKnockedDown` after this method runs so mixer state follows physics state.
   *
   * @param {number} deltaTime Seconds since last frame.
   */
  update(deltaTime) {
    const dt = clampDeltaTime(deltaTime);

    if (dt <= 0) {
      this.updateAABB();
      return;
    }

    const groundY = this.resolveGroundY();

    if (!this.isGrounded || this.velocity.y > 0) {
      this.velocity.addScaledVector(this.gravity, dt);
    }

    this.mesh.position.addScaledVector(this.velocity, dt);

    if (groundY !== null && groundY !== undefined && this.mesh.position.y <= groundY) {
      this.mesh.position.y = groundY;
      this.isGrounded = true;

      if (this.velocity.y < 0) {
        this.velocity.y = 0;
      }
    } else {
      this.isGrounded = false;
    }

    const decay = Math.pow(this.friction, dt * 60);
    this.velocity.x *= decay;
    this.velocity.z *= decay;
    this.updateAABB();
  }

  /**
   * Applies an instantaneous impulse. The same impulse moves low-mass entities
   * more than high-mass entities because acceleration is scaled by `1 / mass`.
   *
   * @param {THREE.Vector3} forceVector Impulse vector in kg*m/s-style game units.
   */
  applyImpulse(forceVector) {
    this.velocity.addScaledVector(forceVector, 1 / this.mass);
  }

  /**
   * Resolves an AABB overlap with another physics entity using one-dimensional
   * elastic collision math along the shallowest penetration axis.
   *
   * This intentionally keeps voxel physics cheap: the AABB push-out prevents
   * clipping, while the impulse transfers momentum based on both masses and
   * relative velocity. The returned `impactEnergy` can drive stun, knockdown,
   * sound, or damage systems without coupling those systems to collision math.
   *
   * @param {VoxelPhysicsEntity} otherEntity Body to test and resolve against.
   * @returns {{
   *   collided: boolean,
   *   normal?: THREE.Vector3,
   *   penetration?: number,
   *   impulseMagnitude?: number,
   *   impactEnergy?: number
   * }}
   */
  resolveCollision(otherEntity) {
    this.updateAABB();
    otherEntity.updateAABB();

    if (!this.aabb.intersectsBox(otherEntity.aabb)) {
      return { collided: false };
    }

    this.aabb.getCenter(SCRATCH_CENTER_A);
    otherEntity.aabb.getCenter(SCRATCH_CENTER_B);

    const overlapX = Math.min(
      this.aabb.max.x - otherEntity.aabb.min.x,
      otherEntity.aabb.max.x - this.aabb.min.x,
    );
    const overlapY = Math.min(
      this.aabb.max.y - otherEntity.aabb.min.y,
      otherEntity.aabb.max.y - this.aabb.min.y,
    );
    const overlapZ = Math.min(
      this.aabb.max.z - otherEntity.aabb.min.z,
      otherEntity.aabb.max.z - this.aabb.min.z,
    );

    let axis = 'x';
    let penetration = overlapX;

    if (overlapY < penetration) {
      axis = 'y';
      penetration = overlapY;
    }

    if (overlapZ < penetration) {
      axis = 'z';
      penetration = overlapZ;
    }

    SCRATCH_NORMAL.set(0, 0, 0);
    SCRATCH_NORMAL[axis] = getAxisSign(
      SCRATCH_CENTER_A[axis] - SCRATCH_CENTER_B[axis],
      this.velocity[axis] - otherEntity.velocity[axis],
    );

    const inverseMassA = 1 / this.mass;
    const inverseMassB = 1 / otherEntity.mass;
    const inverseMassTotal = inverseMassA + inverseMassB;
    const pushA = penetration * (inverseMassA / inverseMassTotal);
    const pushB = penetration * (inverseMassB / inverseMassTotal);

    this.mesh.position.addScaledVector(SCRATCH_NORMAL, pushA);
    otherEntity.mesh.position.addScaledVector(SCRATCH_NORMAL, -pushB);

    SCRATCH_RELATIVE_VELOCITY.copy(this.velocity).sub(otherEntity.velocity);
    const velocityAlongNormal = SCRATCH_RELATIVE_VELOCITY.dot(SCRATCH_NORMAL);
    const reducedMass = (this.mass * otherEntity.mass) / (this.mass + otherEntity.mass);
    const impactEnergy = 0.5 * reducedMass * velocityAlongNormal * velocityAlongNormal;
    let impulseMagnitude = 0;

    if (velocityAlongNormal < 0) {
      const restitution = Math.min(this.restitution, otherEntity.restitution ?? this.restitution);

      impulseMagnitude = (-(1 + restitution) * velocityAlongNormal) / inverseMassTotal;
      this.velocity.addScaledVector(SCRATCH_NORMAL, impulseMagnitude * inverseMassA);
      otherEntity.velocity.addScaledVector(SCRATCH_NORMAL, -impulseMagnitude * inverseMassB);
    }

    if (axis === 'y') {
      if (SCRATCH_NORMAL.y > 0 && this.velocity.y <= 0) {
        this.isGrounded = true;
        this.velocity.y = Math.max(0, this.velocity.y);
      } else if (SCRATCH_NORMAL.y < 0 && otherEntity.velocity.y <= 0) {
        otherEntity.isGrounded = true;
        otherEntity.velocity.y = Math.max(0, otherEntity.velocity.y);
      }
    }

    if (impactEnergy >= this.knockdownEnergyThreshold) {
      this.isStunned = true;
      this.isKnockedDown = true;
    }

    if (impactEnergy >= (otherEntity.knockdownEnergyThreshold ?? Infinity)) {
      otherEntity.isStunned = true;
      otherEntity.isKnockedDown = true;
    }

    this.updateAABB();
    otherEntity.updateAABB();

    return {
      collided: true,
      normal: SCRATCH_NORMAL.clone(),
      penetration,
      impulseMagnitude,
      impactEnergy,
    };
  }

  /**
   * @returns {number} Current translational kinetic energy in game units.
   */
  getKineticEnergy() {
    return 0.5 * this.mass * this.velocity.lengthSq();
  }

  resolveGroundY() {
    if (typeof this.groundResolver === 'function') {
      const resolved = this.groundResolver(this.mesh.position);

      if (resolved !== undefined) {
        return resolved;
      }
    }

    return this.groundY;
  }
}
