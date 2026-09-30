import * as THREE from 'three';
import { BLOCK_IDS } from '../chunk.js';
import { getDesignedMountainSummary } from '../terrain/chunkTerrain.js';

const MOUNTAIN_BLOCK_LABELS = Object.freeze({
  [BLOCK_IDS.SNOW_MOUNTAIN]: '雪山山体',
  [BLOCK_IDS.ROCK_MOUNTAIN]: '岩山山体',
  [BLOCK_IDS.FOREST_MOUNTAIN]: '森林山体',
});

const MOUNTAIN_BLOCK_RISK = Object.freeze({
  [BLOCK_IDS.SNOW_MOUNTAIN]: 0.24,
  [BLOCK_IDS.ROCK_MOUNTAIN]: 0.18,
  [BLOCK_IDS.FOREST_MOUNTAIN]: 0.12,
});

const _instanceMatrix = new THREE.Matrix4();
const _instancePosition = new THREE.Vector3();
const _instanceQuaternion = new THREE.Quaternion();
const _instanceScale = new THREE.Vector3();

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function getDangerLabel(dangerIndex) {
  if (dangerIndex >= 0.76) return '极高';
  if (dangerIndex >= 0.56) return '高';
  if (dangerIndex >= 0.34) return '中';

  return '低';
}

function getSurfaceHeight(entity, x, z) {
  return entity.surfaceHeights[entity.chunk.getColumnIndex(x, z)] ?? 0;
}

function getSlopeScore(entity, x, z, surfaceHeight) {
  const { chunk } = entity;
  const neighbors = [
    [x + 1, z],
    [x - 1, z],
    [x, z + 1],
    [x, z - 1],
  ];
  let maxDelta = 0;

  for (const [neighborX, neighborZ] of neighbors) {
    if (neighborX < 0 || neighborX >= chunk.size.x || neighborZ < 0 || neighborZ >= chunk.size.z) {
      continue;
    }

    maxDelta = Math.max(maxDelta, Math.abs(getSurfaceHeight(entity, neighborX, neighborZ) - surfaceHeight));
  }

  return clamp01(maxDelta / 18);
}

function getTerrainLocalCell(hit) {
  const entity = hit.object.userData?.chunkEntity;
  const instanceId = hit.instanceId;

  if (!entity || typeof instanceId !== 'number') {
    return null;
  }

  hit.object.getMatrixAt(instanceId, _instanceMatrix);
  _instanceMatrix.decompose(_instancePosition, _instanceQuaternion, _instanceScale);

  const { chunk } = entity;
  const x = Math.round(_instancePosition.x / chunk.blockSize + (chunk.size.x - 1) / 2);
  const y = Math.round(_instancePosition.y / chunk.blockSize);
  const z = Math.round(_instancePosition.z / chunk.blockSize + (chunk.size.z - 1) / 2);

  if (!chunk.contains(x, y, z)) {
    return null;
  }

  return { entity, x, y, z };
}

function getTerrainWorldColumn(entity, x, z) {
  return {
    x: entity.chunkCoord.x * entity.chunk.size.x + x,
    z: entity.chunkCoord.z * entity.chunk.size.z + z,
  };
}

function getTerrainWorldBlock(entity, x, y, z) {
  return {
    x: entity.chunkCoord.x * entity.chunk.size.x - entity.chunk.size.x / 2 + x,
    y,
    z: entity.chunkCoord.z * entity.chunk.size.z - entity.chunk.size.z / 2 + z,
  };
}

function formatBuildingHoverState(record) {
  if (!record) {
    return null;
  }

  const referenceImage = record.referenceImage ?? record.meta?.referenceImage ?? null;
  const creatorName = record.creator?.nickname
    ?? record.creator?.userId
    ?? record.userId
    ?? record.playerId
    ?? '未知创建者';

  return {
    type: 'playerBuilding',
    record,
    recordId: record.id,
    title: record.title || record.prompt || 'AI 建筑',
    creatorName,
    userLabel: record.userId ?? record.playerId ?? '未知用户',
    referenceImage,
    referenceMaterials: Array.isArray(record.referenceMaterials)
      ? record.referenceMaterials
      : Array.isArray(record.meta?.referenceMaterials)
        ? record.meta.referenceMaterials
        : [],
    hoveredBlock: record.hoveredBlock ?? null,
    customBlock: record.customBlock ?? record.hoveredBlock?.customBlock ?? null,
    mergedPrompt: record.mergedPrompt
      ?? record.prompts?.integrated
      ?? record.meta?.prompts?.integrated
      ?? '',
    matchedFeatures: Array.isArray(record.matchedFeatures)
      ? record.matchedFeatures
      : Array.isArray(record.meta?.matchedFeatures)
        ? record.meta.matchedFeatures
        : [],
    imageSimilarityScore: Number.isFinite(record.imageSimilarityScore)
      ? record.imageSimilarityScore
      : Number.isFinite(record.meta?.imageSimilarityScore)
        ? record.meta.imageSimilarityScore
        : null,
    blockCount: Array.isArray(record.blocks) ? record.blocks.length : 0,
    createdAt: record.createdAt,
    status: record.status ?? 'active',
    canClear: Boolean(record.isCreator),
  };
}

function getMountainStateFromHit(hit) {
  const cell = getTerrainLocalCell(hit);

  if (!cell) {
    return null;
  }

  const { entity, x, y, z } = cell;
  const blockId = entity.chunk.getBlock(x, y, z);
  const title = MOUNTAIN_BLOCK_LABELS[blockId];

  if (!title) {
    return null;
  }

  const surfaceHeight = getSurfaceHeight(entity, x, z);
  const worldColumn = getTerrainWorldColumn(entity, x, z);
  const mountain = getDesignedMountainSummary(worldColumn.x, worldColumn.z, entity.chunk.size);
  const peakHeight = mountain?.peakHeight ?? surfaceHeight;
  const slope = getSlopeScore(entity, x, z, surfaceHeight);
  const heightScore = clamp01(surfaceHeight / 250);
  const dangerIndex = clamp01(heightScore * 0.52 + slope * 0.34 + (MOUNTAIN_BLOCK_RISK[blockId] ?? 0.12));

  return {
    type: 'terrainMountain',
    title,
    host: '山体',
    stage: `最高峰 ${peakHeight} 格`,
    cycle: `当前位置 ${surfaceHeight} 格 · 命中方块 ${y} 格`,
    status: `危险指数 ${Math.round(dangerIndex * 100)}% · ${getDangerLabel(dangerIndex)}`,
    height: surfaceHeight,
    peakHeight,
    blockHeight: y,
    dangerIndex,
    slope,
  };
}

export class EcosystemHoverSystem {
  constructor({ scene, camera, canvas, eventBus, worldManager = null }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.eventBus = eventBus;
    this.worldManager = worldManager;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoveredObject = null;

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);

    this.canvas.addEventListener('pointermove', this.handlePointerMove, { passive: true });
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave, { passive: true });
  }

  handlePointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    this.pointer.x = ((event.clientX - rect.left) / width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const targets = [];
    this.scene.traverse((object) => {
      if (object.userData?.ecosystemInspectable || object.userData?.terrainInspectable) {
        targets.push(object);
      }
    });

    const hit = this.raycaster.intersectObjects(targets, false)[0] ?? null;
    const hoveredObject = hit?.object ?? null;

    if (hoveredObject === this.hoveredObject) {
      this.emitHoverState(hit);
      return;
    }

    this.hoveredObject = hoveredObject;
    this.emitHoverState(hit);
  }

  emitHoverState(hit) {
    const payload = hit
      ? hit.object.userData?.getEcosystemState?.() ?? getMountainStateFromHit(hit)
      : null;
    const buildingPayload = this.getBuildingStateFromHit(hit);

    this.eventBus.emit('ecosystem:hover', payload);
    this.eventBus.emit('building:pointer-hover', buildingPayload);
  }

  getBuildingStateFromHit(hit) {
    if (!hit || !this.worldManager?.getPlayerBuildingRecordAtWorld) {
      return null;
    }

    const cell = getTerrainLocalCell(hit);

    if (!cell) {
      return null;
    }

    const worldBlock = getTerrainWorldBlock(cell.entity, cell.x, cell.y, cell.z);
    return formatBuildingHoverState(this.worldManager.getPlayerBuildingRecordAtWorld(
      worldBlock.x,
      worldBlock.y,
      worldBlock.z,
    ));
  }

  handlePointerLeave() {
    if (!this.hoveredObject) {
      return;
    }

    this.hoveredObject = null;
    this.eventBus.emit('ecosystem:hover', null);
    this.eventBus.emit('building:pointer-hover', null);
  }

  dispose() {
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.eventBus.emit('ecosystem:hover', null);
    this.eventBus.emit('building:pointer-hover', null);
  }
}
