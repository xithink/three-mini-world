import * as THREE from 'three';
import { BLOCK_IDS } from '../chunk.js';

const DEFAULT_FLOW_TEXTURE_URL = '/assets/texturewater16x16.png';
const DEFAULT_MAX_LEVEL = 8;

function createFlowTexture(textureUrl = DEFAULT_FLOW_TEXTURE_URL) {
  const texture = new THREE.TextureLoader().load(textureUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = 8;

  return texture;
}

function createWaterMaterial({ textureUrl = DEFAULT_FLOW_TEXTURE_URL } = {}) {
  const flowTexture = createFlowTexture(textureUrl);

  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: flowTexture,
    emissive: 0x0a5c8f,
    emissiveMap: flowTexture,
    emissiveIntensity: 0.1,
    roughness: 0.035,
    metalness: 0.02,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    reflectivity: 0.75,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCellKey(x, y, z) {
  return `${x},${y},${z}`;
}

export class FlowingWater {
  constructor({
    chunk,
    cells = [],
    height = 0.86,
    maxLevel = DEFAULT_MAX_LEVEL,
    flowSpeed = 1.2,
    waveAmplitude = 0.055,
    blockId = BLOCK_IDS.WATER,
    material = null,
    textureUrl = DEFAULT_FLOW_TEXTURE_URL,
    useWorldSpaceUv = blockId === BLOCK_IDS.WATER,
    uvScale = blockId === BLOCK_IDS.WATER ? 0.38 : 1,
  }) {
    this.chunk = chunk;
    this.cells = cells;
    this.height = height;
    this.maxLevel = maxLevel;
    this.flowSpeed = flowSpeed;
    this.waveAmplitude = waveAmplitude;
    this.blockId = blockId;
    this.useWorldSpaceUv = useWorldSpaceUv;
    this.uvScale = uvScale;

    this.geometry = null;
    this.material = material ?? createWaterMaterial({ textureUrl });
    this.ownsMaterial = material === null;
    this.mesh = null;
    this.placed = false;
    this.placedCellKeys = new Set();
    this.time = 0;
    this.vertexFlowData = [];
    this.highlightSeed = 0;
  }

  placeInChunk() {
    if (this.placed) {
      return;
    }

    for (const key of this.placedCellKeys) {
      const [x, y, z] = key.split(',').map(Number);

      if (this.chunk.getBlock(x, y, z) === this.blockId) {
        this.chunk.setBlock(x, y, z, BLOCK_IDS.AIR);
        this.chunk.setLight(x, y, z, 0);
      }
    }

    this.placedCellKeys.clear();

    for (const cell of this.cells) {
      this.chunk.setBlock(cell.x, cell.y, cell.z, this.blockId);
      this.chunk.setLight(cell.x, cell.y, cell.z, 230);
      this.placedCellKeys.add(getCellKey(cell.x, cell.y, cell.z));
    }

    this.placed = true;
  }

  updateCells(cells) {
    this.cells = cells;
    this.placed = false;
    this.placeInChunk();
    this.rebuildGeometry();
  }

  rebuildGeometry() {
    if (!this.mesh) {
      return;
    }

    this.geometry?.dispose();
    this.vertexFlowData = [];
    this.geometry = this.createGeometry();
    this.mesh.geometry = this.geometry;
  }

  buildMesh() {
    if (this.mesh) {
      return this.mesh;
    }

    this.placeInChunk();
    this.geometry = this.createGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'FlowingWater';
    this.mesh.position.copy(this.chunk.position);
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;

    this.update(0);

    return this.mesh;
  }

  createGeometry() {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const cellMap = new Map(this.cells.map((cell) => [getCellKey(cell.x, cell.y, cell.z), cell]));

    const pushVertex = (x, y, z, normal, uv, canWave = true) => {
      const index = positions.length / 3;
      positions.push(x, y, z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(uv.x, uv.y);
      this.vertexFlowData[index] = {
        baseY: y,
        phase: x * 0.75 + z * 0.42,
        canWave,
        isSurface: normal.y > 0.5,
      };

      return index;
    };

    const pushQuad = (a, b, c, d) => {
      indices.push(a, b, c, a, c, d);
    };

    for (let index = 0; index < this.cells.length; index += 1) {
      const cell = this.cells[index];
      const bounds = this.getCellBounds(cell);
      const u0 = index;
      const u1 = index + 1;
      const normalUp = new THREE.Vector3(0, 1, 0);

      const topA = pushVertex(
        bounds.minX,
        bounds.topY,
        bounds.minZ,
        normalUp,
        this.getTopUv(bounds.minX, bounds.minZ, u0, 0),
      );
      const topB = pushVertex(
        bounds.maxX,
        bounds.topY,
        bounds.minZ,
        normalUp,
        this.getTopUv(bounds.maxX, bounds.minZ, u1, 0),
      );
      const topC = pushVertex(
        bounds.maxX,
        bounds.topY,
        bounds.maxZ,
        normalUp,
        this.getTopUv(bounds.maxX, bounds.maxZ, u1, 1),
      );
      const topD = pushVertex(
        bounds.minX,
        bounds.topY,
        bounds.maxZ,
        normalUp,
        this.getTopUv(bounds.minX, bounds.maxZ, u0, 1),
      );
      pushQuad(topA, topB, topC, topD);

      this.pushOpenSide(positions, normals, uvs, indices, cellMap, cell, bounds, 'north', 0, -1, u0, u1);
      this.pushOpenSide(positions, normals, uvs, indices, cellMap, cell, bounds, 'east', 1, 0, u0, u1);
      this.pushOpenSide(positions, normals, uvs, indices, cellMap, cell, bounds, 'south', 0, 1, u0, u1);
      this.pushOpenSide(positions, normals, uvs, indices, cellMap, cell, bounds, 'west', -1, 0, u0, u1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    return geometry;
  }

  pushOpenSide(positions, normals, uvs, indices, cellMap, cell, bounds, side, offsetX, offsetZ, u0, u1) {
    const neighbor = cellMap.get(getCellKey(cell.x + offsetX, cell.y, cell.z + offsetZ));
    let bottomY = bounds.baseY;

    if (neighbor) {
      const neighborBounds = this.getCellBounds(neighbor);

      if (neighborBounds.topY >= bounds.topY - 0.01) {
        return;
      }

      bottomY = neighborBounds.topY;
    }

    this.pushSide(positions, normals, uvs, indices, { ...bounds, baseY: bottomY }, side, u0, u1);
  }

  pushSide(positions, normals, uvs, indices, bounds, side, u0, u1) {
    const normalBySide = {
      north: new THREE.Vector3(0, 0, -1),
      east: new THREE.Vector3(1, 0, 0),
      south: new THREE.Vector3(0, 0, 1),
      west: new THREE.Vector3(-1, 0, 0),
    };
    const normal = normalBySide[side];
    const pushVertex = (x, y, z, uv, canWave) => {
      const index = positions.length / 3;
      positions.push(x, y, z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(uv.x, uv.y);
      this.vertexFlowData[index] = {
        baseY: y,
        phase: x * 0.75 + z * 0.42,
        canWave,
        isSurface: false,
      };

      return index;
    };

    const sidePoints = {
      north: [
        [bounds.minX, bounds.topY, bounds.minZ, true],
        [bounds.maxX, bounds.topY, bounds.minZ, true],
        [bounds.maxX, bounds.baseY, bounds.minZ, false],
        [bounds.minX, bounds.baseY, bounds.minZ, false],
      ],
      east: [
        [bounds.maxX, bounds.topY, bounds.minZ, true],
        [bounds.maxX, bounds.topY, bounds.maxZ, true],
        [bounds.maxX, bounds.baseY, bounds.maxZ, false],
        [bounds.maxX, bounds.baseY, bounds.minZ, false],
      ],
      south: [
        [bounds.maxX, bounds.topY, bounds.maxZ, true],
        [bounds.minX, bounds.topY, bounds.maxZ, true],
        [bounds.minX, bounds.baseY, bounds.maxZ, false],
        [bounds.maxX, bounds.baseY, bounds.maxZ, false],
      ],
      west: [
        [bounds.minX, bounds.topY, bounds.maxZ, true],
        [bounds.minX, bounds.topY, bounds.minZ, true],
        [bounds.minX, bounds.baseY, bounds.minZ, false],
        [bounds.minX, bounds.baseY, bounds.maxZ, false],
      ],
    };

    const points = sidePoints[side];
    const a = pushVertex(
      points[0][0],
      points[0][1],
      points[0][2],
      this.getSideUv(side, points[0][0], points[0][1], points[0][2], u0, 1),
      points[0][3],
    );
    const b = pushVertex(
      points[1][0],
      points[1][1],
      points[1][2],
      this.getSideUv(side, points[1][0], points[1][1], points[1][2], u1, 1),
      points[1][3],
    );
    const c = pushVertex(
      points[2][0],
      points[2][1],
      points[2][2],
      this.getSideUv(side, points[2][0], points[2][1], points[2][2], u1, 0),
      points[2][3],
    );
    const d = pushVertex(
      points[3][0],
      points[3][1],
      points[3][2],
      this.getSideUv(side, points[3][0], points[3][1], points[3][2], u0, 0),
      points[3][3],
    );
    indices.push(a, b, c, a, c, d);
  }

  getTopUv(x, z, fallbackX, fallbackY) {
    if (!this.useWorldSpaceUv) {
      return new THREE.Vector2(fallbackX, fallbackY);
    }

    return new THREE.Vector2(x * this.uvScale, z * this.uvScale);
  }

  getSideUv(side, x, y, z, fallbackX, fallbackY) {
    if (!this.useWorldSpaceUv) {
      return new THREE.Vector2(fallbackX, fallbackY);
    }

    const horizontal = side === 'east' || side === 'west' ? z : x;

    return new THREE.Vector2(horizontal * this.uvScale, y * this.uvScale);
  }

  getCellBounds(cell) {
    const blockSize = this.chunk.blockSize;
    const centerX = (cell.x - (this.chunk.size.x - 1) / 2) * blockSize;
    const centerZ = (cell.z - (this.chunk.size.z - 1) / 2) * blockSize;
    const baseY = (cell.y - 0.5) * blockSize;
    const levelScale = clamp((cell.level ?? this.maxLevel) / this.maxLevel, 0.08, 1);
    const fluidHeight = cell.falling ? blockSize : this.height * levelScale * blockSize;

    return {
      minX: centerX - blockSize / 2,
      maxX: centerX + blockSize / 2,
      baseY,
      topY: baseY + fluidHeight,
      minZ: centerZ - blockSize / 2,
      maxZ: centerZ + blockSize / 2,
    };
  }

  update(deltaTime = 0) {
    if (!this.mesh) {
      return;
    }

    this.time += deltaTime * this.flowSpeed;
    this.updateTextureFlow();
    this.updateGeometryFlow();
  }

  updateTextureFlow() {
    const texture = this.material.map;

    if (!texture) {
      return;
    }

    texture.offset.x = -this.time * 0.18;
    texture.offset.y = Math.sin(this.time * 0.6) * 0.03;
  }

  updateGeometryFlow() {
    const position = this.geometry.getAttribute('position');

    for (let index = 0; index < position.count; index += 1) {
      const flowData = this.vertexFlowData[index];

      if (!flowData?.canWave) {
        continue;
      }

      const wave =
        Math.sin(this.time * 2.4 + flowData.phase) * this.waveAmplitude +
        Math.sin(this.time * 4.2 + flowData.phase * 1.7) * this.waveAmplitude * 0.35;
      const highlightRipple = flowData.isSurface
        ? Math.max(0, Math.sin(this.time * 3.8 + flowData.phase * 1.25)) * this.waveAmplitude * 0.32
        : 0;

      position.setY(index, flowData.baseY + wave + highlightRipple);
    }

    position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose() {
    if (this.mesh?.parent) {
      this.mesh.parent.remove(this.mesh);
    }

    for (const key of this.placedCellKeys) {
      const [x, y, z] = key.split(',').map(Number);

      if (this.chunk.getBlock(x, y, z) === this.blockId) {
        this.chunk.setBlock(x, y, z, BLOCK_IDS.AIR);
        this.chunk.setLight(x, y, z, 0);
      }
    }

    this.placedCellKeys.clear();

    this.geometry?.dispose();

    if (this.ownsMaterial) {
      this.material.map?.dispose();
      this.material.dispose();
    }

    this.mesh = null;
  }
}
