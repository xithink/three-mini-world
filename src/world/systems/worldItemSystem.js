import * as THREE from 'three';
import { getMaterial } from '../../crafting/craftingData.js';

const PICKUP_RADIUS = 2.1;
const ITEM_SIZE = 0.46;
const ITEM_GRAVITY = 14;
const ITEM_FRICTION = 5.5;

function hashString(input) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function colorForItem(itemId) {
  const hash = hashString(itemId);
  const color = new THREE.Color();

  color.setHSL((hash % 360) / 360, 0.48 + ((hash >>> 8) % 24) / 100, 0.46 + ((hash >>> 16) % 18) / 100);

  return color;
}

function getTextureKind(itemId, category) {
  if (category === '基础元素') {
    return 'element';
  }

  if (category === '图鉴页' || itemId.startsWith('codex_page_')) {
    return 'codex';
  }

  if (category === '建筑材料' || itemId.includes('block') || itemId.includes('stone') || itemId.includes('slab')) {
    return 'block';
  }

  if (category === '工具机械' || category === '工具类' || itemId.includes('tool')) {
    return 'tool';
  }

  return 'item';
}

function drawItemTexturePattern(context, kind, primary, secondary, mark) {
  context.fillStyle = primary;
  context.fillRect(0, 0, 128, 128);

  context.fillStyle = secondary;
  context.strokeStyle = 'rgba(255,255,255,0.34)';
  context.lineWidth = 6;

  if (kind === 'element') {
    context.beginPath();
    context.arc(64, 64, 37, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.ellipse(64, 64, 50, 16, 0.72, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.ellipse(64, 64, 50, 16, -0.72, 0, Math.PI * 2);
    context.stroke();
  } else if (kind === 'codex') {
    context.fillStyle = '#ead9ac';
    context.fillRect(28, 14, 72, 100);
    context.strokeStyle = 'rgba(68,45,26,0.55)';
    context.strokeRect(28, 14, 72, 100);
    context.beginPath();
    [38, 52, 66, 80].forEach((y, index) => {
      context.moveTo(40, y);
      context.lineTo(index === 3 ? 76 : 88, y);
    });
    context.stroke();
  } else if (kind === 'block') {
    context.beginPath();
    context.moveTo(22, 42);
    context.lineTo(64, 20);
    context.lineTo(106, 42);
    context.lineTo(106, 86);
    context.lineTo(64, 108);
    context.lineTo(22, 86);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(22, 42);
    context.lineTo(64, 64);
    context.lineTo(106, 42);
    context.moveTo(64, 64);
    context.lineTo(64, 108);
    context.stroke();
  } else if (kind === 'tool') {
    context.beginPath();
    for (let i = 0; i < 12; i += 1) {
      const radius = i % 2 === 0 ? 43 : 31;
      const angle = -Math.PI / 2 + i * Math.PI / 6;
      const x = 64 + Math.cos(angle) * radius;
      const y = 64 + Math.sin(angle) * radius;
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = 'rgba(255,255,255,0.72)';
    context.beginPath();
    context.arc(64, 64, 13, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(18, 96);
    context.lineTo(42, 30);
    context.lineTo(70, 74);
    context.lineTo(92, 36);
    context.lineTo(110, 96);
    context.closePath();
    context.fill();
  }

  context.fillStyle = 'rgba(255,255,255,0.92)';
  context.font = '700 28px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(mark, 64, 68);
}

function createItemTexture(itemId) {
  const material = getMaterial(itemId);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const baseColor = colorForItem(itemId);
  const secondaryColor = colorForItem(`${itemId}:secondary`);
  const mark = material.name.slice(0, 2).toUpperCase();

  canvas.width = 128;
  canvas.height = 128;
  drawItemTexturePattern(
    context,
    getTextureKind(itemId, material.category),
    `#${baseColor.getHexString()}`,
    `#${secondaryColor.getHexString()}`,
    mark,
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  return texture;
}

function createItemMesh(itemId) {
  const geometry = new THREE.BoxGeometry(ITEM_SIZE, ITEM_SIZE, ITEM_SIZE);
  const texture = createItemTexture(itemId);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    roughness: 0.62,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.itemId = itemId;

  return mesh;
}

export class WorldItemSystem {
  constructor({ scene, worldManager, player }) {
    this.scene = scene;
    this.worldManager = worldManager;
    this.player = player;
    this.items = new Map();
    this.nextItemId = 1;
    this.tempVector = new THREE.Vector3();

    this.scatterInitialItems();
  }

  scatterInitialItems() {
    const seeds = [
      'flint_tool', 'tnt_block', 'gunpowder', 'gunpowder', 'sand', 'sand', 'S', 'niter',
      'stone', 'stone_slab', 'steel_ingot', 'steel_plate', 'steel_beam', 'wood', 'resin',
      'Fe', 'C', 'Cu', 'Al', 'Si', 'forklift', 'excavator',
      'codex_page_tnt', 'codex_page_tools', 'codex_page_building', 'codex_page_elements',
    ];

    seeds.forEach((itemId, index) => {
      const angle = index * 1.73;
      const isCodexPage = itemId.startsWith('codex_page_');
      const radius = isCodexPage ? 18 + (index % 4) * 5.5 : 4.5 + (index % 5) * 2.1;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = (this.worldManager.getSurfaceHeightAt(x, z) ?? 4) + 1.1;

      this.dropItem(itemId, 1 + (index % 3 === 0 ? 2 : 0), new THREE.Vector3(x, y, z), {
        settled: true,
      });
    });
  }

  dropItem(itemId, count, position, { velocity = null, settled = false } = {}) {
    const id = this.nextItemId;
    this.nextItemId += 1;

    const mesh = createItemMesh(itemId);
    mesh.position.copy(position);
    mesh.rotation.set(0.35, id * 0.7, 0.18);
    this.scene.add(mesh);

    const item = {
      id,
      itemId,
      count,
      mesh,
      velocity: velocity?.clone?.() ?? new THREE.Vector3(),
      settled,
      age: 0,
    };

    this.items.set(id, item);

    return item;
  }

  pickupNearest(playerPosition) {
    const nearest = this.findNearest(playerPosition);

    if (!nearest) {
      return null;
    }

    this.removeItem(nearest.id);

    return {
      itemId: nearest.itemId,
      count: nearest.count,
    };
  }

  findNearest(playerPosition, radius = PICKUP_RADIUS) {
    let nearest = null;
    let nearestDistance = radius;

    for (const item of this.items.values()) {
      const distance = item.mesh.position.distanceTo(playerPosition);

      if (distance < nearestDistance) {
        nearest = item;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  getItemsNear(position, radius) {
    const found = [];

    for (const item of this.items.values()) {
      if (item.mesh.position.distanceTo(position) <= radius) {
        found.push(item);
      }
    }

    return found;
  }

  consumeItemsNear(position, radius, ingredients) {
    const nearby = this.getItemsNear(position, radius);
    const remaining = ingredients.map((ingredient) => ({ ...ingredient }));

    for (const ingredient of remaining) {
      let needed = ingredient.count;

      for (const item of nearby) {
        if (item.itemId !== ingredient.itemId || needed <= 0) {
          continue;
        }

        needed -= item.count;
      }

      if (needed > 0) {
        return false;
      }
    }

    for (const ingredient of ingredients) {
      let needed = ingredient.count;

      for (const item of nearby) {
        if (item.itemId !== ingredient.itemId || needed <= 0) {
          continue;
        }

        const consumed = Math.min(needed, item.count);
        item.count -= consumed;
        needed -= consumed;

        if (item.count <= 0) {
          this.removeItem(item.id);
        }
      }
    }

    return true;
  }

  removeItem(id) {
    const item = this.items.get(id);

    if (!item) {
      return;
    }

    this.scene.remove(item.mesh);
    item.mesh.geometry.dispose();
    item.mesh.material.map?.dispose();
    item.mesh.material.dispose();
    this.items.delete(id);
  }

  update(deltaTime) {
    for (const item of this.items.values()) {
      item.age += deltaTime;
      item.mesh.rotation.y += deltaTime * 1.4;

      if (item.settled) {
        item.mesh.position.y += Math.sin(item.age * 3.1 + item.id) * 0.0018;
        continue;
      }

      item.velocity.y -= ITEM_GRAVITY * deltaTime;
      item.mesh.position.addScaledVector(item.velocity, deltaTime);

      const groundY = (this.worldManager.getSurfaceHeightAt(item.mesh.position.x, item.mesh.position.z) ?? 0) + 0.72;

      if (item.mesh.position.y <= groundY) {
        item.mesh.position.y = groundY;
        item.velocity.y = 0;
        item.velocity.x *= Math.exp(-ITEM_FRICTION * deltaTime);
        item.velocity.z *= Math.exp(-ITEM_FRICTION * deltaTime);

        if (Math.hypot(item.velocity.x, item.velocity.z) < 0.08) {
          item.velocity.set(0, 0, 0);
          item.settled = true;
        }
      }
    }
  }

  dispose() {
    [...this.items.keys()].forEach((id) => this.removeItem(id));
  }
}
