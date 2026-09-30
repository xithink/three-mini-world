import { BLOCK_IDS } from '../chunk.js';

const TREE_TYPES = Object.freeze({
  OAK: 'oak',
  BIRCH: 'birch',
  CACTUS: 'cactus',
});

const L_SYSTEMS = Object.freeze({
  [TREE_TYPES.OAK]: {
    axiom: 'FF[+FL][-FL]L',
    iterations: 2,
    angle: 0.52,
    step: 0.52,
    radius: 1.05,
    leafRadius: 1.42,
    minPitch: 0.34,
    maxPitch: 1.45,
    productions: {
      F: [
        'F[&+FL]F',
        'F[&-FL]F',
        'F[/FL]F',
      ],
    },
  },
  [TREE_TYPES.BIRCH]: {
    axiom: 'FFFFL',
    iterations: 2,
    angle: 0.36,
    step: 1.08,
    radius: 0.48,
    leafRadius: 1.18,
    minPitch: 0.48,
    maxPitch: 1.54,
    productions: {
      F: [
        'FF',
        'F[&+L]F',
        'F[&-L]F',
      ],
    },
  },
});

function hashInt(value) {
  let hash = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return hash >>> 0;
}

function createRandom(seed) {
  let state = hashInt(seed || 1);

  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);

    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseRandom(options, random) {
  return options[Math.floor(random() * options.length) % options.length];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function expandLSystem(config, random) {
  let current = config.axiom;

  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    let next = '';

    for (const symbol of current) {
      const production = config.productions[symbol];

      if (Array.isArray(production)) {
        next += chooseRandom(production, random);
      } else {
        next += production ?? symbol;
      }
    }

    current = next;
  }

  return current;
}

function addBlock(blockMap, x, y, z, blockId) {
  const blockX = Math.round(x);
  const blockY = Math.round(y);
  const blockZ = Math.round(z);
  const key = `${blockX},${blockY},${blockZ}`;
  const existing = blockMap.get(key);

  if (existing && blockId === BLOCK_IDS.LEAVES && existing.blockId !== BLOCK_IDS.LEAVES) {
    return;
  }

  blockMap.set(key, {
    x: blockX,
    y: blockY,
    z: blockZ,
    blockId,
  });
}

function addLeafCluster(blockMap, centerX, centerY, centerZ, radius, random) {
  const roundedRadius = Math.ceil(radius);

  for (let y = -roundedRadius; y <= roundedRadius; y += 1) {
    for (let z = -roundedRadius; z <= roundedRadius; z += 1) {
      for (let x = -roundedRadius; x <= roundedRadius; x += 1) {
        const distance = Math.hypot(x * 0.9, y * 1.05, z * 0.9);
        const edgeNoise = random() * 0.45;

        if (distance > radius + edgeNoise) {
          continue;
        }

        addBlock(blockMap, centerX + x, centerY + y, centerZ + z, BLOCK_IDS.LEAVES);
      }
    }
  }
}

function addWoodPoint(blockMap, x, y, z, radius, blockId) {
  const roundedRadius = Math.max(0, Math.floor(radius));

  if (roundedRadius <= 0) {
    addBlock(blockMap, x, y, z, blockId);
    return;
  }

  for (let offsetZ = -roundedRadius; offsetZ <= roundedRadius; offsetZ += 1) {
    for (let offsetX = -roundedRadius; offsetX <= roundedRadius; offsetX += 1) {
      if (Math.hypot(offsetX, offsetZ) > radius + 0.2) {
        continue;
      }

      addBlock(blockMap, x + offsetX, y, z + offsetZ, blockId);
    }
  }
}

function addSegment(blockMap, from, to, radius, blockId) {
  const distance = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) * 2));

  for (let index = 0; index <= distance; index += 1) {
    const t = index / distance;

    addWoodPoint(
      blockMap,
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
      from.z + (to.z - from.z) * t,
      radius,
      blockId,
    );
  }
}

function prunePlantBlocks(blockMap, baseX, baseY, baseZ, maxHeight, leafMinY = baseY, woodReach = Infinity) {
  const topY = baseY + maxHeight - 1;

  for (const [key, block] of blockMap.entries()) {
    const horizontalReach = Math.hypot(block.x - baseX, block.z - baseZ);

    if (
      block.y < baseY ||
      block.y > topY ||
      (block.blockId === BLOCK_IDS.LEAVES && block.y < leafMinY) ||
      (block.blockId !== BLOCK_IDS.LEAVES && horizontalReach > woodReach)
    ) {
      blockMap.delete(key);
    }
  }
}

function addBirchTopBranches(blockMap, x, y, z, targetHeight, random, woodBlockId) {
  const branchCount = random() > 0.55 ? 2 : 1;
  const usedDirections = new Set();

  for (let index = 0; index < branchCount; index += 1) {
    let directionIndex = Math.floor(random() * 4);

    while (usedDirections.has(directionIndex)) {
      directionIndex = (directionIndex + 1) % 4;
    }

    usedDirections.add(directionIndex);

    const direction = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ][directionIndex];
    const branchY = y + targetHeight - 4 + Math.floor(random() * 2);
    const tip = {
      x: x + direction.x,
      y: branchY + 1,
      z: z + direction.z,
    };

    addSegment(blockMap, { x, y: branchY, z }, tip, 0, woodBlockId);
    addLeafCluster(blockMap, tip.x, tip.y, tip.z, 0.9 + random() * 0.24, random);
  }
}

function getForwardVector(yaw, pitch) {
  const horizontal = Math.cos(pitch);

  return {
    x: Math.sin(yaw) * horizontal,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * horizontal,
  };
}

function buildLSystemTree({
  x,
  y,
  z,
  type,
  seed,
}) {
  const config = L_SYSTEMS[type];
  const random = createRandom(seed);
  const targetHeight = type === TREE_TYPES.OAK
    ? 5 + Math.floor(random() * 2)
    : 7 + Math.floor(random() * 4);
  const program = expandLSystem(config, random);
  const blockMap = new Map();
  const woodBlockId = type === TREE_TYPES.BIRCH ? BLOCK_IDS.BIRCH_WOOD : BLOCK_IDS.WOOD;
  const stack = [];
  const state = {
    x,
    y,
    z,
    yaw: random() * Math.PI * 2,
    pitch: Math.PI / 2,
    step: config.step * (0.9 + random() * 0.22),
    radius: config.radius,
  };

  if (type === TREE_TYPES.OAK) {
    addWoodPoint(blockMap, x, y, z, 1.35, woodBlockId);
    addWoodPoint(blockMap, x, y + 1, z, 1.05, woodBlockId);
    addWoodPoint(blockMap, x, y + 2, z, 0.75, woodBlockId);
  } else {
    for (let offsetY = 0; offsetY < targetHeight - 1; offsetY += 1) {
      addBlock(blockMap, x, y + offsetY, z, woodBlockId);
    }
    addBirchTopBranches(blockMap, x, y, z, targetHeight, random, woodBlockId);
  }

  for (const symbol of type === TREE_TYPES.BIRCH ? '' : program) {
    if (symbol === 'F') {
      const bendYaw = (random() - 0.5) * (type === TREE_TYPES.OAK ? 0.18 : 0.06);
      const bendPitch = (random() - 0.5) * (type === TREE_TYPES.OAK ? 0.12 : 0.04);
      const forward = getForwardVector(
        state.yaw + bendYaw,
        clamp(state.pitch + bendPitch, config.minPitch, config.maxPitch),
      );
      const next = {
        x: state.x + forward.x * state.step,
        y: state.y + forward.y * state.step,
        z: state.z + forward.z * state.step,
      };

      addSegment(blockMap, state, next, state.radius, woodBlockId);
      state.x = next.x;
      state.y = next.y;
      state.z = next.z;
      state.radius *= type === TREE_TYPES.OAK ? 0.92 : 0.96;
      state.step *= type === TREE_TYPES.OAK ? 0.985 : 1.01;
      continue;
    }

    if (symbol === 'L') {
      addLeafCluster(blockMap, state.x, state.y, state.z, config.leafRadius * (0.9 + random() * 0.24), random);
      continue;
    }

    if (symbol === '+') {
      state.yaw += config.angle * (0.75 + random() * 0.5);
      continue;
    }

    if (symbol === '-') {
      state.yaw -= config.angle * (0.75 + random() * 0.5);
      continue;
    }

    if (symbol === '&') {
      state.pitch = clamp(state.pitch - config.angle * (0.55 + random() * 0.35), config.minPitch, config.maxPitch);
      continue;
    }

    if (symbol === '^') {
      state.pitch = clamp(state.pitch + config.angle * (0.45 + random() * 0.3), config.minPitch, config.maxPitch);
      continue;
    }

    if (symbol === '/') {
      state.yaw += (random() - 0.5) * Math.PI * 0.85;
      continue;
    }

    if (symbol === '!') {
      state.radius *= 0.72;
      state.step *= 0.94;
      continue;
    }

    if (symbol === '[') {
      stack.push({ ...state });
      state.pitch = clamp(state.pitch - config.angle * (0.55 + random() * 0.35), config.minPitch, config.maxPitch);
      state.yaw += (random() - 0.5) * config.angle;
      state.radius *= type === TREE_TYPES.OAK ? 0.68 : 0.55;
      continue;
    }

    if (symbol === ']') {
      const restored = stack.pop();

      if (restored) {
        Object.assign(state, restored);
      }
    }
  }

  const crownY = y + targetHeight - 2;

  if (type === TREE_TYPES.OAK) {
    addLeafCluster(blockMap, x, crownY, z, config.leafRadius * (0.92 + random() * 0.18), random);
  } else {
    addLeafCluster(blockMap, x, crownY, z, config.leafRadius * (0.9 + random() * 0.22), random);
  }

  prunePlantBlocks(
    blockMap,
    x,
    y,
    z,
    targetHeight,
    type === TREE_TYPES.OAK ? y + 2 : y + targetHeight - 3,
    type === TREE_TYPES.OAK ? 2 : 1.42,
  );

  return [...blockMap.values()];
}

function buildCactus({
  x,
  y,
  z,
  seed,
}) {
  const random = createRandom(seed);
  const blockMap = new Map();
  const height = 1 + Math.floor(random() * 2);
  const hasSideArm = height === 2 && random() > 0.78;

  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    addBlock(blockMap, x, y + offsetY, z, BLOCK_IDS.CACTUS);
  }

  if (hasSideArm) {
    const armY = y + height - 1;
    const directionIndex = Math.floor(random() * 4);
    const direction = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ][directionIndex];

    addBlock(blockMap, x + direction.x, armY, z + direction.z, BLOCK_IDS.CACTUS);
  }

  return [...blockMap.values()];
}

export class TreeObject {
  constructor({
    x,
    y,
    z,
    type = TREE_TYPES.OAK,
    seed = 1,
    trunkHeight = 5,
    canopyRadius = 2,
  }) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.type = type;
    this.seed = seed;
    this.trunkHeight = trunkHeight;
    this.canopyRadius = canopyRadius;
  }

  place(chunk) {
    const blocks = this.getBlocks();

    for (const block of blocks) {
      chunk.setBlock(block.x, block.y, block.z, block.blockId);
      chunk.setLight(block.x, block.y, block.z, Math.max(90, 190 - block.y * 4));
    }

    return blocks;
  }

  getBlocks() {
    if (this.type === TREE_TYPES.CACTUS) {
      return buildCactus(this);
    }

    return buildLSystemTree(this);
  }
}

export { TREE_TYPES };
