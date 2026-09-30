import * as THREE from 'three';
import { BLOCK_IDS } from '../chunk.js';
import { getMaterial } from '../../crafting/craftingData.js';

const TARGET_RANGE = 8;
const RAY_STEP = 0.22;
const CRAFTING_RADIUS = 3.2;
const ITEM_TARGET_RANGE = 6;

const BLOCK_LABELS = Object.freeze({
  [BLOCK_IDS.GRASS]: '草地',
  [BLOCK_IDS.STONE]: '石头',
  [BLOCK_IDS.SAND]: '沙子',
  [BLOCK_IDS.DIRT]: '泥土',
  [BLOCK_IDS.WOOD]: '木材',
  [BLOCK_IDS.LEAVES]: '树叶',
  [BLOCK_IDS.SNOW]: '雪块',
  [BLOCK_IDS.DRY_GRASS]: '枯草地',
  [BLOCK_IDS.ICE]: '冰块',
  [BLOCK_IDS.CAVE_STONE]: '洞穴石',
  [BLOCK_IDS.ROCK_MOUNTAIN]: '岩山',
  [BLOCK_IDS.SNOW_MOUNTAIN]: '雪山',
  [BLOCK_IDS.FOREST_MOUNTAIN]: '森林山',
  [BLOCK_IDS.BIRCH_WOOD]: '白桦木',
  [BLOCK_IDS.CACTUS]: '仙人掌',
  [BLOCK_IDS.TNT]: 'TNT',
  [BLOCK_IDS.CRAFTING_TABLE]: '工具台',
  [BLOCK_IDS.STONE_SLAB]: '石板',
  [BLOCK_IDS.STEEL_BLOCK]: '钢材',
  [BLOCK_IDS.BRICK]: '砖块',
  [BLOCK_IDS.GLASS]: '玻璃',
  [BLOCK_IDS.CONCRETE]: '混凝土',
  [BLOCK_IDS.WOOD_PLANKS]: '木板',
  [BLOCK_IDS.ROOF_TILES]: '屋顶瓦片',
  [BLOCK_IDS.COBBLESTONE]: '鹅卵石',
  [BLOCK_IDS.SANDSTONE]: '砂岩',
  [BLOCK_IDS.QUARTZ]: '石英',
  [BLOCK_IDS.LAMP]: '灯具',
  [BLOCK_IDS.METAL_PANEL]: '金属板',
  [BLOCK_IDS.SNOW_LOTUS]: '雪莲方块',
  [BLOCK_IDS.WATER_FLOW_DECOR]: '水流装饰',
});

const BLOCK_ITEM_IDS = Object.freeze({
  [BLOCK_IDS.GRASS]: 'grass_block',
  [BLOCK_IDS.STONE]: 'stone',
  [BLOCK_IDS.SAND]: 'sand',
  [BLOCK_IDS.DIRT]: 'dirt_block',
  [BLOCK_IDS.WOOD]: 'wood',
  [BLOCK_IDS.LEAVES]: 'leaves',
  [BLOCK_IDS.SNOW]: 'snow_block',
  [BLOCK_IDS.DRY_GRASS]: 'dry_grass_block',
  [BLOCK_IDS.ICE]: 'ice',
  [BLOCK_IDS.CAVE_STONE]: 'cave_stone',
  [BLOCK_IDS.ROCK_MOUNTAIN]: 'rock_mountain_stone',
  [BLOCK_IDS.SNOW_MOUNTAIN]: 'snow_mountain_block',
  [BLOCK_IDS.FOREST_MOUNTAIN]: 'forest_mountain_block',
  [BLOCK_IDS.BIRCH_WOOD]: 'birch_wood',
  [BLOCK_IDS.CACTUS]: 'cactus',
  [BLOCK_IDS.TNT]: 'tnt_block',
  [BLOCK_IDS.CRAFTING_TABLE]: 'workbench',
  [BLOCK_IDS.STONE_SLAB]: 'stone_slab',
  [BLOCK_IDS.STEEL_BLOCK]: 'steel_beam',
});

function toBlockCoord(position) {
  return {
    x: Math.floor(position.x + 0.5),
    y: Math.floor(position.y + 0.5),
    z: Math.floor(position.z + 0.5),
  };
}

function keyOf(coord) {
  return `${coord.x},${coord.y},${coord.z}`;
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

function getAxisNormal(vector) {
  const absX = Math.abs(vector.x);
  const absY = Math.abs(vector.y);
  const absZ = Math.abs(vector.z);

  if (absX >= absY && absX >= absZ && absX > 0) {
    return new THREE.Vector3(Math.sign(vector.x), 0, 0);
  }

  if (absY >= absX && absY >= absZ && absY > 0) {
    return new THREE.Vector3(0, Math.sign(vector.y), 0);
  }

  if (absZ > 0) {
    return new THREE.Vector3(0, 0, Math.sign(vector.z));
  }

  return new THREE.Vector3(0, 1, 0);
}

function createCraftingMarker(label, color) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.25, 0.035, 8, 64),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.48,
      roughness: 0.35,
      metalness: 0.1,
    }),
  );
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 1.4, 8),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.32,
      transparent: true,
      opacity: 0.72,
    }),
  );

  ring.rotation.x = Math.PI / 2;
  pillar.position.y = 0.72;
  group.add(ring, pillar);
  group.userData.label = label;

  return group;
}

export class InteractionSystem {
  constructor({
    container,
    scene,
    camera,
    eventBus,
    worldManager,
    player,
    inventorySystem,
    worldItemSystem,
  }) {
    this.container = container;
    this.scene = scene;
    this.camera = camera;
    this.eventBus = eventBus;
    this.worldManager = worldManager;
    this.player = player;
    this.inventorySystem = inventorySystem;
    this.worldItemSystem = worldItemSystem;
    this.target = null;
    this.effects = [];
    this.craftingPoints = [];
    this.crosshair = this.createCrosshair();
    this.status = this.createStatus();
    this.direction = new THREE.Vector3();
    this.sample = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.previousCoord = null;

    this.container.append(this.crosshair, this.status);
    this.createWorldStations();

    this.unsubscribe = [
      eventBus.on('interaction:pickup', () => this.pickupTarget()),
      eventBus.on('interaction:use-flint', () => this.useFlint()),
      eventBus.on('interaction:place-block', () => this.placeSelectedBlock()),
      eventBus.on('crafting:request-nearest-point', () => {
        eventBus.emit('crafting:nearest-point', this.getNearestCraftingPoint());
      }),
    ];
  }

  createCrosshair() {
    const element = document.createElement('div');
    element.className = 'world-crosshair';
    element.setAttribute('aria-hidden', 'true');

    return element;
  }

  createStatus() {
    const element = document.createElement('div');
    element.className = 'interaction-status';
    element.classList.add('is-empty');

    return element;
  }

  createWorldStations() {
    const configs = [
      { x: 1, z: 1, label: '工具台', color: 0xffd36a, blockId: BLOCK_IDS.CRAFTING_TABLE, station: '工具台' },
      { x: 9, z: -1, label: '爆破合成点', color: 0xff5b4d, blockId: BLOCK_IDS.TNT, station: '爆破合成点' },
      { x: -7, z: 7, label: '建材合成点', color: 0x8fd6c5, blockId: BLOCK_IDS.STONE_SLAB, station: '建材合成点' },
      { x: -10, z: -7, label: '机械合成点', color: 0x96b8ff, blockId: BLOCK_IDS.STEEL_BLOCK, station: '机械合成点' },
    ];

    configs.forEach((config) => {
      const y = (this.worldManager.getSurfaceHeightAt(config.x, config.z) ?? 4) + 1;

      this.worldManager.setBlockAt(config.x, y, config.z, config.blockId);

      const marker = createCraftingMarker(config.label, config.color);
      marker.position.set(config.x, y + 0.06, config.z);
      this.scene.add(marker);
      this.craftingPoints.push({
        ...config,
        position: new THREE.Vector3(config.x, y, config.z),
        marker,
      });
    });
  }

  findTarget() {
    this.camera.getWorldDirection(this.direction).normalize();
    this.previousCoord = null;
    const visited = new Set();

    for (let distance = RAY_STEP; distance <= TARGET_RANGE; distance += RAY_STEP) {
      this.sample.copy(this.camera.position).addScaledVector(this.direction, distance);
      const coord = toBlockCoord(this.sample);
      const key = keyOf(coord);

      if (visited.has(key)) {
        continue;
      }

      visited.add(key);
      const blockId = this.worldManager.getBlockAt(coord.x, coord.y, coord.z);

      if (blockId !== BLOCK_IDS.AIR && blockId !== BLOCK_IDS.WATER && blockId !== BLOCK_IDS.LAVA) {
        const hitPosition = this.sample.clone();
        const normal = this.previousCoord
          ? getAxisNormal(new THREE.Vector3(
              this.previousCoord.x - coord.x,
              this.previousCoord.y - coord.y,
              this.previousCoord.z - coord.z,
            ))
          : this.getFallbackFaceNormal(this.direction);

        return {
          type: 'block',
          blockId,
          coord,
          normal,
          previousCoord: this.previousCoord,
          hitPosition,
          distance,
          label: BLOCK_LABELS[blockId] ?? `方块 ${blockId}`,
        };
      }

      this.previousCoord = coord;
    }

    return null;
  }

  getFallbackFaceNormal(direction) {
    const absX = Math.abs(direction.x);
    const absY = Math.abs(direction.y);
    const absZ = Math.abs(direction.z);

    if (absX >= absY && absX >= absZ) {
      return new THREE.Vector3(-Math.sign(direction.x) || 1, 0, 0);
    }

    if (absY >= absX && absY >= absZ) {
      return new THREE.Vector3(0, -Math.sign(direction.y) || 1, 0);
    }

    return new THREE.Vector3(0, 0, -Math.sign(direction.z) || 1);
  }

  findItemTarget() {
    this.camera.getWorldDirection(this.direction).normalize();
    this.raycaster.set(this.camera.position, this.direction);
    this.raycaster.far = ITEM_TARGET_RANGE;
    const candidates = Array.from(this.worldItemSystem.items.values()).map((item) => item.mesh);
    const [hit] = this.raycaster.intersectObjects(candidates, false);

    if (!hit) {
      return null;
    }

    const item = Array.from(this.worldItemSystem.items.values()).find((candidate) => candidate.mesh === hit.object);

    if (!item) {
      return null;
    }

    const material = getMaterial(item.itemId);

    return {
      type: 'item',
      item,
      distance: hit.distance,
      label: material.name,
      description: material.description,
    };
  }

  getBestTarget() {
    const itemTarget = this.findItemTarget();
    const blockTarget = this.findTarget();

    if (itemTarget && (!blockTarget || itemTarget.distance <= blockTarget.distance)) {
      return itemTarget;
    }

    return blockTarget;
  }

  pickupTarget() {
    const target = this.getBestTarget();

    if (!target) {
      this.setStatus('');
      return;
    }

    if (target.type === 'item') {
      const { item } = target;

      if (!this.inventorySystem.holdItem(item.itemId, item.count)) {
        return;
      }

      this.worldItemSystem.removeItem(item.id);
      this.setStatus(`拾取 ${getMaterial(item.itemId).name} x${item.count}`);
      return;
    }

    const itemId = BLOCK_ITEM_IDS[target.blockId];

    if (!itemId) {
      this.setStatus(`${target.label} 不可拾取`);
      return;
    }

    const result = this.worldManager.destroyBlockAt(target.coord.x, target.coord.y, target.coord.z);

    if (!result.changed) {
      this.setStatus(`${target.label} 不可拾取`);
      return;
    }

    this.inventorySystem.holdItem(itemId, 1);
    this.setStatus(`拾取 ${target.label}`);
  }

  useFlint() {
    if (this.inventorySystem.getSelectedItemId() !== 'flint_tool') {
      this.setStatus('需要选中打火石');
      return;
    }

    const target = this.findTarget();

    if (!target) {
      this.setStatus('准星未指向可作用目标');
      return;
    }

    if (target.blockId === BLOCK_IDS.TNT) {
      this.worldManager.setBlockAt(target.coord.x, target.coord.y, target.coord.z, BLOCK_IDS.AIR);
      this.eventBus.emit('tnt:explode', {
        center: { x: target.coord.x, y: target.coord.y, z: target.coord.z },
        radius: 3.2,
        damageWorld: true,
      });
      this.createExplosionEffect(new THREE.Vector3(target.coord.x, target.coord.y, target.coord.z));
      this.setStatus('TNT 已引爆');
      return;
    }

    const result = this.worldManager.destroyBlockAt(target.coord.x, target.coord.y, target.coord.z);

    this.setStatus(result.changed ? `已破坏 ${target.label}` : '目标无法破坏');
  }

  placeSelectedBlock() {
    const blockId = this.inventorySystem.getSelectedPlaceBlockId();
    const itemId = this.inventorySystem.getSelectedItemId();

    if (!blockId || !itemId) {
      this.setStatus('当前物品不可放置');
      return;
    }

    const target = this.findTarget();
    let placeCoord = target?.normal
      ? {
        x: target.coord.x + target.normal.x,
        y: target.coord.y + target.normal.y,
        z: target.coord.z + target.normal.z,
      }
      : null;

    if (!placeCoord) {
      const forward = this.player.characterFacingDirection.clone().normalize();
      const x = Math.floor(this.player.position.x + forward.x * 2 + 0.5);
      const z = Math.floor(this.player.position.z + forward.z * 2 + 0.5);
      const y = (this.worldManager.getSurfaceHeightAt(x, z) ?? Math.floor(this.player.position.y)) + 1;
      placeCoord = { x, y, z };
    }

    const currentBlock = this.worldManager.getBlockAt(placeCoord.x, placeCoord.y, placeCoord.z);

    if (currentBlock !== BLOCK_IDS.AIR && currentBlock !== BLOCK_IDS.WATER) {
      this.setStatus('放置位置被占用');
      return;
    }

    this.worldManager.setBlockAt(placeCoord.x, placeCoord.y, placeCoord.z, blockId);
    this.inventorySystem.removeSelected(1);
    this.setStatus(`已放置 ${getMaterial(itemId).name}`);
  }

  createExplosionEffect(position) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 18, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffc15a,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
      }),
    );

    mesh.position.copy(position);
    this.scene.add(mesh);
    this.effects.push({ mesh, age: 0, duration: 0.62 });
  }

  getNearestCraftingPoint(radius = CRAFTING_RADIUS) {
    let nearest = null;
    let nearestDistance = radius;

    this.craftingPoints.forEach((point) => {
      const distance = point.position.distanceTo(this.player.position);

      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    });

    return nearest ? {
      label: nearest.label,
      station: nearest.station,
      position: nearest.position,
      radius,
    } : null;
  }

  setStatus(message) {
    this.status.textContent = message;
    this.status.classList.toggle('is-empty', !message);
  }

  update(deltaTime) {
    this.target = this.getBestTarget();
    const buildingHoverState = this.target?.type === 'block'
      ? formatBuildingHoverState(this.worldManager.getPlayerBuildingRecordAtWorld(
        this.target.coord.x,
        this.target.coord.y,
        this.target.coord.z,
      ))
      : null;

    this.eventBus.emit('building:hover', buildingHoverState);
    this.crosshair.classList.toggle('has-target', Boolean(this.target));
    if (this.target?.type === 'item') {
      this.setStatus(`物品：${this.target.label} · ${this.target.description}`);
    } else if (this.target?.type === 'block') {
      const itemId = BLOCK_ITEM_IDS[this.target.blockId];
      const material = itemId ? getMaterial(itemId) : null;
      this.setStatus(`方块：${this.target.label}${material ? ` · ${material.description}` : ''}`);
    } else {
      this.setStatus('');
    }

    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      effect.age += deltaTime;
      const progress = effect.age / effect.duration;

      effect.mesh.scale.setScalar(1 + progress * 4);
      effect.mesh.material.opacity = Math.max(0, 0.78 * (1 - progress));

      if (progress >= 1) {
        this.scene.remove(effect.mesh);
        effect.mesh.geometry.dispose();
        effect.mesh.material.dispose();
        this.effects.splice(index, 1);
      }
    }
  }

  dispose() {
    this.eventBus.emit('building:hover', null);
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.craftingPoints.forEach((point) => {
      this.scene.remove(point.marker);
      point.marker.traverse((child) => {
        if (child.geometry) {
          child.geometry.dispose();
        }

        if (child.material) {
          child.material.dispose();
        }
      });
    });
    this.effects.forEach(({ mesh }) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    this.crosshair.remove();
    this.status.remove();
  }
}
