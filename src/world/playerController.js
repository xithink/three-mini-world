import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { findNearestOpenBodyPosition, moveBodyWithCollisions } from './physics/collision.js';
import { RigidBody } from './physics/rigidBody.js';
import { handleEditingKeydown, isEditableTarget } from './utils/inputFocus.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const CAMERA_FOLLOW_ANGLES = Object.freeze([
  Math.PI,
  Math.PI + Math.PI / 7,
  Math.PI - Math.PI / 7,
]);
const CAMERA_ORBIT_SENSITIVITY = 0.0032;
const CAMERA_ORBIT_HEIGHT_SENSITIVITY = 0.012;
const THIRD_PERSON_MOUSE_LOOK_SENSITIVITY = 0.00085;
const THIRD_PERSON_MOUSE_HEIGHT_SENSITIVITY = 0.0032;
const THIRD_PERSON_MIN_HEIGHT_OFFSET = -0.55;
const THIRD_PERSON_MAX_HEIGHT_OFFSET = 0.75;
const THIRD_PERSON_CAMERA_OFFSET_LERP = 18;
const CAMERA_MODES = Object.freeze({
  FIRST_PERSON: 'firstPerson',
  THIRD_PERSON: 'thirdPerson',
});
const INTERACTIVE_OVERLAY_SELECTOR = [
  '.ai-building',
  '.ai-building__toggle',
  '.ai-building__panel',
  '.crafting-codex',
  '.inventory-ui',
  '.world-status-hud',
  '.village-elevator',
  '.npc-dialogue',
  '.trade-panel',
  '.save-select',
  '[role="dialog"]',
  '[data-ui-block-player]',
  'button',
  'input',
  'textarea',
  'select',
].join(',');
const DEFAULT_PLAYER_MASS = 72;
const DEFAULT_PLAYER_HEIGHT = 1.82;
const BASE_GRAVITY = 18;
const BASE_ACCELERATION = 34;
const GROUND_FRICTION = 9.5;
const AIR_FRICTION = 1.8;
const WATER_DRAG = 5.6;
const STOP_EPSILON = 0.015;
const MIN_MOVABLE_HUNGER = 3;
const MAX_HUNGER = 10;
const MAX_STAMINA = 600;
const WALK_STAMINA_DRAIN_PER_SECOND = MAX_STAMINA / 600;
const WATER_STAMINA_DRAIN_PER_SECOND = WALK_STAMINA_DRAIN_PER_SECOND * 1.5;
const LATERAL_FACING_INFLUENCE = 0.16;
const WALL_BOUNCE_THRESHOLD = 4.2;
const WALL_BOUNCE_RESTITUTION = 0.42;
const WALL_STAMINA_LOSS_SCALE = 5.5;
const FALL_STAMINA_SAFE_SPEED = 8.5;
const FALL_STAMINA_LOSS_SCALE = 7;
const KNOCKDOWN_FALL_SPEED = 13;
const KNOCKDOWN_WALL_SPEED = 7.5;
const KNOCKDOWN_BASE_SECONDS = 0.8;
const KNOCKDOWN_MAX_SECONDS = 2.4;
const KNOCKDOWN_VISUAL_LERP = 12;
const KNOCKDOWN_FORWARD_TILT = 1.18;
const LIE_DOWN_VISUAL_LERP = 10;
const LIE_DOWN_FORWARD_TILT = Math.PI * 0.5;
const ENTITY_COLLISION_EPSILON = 0.015;
const KICK_STAMINA_COST = 6;
const KICK_GESTURE_SECONDS = 0.36;
const LYING_REST_STAMINA_MULTIPLIER = 5;
const GLIDE_GRAVITY_SCALE = 0.18;
const GLIDE_MAX_FALL_SPEED = 2.4;
const GLIDE_FORWARD_ACCELERATION = 5.8;
const GLIDE_MAX_HORIZONTAL_SPEED = 8.2;
const GLIDE_STAMINA_DRAIN_PER_SECOND = 0.65;
const HOVER_SPEED_MULTIPLIER = 0.82;

export class PlayerController {
  constructor({ camera, canvas, character, eventBus = null }) {
    this.camera = camera;
    this.canvas = canvas;
    this.character = character;
    this.eventBus = eventBus;
    this.body = new RigidBody({
      position: new THREE.Vector3(0, 5, 0),
      radius: 0.34,
      height: DEFAULT_PLAYER_HEIGHT,
      mass: DEFAULT_PLAYER_MASS,
    });
    this.position = this.body.position;
    this.velocity = new THREE.Vector3();
    this.controls = new PointerLockControls(camera, canvas);
    this.controls.pointerSpeed = 0.82;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = Math.PI - 0.08;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(-0.26, -Math.PI * 0.22, 0);
    this.baseSpeed = 6.8;
    this.speed = this.baseSpeed;
    this.baseJumpSpeed = 7.2;
    this.jumpSpeed = this.baseJumpSpeed;
    this.superJumpHeightMultiplier = 3;
    this.superJumpTapWindow = 0.28;
    this.gravity = BASE_GRAVITY;
    this.playerMass = DEFAULT_PLAYER_MASS;
    this.playerHeight = DEFAULT_PLAYER_HEIGHT;
    this.hunger = MAX_HUNGER;
    this.stamina = MAX_STAMINA;
    this.isResting = true;
    this.isLyingDown = false;
    this.isGliding = false;
    this.isHovering = false;
    this.isMovementBlockedByHunger = false;
    this.isKnockedDown = false;
    this.knockdownTimer = 0;
    this.characterKnockdownAmount = 0;
    this.characterLieDownAmount = 0;
    this.eyeHeight = 1.62;
    this.cameraDistance = 5.2;
    this.cameraHeight = 2.35;
    this.cameraFollowAngleIndex = 0;
    this.cameraFollowAngle = CAMERA_FOLLOW_ANGLES[this.cameraFollowAngleIndex];
    this.cameraOrbitHeightOffset = 0;
    this.targetCameraFollowAngle = this.cameraFollowAngle;
    this.targetCameraOrbitHeightOffset = this.cameraOrbitHeightOffset;
    this.minCameraOrbitHeightOffset = -1.15;
    this.maxCameraOrbitHeightOffset = 8.5;
    this.minFov = 46;
    this.maxFov = 78;
    this.zoomSpeed = 0.025;
    this.movementMode = 'grounded';
    this.cameraMode = CAMERA_MODES.THIRD_PERSON;
    this.controls.enabled = false;
    this.elapsedTime = 0;
    this.lastGroundJumpTime = -Infinity;
    this.groundJumpStartY = 0;
    this.didSuperJumpThisTakeoff = false;
    this.hasUsedAirJump = false;
    this.lastVerticalVelocity = 0;
    this.kickGestureTimer = 0;
    // 方便以后扩展移动模式：滑翔、悬浮都保持在同一套控制器里。
    this.keys = new Set();

    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3();
    this.movementDirection = new THREE.Vector3();
    this.desiredFacingDirection = new THREE.Vector3(0, 0, -1);
    this.characterFacingDirection = new THREE.Vector3(0, 0, -1);
    this.cameraDirection = new THREE.Vector3();
    this.cameraFollowPosition = new THREE.Vector3();
    this.cameraFollowDirection = new THREE.Vector3();
    this.cameraLookTarget = new THREE.Vector3();
    this.combatAabb = new THREE.Box3();
    this.combatSize = new THREE.Vector3(this.body.radius * 2, this.body.height, this.body.radius * 2);
    this.combatCenter = new THREE.Vector3();
    const controller = this;

    this.combatEntity = {
      mesh: this.character,
      velocity: this.body.velocity,
      size: this.combatSize,
      aabb: this.combatAabb,
      animationController: {
        playKick: () => controller.startKickGesture(),
        playKnockdown: () => {
          controller.knockDown();
          return true;
        },
      },
      get mass() {
        return controller.body.mass;
      },
      get isKnockedDown() {
        return controller.isKnockedDown;
      },
      set isKnockedDown(value) {
        controller.isKnockedDown = Boolean(value);
      },
      get isStunned() {
        return controller.isKnockedDown || controller.isLyingDown;
      },
      set isStunned(value) {
        if (value) {
          controller.knockDown();
        }
      },
      getForward: () => controller.characterFacingDirection,
      updateAABB: () => controller.updateCombatAabb(),
      applyImpulse: (forceVector) => {
        controller.body.velocity.addScaledVector(forceVector, 1 / controller.body.mass);
      },
    };
    this.appliedCharacterHeight = 0;
    this.isOrbitingCamera = false;
    this.isMouseLookActive = false;
    this.isWaitingForDirectionMouseMove = false;
    this.pointerControlBlockers = new Set();
    this.inputForward = 0;
    this.inputLateral = 0;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);

    this.updateCamera(0);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('click', this.onClick);
    this.canvas.addEventListener('pointerdown', this.onMouseDown);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  onKeyDown(event) {
    if (handleEditingKeydown(event)) {
      this.keys.clear();
      return;
    }

    if (event.code === 'Tab') {
      event.preventDefault();

      if (!event.repeat) {
        this.eventBus?.emit('inventory:hotbar-next');
      }

      return;
    }

    if (event.code === 'KeyE') {
      event.preventDefault();

      if (!event.repeat) {
        this.eventBus?.emit('interaction:pickup');
      }

      return;
    }

    if (event.code === 'KeyQ') {
      event.preventDefault();

      if (!event.repeat) {
        this.eventBus?.emit('inventory:throw-selected');
      }

      return;
    }

    if (event.code === 'KeyR') {
      event.preventDefault();

      if (!event.repeat) {
        this.eventBus?.emit('interaction:place-block');
      }

      return;
    }

    if (event.code === 'KeyC') {
      event.preventDefault();

      if (!event.repeat) {
        this.eventBus?.emit('interaction:use-flint');
      }

      return;
    }

    if (event.code === 'KeyX') {
      event.preventDefault();

      if (!event.repeat) {
        this.toggleLieDown();
      }

      return;
    }

    if (event.code === 'KeyZ') {
      event.preventDefault();

      if (!event.repeat) {
        this.eventBus?.emit('inventory:toggle');
      }

      return;
    }

    if (event.code === 'KeyV') {
      event.preventDefault();

      if (!event.repeat) {
        this.toggleGliding();
      }

      return;
    }

    if (event.code === 'KeyT') {
      event.preventDefault();

      if (!event.repeat) {
        this.toggleHovering();
      }

      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();

      if (event.repeat) {
        return;
      }

      if (this.isLyingDown) {
        this.setLyingDown(false);
        return;
      }

      this.jump();
      return;
    }

    if (event.code === 'KeyF') {
      event.preventDefault();

      if (!event.repeat) {
        this.toggleCameraMode();
      }

      return;
    }

    if (event.code === 'KeyK') {
      event.preventDefault();

      if (!event.repeat) {
        this.requestKick();
      }

      return;
    }

    if (this.isMovementKey(event.code)) {
      event.preventDefault();
      this.keys.add(event.code);
    }
  }

  onKeyUp(event) {
    this.keys.delete(event.code);
  }

  isPointerControlBlocked() {
    return this.pointerControlBlockers.size > 0;
  }

  setPointerControlBlocked(source, isBlocked) {
    if (!source) {
      return;
    }

    if (isBlocked) {
      this.pointerControlBlockers.add(source);
      this.isOrbitingCamera = false;
      this.isMouseLookActive = false;
      this.isWaitingForDirectionMouseMove = false;
      this.controls.enabled = false;

      if (this.controls.isLocked) {
        this.controls.unlock();
      }

      return;
    }

    this.pointerControlBlockers.delete(source);
  }

  isInteractiveOverlayElement(element) {
    return element instanceof Element && Boolean(element.closest(INTERACTIVE_OVERLAY_SELECTOR));
  }

  shouldIgnorePointerControl(event) {
    if (this.isPointerControlBlocked()) {
      return true;
    }

    if (event.target !== this.canvas) {
      return true;
    }

    if (
      Number.isFinite(event.clientX) &&
      Number.isFinite(event.clientY) &&
      typeof document.elementsFromPoint === 'function'
    ) {
      return document
        .elementsFromPoint(event.clientX, event.clientY)
        .some((element) => element !== this.canvas && this.isInteractiveOverlayElement(element));
    }

    return false;
  }

  restoreGameInputFromCanvasEvent(event) {
    if (this.shouldIgnorePointerControl(event)) {
      return false;
    }

    if (isEditableTarget(document.activeElement)) {
      document.activeElement.blur();
    }

    this.pointerControlBlockers.clear();

    return true;
  }

  lockPointerControl() {
    if (this.isPointerControlBlocked() || this.controls.isLocked || typeof this.canvas.requestPointerLock !== 'function') {
      return;
    }

    try {
      const lockRequest = this.canvas.requestPointerLock({ unadjustedMovement: false });
      lockRequest?.catch?.(() => {});
    } catch {
      try {
        const lockRequest = this.canvas.requestPointerLock();
        lockRequest?.catch?.(() => {});
      } catch {
        // Pointer lock can be refused right after UI-driven unlocks.
      }
    }
  }

  onClick(event) {
    if (!this.restoreGameInputFromCanvasEvent(event)) {
      return;
    }

    this.controls.enabled = this.cameraMode === CAMERA_MODES.FIRST_PERSON;

    if (!this.controls.isLocked) {
      this.lockPointerControl();
    }
  }

  onMouseDown(event) {
    if (!this.restoreGameInputFromCanvasEvent(event)) {
      return;
    }

    if (event.button === 0) {
      event.preventDefault();
      this.isOrbitingCamera = false;
      this.isWaitingForDirectionMouseMove = false;
      this.isMouseLookActive = true;
      this.controls.enabled = this.cameraMode === CAMERA_MODES.FIRST_PERSON;

      if (!this.controls.isLocked) {
        this.lockPointerControl();
      }

      return;
    }

    if (event.button !== 2) {
      return;
    }

    if (this.cameraMode === CAMERA_MODES.FIRST_PERSON) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    this.isOrbitingCamera = true;
    this.isMouseLookActive = false;
    this.controls.enabled = false;

    if (!this.controls.isLocked) {
      this.lockPointerControl();
    }
  }

  onMouseUp(event) {
    if (event.button === 0) {
      this.isMouseLookActive = false;
      return;
    }

    if (event.button !== 2) {
      return;
    }

    if (!this.isOrbitingCamera) {
      this.controls.enabled = this.cameraMode === CAMERA_MODES.FIRST_PERSON;
      return;
    }

    this.isOrbitingCamera = false;
    this.isWaitingForDirectionMouseMove = true;
    this.controls.enabled = this.cameraMode === CAMERA_MODES.FIRST_PERSON;
  }

  onMouseMove(event) {
    if (!this.isOrbitingCamera) {
      if (this.isWaitingForDirectionMouseMove && this.controls.isLocked) {
        this.isWaitingForDirectionMouseMove = false;
      }

      if (this.cameraMode === CAMERA_MODES.THIRD_PERSON && this.isMouseLookActive && this.controls.isLocked) {
        this.targetCameraFollowAngle -= event.movementX * THIRD_PERSON_MOUSE_LOOK_SENSITIVITY;
        this.targetCameraOrbitHeightOffset = clamp(
          this.targetCameraOrbitHeightOffset + event.movementY * THIRD_PERSON_MOUSE_HEIGHT_SENSITIVITY,
          THIRD_PERSON_MIN_HEIGHT_OFFSET,
          THIRD_PERSON_MAX_HEIGHT_OFFSET,
        );
      }

      return;
    }

    event.preventDefault();
    this.controls.enabled = false;
    this.targetCameraFollowAngle += event.movementX * CAMERA_ORBIT_SENSITIVITY;
    this.targetCameraOrbitHeightOffset = clamp(
      this.targetCameraOrbitHeightOffset + event.movementY * CAMERA_ORBIT_HEIGHT_SENSITIVITY,
      this.minCameraOrbitHeightOffset,
      this.maxCameraOrbitHeightOffset,
    );
  }

  onContextMenu(event) {
    event.preventDefault();
  }

  onWheel(event) {
    event.preventDefault();

    this.camera.fov = clamp(this.camera.fov + event.deltaY * this.zoomSpeed, this.minFov, this.maxFov);
    this.camera.updateProjectionMatrix();
  }

  cycleCameraFollowAngle() {
    this.cameraFollowAngleIndex = (this.cameraFollowAngleIndex + 1) % CAMERA_FOLLOW_ANGLES.length;
    this.cameraFollowAngle = CAMERA_FOLLOW_ANGLES[this.cameraFollowAngleIndex];
    this.targetCameraFollowAngle = this.cameraFollowAngle;
  }

  toggleCameraMode() {
    this.cameraMode =
      this.cameraMode === CAMERA_MODES.FIRST_PERSON
        ? CAMERA_MODES.THIRD_PERSON
        : CAMERA_MODES.FIRST_PERSON;

    this.isOrbitingCamera = false;
    this.isMouseLookActive = false;
    this.isWaitingForDirectionMouseMove = false;
    this.controls.enabled = this.cameraMode === CAMERA_MODES.FIRST_PERSON;
    this.character.visible = this.cameraMode !== CAMERA_MODES.FIRST_PERSON;
    this.targetCameraFollowAngle = this.cameraFollowAngle;
    this.targetCameraOrbitHeightOffset = this.cameraOrbitHeightOffset;
    this.updateCamera(0);
  }

  isMovementKey(code) {
    return (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    );
  }

  jump() {
    if (this.isLyingDown) {
      return;
    }

    if (this.movementMode !== 'grounded') {
      return;
    }

    if (this.hunger <= MIN_MOVABLE_HUNGER || this.stamina < 8) {
      return;
    }

    if (this.body.grounded) {
      this.body.velocity.y = this.getEffectiveJumpSpeed();
      this.body.grounded = false;
      this.consumeStamina(8);
      this.consumeHunger(0.05);
      this.lastGroundJumpTime = this.elapsedTime;
      this.groundJumpStartY = this.position.y;
      this.didSuperJumpThisTakeoff = false;
      this.hasUsedAirJump = false;
      return;
    }

    if (!this.didSuperJumpThisTakeoff && this.elapsedTime - this.lastGroundJumpTime <= this.superJumpTapWindow) {
      const normalJumpHeight = (this.getEffectiveJumpSpeed() * this.getEffectiveJumpSpeed()) / (2 * this.gravity);
      const targetApexY = this.groundJumpStartY + normalJumpHeight * this.superJumpHeightMultiplier;
      const remainingHeight = Math.max(0, targetApexY - this.position.y);
      const requiredSpeed = Math.sqrt(2 * this.gravity * remainingHeight);

      this.body.velocity.y = Math.max(this.body.velocity.y, requiredSpeed);
      this.consumeStamina(12);
      this.consumeHunger(0.08);
      this.didSuperJumpThisTakeoff = true;
      return;
    }

    if (this.hasUsedAirJump) {
      return;
    }

    this.body.velocity.y = this.getEffectiveJumpSpeed();
    this.consumeStamina(10);
    this.consumeHunger(0.06);
    this.hasUsedAirJump = true;
  }

  update(deltaTime, worldManager, npcSystem = null) {
    this.elapsedTime += deltaTime;
    this.updateCharacterBounds();
    this.updateVectors();
    this.updatePosition(deltaTime, worldManager, npcSystem);
    this.updateCharacter(deltaTime);
    this.updateCharacterAnimation(deltaTime);
    this.updateCamera(deltaTime);
    this.emitPlayerState();
  }

  updateCharacterBounds() {
    const characterHeight = this.character.userData.height ?? 0;

    if (characterHeight <= 0 || Math.abs(characterHeight - this.appliedCharacterHeight) < 0.001) {
      return;
    }

    this.appliedCharacterHeight = characterHeight;
    this.body.height = Math.max(0.7, characterHeight);
    this.playerHeight = this.body.height;
    this.body.radius = clamp(
      Math.max(this.character.userData.bounds?.width ?? 0, this.character.userData.bounds?.depth ?? 0) * 0.28,
      0.18,
      0.78,
    );
    this.combatSize.set(this.body.radius * 2, this.body.height, this.body.radius * 2);
    this.eyeHeight = Math.max(0.55, this.body.height * 0.88);
    this.cameraHeight = Math.max(1.1, this.body.height * 1.28);
  }

  requestKick() {
    if (this.isKnockedDown || this.isLyingDown || this.isGliding || this.hunger <= MIN_MOVABLE_HUNGER || this.stamina < KICK_STAMINA_COST) {
      return;
    }

    this.eventBus?.emit('player:kick', { attacker: this.getCombatEntity() });
  }

  startKickGesture() {
    this.kickGestureTimer = KICK_GESTURE_SECONDS;
    this.consumeStamina(KICK_STAMINA_COST);
    this.consumeHunger(0.03);
  }

  getCombatEntity() {
    this.updateCombatAabb();
    return this.combatEntity;
  }

  updateCombatAabb() {
    this.combatCenter.set(
      this.position.x,
      this.position.y + this.body.height * 0.5,
      this.position.z,
    );
    this.combatAabb.setFromCenterAndSize(this.combatCenter, this.combatSize);
    return this.combatAabb;
  }

  updateVectors() {
    if (this.cameraMode === CAMERA_MODES.THIRD_PERSON) {
      this.forward
        .set(Math.sin(this.targetCameraFollowAngle), 0, Math.cos(this.targetCameraFollowAngle))
        .normalize();
    } else if (!this.isOrbitingCamera && !this.isWaitingForDirectionMouseMove) {
      this.controls.getDirection(this.cameraDirection);
      this.forward.copy(this.cameraDirection);
      this.forward.y = 0;

      if (this.forward.lengthSq() === 0) {
        this.forward.copy(this.characterFacingDirection);
      }

      this.forward.normalize();
    }

    this.right.set(-this.forward.z, 0, this.forward.x).normalize();
  }

  updatePosition(deltaTime, worldManager, npcSystem = null) {
    this.movementDirection.set(0, 0, 0);
    this.inputForward = 0;
    this.inputLateral = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
      this.inputForward += 1;
    }

    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      this.inputForward -= 1;
    }

    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
      this.inputLateral += 1;
    }

    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
      this.inputLateral -= 1;
    }

    if (this.inputForward !== 0) {
      this.movementDirection.addScaledVector(this.forward, this.inputForward);
    }

    if (this.inputLateral !== 0) {
      this.movementDirection.addScaledVector(this.right, this.inputLateral);
    }

    if (this.isHovering) {
      this.updateHoverPosition(deltaTime, worldManager, npcSystem);
      return;
    }

    const isInWater = worldManager.isBodyInWater(this.body);
    const movement = new THREE.Vector3();
    if (this.isLyingDown && !this.body.grounded) {
      this.setLyingDown(false);
    }

    if (this.isGliding && (isInWater || this.isLyingDown || this.isKnockedDown)) {
      this.setGliding(false);
    }

    const isGlidePhysicsActive = this.isGlidePhysicsActive(isInWater);
    const wantsToMove = !this.isLyingDown && this.movementDirection.lengthSq() > 0;
    const canMove = this.hunger > MIN_MOVABLE_HUNGER && this.stamina > 1 && !this.isLyingDown;
    const waterSpeedScale = isInWater ? 0.7 : 1;
    const effectiveMaxSpeed = this.getEffectiveMaxSpeed(waterSpeedScale);

    this.isMovementBlockedByHunger = wantsToMove && this.hunger <= MIN_MOVABLE_HUNGER;
    this.isResting = (this.isLyingDown || !wantsToMove) &&
      this.body.grounded &&
      Math.hypot(this.body.velocity.x, this.body.velocity.z) < 0.08;

    if (wantsToMove && canMove && !this.isKnockedDown) {
      this.movementDirection.normalize();
      this.applyHorizontalAcceleration(deltaTime, effectiveMaxSpeed);
      this.consumeStamina((isInWater ? WATER_STAMINA_DRAIN_PER_SECOND : WALK_STAMINA_DRAIN_PER_SECOND) * deltaTime);
      this.consumeHunger((isInWater ? 0.035 : 0.025) * deltaTime);
    } else {
      this.applyFriction(deltaTime, isInWater);
    }

    this.speed = effectiveMaxSpeed;
    movement.x = this.body.velocity.x * deltaTime;
    movement.z = this.body.velocity.z * deltaTime;

    this.updateRestRecovery(deltaTime);
    this.updateKnockdown(deltaTime);
    this.kickGestureTimer = Math.max(0, this.kickGestureTimer - deltaTime);
    this.gravity = this.getEffectiveGravity(isGlidePhysicsActive);
    this.lastVerticalVelocity = this.body.velocity.y;
    this.body.velocity.y -= this.gravity * deltaTime;

    if (isGlidePhysicsActive) {
      this.applyGlidingPhysics(deltaTime);
    }

    movement.y += this.body.velocity.y * deltaTime;

    const collisionResult = moveBodyWithCollisions(this.body, movement, worldManager);

    this.resolvePhysicalCollision(collisionResult);
    this.resolveEntityCollisions(npcSystem);
    this.resolveSolidBlockEntrapment(worldManager);

    this.velocity.copy(this.body.velocity);

    if (this.body.grounded) {
      this.didSuperJumpThisTakeoff = false;
      this.hasUsedAirJump = false;

      if (isGlidePhysicsActive) {
        this.setGliding(false);
      }
    }
  }

  updateHoverPosition(deltaTime, worldManager, npcSystem = null) {
    const hoverDirection = this.movementDirection.clone();
    const hoverSpeed = this.baseSpeed * HOVER_SPEED_MULTIPLIER;
    const targetVelocity = new THREE.Vector3();

    if (hoverDirection.lengthSq() > 0) {
      hoverDirection.normalize();
      targetVelocity.copy(hoverDirection).multiplyScalar(hoverSpeed);
    }

    this.body.velocity.lerp(targetVelocity, 1 - Math.exp(-deltaTime * 10));
    this.body.velocity.y = 0;
    this.gravity = 0;
    this.isResting = false;
    this.isMovementBlockedByHunger = false;
    this.kickGestureTimer = Math.max(0, this.kickGestureTimer - deltaTime);

    const movement = this.body.velocity.clone().multiplyScalar(deltaTime);
    const collisionResult = moveBodyWithCollisions(this.body, movement, worldManager);

    this.resolvePhysicalCollision(collisionResult);
    this.resolveEntityCollisions(npcSystem);
    this.resolveSolidBlockEntrapment(worldManager);
    this.velocity.copy(this.body.velocity);
    this.body.grounded = false;
  }

  resolveSolidBlockEntrapment(worldManager) {
    const openPosition = findNearestOpenBodyPosition(this.body, worldManager);

    if (!openPosition) {
      return;
    }

    this.body.position.copy(openPosition);
    this.body.velocity.set(0, 0, 0);
    this.body.grounded = false;
    this.setHovering?.(false);
    this.setGliding?.(false);
    this.setLyingDown?.(false);
  }

  updateCharacter(deltaTime) {
    this.character.position.copy(this.position);

    if (this.movementDirection.lengthSq() > 0) {
      this.updateDesiredFacingDirection();
      this.characterFacingDirection.lerp(this.desiredFacingDirection, 0.12).normalize();
    } else if (this.cameraMode === CAMERA_MODES.THIRD_PERSON && this.isMouseLookActive) {
      this.characterFacingDirection.copy(this.forward);
    } else if (this.cameraMode === CAMERA_MODES.FIRST_PERSON && !this.isOrbitingCamera) {
      this.characterFacingDirection.copy(this.forward);
    }

    this.character.rotation.y =
      Math.atan2(this.characterFacingDirection.x, this.characterFacingDirection.z) +
      (this.character.userData.forwardYawOffset ?? 0);
    this.updateCharacterPose(deltaTime);
  }

  updateDesiredFacingDirection() {
    this.desiredFacingDirection.set(0, 0, 0);

    if (this.inputForward !== 0) {
      this.desiredFacingDirection.addScaledVector(this.forward, this.inputForward);
    } else {
      this.desiredFacingDirection.copy(this.forward);
    }

    if (this.inputLateral !== 0) {
      this.desiredFacingDirection.addScaledVector(this.right, this.inputLateral * LATERAL_FACING_INFLUENCE);
    }

    if (this.desiredFacingDirection.lengthSq() === 0) {
      this.desiredFacingDirection.copy(this.characterFacingDirection);
    }

    this.desiredFacingDirection.normalize();
  }

  resolvePhysicalCollision(collisionResult) {
    const impactVelocity = collisionResult.impactVelocity ?? this.body.velocity;

    if (collisionResult.collidedX) {
      this.resolveHorizontalImpact('x', impactVelocity.x);
    }

    if (collisionResult.collidedZ) {
      this.resolveHorizontalImpact('z', impactVelocity.z);
    }

    if (collisionResult.grounded || collisionResult.collidedY) {
      this.resolveVerticalImpact(impactVelocity.y);
    }
  }

  resolveEntityCollisions(npcSystem) {
    if (typeof npcSystem?.getCollisionBodies !== 'function') {
      return;
    }

    for (const entity of npcSystem.getCollisionBodies()) {
      if (!entity?.position) {
        continue;
      }

      const playerBounds = this.body.getBoundsAt(this.position);
      const radius = entity.radius ?? 0.34;
      const entityBounds = {
        minX: entity.position.x - radius,
        maxX: entity.position.x + radius,
        minY: entity.position.y,
        maxY: entity.position.y + (entity.height ?? DEFAULT_PLAYER_HEIGHT),
        minZ: entity.position.z - radius,
        maxZ: entity.position.z + radius,
      };

      if (
        playerBounds.maxX <= entityBounds.minX ||
        playerBounds.minX >= entityBounds.maxX ||
        playerBounds.maxY <= entityBounds.minY ||
        playerBounds.minY >= entityBounds.maxY ||
        playerBounds.maxZ <= entityBounds.minZ ||
        playerBounds.minZ >= entityBounds.maxZ
      ) {
        continue;
      }

      const overlapX = Math.min(playerBounds.maxX - entityBounds.minX, entityBounds.maxX - playerBounds.minX);
      const overlapZ = Math.min(playerBounds.maxZ - entityBounds.minZ, entityBounds.maxZ - playerBounds.minZ);
      const useXAxis = overlapX <= overlapZ;
      const axis = useXAxis ? 'x' : 'z';
      const normal = new THREE.Vector3();
      const direction = this.position[axis] >= entity.position[axis] ? 1 : -1;

      normal[axis] = direction;
      this.position[axis] += direction * ((useXAxis ? overlapX : overlapZ) + ENTITY_COLLISION_EPSILON);

      const impactSpeed = Math.max(0, -this.body.velocity.dot(normal));

      if (impactSpeed > 0) {
        this.resolveHorizontalImpact(axis, this.body.velocity[axis]);
        entity.onImpact?.({
          impactSpeed,
          normal,
          playerMass: this.body.mass,
        });
      } else {
        this.body.velocity[axis] = 0;
      }
    }
  }

  resolveHorizontalImpact(axis, impactSpeed) {
    const absoluteImpactSpeed = Math.abs(impactSpeed);

    if (absoluteImpactSpeed >= WALL_BOUNCE_THRESHOLD) {
      this.body.velocity[axis] = -impactSpeed * WALL_BOUNCE_RESTITUTION;
      this.consumeStamina((absoluteImpactSpeed - WALL_BOUNCE_THRESHOLD) * WALL_STAMINA_LOSS_SCALE);

      if (absoluteImpactSpeed >= KNOCKDOWN_WALL_SPEED) {
        this.knockDown((absoluteImpactSpeed - KNOCKDOWN_WALL_SPEED) * 0.18);
      }

      return;
    }

    this.body.velocity[axis] = 0;
  }

  resolveVerticalImpact(impactSpeed) {
    const fallSpeed = Math.max(0, -impactSpeed);

    if (this.isGliding) {
      this.body.velocity.y = 0;
      return;
    }

    if (fallSpeed > FALL_STAMINA_SAFE_SPEED) {
      this.consumeStamina((fallSpeed - FALL_STAMINA_SAFE_SPEED) * FALL_STAMINA_LOSS_SCALE);
    }

    if (fallSpeed >= KNOCKDOWN_FALL_SPEED) {
      this.knockDown((fallSpeed - KNOCKDOWN_FALL_SPEED) * 0.22);
    }

    this.body.velocity.y = 0;
  }

  knockDown(extraSeconds = 0) {
    this.setLyingDown(false);
    this.setGliding(false);
    this.isKnockedDown = true;
    this.knockdownTimer = Math.max(
      this.knockdownTimer,
      clamp(KNOCKDOWN_BASE_SECONDS + extraSeconds, KNOCKDOWN_BASE_SECONDS, KNOCKDOWN_MAX_SECONDS),
    );
  }

  updateKnockdown(deltaTime) {
    if (!this.isKnockedDown) {
      return;
    }

    this.knockdownTimer = Math.max(0, this.knockdownTimer - deltaTime);
    this.applyFriction(deltaTime, false);

    if (this.knockdownTimer <= 0 && this.body.grounded) {
      this.isKnockedDown = false;
    }
  }

  toggleGliding() {
    this.setGliding(!this.isGliding);
  }

  setGliding(isGliding) {
    const nextValue = Boolean(isGliding) && !this.isHovering && !this.isLyingDown && !this.isKnockedDown;

    if (this.isGliding === nextValue) {
      return;
    }

    this.isGliding = nextValue;
    this.character.userData.setGliderVisible?.(this.isGliding);
  }

  toggleHovering() {
    this.setHovering(!this.isHovering);
  }

  setHovering(isHovering) {
    const nextValue = Boolean(isHovering) && !this.isKnockedDown && !this.isLyingDown;

    if (this.isHovering === nextValue) {
      return;
    }

    this.isHovering = nextValue;

    if (this.isHovering) {
      this.setLyingDown(false);
      this.setGliding(false);
      if (this.body.grounded) {
        this.position.y += 0.45;
      }
      this.body.grounded = false;
      this.body.velocity.y = 0;
    }
  }

  isGlidePhysicsActive(isInWater = false) {
    return (
      this.isGliding &&
      !this.body.grounded &&
      !isInWater &&
      !this.isLyingDown &&
      !this.isKnockedDown &&
      this.stamina > 0
    );
  }

  applyGlidingPhysics(deltaTime) {
    if (this.body.velocity.y < -GLIDE_MAX_FALL_SPEED) {
      this.body.velocity.y = Math.max(
        this.body.velocity.y,
        -GLIDE_MAX_FALL_SPEED,
      );
    }

    const horizontalSpeed = Math.hypot(this.body.velocity.x, this.body.velocity.z);

    if (horizontalSpeed < GLIDE_MAX_HORIZONTAL_SPEED) {
      this.body.velocity.x += this.characterFacingDirection.x * GLIDE_FORWARD_ACCELERATION * deltaTime;
      this.body.velocity.z += this.characterFacingDirection.z * GLIDE_FORWARD_ACCELERATION * deltaTime;
      this.limitHorizontalSpeed(GLIDE_MAX_HORIZONTAL_SPEED);
    }

    this.consumeStamina(GLIDE_STAMINA_DRAIN_PER_SECOND * deltaTime);

    if (this.stamina <= 0) {
      this.setGliding(false);
    }
  }

  toggleLieDown() {
    this.setLyingDown(!this.isLyingDown);
  }

  setLyingDown(isLyingDown) {
    const nextValue = Boolean(isLyingDown) && this.body.grounded && !this.isKnockedDown;

    if (this.isLyingDown === nextValue) {
      return;
    }

    this.isLyingDown = nextValue;

    if (this.isLyingDown) {
      this.setGliding(false);
      this.keys.clear();
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
      this.kickGestureTimer = 0;
    }
  }

  updateCharacterPose(deltaTime) {
    const targetAmount = this.isKnockedDown ? 1 : 0;
    const targetLieDownAmount = this.isLyingDown && !this.isKnockedDown ? 1 : 0;

    this.characterKnockdownAmount +=
      (targetAmount - this.characterKnockdownAmount) *
      (1 - Math.exp(-KNOCKDOWN_VISUAL_LERP * deltaTime));
    this.characterLieDownAmount +=
      (targetLieDownAmount - this.characterLieDownAmount) *
      (1 - Math.exp(-LIE_DOWN_VISUAL_LERP * deltaTime));
    this.character.rotation.x =
      -this.characterKnockdownAmount * KNOCKDOWN_FORWARD_TILT -
      this.characterLieDownAmount * LIE_DOWN_FORWARD_TILT;
    this.character.rotation.z = this.characterKnockdownAmount * 0.08;
  }

  updateCharacterAnimation(deltaTime) {
    if (typeof this.character.userData.updateAnimation !== 'function') {
      return;
    }

    this.character.userData.updateAnimation(deltaTime, {
      horizontalSpeed: Math.hypot(this.velocity.x, this.velocity.z),
      isGrounded: this.body.grounded,
      isMoving: !this.isKnockedDown && this.movementDirection.lengthSq() > 0,
      maxSpeed: this.speed,
      verticalSpeed: this.body.velocity.y,
      isKnockedDown: this.isKnockedDown,
      isLyingDown: this.isLyingDown,
      isGliding: this.isGliding,
      isHovering: this.isHovering,
      isKicking: this.kickGestureTimer > 0,
    });
  }

  applyHorizontalAcceleration(deltaTime, maxSpeed) {
    const acceleration = BASE_ACCELERATION * this.getMassSpeedScale() * this.getHeightSpeedScale();

    this.body.velocity.x += this.movementDirection.x * acceleration * deltaTime;
    this.body.velocity.z += this.movementDirection.z * acceleration * deltaTime;
    this.limitHorizontalSpeed(maxSpeed);
  }

  applyFriction(deltaTime, isInWater) {
    const friction = isInWater ? WATER_DRAG : this.body.grounded ? GROUND_FRICTION : AIR_FRICTION;
    const decay = Math.exp(-friction * deltaTime);

    this.body.velocity.x *= decay;
    this.body.velocity.z *= decay;

    if (Math.abs(this.body.velocity.x) < STOP_EPSILON) {
      this.body.velocity.x = 0;
    }

    if (Math.abs(this.body.velocity.z) < STOP_EPSILON) {
      this.body.velocity.z = 0;
    }
  }

  limitHorizontalSpeed(maxSpeed) {
    const horizontalSpeed = Math.hypot(this.body.velocity.x, this.body.velocity.z);

    if (horizontalSpeed <= maxSpeed || horizontalSpeed <= 0) {
      return;
    }

    const scale = maxSpeed / horizontalSpeed;
    this.body.velocity.x *= scale;
    this.body.velocity.z *= scale;
  }

  getMassSpeedScale() {
    return clamp(DEFAULT_PLAYER_MASS / Math.max(this.playerMass, 1), 0.68, 1.18);
  }

  getHeightSpeedScale() {
    return clamp(this.playerHeight / DEFAULT_PLAYER_HEIGHT, 0.76, 1.18);
  }

  getStaminaSpeedScale() {
    return clamp(0.35 + (this.stamina / MAX_STAMINA) * 0.65, 0.35, 1);
  }

  getHungerSpeedScale() {
    if (this.hunger <= MIN_MOVABLE_HUNGER) {
      return 0;
    }

    return clamp((this.hunger - MIN_MOVABLE_HUNGER) / (MAX_HUNGER - MIN_MOVABLE_HUNGER), 0.2, 1);
  }

  getEffectiveMaxSpeed(waterSpeedScale = 1) {
    return this.baseSpeed *
      waterSpeedScale *
      this.getMassSpeedScale() *
      this.getHeightSpeedScale() *
      this.getStaminaSpeedScale() *
      this.getHungerSpeedScale();
  }

  getEffectiveJumpSpeed() {
    return this.baseJumpSpeed *
      this.getHeightSpeedScale() *
      Math.sqrt(this.getMassSpeedScale()) *
      clamp(0.55 + (this.stamina / MAX_STAMINA) * 0.45, 0.55, 1);
  }

  getEffectiveGravity(isGliding = false) {
    return BASE_GRAVITY * clamp(this.playerMass / DEFAULT_PLAYER_MASS, 0.82, 1.28) * (isGliding ? GLIDE_GRAVITY_SCALE : 1);
  }

  consumeStamina(amount) {
    this.stamina = clamp(this.stamina - amount, 0, this.getEffectiveStaminaCap());
  }

  consumeHunger(amount) {
    this.hunger = clamp(this.hunger - amount, 0, MAX_HUNGER);
    this.stamina = Math.min(this.stamina, this.getEffectiveStaminaCap());
  }

  updateRestRecovery(deltaTime) {
    if (!this.isResting) {
      return;
    }

    this.hunger = clamp(this.hunger + 0.18 * deltaTime, 0, MAX_HUNGER);
    const staminaRecoveryMultiplier = this.isLyingDown ? LYING_REST_STAMINA_MULTIPLIER : 1;

    this.stamina = clamp(this.stamina + 12 * staminaRecoveryMultiplier * deltaTime, 0, this.getEffectiveStaminaCap());
  }

  getEffectiveStaminaCap() {
    return MAX_STAMINA * clamp(this.hunger / MAX_HUNGER, 0.3, 1);
  }

  emitPlayerState() {
    const maxStamina = this.getEffectiveStaminaCap();
    const headingDegrees = ((Math.atan2(this.characterFacingDirection.x, -this.characterFacingDirection.z) * 180 / Math.PI) + 360) % 360;

    this.eventBus?.emit('player:update', {
      hunger: this.hunger,
      maxHunger: MAX_HUNGER,
      stamina: Math.min(this.stamina, maxStamina),
      maxStamina,
      speed: Math.hypot(this.body.velocity.x, this.body.velocity.z),
      maxSpeed: this.speed,
      mass: this.playerMass,
      height: this.playerHeight,
      altitude: this.position.y,
      gravity: this.gravity,
      isResting: this.isResting,
      isLyingDown: this.isLyingDown,
      isGliding: this.isGliding,
      isHovering: this.isHovering,
      isKnockedDown: this.isKnockedDown,
      isMovementBlockedByHunger: this.isMovementBlockedByHunger,
      headingDegrees,
    });
  }

  serialize() {
    return {
      position: this.position.toArray(),
      velocity: this.body.velocity.toArray(),
      hunger: this.hunger,
      stamina: this.stamina,
      isLyingDown: this.isLyingDown,
      isGliding: this.isGliding,
      isHovering: this.isHovering,
      cameraMode: this.cameraMode,
      cameraFollowAngleIndex: this.cameraFollowAngleIndex,
      cameraOrbitHeightOffset: this.cameraOrbitHeightOffset,
      heading: this.characterFacingDirection.toArray(),
    };
  }

  restore(state = {}) {
    if (Array.isArray(state.position) && state.position.length >= 3) {
      this.position.fromArray(state.position);
    }

    if (Array.isArray(state.velocity) && state.velocity.length >= 3) {
      this.body.velocity.fromArray(state.velocity);
    } else {
      this.body.velocity.set(0, 0, 0);
    }

    this.hunger = clamp(Number(state.hunger ?? this.hunger), 0, MAX_HUNGER);
    this.stamina = clamp(Number(state.stamina ?? this.stamina), 0, this.getEffectiveStaminaCap());
    this.setLyingDown(Boolean(state.isLyingDown));
    this.setGliding(Boolean(state.isGliding));
    this.body.grounded = false;
    this.setHovering(Boolean(state.isHovering));

    if (state.cameraMode && Object.values(CAMERA_MODES).includes(state.cameraMode)) {
      this.cameraMode = state.cameraMode;
      this.controls.enabled = this.cameraMode === CAMERA_MODES.FIRST_PERSON;
      this.character.visible = this.cameraMode !== CAMERA_MODES.FIRST_PERSON;
    }

    this.cameraFollowAngleIndex = clamp(Number(state.cameraFollowAngleIndex ?? this.cameraFollowAngleIndex), 0, CAMERA_FOLLOW_ANGLES.length - 1);
    this.cameraFollowAngle = CAMERA_FOLLOW_ANGLES[this.cameraFollowAngleIndex];
    this.targetCameraFollowAngle = this.cameraFollowAngle;
    this.cameraOrbitHeightOffset = clamp(Number(state.cameraOrbitHeightOffset ?? this.cameraOrbitHeightOffset), this.minCameraOrbitHeightOffset, this.maxCameraOrbitHeightOffset);
    this.targetCameraOrbitHeightOffset = this.cameraOrbitHeightOffset;

    if (Array.isArray(state.heading) && state.heading.length >= 3) {
      this.characterFacingDirection.fromArray(state.heading).normalize();
    }

    this.updateCamera(0);
    this.emitPlayerState();
  }

  updateCamera(deltaTime) {
    if (this.cameraMode === CAMERA_MODES.FIRST_PERSON) {
      this.camera.position.set(
        this.position.x,
        this.position.y + this.eyeHeight,
        this.position.z,
      );
      return;
    }

    if (deltaTime > 0) {
      const cameraOffsetLerp = 1 - Math.exp(-deltaTime * THIRD_PERSON_CAMERA_OFFSET_LERP);
      this.cameraFollowAngle += (this.targetCameraFollowAngle - this.cameraFollowAngle) * cameraOffsetLerp;
      this.cameraOrbitHeightOffset +=
        (this.targetCameraOrbitHeightOffset - this.cameraOrbitHeightOffset) * cameraOffsetLerp;
    } else {
      this.cameraFollowAngle = this.targetCameraFollowAngle;
      this.cameraOrbitHeightOffset = this.targetCameraOrbitHeightOffset;
    }

    this.cameraFollowDirection
      .set(Math.sin(this.cameraFollowAngle), 0, Math.cos(this.cameraFollowAngle))
      .normalize();

    this.cameraFollowPosition.set(
      this.position.x,
      this.position.y + this.cameraHeight + this.cameraOrbitHeightOffset,
      this.position.z,
    );
    this.cameraFollowPosition.addScaledVector(this.cameraFollowDirection, -this.cameraDistance);

    if (this.isOrbitingCamera && this.cameraOrbitHeightOffset > 2.4) {
      this.cameraFollowPosition.addScaledVector(this.cameraFollowDirection, this.cameraOrbitHeightOffset * 0.22);
    }

    if (deltaTime > 0) {
      const followAmount = 1 - Math.exp(-deltaTime * 12);
      this.camera.position.lerp(this.cameraFollowPosition, followAmount);
    } else {
      this.camera.position.copy(this.cameraFollowPosition);
    }

    this.cameraLookTarget.set(
      this.position.x,
      this.position.y + this.eyeHeight * 0.82 + (this.isOrbitingCamera ? this.cameraOrbitHeightOffset * 0.42 : 0),
      this.position.z,
    );
    this.camera.lookAt(this.cameraLookTarget);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('pointerdown', this.onMouseDown);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.controls.unlock();
    this.controls.dispose();
  }
}
