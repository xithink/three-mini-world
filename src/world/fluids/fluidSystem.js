import { BLOCK_IDS } from '../chunk.js';
import { getColumnIndex } from '../terrain/chunkTerrain.js';

export const FLUID_TYPES = Object.freeze({
  WATER: 'water',
  LAVA: 'lava',
});

export const FLUID_LEVELS = Object.freeze({
  EMPTY: 0,
  MAX: 8,
});

const TYPE_TO_BLOCK_ID = Object.freeze({
  [FLUID_TYPES.WATER]: BLOCK_IDS.WATER,
  [FLUID_TYPES.LAVA]: BLOCK_IDS.LAVA,
});

const FLOW_PARAMS = Object.freeze({
  [FLUID_TYPES.WATER]: {
    spreadLoss: 1,
    downLoss: 0,
    dryLoss: 1,
    maxDistance: 7,
    updateEvery: 1,
  },
  [FLUID_TYPES.LAVA]: {
    spreadLoss: 2,
    downLoss: 1,
    dryLoss: 1,
    maxDistance: 4,
    updateEvery: 4,
  },
});

const HORIZONTAL_DIRECTIONS = Object.freeze([
  { x: 1, y: 0, z: 0, velocityHint: 'x+' },
  { x: -1, y: 0, z: 0, velocityHint: 'x-' },
  { x: 0, y: 0, z: 1, velocityHint: 'z+' },
  { x: 0, y: 0, z: -1, velocityHint: 'z-' },
]);

function getCellKey(x, y, z) {
  return `${x},${y},${z}`;
}

function parseCellKey(key) {
  const [x, y, z] = key.split(',').map(Number);

  return { x, y, z };
}

function isFluidBlock(blockId) {
  return blockId === BLOCK_IDS.WATER || blockId === BLOCK_IDS.LAVA;
}

function cloneFluidState(state) {
  return { ...state };
}

export class FluidSystem {
  constructor({
    chunk,
    surfaceHeights,
    waterSources = [],
    lavaSources = [],
    maxLevel = FLUID_LEVELS.MAX,
    prewarmTicks = 18,
  }) {
    this.chunk = chunk;
    this.surfaceHeights = surfaceHeights;
    this.maxLevel = maxLevel;
    this.tickIndex = 0;
    this.oldBuffer = new Map();
    this.newBuffer = new Map();
    this.activeKeys = new Set();
    this.reactionBlocks = new Map();
    this.sourceKeys = new Set();
    this.sourceStates = new Map();
    this.version = 0;

    this.addSources(waterSources, FLUID_TYPES.WATER);
    this.addSources(lavaSources, FLUID_TYPES.LAVA);

    for (let tick = 0; tick < prewarmTicks; tick += 1) {
      this.tick();
    }
  }

  addSources(sources, type) {
    for (const source of sources) {
      if (!this.isInside(source.x, 0, source.z)) {
        continue;
      }

      const surfaceY = this.surfaceHeights[getColumnIndex(this.chunk.size, source.x, source.z)];
      const y = source.y ?? Math.min(this.chunk.size.y - 1, surfaceY + 1);

      if (!this.isInside(source.x, y, source.z)) {
        continue;
      }

      const key = getCellKey(source.x, y, source.z);
      const state = {
        x: source.x,
        y,
        z: source.z,
        type,
        level: this.maxLevel,
        source: true,
        distance: 0,
        falling: false,
        velocityHint: 'still',
        stableTicks: 0,
      };

      this.oldBuffer.set(key, state);
      this.sourceKeys.add(key);
      this.sourceStates.set(key, cloneFluidState(state));
      this.markActiveAround(source.x, y, source.z);
    }
  }

  tick() {
    this.tickIndex += 1;
    this.newBuffer.clear();
    this.reactionBlocks.clear();

    this.restoreSources();

    for (const key of this.activeKeys) {
      const state = this.oldBuffer.get(key);

      if (!state || state.level <= FLUID_LEVELS.EMPTY) {
        continue;
      }

      this.solveCell(state);
    }

    this.swapBuffers();
  }

  restoreSources() {
    for (const key of this.sourceKeys) {
      const source = this.oldBuffer.get(key) ?? cloneFluidState(this.sourceStates.get(key));

      if (!source) {
        continue;
      }

      source.level = this.maxLevel;
      source.source = true;
      source.distance = 0;
      source.falling = false;
      source.velocityHint = 'still';
      this.oldBuffer.set(key, source);
      this.markActiveAround(source.x, source.y, source.z);
    }
  }

  solveCell(state) {
    const params = FLOW_PARAMS[state.type];

    if (this.tickIndex % params.updateEvery !== 0) {
      this.writeFluid(state, cloneFluidState(state));
      return;
    }

    if (state.source) {
      this.writeFluid(state, {
        ...state,
        level: this.maxLevel,
        distance: 0,
        falling: false,
        velocityHint: 'still',
      });
    }

    const below = { x: state.x, y: state.y - 1, z: state.z };

    if (this.canFlowInto(below.x, below.y, below.z, state.type)) {
      const nextLevel = state.source
        ? this.maxLevel
        : Math.max(FLUID_LEVELS.EMPTY, state.level - params.downLoss);

      if (nextLevel > FLUID_LEVELS.EMPTY) {
        this.writeFluid(below, {
          ...below,
          type: state.type,
          level: nextLevel,
          source: false,
          distance: state.distance,
          falling: true,
          velocityHint: 'down',
          stableTicks: 0,
        });
      }

      return;
    }

    const nextDistance = state.source ? 1 : state.distance + 1;
    const nextLevel = state.source
      ? this.maxLevel - params.spreadLoss
      : state.level - params.spreadLoss;

    if (nextLevel > FLUID_LEVELS.EMPTY && nextDistance <= params.maxDistance) {
      for (const direction of HORIZONTAL_DIRECTIONS) {
        const target = {
          x: state.x + direction.x,
          y: state.y,
          z: state.z + direction.z,
        };

        if (!this.canFlowInto(target.x, target.y, target.z, state.type)) {
          continue;
        }

        this.writeFluid(target, {
          ...target,
          type: state.type,
          level: nextLevel,
          source: false,
          distance: nextDistance,
          falling: false,
          velocityHint: direction.velocityHint,
          stableTicks: 0,
        });
      }
    }

    if (!state.source) {
      const retainedLevel = state.level - params.dryLoss;

      if (retainedLevel > FLUID_LEVELS.EMPTY && state.distance <= params.maxDistance) {
        this.writeFluid(state, {
          ...state,
          level: retainedLevel,
          falling: false,
          velocityHint: 'still',
          stableTicks: state.stableTicks + 1,
        });
      }
    }
  }

  canFlowInto(x, y, z, type) {
    if (!this.isInside(x, y, z)) {
      return false;
    }

    const key = getCellKey(x, y, z);
    const existingFluid = this.oldBuffer.get(key) ?? this.newBuffer.get(key);

    if (existingFluid && existingFluid.type !== type) {
      return true;
    }

    const blockId = this.chunk.getBlock(x, y, z);

    return blockId === BLOCK_IDS.AIR || isFluidBlock(blockId);
  }

  writeFluid(position, incoming) {
    if (incoming.level <= FLUID_LEVELS.EMPTY || !this.isInside(position.x, position.y, position.z)) {
      return;
    }

    const key = getCellKey(position.x, position.y, position.z);
    const existing = this.newBuffer.get(key) ?? this.oldBuffer.get(key);

    if (existing && existing.type !== incoming.type) {
      this.resolveFluidCollision(position, existing, incoming);
      return;
    }

    const current = this.newBuffer.get(key);

    if (!current) {
      this.newBuffer.set(key, incoming);
      this.markActiveAround(position.x, position.y, position.z);
      return;
    }

    current.level = Math.max(current.level, incoming.level);
    current.distance = Math.min(current.distance, incoming.distance);
    current.source = current.source || incoming.source;
    current.falling = current.falling || incoming.falling;
    current.velocityHint = current.falling ? 'down' : incoming.velocityHint;
    current.stableTicks = Math.min(current.stableTicks, incoming.stableTicks);
    this.markActiveAround(position.x, position.y, position.z);
  }

  resolveFluidCollision(position, existing, incoming) {
    const key = getCellKey(position.x, position.y, position.z);
    const waterLevel = existing.type === FLUID_TYPES.WATER ? existing.level : incoming.level;
    const lavaLevel = existing.type === FLUID_TYPES.LAVA ? existing.level : incoming.level;

    this.newBuffer.delete(key);
    this.reactionBlocks.set(key, {
      x: position.x,
      y: position.y,
      z: position.z,
      blockId: waterLevel >= lavaLevel ? BLOCK_IDS.STONE : BLOCK_IDS.CAVE_STONE,
    });
    this.markActiveAround(position.x, position.y, position.z);
  }

  swapBuffers() {
    for (const reaction of this.reactionBlocks.values()) {
      this.chunk.setBlock(reaction.x, reaction.y, reaction.z, reaction.blockId);
    }

    const previousKeys = new Set(this.oldBuffer.keys());
    const nextActiveKeys = new Set();
    const oldBuffer = this.oldBuffer;

    this.oldBuffer = this.newBuffer;
    this.newBuffer = oldBuffer;
    this.newBuffer.clear();

    for (const key of this.sourceKeys) {
      if (!this.oldBuffer.has(key)) {
        const { x, y, z } = parseCellKey(key);

        this.oldBuffer.set(key, cloneFluidState(this.sourceStates.get(key)));
      }
    }

    for (const key of previousKeys) {
      if (!this.oldBuffer.has(key)) {
        const { x, y, z } = parseCellKey(key);

        this.addNeighborKeys(nextActiveKeys, x, y, z);
      }
    }

    for (const state of this.oldBuffer.values()) {
      this.addNeighborKeys(nextActiveKeys, state.x, state.y, state.z);
    }

    this.activeKeys = nextActiveKeys;
    this.version += 1;
  }

  addNeighborKeys(targetSet, x, y, z) {
    const positions = [
      { x, y, z },
      { x, y: y - 1, z },
      { x, y: y + 1, z },
      ...HORIZONTAL_DIRECTIONS.map((direction) => ({
        x: x + direction.x,
        y,
        z: z + direction.z,
      })),
    ];

    for (const position of positions) {
      if (this.isInside(position.x, position.y, position.z)) {
        targetSet.add(getCellKey(position.x, position.y, position.z));
      }
    }
  }

  markActiveAround(x, y, z) {
    this.addNeighborKeys(this.activeKeys, x, y, z);
  }

  isInside(x, y, z) {
    return (
      x >= 0 && x < this.chunk.size.x &&
      y >= 0 && y < this.chunk.size.y &&
      z >= 0 && z < this.chunk.size.z
    );
  }

  getCellsByType(type) {
    return [...this.oldBuffer.values()]
      .filter((state) => state.type === type && state.level > FLUID_LEVELS.EMPTY)
      .map((state) => ({ ...state }));
  }
}
