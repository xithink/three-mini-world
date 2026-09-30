import * as THREE from 'three';

/**
 * Thin Three.js AnimationMixer state machine for voxel characters.
 *
 * It owns only animation concerns. Physics state is optional and injected through
 * `entity`, allowing the same controller to drive a player, NPC, or dummy model.
 */
export class AnimationController {
  /**
   * @param {THREE.Object3D} mesh Animated GLTF root or Object3D.
   * @param {THREE.AnimationClip[]} clips Animation clips to register.
   * @param {object} [options]
   * @param {import('../physics/VoxelPhysicsEntity.js').VoxelPhysicsEntity} [options.entity]
   * Physics entity whose `isStunned`, `isKnockedDown`, and `friction` are synced.
   * @param {Record<string, string | RegExp>} [options.aliases] Logical names to clip names/patterns.
   * @param {number} [options.knockdownFriction=0.88] Lower velocity retention while knocked down.
   */
  constructor(mesh, clips = [], options = {}) {
    if (!mesh?.isObject3D) {
      throw new TypeError('AnimationController requires a THREE.Object3D mesh.');
    }

    this.mesh = mesh;
    this.entity = options.entity ?? null;
    this.mixer = new THREE.AnimationMixer(mesh);
    this.actions = new Map();
    this.currentAction = null;
    this.currentName = '';
    this.recoveryTimer = 0;
    this.recoveryPending = false;
    this.gettingUp = false;
    this.originalFriction = null;
    this.knockdownFriction = options.knockdownFriction ?? 0.88;

    clips.forEach((clip) => this.addClip(clip));
    this.bindAliases(options.aliases);
  }

  /**
   * Registers a clip as an AnimationAction.
   *
   * @param {THREE.AnimationClip} clip
   * @param {string} [name=clip.name]
   * @returns {THREE.AnimationAction}
   */
  addClip(clip, name = clip.name) {
    const action = this.mixer.clipAction(clip);

    action.enabled = true;
    this.actions.set(name, action);
    return action;
  }

  /**
   * Maps logical names such as `idle`, `run`, and `kick` to real GLTF clip names.
   *
   * @param {Record<string, string | RegExp>} [aliases]
   */
  bindAliases(aliases = {}) {
    for (const [logicalName, matcher] of Object.entries(aliases)) {
      const existing = this.actions.get(logicalName);

      if (existing) {
        continue;
      }

      const found = [...this.actions.entries()].find(([clipName]) => {
        if (typeof matcher === 'string') {
          return clipName === matcher;
        }

        return matcher.test(clipName);
      });

      if (found) {
        this.actions.set(logicalName, found[1]);
      }
    }
  }

  /**
   * Crossfades to an action. This is the central state transition path for the
   * mixer, so combat and locomotion code can request animation states without
   * directly manipulating `THREE.AnimationAction` instances.
   *
   * @param {string} name Registered action name.
   * @param {number} [duration=0.2] Crossfade duration in seconds.
   * @returns {THREE.AnimationAction | null}
   */
  playAction(name, duration = 0.2) {
    const nextAction = this.actions.get(name);

    if (!nextAction) {
      return null;
    }

    if (this.currentAction === nextAction) {
      return nextAction;
    }

    nextAction.enabled = true;
    nextAction.reset();
    nextAction.setEffectiveWeight(1);
    nextAction.play();

    if (this.currentAction) {
      this.currentAction.crossFadeTo(nextAction, duration, false);
    } else {
      nextAction.fadeIn(duration);
    }

    this.currentAction = nextAction;
    this.currentName = name;
    return nextAction;
  }

  /**
   * Plays the kick clip once, then returns to idle/run after the mixer emits a
   * `finished` event. The physics impulse is applied elsewhere by CombatController.
   *
   * @returns {boolean} Whether a kick action was available.
   */
  playKick() {
    return this.playOnce('kick', this.getLocomotionFallbackName(), 0.08);
  }

  /**
   * Enters a knockdown state, slows the physics body, waits for recovery time,
   * then plays `get_up` and clears stun flags after the get-up clip finishes.
   *
   * @param {number} [recoveryTime=2] Seconds before starting get-up animation.
   * @returns {boolean} Whether a knockdown action was available.
   */
  playKnockdown(recoveryTime = 2.0) {
    const action = this.playAction('knockdown', 0.12);

    if (!action) {
      return false;
    }

    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    this.recoveryTimer = Math.max(0, recoveryTime);
    this.recoveryPending = true;
    this.gettingUp = false;

    if (this.entity) {
      this.entity.isKnockedDown = true;
      this.entity.isStunned = true;

      if (this.originalFriction === null) {
        this.originalFriction = this.entity.friction;
      }

      this.entity.friction = Math.min(this.entity.friction, this.knockdownFriction);
    }

    return true;
  }

  /**
   * Advances the AnimationMixer and internal recovery timers. Call once per
   * render tick after physics update so animation states reflect current motion.
   *
   * @param {number} deltaTime Seconds since last frame.
   */
  update(deltaTime) {
    const dt = Math.max(0, deltaTime);

    if (this.recoveryPending && !this.gettingUp) {
      this.recoveryTimer = Math.max(0, this.recoveryTimer - dt);

      if (this.recoveryTimer <= 0) {
        this.playGetUp();
      }
    }

    this.mixer.update(dt);
  }

  playOnce(name, fallbackName = 'idle', duration = 0.1) {
    const action = this.playAction(name, duration);

    if (!action) {
      return false;
    }

    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;

    const onFinished = (event) => {
      if (event.action !== action) {
        return;
      }

      this.mixer.removeEventListener('finished', onFinished);
      this.playAction(fallbackName, 0.16);
    };

    this.mixer.addEventListener('finished', onFinished);
    return true;
  }

  playGetUp() {
    this.gettingUp = true;
    this.recoveryPending = false;

    const action = this.playAction('get_up', 0.16);

    if (!action) {
      this.finishGetUp();
      return;
    }

    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;

    const onFinished = (event) => {
      if (event.action !== action) {
        return;
      }

      this.mixer.removeEventListener('finished', onFinished);
      this.finishGetUp();
    };

    this.mixer.addEventListener('finished', onFinished);
  }

  finishGetUp() {
    this.gettingUp = false;

    if (this.entity) {
      this.entity.isKnockedDown = false;
      this.entity.isStunned = false;

      if (this.originalFriction !== null) {
        this.entity.friction = this.originalFriction;
        this.originalFriction = null;
      }
    }

    this.playAction(this.getLocomotionFallbackName(), 0.18);
  }

  getLocomotionFallbackName() {
    const horizontalSpeed = this.entity
      ? Math.hypot(this.entity.velocity.x, this.entity.velocity.z)
      : 0;

    return horizontalSpeed > 0.15 && this.actions.has('run') ? 'run' : 'idle';
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mesh);
  }
}
