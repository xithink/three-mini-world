import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createRasterSvgTexture } from '../utils/svgTexture.js';

//const CHARACTER_ASSET_URL = '/assets/weilaixianjia.glb';
//const CHARACTER_ASSET_URL = '/assets/renwu.glb';
const CHARACTER_ASSET_URL = '/assets/Steve03.glb';
const GLIDER_WING_TEXTURE_URL = '/assets/textwatergliderwing.svg';


const CHARACTER_SCALE = 0.5;
const PLAYER_NAME = '未来探险家';
const ANIMATION_FADE_SECONDS = 0.16;
const ANIMATION_BINDINGS = Object.freeze({
  idle: [/^idle/i, /idle/i, /stand/i, /breath/i, /wait/i, /rest/i],
  walk: [/^walk/i, /walk/i, /run/i, /jog/i, /move/i, /locomotion/i, /layer0/i, /mixamo/i],
  jump: [/^jump/i, /jump/i, /fall/i, /air/i, /leap/i],
  kick: [/^kick/i, /kick/i, /attack/i],
});

const MATERIAL_TEXTURE_SLOTS = [
  'map',
  'emissiveMap',
  'aoMap',
  'bumpMap',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'alphaMap',
];

const calibrationBox = new THREE.Box3();
const calibrationSize = new THREE.Vector3();
const calibrationCenter = new THREE.Vector3();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeMaterial(color, roughness = 0.72) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.02,
  });
}

function addMesh(group, geometry, material, position, scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  return mesh;
}

function configurePixelTexture(texture, slotName) {
  if (!texture) {
    return;
  }

  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 1;

  if (slotName === 'map' || slotName === 'emissiveMap') {
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  texture.needsUpdate = true;
}

function configurePixelMaterial(material) {
  if (!material) {
    return;
  }

  MATERIAL_TEXTURE_SLOTS.forEach((slotName) => {
    configurePixelTexture(material[slotName], slotName);
  });
  material.needsUpdate = true;
}

function createGliderWingAttachment(bounds) {
  const texture = createRasterSvgTexture(GLIDER_WING_TEXTURE_URL, {
    width: 512,
    height: 256,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  texture.anisotropy = 8;

  const geometry = new THREE.PlaneGeometry(2.75, 1.26);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
    roughness: 0.48,
    metalness: 0.02,
  });
  const group = new THREE.Group();
  const wing = new THREE.Mesh(geometry, material);
  const shoulderHeight = Math.max(0.9, bounds.height * 0.62);

  group.name = 'GliderWing';
  group.visible = false;
  group.position.set(0, shoulderHeight, 0.32);
  group.rotation.x = -0.18;
  group.scale.set(0.45, 0.28, 1);
  wing.castShadow = true;
  wing.receiveShadow = true;
  group.add(wing);

  return {
    group,
    dispose: () => {
      geometry.dispose();
      texture.dispose();
      material.dispose();
    },
  };
}

function configureCharacterMesh(object) {
  if (!object.isMesh) {
    return;
  }

  object.castShadow = true;
  object.receiveShadow = true;
  object.frustumCulled = false;
  object.userData.characterPart = true;

  if (Array.isArray(object.material)) {
    object.material.forEach(configurePixelMaterial);
  } else {
    configurePixelMaterial(object.material);
  }
}

function calibrateModelToFeet(model) {
  model.updateMatrixWorld(true);
  calibrationBox.setFromObject(model);
  calibrationBox.getCenter(calibrationCenter);

  model.position.x -= calibrationCenter.x;
  model.position.y -= calibrationBox.min.y;
  model.position.z -= calibrationCenter.z;

  model.updateMatrixWorld(true);
  calibrationBox.setFromObject(model);
  calibrationBox.getSize(calibrationSize);

  return {
    height: calibrationSize.y,
    width: calibrationSize.x,
    depth: calibrationSize.z,
    footY: calibrationBox.min.y,
  };
}

function createFallbackCharacterModel() {
  const model = new THREE.Group();
  const bootMaterial = makeMaterial(0x1d2528);
  const suitMaterial = makeMaterial(0x2b5a68);
  const armorMaterial = makeMaterial(0xd8eef2, 0.48);
  const visorMaterial = makeMaterial(0x83f7ff, 0.36);
  const skinMaterial = makeMaterial(0xd0a06f, 0.58);
  const accentMaterial = makeMaterial(0xffc857, 0.5);

  addMesh(model, new THREE.BoxGeometry(0.22, 0.5, 0.22), suitMaterial, [-0.18, 0.5, 0]);
  addMesh(model, new THREE.BoxGeometry(0.22, 0.5, 0.22), suitMaterial, [0.18, 0.5, 0]);
  addMesh(model, new THREE.BoxGeometry(0.28, 0.12, 0.3), bootMaterial, [-0.18, 0.17, 0.04]);
  addMesh(model, new THREE.BoxGeometry(0.28, 0.12, 0.3), bootMaterial, [0.18, 0.17, 0.04]);
  addMesh(model, new THREE.BoxGeometry(0.72, 0.82, 0.36), armorMaterial, [0, 1.12, 0]);
  addMesh(model, new THREE.BoxGeometry(0.18, 0.62, 0.18), suitMaterial, [-0.48, 1.12, 0]);
  addMesh(model, new THREE.BoxGeometry(0.18, 0.62, 0.18), suitMaterial, [0.48, 1.12, 0]);
  addMesh(model, new THREE.SphereGeometry(0.28, 16, 12), skinMaterial, [0, 1.76, 0]);
  addMesh(model, new THREE.BoxGeometry(0.46, 0.18, 0.36), visorMaterial, [0, 1.87, -0.08]);
  addMesh(model, new THREE.BoxGeometry(0.16, 0.3, 0.12), accentMaterial, [0, 1.2, -0.24]);

  return model;
}

function normalizeAnimationName(clip) {
  return (clip?.name ?? '').toLowerCase();
}

function findAnimationClip(animations, key, usedClips) {
  const matchers = ANIMATION_BINDINGS[key] ?? [];

  return animations.find((clip) => {
    if (usedClips.has(clip)) {
      return false;
    }

    const name = normalizeAnimationName(clip);

    return matchers.some((matcher) => matcher.test(name));
  });
}

function stripRootMotionTracks(clip) {
  const rootMotionTrackMatchers = [
    /^Armature\.position$/i,
    /^Hips\.position$/i,
    /^Main\.position$/i,
    /^Root\.position$/i,
    /^mixamorigHips\.position$/i,
  ];
  const filteredTracks = clip.tracks.filter((track) => {
    if (!track.name.endsWith('.position')) {
      return true;
    }

    return !rootMotionTrackMatchers.some((matcher) => matcher.test(track.name));
  });

  if (filteredTracks.length === clip.tracks.length) {
    return clip;
  }

  return new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
}

function bindAnimationClips(animations) {
  const clips = animations.map((clip) => stripRootMotionTracks(clip.clone()));
  const usedClips = new Set();
  const bindings = {
    idle: null,
    walk: null,
    jump: null,
  };

  Object.keys(bindings).forEach((key) => {
    const clip = findAnimationClip(clips, key, usedClips);

    if (clip) {
      bindings[key] = clip;
      usedClips.add(clip);
    }
  });

  if (!bindings.walk) {
    bindings.walk = clips.find((clip) => !usedClips.has(clip)) ?? bindings.idle ?? bindings.jump ?? clips[0] ?? null;
  }

  if (!bindings.idle) {
    bindings.idle = bindings.walk ?? bindings.jump ?? clips[0] ?? null;
  }

  if (!bindings.jump) {
    bindings.jump = bindings.walk ?? bindings.idle ?? clips[0] ?? null;
  }

  return {
    bindings,
    clips,
  };
}

function findFirstObjectByName(root, names) {
  const wanted = names.map((name) => name.toLowerCase());
  let found = null;

  root.traverse((object) => {
    if (found || !object.name) {
      return;
    }

    if (wanted.includes(object.name.toLowerCase())) {
      found = object;
    }
  });

  return found;
}

function collectPoseBones(model) {
  return {
    hips: findFirstObjectByName(model, ['Hips', 'Main']),
    chest: findFirstObjectByName(model, ['Chest']),
    head: findFirstObjectByName(model, ['Head']),
    leftUpperArm: findFirstObjectByName(model, ['L_Up']),
    leftLowerArm: findFirstObjectByName(model, ['L_Bottom']),
    rightUpperArm: findFirstObjectByName(model, ['R_Up']),
    rightLowerArm: findFirstObjectByName(model, ['R_Bottom']),
    leftUpperLeg: findFirstObjectByName(model, ['LT_leg']),
    leftLowerLeg: findFirstObjectByName(model, ['LB_leg']),
    leftFoot: findFirstObjectByName(model, ['L_Foot']),
    rightUpperLeg: findFirstObjectByName(model, ['RT_leg']),
    rightLowerLeg: findFirstObjectByName(model, ['RB_leg']),
    rightFoot: findFirstObjectByName(model, ['R_Foot']),
  };
}

function makeProceduralPoseAnimator(model) {
  const bones = collectPoseBones(model);
  const poseTargets = Object.values(bones).filter(Boolean);
  const restRotations = new Map();
  const restPositions = new Map();
  const baseModelPosition = model.position.clone();
  let elapsedTime = 0;

  if (!poseTargets.length) {
    return null;
  }

  poseTargets.forEach((bone) => {
    restRotations.set(bone, bone.rotation.clone());
    restPositions.set(bone, bone.position.clone());
  });

  function resetPose() {
    poseTargets.forEach((bone) => {
      bone.rotation.copy(restRotations.get(bone));
      bone.position.copy(restPositions.get(bone));
    });
    model.position.copy(baseModelPosition);
  }

  function rotateBone(bone, x = 0, y = 0, z = 0) {
    if (!bone) {
      return;
    }

    bone.rotation.x += x;
    bone.rotation.y += y;
    bone.rotation.z += z;
  }

  function setModelBob(value) {
    model.position.y = baseModelPosition.y + value;
  }

  function update(deltaTime, state = {}) {
    elapsedTime += deltaTime;
    resetPose();

    const horizontalSpeed = state.horizontalSpeed ?? 0;
    const maxSpeed = Math.max(state.maxSpeed ?? 1, 0.001);
    const speedRatio = clamp(horizontalSpeed / maxSpeed, 0, 1.2);
    const isMoving = state.isMoving || horizontalSpeed > 0.05;
    const isAirborne = state.isGrounded === false;

    if (state.isKicking) {
      const kickPhase = Math.sin(elapsedTime * 28);
      const extension = Math.max(0, kickPhase);

      rotateBone(bones.hips, -0.08, 0, -0.08);
      rotateBone(bones.chest, 0.12, 0, 0.08);
      rotateBone(bones.head, 0.04, 0, -0.04);
      rotateBone(bones.leftUpperArm, 0.22, 0, 0.34);
      rotateBone(bones.rightUpperArm, -0.42, 0, -0.26);
      rotateBone(bones.leftUpperLeg, 0.16, 0, 0.05);
      rotateBone(bones.rightUpperLeg, -0.72 - extension * 0.46, 0, -0.05);
      rotateBone(bones.rightLowerLeg, 0.72 + extension * 0.28);
      rotateBone(bones.rightFoot, 0.22);
      setModelBob(0.015);
      return;
    }

    if (state.isKnockedDown) {
      rotateBone(bones.chest, -0.18, 0, 0.08);
      rotateBone(bones.head, 0.12, 0, -0.05);
      rotateBone(bones.leftUpperArm, -0.7, 0, 0.36);
      rotateBone(bones.rightUpperArm, -0.7, 0, -0.36);
      rotateBone(bones.leftUpperLeg, 0.42, 0, 0.08);
      rotateBone(bones.rightUpperLeg, 0.42, 0, -0.08);
      rotateBone(bones.leftLowerLeg, -0.5);
      rotateBone(bones.rightLowerLeg, -0.5);
      setModelBob(0);
      return;
    }

    if (state.isLyingDown) {
      rotateBone(bones.chest, -0.1);
      rotateBone(bones.head, 0.18);
      rotateBone(bones.leftUpperArm, -0.32, 0, 0.28);
      rotateBone(bones.rightUpperArm, -0.32, 0, -0.28);
      rotateBone(bones.leftLowerArm, -0.26);
      rotateBone(bones.rightLowerArm, -0.26);
      rotateBone(bones.leftUpperLeg, 0.12, 0, 0.06);
      rotateBone(bones.rightUpperLeg, 0.12, 0, -0.06);
      rotateBone(bones.leftLowerLeg, -0.18);
      rotateBone(bones.rightLowerLeg, -0.18);
      setModelBob(0);
      return;
    }

    if (state.isGliding) {
      const glideWave = Math.sin(elapsedTime * 3.8);

      rotateBone(bones.hips, -0.2);
      rotateBone(bones.chest, 0.24, 0, glideWave * 0.025);
      rotateBone(bones.head, 0.1, 0, -glideWave * 0.018);
      rotateBone(bones.leftUpperArm, -0.18, 0, 1.18);
      rotateBone(bones.rightUpperArm, -0.18, 0, -1.18);
      rotateBone(bones.leftLowerArm, -0.22, 0, 0.16);
      rotateBone(bones.rightLowerArm, -0.22, 0, -0.16);
      rotateBone(bones.leftUpperLeg, 0.2, 0, 0.06);
      rotateBone(bones.rightUpperLeg, 0.2, 0, -0.06);
      rotateBone(bones.leftLowerLeg, -0.42);
      rotateBone(bones.rightLowerLeg, -0.42);
      setModelBob(0.03 + glideWave * 0.01);
      return;
    }

    if (isAirborne) {
      const verticalSpeed = state.verticalSpeed ?? 0;
      const jumpLean = clamp(verticalSpeed / 8, -0.65, 0.65);

      rotateBone(bones.hips, -0.12 - jumpLean * 0.08);
      rotateBone(bones.chest, 0.08 + jumpLean * 0.06);
      rotateBone(bones.leftUpperArm, -1.05, 0, 0.18);
      rotateBone(bones.rightUpperArm, -1.05, 0, -0.18);
      rotateBone(bones.leftLowerArm, -0.38);
      rotateBone(bones.rightLowerArm, -0.38);
      rotateBone(bones.leftUpperLeg, 0.36 - jumpLean * 0.12, 0, 0.06);
      rotateBone(bones.rightUpperLeg, 0.36 - jumpLean * 0.12, 0, -0.06);
      rotateBone(bones.leftLowerLeg, -0.72);
      rotateBone(bones.rightLowerLeg, -0.72);
      rotateBone(bones.leftFoot, 0.32);
      rotateBone(bones.rightFoot, 0.32);
      setModelBob(0.04);
      return;
    }

    if (isMoving) {
      const strideTime = elapsedTime * (7.4 + speedRatio * 3.2);
      const stride = Math.sin(strideTime);
      const counterStride = Math.sin(strideTime + Math.PI);
      const legSwing = 0.68 * clamp(speedRatio, 0.45, 1.1);
      const armSwing = 0.58 * clamp(speedRatio, 0.45, 1.05);
      const kneeBend = Math.max(0, Math.sin(strideTime + Math.PI * 0.35)) * 0.45;
      const counterKneeBend = Math.max(0, Math.sin(strideTime + Math.PI * 1.35)) * 0.45;

      rotateBone(bones.hips, 0, 0, stride * 0.045);
      rotateBone(bones.chest, 0, 0, -stride * 0.035);
      rotateBone(bones.head, 0, -stride * 0.025);
      rotateBone(bones.leftUpperLeg, stride * legSwing);
      rotateBone(bones.rightUpperLeg, counterStride * legSwing);
      rotateBone(bones.leftLowerLeg, kneeBend);
      rotateBone(bones.rightLowerLeg, counterKneeBend);
      rotateBone(bones.leftFoot, -stride * 0.18);
      rotateBone(bones.rightFoot, -counterStride * 0.18);
      rotateBone(bones.leftUpperArm, counterStride * armSwing);
      rotateBone(bones.rightUpperArm, stride * armSwing);
      rotateBone(bones.leftLowerArm, -0.18 - Math.max(0, counterStride) * 0.22);
      rotateBone(bones.rightLowerArm, -0.18 - Math.max(0, stride) * 0.22);
      setModelBob(Math.abs(Math.sin(strideTime * 2)) * 0.035);
      return;
    }

    const idleWave = Math.sin(elapsedTime * 2.2);
    const idleBreath = Math.sin(elapsedTime * 1.35);

    rotateBone(bones.chest, idleBreath * 0.018, 0, idleWave * 0.01);
    rotateBone(bones.head, idleWave * 0.012, idleWave * 0.018);
    rotateBone(bones.leftUpperArm, 0.06 + idleWave * 0.018, 0, 0.035);
    rotateBone(bones.rightUpperArm, 0.06 - idleWave * 0.018, 0, -0.035);
    rotateBone(bones.leftLowerArm, -0.08);
    rotateBone(bones.rightLowerArm, -0.08);
    setModelBob((idleBreath + 1) * 0.006);
  }

  function dispose() {
    resetPose();
  }

  return {
    update,
    dispose,
    names: ['procedural-idle', 'procedural-walk', 'procedural-jump'],
    source: 'procedural',
  };
}

function createCharacterAnimator(model, animations) {
  if (!animations?.length) {
    return makeProceduralPoseAnimator(model);
  }

  const mixer = new THREE.AnimationMixer(model);
  const { bindings, clips } = bindAnimationClips(animations);
  const actions = new Map();
  let activeAction = null;
  let activeKey = null;

  clips.forEach((clip) => {
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.setEffectiveWeight(0);
    action.setEffectiveTimeScale(1);
    action.loop = THREE.LoopRepeat;
    actions.set(clip, action);
  });

  function getAction(key) {
    const clip = bindings[key];

    return clip ? actions.get(clip) : null;
  }

  function playAction(key) {
    if (activeKey === key) {
      return activeAction;
    }

    const nextAction = getAction(key);

    if (!nextAction) {
      return null;
    }

    if (activeAction) {
      activeAction.fadeOut(ANIMATION_FADE_SECONDS);
    }

    nextAction
      .reset()
      .setEffectiveWeight(1)
      .fadeIn(ANIMATION_FADE_SECONDS)
      .play();

    activeAction = nextAction;
    activeKey = key;

    return activeAction;
  }

  function stopAction() {
    if (!activeAction) {
      return;
    }

    activeAction.fadeOut(ANIMATION_FADE_SECONDS);
    activeAction = null;
    activeKey = null;
  }

  function update(deltaTime, state = {}) {
    if (state.isKnockedDown || state.isLyingDown) {
      stopAction();
      mixer.update(deltaTime);
      return;
    }

    const isMoving = state.isMoving || (state.horizontalSpeed ?? 0) > 0.05;
    const isAirborne = state.isGrounded === false;
    const nextKey =
      state.isKicking && bindings.kick
        ? 'kick'
        : isAirborne && bindings.jump
        ? 'jump'
        : isMoving
          ? 'walk'
          : bindings.idle
            ? 'idle'
            : 'walk';

    if (nextKey) {
      const action = playAction(nextKey);

      if (action && nextKey === 'walk') {
        const maxSpeed = Math.max(state.maxSpeed ?? 1, 0.001);
        const speedRatio = isMoving
          ? clamp((state.horizontalSpeed ?? maxSpeed) / maxSpeed, 0.55, 1.35)
          : 1;
        action.setEffectiveTimeScale(speedRatio);
      } else if (action && nextKey === 'jump') {
        action.setEffectiveTimeScale(state.verticalSpeed < -0.2 ? 0.9 : 1.15);
      } else if (action && nextKey === 'kick') {
        action.setEffectiveTimeScale(1.35);
      } else if (action) {
        action.setEffectiveTimeScale(1);
      }
    } else {
      stopAction();
    }

    mixer.update(deltaTime);
  }

  function dispose() {
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
  }

  return {
    mixer,
    clips,
    update,
    dispose,
    names: clips.map((clip) => clip.name || '(unnamed)'),
    source: 'clips',
    bindings: Object.fromEntries(
      Object.entries(bindings).map(([key, clip]) => [key, clip?.name || null]),
    ),
  };
}

function applyCharacterModel(character, model, source, animations = []) {
  character.userData.disposeAnimation?.();
  character.userData.disposeGlider?.();
  character.clear();
  model.name = source === 'glb' ? 'SteveRiggedModel' : 'FallbackFutureExplorerModel';
  model.scale.setScalar(CHARACTER_SCALE);
  model.traverse(configureCharacterMesh);

  const bounds = calibrateModelToFeet(model);

  character.add(model);
  const animator = createCharacterAnimator(model, animations);
  const glider = createGliderWingAttachment(bounds);
  let gliderOpenAmount = 0;
  let forcedGliderVisible = false;

  character.add(glider.group);

  function updateGlider(deltaTime, state = {}) {
    const targetAmount = state.isGliding || forcedGliderVisible ? 1 : 0;

    gliderOpenAmount += (targetAmount - gliderOpenAmount) * (1 - Math.exp(-deltaTime * 12));
    glider.group.visible = gliderOpenAmount > 0.02;
    glider.group.scale.set(
      0.45 + gliderOpenAmount * 0.55,
      0.28 + gliderOpenAmount * 0.72,
      1,
    );
    glider.group.rotation.x = -0.18 - gliderOpenAmount * 0.18;
    glider.group.position.z = 0.24 + gliderOpenAmount * 0.18;
  }

  character.userData.source = source;
  character.userData.height = bounds.height;
  character.userData.bounds = bounds;
  character.userData.isLoaded = true;
  character.userData.forwardYawOffset = source === 'fallback' ? Math.PI : 0;
  character.userData.animationNames = animator?.names ?? [];
  character.userData.animationSource = animator?.source ?? 'none';
  character.userData.animationBindings = animator?.bindings ?? null;
  character.userData.updateAnimation = (deltaTime, state = {}) => {
    animator?.update?.(deltaTime, state);
    updateGlider(deltaTime, state);
  };
  character.userData.setGliderVisible = (isVisible) => {
    forcedGliderVisible = Boolean(isVisible);
  };
  character.userData.disposeAnimation = animator?.dispose ?? null;
  character.userData.disposeGlider = glider.dispose;

  return bounds;
}

function loadCharacterModel(character) {
  const loader = new GLTFLoader();

  loader.load(
    CHARACTER_ASSET_URL,
    (gltf) => {
      applyCharacterModel(character, gltf.scene, 'glb', gltf.animations);
    },
    undefined,
    (error) => {
      console.warn(`Failed to load ${CHARACTER_ASSET_URL}; using fallback character.`, error);
      applyCharacterModel(character, createFallbackCharacterModel(), 'fallback');
    },
  );
}

export function createCharacterObject() {
  const character = new THREE.Group();
  character.name = `Player: ${PLAYER_NAME}`;
  character.userData.playerName = PLAYER_NAME;
  character.userData.assetUrl = CHARACTER_ASSET_URL;
  character.userData.scale = CHARACTER_SCALE;
  character.userData.isLoaded = false;

  loadCharacterModel(character);

  return character;
}
