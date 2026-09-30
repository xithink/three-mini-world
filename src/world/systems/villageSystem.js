import * as THREE from 'three';
import { BLOCK_IDS, CHUNK_HEIGHT, CHUNK_SIZE } from '../chunk.js';
import { handleEditingKeydown } from '../utils/inputFocus.js';

const ROAD_BLOCK = BLOCK_IDS.STONE_SLAB;
const CLEAR_HEIGHT = 12;
const VILLAGE_VERSION = 'village-v13-clear-building-entrances';
const ELEVATOR_LANDING_OFFSET = Object.freeze({ x: 3, z: 0 });
const ELEVATOR_TRAVEL_OFFSET = Object.freeze({ x: 0, z: 0 });
const ELEVATOR_MOVE_SPEED = 13;
const ELEVATOR_MIN_MOVE_SECONDS = 0.65;
const ELEVATOR_MAX_MOVE_SECONDS = 4.8;
const ELEVATOR_EXIT_SPACE_PRESSES = 3;
const ELEVATOR_EXIT_PRESS_WINDOW_SECONDS = 1.4;
const ELEVATOR_REENTRY_COOLDOWN_SECONDS = 30;
const BUILDING_ELEVATOR_RADIUS = 2.35;
const BUILDING_ELEVATOR_VERTICAL_RANGE = 2.4;
const ELEVATOR_PLATFORM_CLEAR_HEIGHT = 5;
const VILLAGE_MUSIC_SCAN_DISTANCE = 18;

const VILLAGE_BUILDINGS = Object.freeze([
  { id: 'inn', label: '旅店', x: -22, z: -22, width: 10, depth: 8, floors: 2, wall: BLOCK_IDS.WOOD_PLANKS, roof: BLOCK_IDS.ROOF_TILES, trim: BLOCK_IDS.WOOD },
  { id: 'dining', label: '吃饭点', x: -9, z: -22, width: 9, depth: 7, floors: 1, wall: BLOCK_IDS.BRICK, roof: BLOCK_IDS.ROOF_TILES, trim: BLOCK_IDS.WOOD_PLANKS },
  { id: 'food-street', label: '美食街', x: 3, z: -22, width: 19, depth: 7, floors: 1, wall: BLOCK_IDS.WOOD_PLANKS, roof: BLOCK_IDS.ROOF_TILES, trim: BLOCK_IDS.WOOD },
  { id: 'warehouse', label: '仓库', x: -22, z: -11, width: 10, depth: 8, floors: 1, wall: BLOCK_IDS.METAL_PANEL, roof: BLOCK_IDS.STEEL_BLOCK, trim: BLOCK_IDS.COBBLESTONE },
  { id: 'hospital', label: '医院', x: 10, z: -11, width: 11, depth: 8, floors: 1, wall: BLOCK_IDS.QUARTZ, roof: BLOCK_IDS.CONCRETE, trim: BLOCK_IDS.GLASS },
  { id: 'homes', label: '村民家', x: -10, z: 7, width: 12, depth: 11, floors: 1, wall: BLOCK_IDS.WOOD_PLANKS, roof: BLOCK_IDS.ROOF_TILES, trim: BLOCK_IDS.COBBLESTONE },
  { id: 'fields', label: '田地', x: -22, z: 9, width: 16, depth: 11, floors: 0, wall: BLOCK_IDS.DIRT, roof: BLOCK_IDS.LEAVES, trim: BLOCK_IDS.WATER_FLOW_DECOR },
  { id: 'bar', label: '酒吧', x: 2, z: 7, width: 9, depth: 8, floors: 1, wall: BLOCK_IDS.BRICK, roof: BLOCK_IDS.ROOF_TILES, trim: BLOCK_IDS.WOOD },
  { id: 'theatre', label: '剧院', x: 12, z: 5, width: 11, depth: 14, floors: 2, wall: BLOCK_IDS.CONCRETE, roof: BLOCK_IDS.METAL_PANEL, trim: BLOCK_IDS.LAMP },
]);

const VILLAGE_MUSIC_BY_BUILDING = Object.freeze({
  inn: 'village',
  homes: 'village',
  hospital: 'villageHealing',
  fields: 'villageField',
  warehouse: 'villageField',
  bar: 'villageCafe',
  'food-street': 'villageCafe',
  dining: 'villageCafe',
  theatre: 'villageTheatre',
});

const VILLAGE_MUSIC_BY_PART_PREFIX = Object.freeze([
  ['elevator-', 'village'],
  ['bridge-elevator-', 'village'],
  ['village-bridge', 'village'],
]);

function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function toBlockCoord(value) {
  return Math.floor(value + 0.5);
}

function toChunkCoord(value, size = CHUNK_SIZE) {
  return Math.floor((value + size / 2) / size);
}

function chunkKeyAt(x, z) {
  return `${toChunkCoord(x)},${toChunkCoord(z)}`;
}

function getHorizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clampSurfaceY(worldManager, x, z) {
  return Math.max(1, worldManager.getSurfaceHeightAt(x, z) ?? 1);
}

function getSurfaceRange(worldManager, { minX, maxX, minZ, maxZ }) {
  let minY = Infinity;
  let maxY = -Infinity;

  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const y = clampSurfaceY(worldManager, x, z);

      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  return { minY, maxY };
}

function getLotBaseY(worldManager, lot) {
  let surfaceY = 0;

  for (let x = lot.x - 1; x <= lot.x + lot.width; x += 1) {
    for (let z = lot.z - 1; z <= lot.z + lot.depth; z += 1) {
      surfaceY = Math.max(surfaceY, clampSurfaceY(worldManager, x, z));
    }
  }

  return surfaceY + 1;
}

function getWorldCenter(lot, baseY, height = 4) {
  return new THREE.Vector3(
    lot.x + (lot.width - 1) / 2,
    baseY + height,
    lot.z + (lot.depth - 1) / 2,
  );
}

class BlockCollector {
  constructor(worldManager) {
    this.worldManager = worldManager;
    this.blocks = new Map();
  }

  add(x, y, z, blockId, part = 'village') {
    this.blocks.set(blockKey(x, y, z), { x, y, z, blockId, part });
  }

  rect({ minX, maxX, minY, maxY, minZ, maxZ, blockId, part = 'village', shell = false }) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          if (shell && x > minX && x < maxX && y > minY && y < maxY && z > minZ && z < maxZ) {
            continue;
          }

          this.add(x, y, z, blockId, part);
        }
      }
    }
  }

  clearLot(lot, baseY, extraHeight = CLEAR_HEIGHT) {
    this.rect({
      minX: lot.x - 1,
      maxX: lot.x + lot.width,
      minY: baseY,
      maxY: baseY + extraHeight,
      minZ: lot.z - 1,
      maxZ: lot.z + lot.depth,
      blockId: BLOCK_IDS.AIR,
      part: 'village-clear',
    });
  }

  fillFoundation(lot, baseY, blockId = BLOCK_IDS.COBBLESTONE) {
    const minX = lot.x - 1;
    const maxX = lot.x + lot.width;
    const minZ = lot.z - 1;
    const maxZ = lot.z + lot.depth;

    for (let x = lot.x - 1; x <= lot.x + lot.width; x += 1) {
      for (let z = lot.z - 1; z <= lot.z + lot.depth; z += 1) {
        const surfaceY = clampSurfaceY(this.worldManager, x, z);
        const isCorner = (x === minX || x === maxX) && (z === minZ || z === maxZ);
        const midX = Math.round((minX + maxX) / 2);
        const midZ = Math.round((minZ + maxZ) / 2);
        const longSpanX = maxX - minX > 9;
        const longSpanZ = maxZ - minZ > 9;
        const isEdgeMidPier =
          (longSpanX && z === minZ && x === midX) ||
          (longSpanX && z === maxZ && x === midX) ||
          (longSpanZ && x === minX && z === midZ) ||
          (longSpanZ && x === maxX && z === midZ);
        const isCenterPier = longSpanX && longSpanZ && x === midX && z === midZ;
        const shouldSupport = isCorner || isEdgeMidPier || isCenterPier;

        this.add(x, baseY, z, blockId, 'village-platform');

        if (!shouldSupport || surfaceY >= baseY - 1) {
          continue;
        }

        for (let y = surfaceY + 1; y < baseY; y += 1) {
          this.add(x, y, z, BLOCK_IDS.STEEL_BLOCK, 'village-pier');
        }

        for (let y = baseY - 3; y > surfaceY + 1; y -= 5) {
          this.add(x, y, z, BLOCK_IDS.STEEL_BLOCK, 'village-brace');
        }
      }
    }
  }

  values() {
    return [...this.blocks.values()];
  }
}

function addRoad(collector, worldManager, { minX, maxX, minZ, maxZ }) {
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const y = clampSurfaceY(worldManager, x, z) + 1;

      collector.add(x, y, z, ROAD_BLOCK, 'village-road');
      collector.add(x, y + 1, z, BLOCK_IDS.AIR, 'village-road-clear');
      collector.add(x, y + 2, z, BLOCK_IDS.AIR, 'village-road-clear');
    }
  }
}

function getLotAccessPoint(lot) {
  if (lot.id === 'fields') {
    return {
      x: lot.x + Math.floor(lot.width / 2),
      z: lot.z + Math.floor(lot.depth / 2),
    };
  }

  return {
    x: lot.x + Math.floor(lot.width / 2),
    z: lot.z - 2,
  };
}

function getLotBridgeElevatorPoint(lot) {
  const access = getLotAccessPoint(lot);

  if (lot.id === 'fields') {
    return access;
  }

  return { x: access.x, z: access.z - 2 };
}

function getLotElevatorRoofLot(lot) {
  if (lot.id === 'homes') {
    return { ...lot, x: lot.x, z: lot.z, width: 5, depth: 5, label: lot.label };
  }

  return lot;
}

function getLotBuildingElevatorPoint(lot) {
  const access = getLotAccessPoint(lot);

  if (lot.id === 'fields') {
    return { x: access.x + 2, z: access.z };
  }

  const roofLot = getLotElevatorRoofLot(lot);

  return {
    x: roofLot.x + Math.floor(roofLot.width / 2),
    z: roofLot.z + Math.floor(roofLot.depth / 2),
  };
}

function getLotBuildingElevatorY(worldManager, lot) {
  if (lot.id === 'fields') {
    const point = getLotBuildingElevatorPoint(lot);

    return clampSurfaceY(worldManager, point.x, point.z) + 1;
  }

  const roofLot = getLotElevatorRoofLot(lot);
  const baseY = getLotBaseY(worldManager, roofLot);
  const wallHeight = Math.max(3, roofLot.floors * 3);

  return baseY + wallHeight + 1;
}

function addBridgeSupport(collector, worldManager, x, y, z) {
  const surfaceY = clampSurfaceY(worldManager, x, z);

  if (surfaceY >= y - 1) {
    return;
  }

  for (let supportY = surfaceY + 1; supportY < y; supportY += 1) {
    collector.add(x, supportY, z, BLOCK_IDS.STEEL_BLOCK, 'village-bridge-support');
  }
}

function addBridgePoint(collector, worldManager, x, y, z, { support = false } = {}) {
  collector.add(x, y, z, ROAD_BLOCK, 'village-bridge');
  for (let clearY = y + 1; clearY <= y + ELEVATOR_PLATFORM_CLEAR_HEIGHT; clearY += 1) {
    collector.add(x, clearY, z, BLOCK_IDS.AIR, 'village-bridge-clear');
  }

  if (support) {
    addBridgeSupport(collector, worldManager, x, y, z);
  }
}

function addBridgeSegment(collector, worldManager, from, to, bridgeY) {
  const fromX = Math.round(from.x);
  const fromZ = Math.round(from.z);
  const toX = Math.round(to.x);
  const toZ = Math.round(to.z);
  const stepX = Math.sign(toX - fromX);
  const stepZ = Math.sign(toZ - fromZ);

  if (fromZ === toZ) {
    for (let x = fromX; x !== toX + stepX; x += stepX || 1) {
      const support = Math.abs(x - fromX) % 7 === 0 || x === toX;

      addBridgePoint(collector, worldManager, x, bridgeY, fromZ, { support });
      collector.add(x, bridgeY + 1, fromZ - 1, BLOCK_IDS.GLASS, 'village-bridge-railing');
      collector.add(x, bridgeY + 1, fromZ + 1, BLOCK_IDS.GLASS, 'village-bridge-railing');

      if (x === toX) break;
    }

    return;
  }

  if (fromX === toX) {
    for (let z = fromZ; z !== toZ + stepZ; z += stepZ || 1) {
      const support = Math.abs(z - fromZ) % 7 === 0 || z === toZ;

      addBridgePoint(collector, worldManager, fromX, bridgeY, z, { support });
      collector.add(fromX - 1, bridgeY + 1, z, BLOCK_IDS.GLASS, 'village-bridge-railing');
      collector.add(fromX + 1, bridgeY + 1, z, BLOCK_IDS.GLASS, 'village-bridge-railing');

      if (z === toZ) break;
    }
  }
}

function addBridgePath(collector, worldManager, points, bridgeY) {
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const corner = { x: to.x, z: from.z };

    addBridgeSegment(collector, worldManager, from, corner, bridgeY);
    addBridgeSegment(collector, worldManager, corner, to, bridgeY);
  }
}

function addBridgeElevator(collector, worldManager, location, bridgeY) {
  const building = location.building;
  const buildingY = location.buildingY ?? clampSurfaceY(worldManager, building.x, building.z) + 1;
  const top = location.bridge;
  const sign = location.sign ?? building;

  collector.rect({
    minX: building.x - 1,
    maxX: building.x + 1,
    minY: buildingY,
    maxY: buildingY,
    minZ: building.z - 1,
    maxZ: building.z + 1,
    blockId: ROAD_BLOCK,
    part: 'bridge-elevator-building',
  });
  collector.rect({
    minX: building.x - 1,
    maxX: building.x + 1,
    minY: buildingY + 1,
    maxY: buildingY + ELEVATOR_PLATFORM_CLEAR_HEIGHT,
    minZ: building.z - 1,
    maxZ: building.z + 1,
    blockId: BLOCK_IDS.AIR,
    part: 'bridge-elevator-building-clear',
  });
  collector.rect({
    minX: top.x - 1,
    maxX: top.x + 1,
    minY: bridgeY,
    maxY: bridgeY,
    minZ: top.z - 1,
    maxZ: top.z + 1,
    blockId: ROAD_BLOCK,
    part: 'bridge-elevator-corridor',
  });
  collector.rect({
    minX: top.x - 1,
    maxX: top.x + 1,
    minY: bridgeY + 1,
    maxY: bridgeY + ELEVATOR_PLATFORM_CLEAR_HEIGHT,
    minZ: top.z - 1,
    maxZ: top.z + 1,
    blockId: BLOCK_IDS.AIR,
    part: 'bridge-elevator-corridor-clear',
  });
  collector.add(building.x - 2, buildingY + 1, building.z, BLOCK_IDS.LAMP, 'bridge-elevator-building-marker');
  collector.add(building.x + 2, buildingY + 1, building.z, BLOCK_IDS.LAMP, 'bridge-elevator-building-marker');
  collector.add(sign.x, buildingY + ELEVATOR_PLATFORM_CLEAR_HEIGHT + 1, sign.z, BLOCK_IDS.LAMP, 'bridge-elevator-building-sign');
  collector.add(top.x - 2, bridgeY + 1, top.z, BLOCK_IDS.LAMP, 'bridge-elevator-marker');
  collector.add(top.x + 2, bridgeY + 1, top.z, BLOCK_IDS.LAMP, 'bridge-elevator-marker');

  const bottom = new THREE.Vector3(building.x, buildingY + 0.52, building.z);
  const topPosition = new THREE.Vector3(top.x, bridgeY + 0.52, top.z);

  return {
    id: location.id,
    label: location.label,
    radius: BUILDING_ELEVATOR_RADIUS,
    bottom,
    top: topPosition,
    travelPosition: bottom.clone(),
    floors: [
      {
        id: `${location.id}-building`,
        index: 0,
        label: location.bottomLabel ?? '建筑层',
        y: bottom.y,
        position: bottom.clone(),
      },
      {
        id: `${location.id}-bridge`,
        index: 1,
        label: '连廊层',
        y: topPosition.y,
        position: topPosition.clone(),
      },
    ],
  };
}

function clearElevatorHeadroom(collector, elevatorInfo) {
  elevatorInfo.floors.forEach((floor) => {
    const x = Math.round(floor.position.x);
    const z = Math.round(floor.position.z);
    const y = Math.round(floor.position.y - 0.52);

    collector.rect({
      minX: x - 1,
      maxX: x + 1,
      minY: y + 1,
      maxY: y + ELEVATOR_PLATFORM_CLEAR_HEIGHT,
      minZ: z - 1,
      maxZ: z + 1,
      blockId: BLOCK_IDS.AIR,
      part: 'bridge-elevator-final-clear',
    });
  });
}

function addBuildingElevator(collector, worldManager, lot, bridgeY) {
  const buildingPoint = getLotBuildingElevatorPoint(lot);

  return addBridgeElevator(collector, worldManager, {
    id: lot.id,
    label: lot.label,
    building: buildingPoint,
    buildingY: getLotBuildingElevatorY(worldManager, lot),
    bridge: getLotBridgeElevatorPoint(lot),
    sign: lot.id === 'fields'
      ? buildingPoint
      : { x: buildingPoint.x, z: buildingPoint.z + 2 },
    bottomLabel: lot.id === 'fields' ? '田地层' : '建筑层',
  }, bridgeY);
}

function addVillageBridgeNetwork(collector, worldManager, elevator, labels) {
  if (!elevator) {
    return [];
  }

  const bridgeY = elevator.topY;
  const elevatorLanding = {
    x: elevator.shaftX + ELEVATOR_LANDING_OFFSET.x,
    z: elevator.shaftZ + ELEVATOR_LANDING_OFFSET.z,
  };
  const center = { x: 0, z: 0 };
  const rowHubs = {
    north: { x: 0, z: -24 },
    middle: { x: 0, z: -10 },
    south: { x: 0, z: 20 },
  };
  const utilityPoints = [
    { id: 'watch-post', label: '瞭望点', building: { x: -8, z: -2 }, bridge: { x: -6, z: -4 }, bottomLabel: '设施层' },
    { id: 'craft-station', label: '工坊点', building: { x: 4, z: -6 }, bridge: { x: 2, z: -8 }, bottomLabel: '设施层' },
    { id: 'market', label: '市场点', building: { x: 10, z: -18 }, bridge: { x: 8, z: -20 }, bottomLabel: '设施层' },
    { id: 'village-square', label: '村庄广场', building: { x: -2, z: -2 }, bridge: { x: 0, z: -4 }, bottomLabel: '设施层' },
  ];
  const buildingElevators = VILLAGE_BUILDINGS.map((lot) => addBuildingElevator(collector, worldManager, lot, bridgeY));
  const utilityElevators = utilityPoints.map((point) => addBridgeElevator(collector, worldManager, point, bridgeY));
  const locationElevators = [...buildingElevators, ...utilityElevators];
  const accessPoints = locationElevators.map((elevatorInfo) => ({
    id: elevatorInfo.id,
    x: Math.round(elevatorInfo.top.x),
    z: Math.round(elevatorInfo.top.z),
  }));

  addBridgePath(collector, worldManager, [elevatorLanding, center], bridgeY);
  addBridgePath(collector, worldManager, [center, rowHubs.north], bridgeY);
  addBridgePath(collector, worldManager, [center, rowHubs.middle], bridgeY);
  addBridgePath(collector, worldManager, [center, rowHubs.south], bridgeY);

  accessPoints.forEach((point) => {
    const hub = point.z < -15
      ? rowHubs.north
      : point.z < 3
        ? rowHubs.middle
        : rowHubs.south;

    addBridgePath(collector, worldManager, [hub, point], bridgeY);
  });

  [
    accessPoints.filter((point) => point.z < -15).sort((a, b) => a.x - b.x),
    accessPoints.filter((point) => point.z >= -15 && point.z < 3).sort((a, b) => a.x - b.x),
    accessPoints.filter((point) => point.z >= 3).sort((a, b) => a.x - b.x),
  ].forEach((row) => {
    for (let index = 1; index < row.length; index += 1) {
      addBridgePath(collector, worldManager, [row[index - 1], row[index]], bridgeY);
    }
  });

  locationElevators.forEach((elevatorInfo) => clearElevatorHeadroom(collector, elevatorInfo));

  labels.push({
    id: 'village-bridge-network',
    label: '水平连廊桥',
    position: new THREE.Vector3(center.x, bridgeY + 3, center.z),
  });

  return locationElevators;
}

function addDoor(collector, lot, baseY) {
  const doorX = lot.x + Math.floor(lot.width / 2);

  for (let x = doorX - 1; x <= doorX + 2; x += 1) {
    for (let y = baseY + 1; y <= baseY + 4; y += 1) {
      for (let z = lot.z - 2; z <= lot.z + 2; z += 1) {
        if (z === lot.z && (x < doorX || x > doorX + 1)) {
          continue;
        }

        collector.add(x, y, z, BLOCK_IDS.AIR, z < lot.z ? 'door-front-clear' : 'door-entry-clear');
      }
    }
  }
}

function addWindows(collector, lot, baseY, wallHeight) {
  for (let y = baseY + 2; y <= baseY + wallHeight - 1; y += 3) {
    for (let x = lot.x + 2; x <= lot.x + lot.width - 3; x += 4) {
      collector.add(x, y, lot.z, BLOCK_IDS.GLASS, 'window');
      collector.add(x, y, lot.z + lot.depth - 1, BLOCK_IDS.GLASS, 'window');
    }

    for (let z = lot.z + 2; z <= lot.z + lot.depth - 3; z += 4) {
      collector.add(lot.x, y, z, BLOCK_IDS.GLASS, 'window');
      collector.add(lot.x + lot.width - 1, y, z, BLOCK_IDS.GLASS, 'window');
    }
  }
}

function addFlatRoof(collector, lot, baseY, wallHeight, roofBlock) {
  collector.rect({
    minX: lot.x - 1,
    maxX: lot.x + lot.width,
    minY: baseY + wallHeight + 1,
    maxY: baseY + wallHeight + 1,
    minZ: lot.z - 1,
    maxZ: lot.z + lot.depth,
    blockId: roofBlock,
    part: 'roof',
  });
}

function addBasicBuilding(collector, worldManager, lot, labels) {
  const baseY = getLotBaseY(worldManager, lot);
  const wallHeight = Math.max(3, lot.floors * 3);

  collector.clearLot(lot, baseY, wallHeight + 4);
  collector.fillFoundation(lot, baseY, lot.trim);
  collector.rect({
    minX: lot.x,
    maxX: lot.x + lot.width - 1,
    minY: baseY,
    maxY: baseY,
    minZ: lot.z,
    maxZ: lot.z + lot.depth - 1,
    blockId: lot.id === 'hospital' ? BLOCK_IDS.QUARTZ : BLOCK_IDS.COBBLESTONE,
    part: 'foundation',
  });
  collector.rect({
    minX: lot.x,
    maxX: lot.x + lot.width - 1,
    minY: baseY + 1,
    maxY: baseY + wallHeight,
    minZ: lot.z,
    maxZ: lot.z + lot.depth - 1,
    blockId: lot.wall,
    part: 'wall',
    shell: true,
  });
  addDoor(collector, lot, baseY);
  addWindows(collector, lot, baseY, wallHeight);
  addFlatRoof(collector, lot, baseY, wallHeight, lot.roof);

  for (let y = baseY + 1; y <= baseY + wallHeight; y += 1) {
    collector.add(lot.x, y, lot.z, lot.trim, 'wall');
    collector.add(lot.x + lot.width - 1, y, lot.z, lot.trim, 'wall');
    collector.add(lot.x, y, lot.z + lot.depth - 1, lot.trim, 'wall');
    collector.add(lot.x + lot.width - 1, y, lot.z + lot.depth - 1, lot.trim, 'wall');
  }

  labels.push({
    id: lot.id,
    label: lot.label,
    position: getWorldCenter(lot, baseY, wallHeight + 2),
  });

  return { baseY, wallHeight };
}

function addTable(collector, x, y, z) {
  collector.add(x, y, z, BLOCK_IDS.WOOD_PLANKS, 'facility');
  collector.add(x - 1, y, z, BLOCK_IDS.STONE_SLAB, 'facility');
  collector.add(x + 1, y, z, BLOCK_IDS.STONE_SLAB, 'facility');
}

function addCounter(collector, x, y, z, length, axis = 'x') {
  for (let index = 0; index < length; index += 1) {
    collector.add(x + (axis === 'x' ? index : 0), y, z + (axis === 'z' ? index : 0), BLOCK_IDS.CRAFTING_TABLE, 'facility');
  }
}

function addInn(collector, worldManager, lot, labels) {
  const { baseY } = addBasicBuilding(collector, worldManager, lot, labels);

  addCounter(collector, lot.x + 1, baseY + 1, lot.z + 1, 3);
  for (let x = lot.x + 5; x <= lot.x + lot.width - 2; x += 3) {
    collector.add(x, baseY + 1, lot.z + 2, BLOCK_IDS.WOOD_PLANKS, 'facility');
    collector.add(x, baseY + 1, lot.z + 3, BLOCK_IDS.SNOW, 'facility');
    collector.add(x, baseY + 4, lot.z + 2, BLOCK_IDS.WOOD_PLANKS, 'facility');
    collector.add(x, baseY + 4, lot.z + 3, BLOCK_IDS.SNOW, 'facility');
  }
  collector.add(lot.x + 1, baseY + 2, lot.z + lot.depth - 2, BLOCK_IDS.LAMP, 'facility');
  addDoor(collector, lot, baseY);
}

function addDining(collector, worldManager, lot, labels) {
  const { baseY } = addBasicBuilding(collector, worldManager, lot, labels);

  addCounter(collector, lot.x + 1, baseY + 1, lot.z + 1, 4);
  addTable(collector, lot.x + 3, baseY + 1, lot.z + 4);
  addTable(collector, lot.x + 6, baseY + 1, lot.z + 4);
  collector.add(lot.x + 1, baseY + 2, lot.z + lot.depth - 2, BLOCK_IDS.LAMP, 'facility');
  addDoor(collector, lot, baseY);
}

function addFoodStreet(collector, worldManager, lot, labels) {
  const baseY = getLotBaseY(worldManager, lot);

  collector.clearLot(lot, baseY, 6);
  collector.fillFoundation(lot, baseY, BLOCK_IDS.STONE_SLAB);
  collector.rect({
    minX: lot.x,
    maxX: lot.x + lot.width - 1,
    minY: baseY,
    maxY: baseY,
    minZ: lot.z,
    maxZ: lot.z + lot.depth - 1,
    blockId: ROAD_BLOCK,
    part: 'foundation',
  });

  for (let stall = 0; stall < 3; stall += 1) {
    const sx = lot.x + 1 + stall * 6;
    const sz = lot.z + 1;

    collector.rect({ minX: sx, maxX: sx + 4, minY: baseY + 4, maxY: baseY + 4, minZ: sz, maxZ: sz + 4, blockId: lot.roof, part: 'roof' });
    [[sx, sz], [sx + 4, sz], [sx, sz + 4], [sx + 4, sz + 4]].forEach(([x, z]) => {
      collector.rect({ minX: x, maxX: x, minY: baseY + 1, maxY: baseY + 3, minZ: z, maxZ: z, blockId: lot.trim, part: 'wall' });
    });
    addCounter(collector, sx + 1, baseY + 1, sz + 3, 3);
    collector.add(sx + 2, baseY + 2, sz + 1, BLOCK_IDS.LAMP, 'facility');
  }

  labels.push({ id: lot.id, label: lot.label, position: getWorldCenter(lot, baseY, 6) });
}

function addWarehouse(collector, worldManager, lot, labels) {
  const { baseY } = addBasicBuilding(collector, worldManager, lot, labels);

  for (let z = lot.z + 2; z <= lot.z + lot.depth - 2; z += 2) {
    collector.add(lot.x + 2, baseY + 1, z, BLOCK_IDS.METAL_PANEL, 'facility');
    collector.add(lot.x + 3, baseY + 1, z, BLOCK_IDS.METAL_PANEL, 'facility');
    collector.add(lot.x + lot.width - 3, baseY + 1, z, BLOCK_IDS.WOOD_PLANKS, 'facility');
  }
  addDoor(collector, lot, baseY);
}

function addHospital(collector, worldManager, lot, labels) {
  const { baseY } = addBasicBuilding(collector, worldManager, lot, labels);
  const crossX = lot.x + Math.floor(lot.width / 2);

  collector.add(crossX, baseY + 3, lot.z, BLOCK_IDS.LAMP, 'wall');
  collector.add(crossX - 1, baseY + 3, lot.z, BLOCK_IDS.LAMP, 'wall');
  collector.add(crossX + 1, baseY + 3, lot.z, BLOCK_IDS.LAMP, 'wall');
  collector.add(crossX, baseY + 2, lot.z, BLOCK_IDS.LAMP, 'wall');
  collector.add(crossX, baseY + 4, lot.z, BLOCK_IDS.LAMP, 'wall');

  for (let z = lot.z + 2; z <= lot.z + lot.depth - 3; z += 3) {
    collector.add(lot.x + 2, baseY + 1, z, BLOCK_IDS.QUARTZ, 'facility');
    collector.add(lot.x + 3, baseY + 1, z, BLOCK_IDS.SNOW, 'facility');
    collector.add(lot.x + lot.width - 3, baseY + 1, z, BLOCK_IDS.CRAFTING_TABLE, 'facility');
  }
  addDoor(collector, lot, baseY);
}

function addHomes(collector, worldManager, lot, labels) {
  const homeLots = [
    { ...lot, x: lot.x, z: lot.z, width: 5, depth: 5, label: '村民家' },
    { ...lot, x: lot.x + 7, z: lot.z, width: 5, depth: 5, label: '村民家' },
    { ...lot, x: lot.x + 3, z: lot.z + 6, width: 6, depth: 5, label: '村民家' },
  ];

  homeLots.forEach((homeLot) => {
    const { baseY } = addBasicBuilding(collector, worldManager, homeLot, []);
    collector.add(homeLot.x + 1, baseY + 1, homeLot.z + 2, BLOCK_IDS.WOOD_PLANKS, 'facility');
    collector.add(homeLot.x + 2, baseY + 1, homeLot.z + 2, BLOCK_IDS.SNOW, 'facility');
    collector.add(homeLot.x + homeLot.width - 2, baseY + 1, homeLot.z + homeLot.depth - 2, BLOCK_IDS.CRAFTING_TABLE, 'facility');
    addDoor(collector, homeLot, baseY);
  });

  const baseY = getLotBaseY(worldManager, lot);
  labels.push({ id: lot.id, label: lot.label, position: getWorldCenter(lot, baseY, 6) });
}

function addFields(collector, worldManager, lot, labels) {
  const baseY = getLotBaseY(worldManager, lot);

  collector.clearLot(lot, baseY, 5);
  collector.fillFoundation(lot, baseY, BLOCK_IDS.DIRT);
  collector.rect({
    minX: lot.x,
    maxX: lot.x + lot.width - 1,
    minY: baseY,
    maxY: baseY,
    minZ: lot.z,
    maxZ: lot.z + lot.depth - 1,
    blockId: BLOCK_IDS.DIRT,
    part: 'foundation',
  });

  for (let x = lot.x + 1; x < lot.x + lot.width - 1; x += 1) {
    for (let z = lot.z + 1; z < lot.z + lot.depth - 1; z += 1) {
      const isWater = x === lot.x + Math.floor(lot.width / 2);

      collector.add(x, baseY + 1, z, isWater ? BLOCK_IDS.WATER_FLOW_DECOR : BLOCK_IDS.DRY_GRASS, 'facility');
      if (!isWater && (x + z) % 3 === 0) {
        collector.add(x, baseY + 2, z, BLOCK_IDS.LEAVES, 'facility');
      }
    }
  }

  labels.push({ id: lot.id, label: lot.label, position: getWorldCenter(lot, baseY, 4) });
}

function addBar(collector, worldManager, lot, labels) {
  const { baseY } = addBasicBuilding(collector, worldManager, lot, labels);

  addCounter(collector, lot.x + 1, baseY + 1, lot.z + 1, 6);
  for (let x = lot.x + 2; x <= lot.x + lot.width - 3; x += 2) {
    collector.add(x, baseY + 1, lot.z + 4, BLOCK_IDS.STONE_SLAB, 'facility');
    collector.add(x, baseY + 2, lot.z + lot.depth - 2, BLOCK_IDS.LAMP, 'facility');
  }
  addDoor(collector, lot, baseY);
}

function addTheatre(collector, worldManager, lot, labels) {
  const { baseY, wallHeight } = addBasicBuilding(collector, worldManager, lot, labels);

  collector.rect({
    minX: lot.x + 1,
    maxX: lot.x + lot.width - 2,
    minY: baseY + 1,
    maxY: baseY + 1,
    minZ: lot.z + lot.depth - 4,
    maxZ: lot.z + lot.depth - 2,
    blockId: BLOCK_IDS.WOOD_PLANKS,
    part: 'facility',
  });
  for (let row = 0; row < 3; row += 1) {
    for (let x = lot.x + 2; x <= lot.x + lot.width - 3; x += 2) {
      collector.add(x, baseY + 1, lot.z + 2 + row * 2, BLOCK_IDS.STONE_SLAB, 'facility');
    }
  }
  collector.add(lot.x + 2, baseY + wallHeight, lot.z + lot.depth - 2, BLOCK_IDS.LAMP, 'facility');
  collector.add(lot.x + lot.width - 3, baseY + wallHeight, lot.z + lot.depth - 2, BLOCK_IDS.LAMP, 'facility');
  addDoor(collector, lot, baseY);
}

function addMountainElevator(collector, worldManager, labels) {
  const shaftX = 26;
  const shaftZ = -1;
  const villageRange = getSurfaceRange(worldManager, { minX: -24, maxX: 24, minZ: -24, maxZ: 22 });
  const footRange = getSurfaceRange(worldManager, { minX: shaftX - 4, maxX: shaftX + 4, minZ: shaftZ - 4, maxZ: shaftZ + 4 });
  const footY = footRange.minY + 1;
  const topY = Math.min(CHUNK_HEIGHT - 8, Math.max(villageRange.maxY + 4, footY + 34));

  collector.rect({
    minX: shaftX - 4,
    maxX: shaftX + 4,
    minY: footY,
    maxY: topY + 5,
    minZ: shaftZ - 4,
    maxZ: shaftZ + 4,
    blockId: BLOCK_IDS.AIR,
    part: 'elevator-clear',
  });
  const stopCount = 6;
  const floorYs = Array.from({ length: stopCount }, (_, index) => {
    const t = index / (stopCount - 1);

    return Math.round(footY + (topY - footY) * t);
  }).filter((floorY, index, values) => index === 0 || floorY > values[index - 1] + 2);

  if (floorYs[floorYs.length - 1] !== topY) {
    floorYs.push(topY);
  }

  floorYs.forEach((floorY, index) => {
    const platformBlock = index === 0 ? BLOCK_IDS.COBBLESTONE : BLOCK_IDS.STONE_SLAB;
    const landingX = shaftX + ELEVATOR_LANDING_OFFSET.x;
    const landingZ = shaftZ + ELEVATOR_LANDING_OFFSET.z;

    collector.rect({
      minX: landingX - 1,
      maxX: landingX + 1,
      minY: floorY,
      maxY: floorY,
      minZ: landingZ - 1,
      maxZ: landingZ + 1,
      blockId: platformBlock,
      part: 'elevator-platform',
    });
    collector.rect({
      minX: landingX - 1,
      maxX: landingX + 1,
      minY: floorY + 1,
      maxY: floorY + ELEVATOR_PLATFORM_CLEAR_HEIGHT,
      minZ: landingZ - 1,
      maxZ: landingZ + 1,
      blockId: BLOCK_IDS.AIR,
      part: 'elevator-landing-clear',
    });
  });

  const topLandingX = shaftX + ELEVATOR_LANDING_OFFSET.x;

  for (let x = 2; x <= topLandingX - 2; x += 1) {
    collector.add(x, topY, shaftZ, BLOCK_IDS.STONE_SLAB, 'elevator-skywalk');
    for (let clearY = topY + 1; clearY <= topY + ELEVATOR_PLATFORM_CLEAR_HEIGHT; clearY += 1) {
      collector.add(x, clearY, shaftZ, BLOCK_IDS.AIR, 'elevator-skywalk-clear');
    }
    collector.add(x, topY + 1, shaftZ - 1, BLOCK_IDS.GLASS, 'elevator-railing');
    collector.add(x, topY + 1, shaftZ + 1, BLOCK_IDS.GLASS, 'elevator-railing');
  }

  labels.push({
    id: 'mountain-elevator',
    label: '山体超长电梯',
    position: new THREE.Vector3(shaftX, topY + 7, shaftZ),
  });

  return {
    id: 'mountain-elevator',
    label: '山体电梯',
    shaftX,
    shaftZ,
    footY,
    topY,
    radius: 4.2,
    travelPosition: new THREE.Vector3(
      shaftX + ELEVATOR_TRAVEL_OFFSET.x,
      0,
      shaftZ + ELEVATOR_TRAVEL_OFFSET.z,
    ),
    floors: floorYs.map((floorY, index) => ({
      id: `floor-${index}`,
      index,
      label: index === 0 ? '山下' : index === floorYs.length - 1 ? '山顶' : `${index + 1}层`,
      y: floorY,
      position: new THREE.Vector3(
        shaftX + ELEVATOR_LANDING_OFFSET.x,
        floorY + 0.62,
        shaftZ + ELEVATOR_LANDING_OFFSET.z,
      ),
    })),
  };
}

export class VillageSystem {
  constructor({ scene, camera, container, worldManager, player }) {
    this.scene = scene;
    this.camera = camera;
    this.container = container;
    this.worldManager = worldManager;
    this.player = player;
    this.labels = [];
    this.villageBlocks = [];
    this.blocksByChunkKey = new Map();
    this.villageBlockLookup = new Map();
    this.elevator = null;
    this.buildingElevators = [];
    this.elevatorRide = null;
    this.elevatorCabin = null;
    this.elevatorCurtain = null;
    this.activeElevator = null;
    this.renderedElevatorId = '';
    this.isNearElevator = false;
    this.elevatorExitPresses = 0;
    this.elevatorExitPressTimer = 0;
    this.elevatorReentryCooldown = 0;
    this.refreshAccumulator = 0;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'village-label-layer';
    this.elevatorPanel = this.createElevatorPanel();
    this.container.append(this.labelLayer);
    this.container.append(this.elevatorPanel);
    window.addEventListener('keydown', this.onKeyDown, true);
    this.buildVillage();
  }

  createElevatorCabin() {
    const group = new THREE.Group();
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x8adfff,
      emissive: 0x2a9dc8,
      emissiveIntensity: 0.55,
      roughness: 0.38,
      metalness: 0.12,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.035, 8, 48), ringMaterial);
    const marker = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.026, 8, 32), ringMaterial.clone());

    ring.rotation.x = Math.PI * 0.5;
    marker.rotation.x = Math.PI * 0.5;
    marker.position.y = 1.35;
    group.add(ring, marker);
    group.visible = false;
    group.userData.dispose = () => {
      ring.geometry.dispose();
      marker.geometry.dispose();
      ring.material.dispose();
      marker.material.dispose();
    };
    this.scene.add(group);

    return group;
  }

  createMountainElevatorCurtain(elevatorInfo) {
    if (!elevatorInfo) {
      return null;
    }

    const group = new THREE.Group();
    const height = elevatorInfo.topY - elevatorInfo.footY + 6;
    const centerY = elevatorInfo.footY + height / 2 - 0.5;
    const radius = 3.65;
    const panelLength = radius * 2;
    const panelThickness = 0.045;
    const material = new THREE.MeshStandardMaterial({
      color: 0x9de9ff,
      emissive: 0x1d6d8a,
      emissiveIntensity: 0.22,
      roughness: 0.18,
      metalness: 0.02,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const horizontalGeometry = new THREE.BoxGeometry(panelLength, height, panelThickness);
    const verticalGeometry = new THREE.BoxGeometry(panelThickness, height, panelLength);
    const north = new THREE.Mesh(horizontalGeometry, material);
    const south = new THREE.Mesh(horizontalGeometry, material);
    const west = new THREE.Mesh(verticalGeometry, material);
    const east = new THREE.Mesh(verticalGeometry, material);

    north.position.set(elevatorInfo.shaftX, centerY, elevatorInfo.shaftZ - radius);
    south.position.set(elevatorInfo.shaftX, centerY, elevatorInfo.shaftZ + radius);
    west.position.set(elevatorInfo.shaftX - radius, centerY, elevatorInfo.shaftZ);
    east.position.set(elevatorInfo.shaftX + radius, centerY, elevatorInfo.shaftZ);
    group.add(north, south, west, east);
    group.userData.dispose = () => {
      horizontalGeometry.dispose();
      verticalGeometry.dispose();
      material.dispose();
    };
    this.scene.add(group);

    return group;
  }

  createElevatorPanel() {
    const panel = document.createElement('section');

    panel.className = 'village-elevator';
    panel.setAttribute('aria-label', '电梯控制');
    panel.innerHTML = `
      <div class="village-elevator__header">
        <strong data-elevator-title>电梯</strong>
        <span data-elevator-status>进入电梯后选择楼层</span>
      </div>
      <div class="village-elevator__floors" data-elevator-floors></div>
    `;

    return panel;
  }

  buildVillage() {
    const collector = new BlockCollector(this.worldManager);
    const labels = [];

    addRoad(collector, this.worldManager, { minX: -24, maxX: 24, minZ: -2, maxZ: 2 });
    addRoad(collector, this.worldManager, { minX: -2, maxX: 2, minZ: -24, maxZ: 22 });
    addRoad(collector, this.worldManager, { minX: -6, maxX: 8, minZ: -7, maxZ: 6 });

    for (const lot of VILLAGE_BUILDINGS) {
      if (lot.id === 'inn') addInn(collector, this.worldManager, lot, labels);
      else if (lot.id === 'dining') addDining(collector, this.worldManager, lot, labels);
      else if (lot.id === 'food-street') addFoodStreet(collector, this.worldManager, lot, labels);
      else if (lot.id === 'warehouse') addWarehouse(collector, this.worldManager, lot, labels);
      else if (lot.id === 'hospital') addHospital(collector, this.worldManager, lot, labels);
      else if (lot.id === 'homes') addHomes(collector, this.worldManager, lot, labels);
      else if (lot.id === 'fields') addFields(collector, this.worldManager, lot, labels);
      else if (lot.id === 'bar') addBar(collector, this.worldManager, lot, labels);
      else if (lot.id === 'theatre') addTheatre(collector, this.worldManager, lot, labels);
    }

    this.elevator = addMountainElevator(collector, this.worldManager, labels);
    this.buildingElevators = addVillageBridgeNetwork(collector, this.worldManager, this.elevator, labels);
    this.elevatorCabin = this.createElevatorCabin();
    this.elevatorCurtain = this.createMountainElevatorCurtain(this.elevator);

    this.villageBlocks = collector.values();
    this.blocksByChunkKey = this.indexBlocksByChunk(this.villageBlocks);
    this.villageBlockLookup = this.indexBlocksByPosition(this.villageBlocks);
    this.worldManager.setBlocksAt(this.villageBlocks);
    this.markLoadedVillageChunks();
    this.labels = labels.map((label) => {
      const element = document.createElement('div');
      element.className = 'village-label';
      element.innerHTML = `<span>村庄设施</span><strong>${label.label}</strong>`;
      this.labelLayer.append(element);

      return { ...label, element };
    });
    this.renderElevatorPanel();
  }

  renderElevatorPanel() {
    const floorList = this.elevatorPanel.querySelector('[data-elevator-floors]');
    const title = this.elevatorPanel.querySelector('[data-elevator-title]');
    const elevator = this.activeElevator ?? this.elevator;

    floorList.innerHTML = '';

    if (title) {
      title.textContent = elevator?.label ?? '电梯';
    }

    elevator?.floors.forEach((floor, index) => {
      const button = document.createElement('button');

      button.type = 'button';
      button.dataset.elevatorFloor = String(index);
      button.innerHTML = `<span>${index + 1}</span><strong>${floor.label}</strong>`;
      button.addEventListener('click', () => this.movePlayerToFloor(index));
      floorList.append(button);
    });
  }

  getBehaviorAnchors() {
    const anchors = new Map();

    this.labels.forEach((label) => {
      anchors.set(label.id, label.position.clone());
    });

    VILLAGE_BUILDINGS.forEach((lot) => {
      const elevatorInfo = this.buildingElevators.find((candidate) => candidate.id === lot.id);

      if (elevatorInfo) {
        anchors.set(lot.id, elevatorInfo.bottom.clone());
        return;
      }

      const access = getLotBuildingElevatorPoint(lot);

      anchors.set(lot.id, new THREE.Vector3(access.x, clampSurfaceY(this.worldManager, access.x, access.z) + 1, access.z));
    });

    this.buildingElevators.forEach((elevatorInfo) => {
      if (!anchors.has(elevatorInfo.id)) {
        anchors.set(elevatorInfo.id, elevatorInfo.bottom.clone());
      }
    });

    anchors.set('village-center', new THREE.Vector3(0, clampSurfaceY(this.worldManager, 0, 0) + 1, 0));

    if (this.elevator?.floors?.[0]) {
      anchors.set('elevator-foot', this.elevator.floors[0].position.clone());
    }

    if (this.elevator?.floors?.length) {
      anchors.set('mountain-view', this.elevator.floors[this.elevator.floors.length - 1].position.clone());
    }

    return anchors;
  }

  getVillageBounds() {
    return { minX: -26, maxX: 32, minZ: -26, maxZ: 24 };
  }

  getNearestBuildingElevator(position) {
    if (!this.buildingElevators.length) {
      return null;
    }

    return this.buildingElevators.reduce((nearest, elevatorInfo) => (
      getHorizontalDistance(position, elevatorInfo.bottom) < getHorizontalDistance(position, nearest.bottom)
        ? elevatorInfo
        : nearest
    ), this.buildingElevators[0]);
  }

  getBuildingElevatorRoute(fromPosition, targetPosition, targetId = '') {
    if (targetId === 'mountain-view' || targetId === 'elevator-foot' || targetId === 'mountain-elevator') {
      return null;
    }

    const targetElevator = this.buildingElevators.find((elevatorInfo) => elevatorInfo.id === targetId)
      ?? this.getNearestBuildingElevator(targetPosition);
    const startElevator = this.getNearestBuildingElevator(fromPosition);

    if (!targetElevator || !startElevator) {
      return null;
    }

    const fromOnBridge = fromPosition.y >= targetElevator.top.y - 2;
    const targetOnBridge = targetPosition.y >= targetElevator.top.y - 2;
    const route = [];

    if (fromOnBridge) {
      route.push(startElevator.top.clone());
    } else {
      route.push(startElevator.bottom.clone(), startElevator.top.clone());
    }

    if (startElevator.id !== targetElevator.id) {
      route.push(targetElevator.top.clone());
    }

    if (!targetOnBridge) {
      route.push(targetElevator.bottom.clone());
    }

    route.push(targetPosition.clone());

    return route;
  }

  onKeyDown(event) {
    if (handleEditingKeydown(event)) {
      return;
    }

    if (event.code === 'Space' && this.elevatorRide && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.registerElevatorExitPress();
      return;
    }

    if (!this.isNearElevator || this.elevatorReentryCooldown > 0) {
      return;
    }

    const numericKey = event.code.startsWith('Digit')
      ? Number(event.code.slice(5))
      : event.code.startsWith('Numpad')
        ? Number(event.code.slice(6))
        : NaN;

    if (!Number.isFinite(numericKey)) {
      return;
    }

    const floorIndex = numericKey === 0 ? 9 : numericKey - 1;

    if (!this.activeElevator?.floors[floorIndex]) {
      return;
    }

    event.preventDefault();
    this.movePlayerToFloor(floorIndex);
  }

  updateElevatorExitTimers(deltaTime) {
    this.elevatorReentryCooldown = Math.max(0, this.elevatorReentryCooldown - deltaTime);

    if (this.elevatorExitPressTimer <= 0) {
      return;
    }

    this.elevatorExitPressTimer = Math.max(0, this.elevatorExitPressTimer - deltaTime);
    if (this.elevatorExitPressTimer <= 0) {
      this.elevatorExitPresses = 0;
    }
  }

  registerElevatorExitPress() {
    this.elevatorExitPresses += 1;
    this.elevatorExitPressTimer = ELEVATOR_EXIT_PRESS_WINDOW_SECONDS;

    if (this.elevatorExitPresses < ELEVATOR_EXIT_SPACE_PRESSES) {
      return;
    }

    this.exitElevatorRide();
  }

  exitElevatorRide() {
    const ride = this.elevatorRide;

    if (!ride) {
      return;
    }

    const elevatorInfo = ride.elevator;
    const exitOffset = Math.max(2.1, (elevatorInfo?.radius ?? 1.2) + 0.9);
    const exitPosition = this.player.position.clone().add(new THREE.Vector3(exitOffset, 0, 0));

    this.worldManager.loadAround(exitPosition);
    this.applyLoadedVillageChunks();
    this.player.position.copy(exitPosition);
    this.player.body.velocity.set(0, 0, 0);
    this.player.body.grounded = false;
    this.player.setHovering?.(false);
    this.player.setGliding?.(false);
    this.player.setLyingDown?.(false);
    this.player.update?.(0, this.worldManager);
    this.elevatorRide = null;
    this.elevatorExitPresses = 0;
    this.elevatorExitPressTimer = 0;
    this.elevatorReentryCooldown = ELEVATOR_REENTRY_COOLDOWN_SECONDS;
    this.activeElevator = null;
    this.isNearElevator = false;
    this.syncElevatorCabin();
    this.updateElevatorPanel();
  }

  indexBlocksByChunk(blocks) {
    const blocksByChunkKey = new Map();

    blocks.forEach((block) => {
      const key = chunkKeyAt(block.x, block.z);
      const chunkBlocks = blocksByChunkKey.get(key) ?? [];

      chunkBlocks.push(block);
      blocksByChunkKey.set(key, chunkBlocks);
    });

    return blocksByChunkKey;
  }

  indexBlocksByPosition(blocks) {
    const lookup = new Map();

    blocks.forEach((block) => {
      lookup.set(blockKey(block.x, block.y, block.z), block);
    });

    return lookup;
  }

  getMusicProfileForPart(part) {
    if (!part) {
      return null;
    }

    const match = VILLAGE_MUSIC_BY_PART_PREFIX.find(([prefix]) => part.startsWith(prefix));

    return match?.[1] ?? null;
  }

  getBuildingAtColumn(x, z) {
    return VILLAGE_BUILDINGS.find((lot) => (
      x >= lot.x - 1 &&
      x <= lot.x + lot.width &&
      z >= lot.z - 1 &&
      z <= lot.z + lot.depth
    )) ?? null;
  }

  getMusicProfileAt(position, { radius = 0.36, scanDistance = VILLAGE_MUSIC_SCAN_DISTANCE } = {}) {
    if (!position || !this.villageBlockLookup.size) {
      return null;
    }

    const startY = toBlockCoord(position.y - 0.46);
    const minY = Math.max(0, startY - scanDistance);
    const samplePoints = [
      [position.x, position.z],
      [position.x + radius, position.z],
      [position.x - radius, position.z],
      [position.x, position.z + radius],
      [position.x, position.z - radius],
    ];

    for (let y = startY; y >= minY; y -= 1) {
      for (const [sampleX, sampleZ] of samplePoints) {
        const x = toBlockCoord(sampleX);
        const z = toBlockCoord(sampleZ);
        const block = this.villageBlockLookup.get(blockKey(x, y, z));

        if (!block || block.blockId === BLOCK_IDS.AIR) {
          continue;
        }

        const partProfile = this.getMusicProfileForPart(block.part);

        if (partProfile) {
          return partProfile;
        }

        const building = this.getBuildingAtColumn(x, z);

        if (building) {
          return VILLAGE_MUSIC_BY_BUILDING[building.id] ?? null;
        }
      }
    }

    return null;
  }

  markLoadedVillageChunks() {
    for (const key of this.blocksByChunkKey.keys()) {
      const entity = this.worldManager.loadedChunks.get(key);

      if (entity) {
        entity.villageVersion = VILLAGE_VERSION;
      }
    }
  }

  applyLoadedVillageChunks() {
    for (const [key, blocks] of this.blocksByChunkKey) {
      const entity = this.worldManager.loadedChunks.get(key);

      if (!entity || entity.villageVersion === VILLAGE_VERSION) {
        continue;
      }

      this.worldManager.setBlocksAt(blocks);
      entity.villageVersion = VILLAGE_VERSION;
    }
  }

  updateElevatorPanel() {
    if (!this.elevator) {
      return;
    }

    const detectedElevator = this.elevatorRide?.elevator ?? this.getNearbyPlayerElevator();

    this.activeElevator = detectedElevator;
    this.isNearElevator = Boolean(detectedElevator);

    if (this.renderedElevatorId !== (detectedElevator?.id ?? '')) {
      this.renderedElevatorId = detectedElevator?.id ?? '';
      this.renderElevatorPanel();
    }

    this.elevatorPanel.classList.toggle('is-open', this.isNearElevator);

    if (!this.isNearElevator) {
      return;
    }

    const nearestFloor = this.getNearestElevatorFloor(detectedElevator);
    const status = this.elevatorPanel.querySelector('[data-elevator-status]');

    if (status && nearestFloor) {
      status.textContent = this.elevatorRide
        ? `运行中：${detectedElevator.label} / ${this.elevatorRide.targetFloor.label}`
        : `当前靠近：${detectedElevator.label} / ${nearestFloor.label}`;
    }

    this.elevatorPanel.querySelectorAll('[data-elevator-floor]').forEach((button) => {
      const floor = detectedElevator.floors[Number(button.dataset.elevatorFloor)];

      button.classList.toggle('is-current', floor === nearestFloor);
      button.disabled = Boolean(this.elevatorRide);
    });
  }

  getElevatorSystems() {
    return [
      this.elevator,
      ...this.buildingElevators,
    ].filter(Boolean);
  }

  isPlayerNearElevator(elevatorInfo) {
    if (!elevatorInfo) {
      return false;
    }

    if (elevatorInfo.id === 'mountain-elevator') {
      const dx = this.player.position.x - elevatorInfo.shaftX;
      const dz = this.player.position.z - elevatorInfo.shaftZ;

      return (
        Math.hypot(dx, dz) <= elevatorInfo.radius &&
        this.player.position.y >= elevatorInfo.footY - 1 &&
        this.player.position.y <= elevatorInfo.topY + 7
      );
    }

    return elevatorInfo.floors.some((floor) => (
      getHorizontalDistance(this.player.position, floor.position) <= elevatorInfo.radius &&
      Math.abs(this.player.position.y - floor.position.y) <= BUILDING_ELEVATOR_VERTICAL_RANGE
    ));
  }

  getNearbyPlayerElevator() {
    if (this.elevatorReentryCooldown > 0 && !this.elevatorRide) {
      return null;
    }

    const candidates = this.getElevatorSystems().filter((elevatorInfo) => this.isPlayerNearElevator(elevatorInfo));

    if (!candidates.length) {
      return null;
    }

    return candidates.reduce((nearest, elevatorInfo) => {
      const nearestFloor = this.getNearestElevatorFloor(elevatorInfo);
      const currentNearestFloor = this.getNearestElevatorFloor(nearest);
      const distance = nearestFloor ? this.player.position.distanceTo(nearestFloor.position) : Infinity;
      const currentDistance = currentNearestFloor ? this.player.position.distanceTo(currentNearestFloor.position) : Infinity;

      return distance < currentDistance ? elevatorInfo : nearest;
    }, candidates[0]);
  }

  getNearestElevatorFloor(elevatorInfo = this.activeElevator) {
    return elevatorInfo?.floors.reduce((nearest, floor) => (
      Math.abs(floor.position.y - this.player.position.y) < Math.abs(nearest.position.y - this.player.position.y)
        ? floor
        : nearest
    ), elevatorInfo.floors[0]) ?? null;
  }

  movePlayerToFloor(floorIndex) {
    const elevatorInfo = this.activeElevator;
    const floor = elevatorInfo?.floors[floorIndex];

    if (!elevatorInfo || !floor || this.elevatorRide || this.elevatorReentryCooldown > 0) {
      return;
    }

    this.worldManager.loadAround(floor.position);
    this.applyLoadedVillageChunks();

    const startPosition = this.player.position.clone();
    const endPosition = floor.position.clone();
    const travelPosition = elevatorInfo.travelPosition ?? endPosition;
    const startTravelPosition = new THREE.Vector3(travelPosition.x, startPosition.y, travelPosition.z);
    const endTravelPosition = new THREE.Vector3(travelPosition.x, endPosition.y, travelPosition.z);
    const path = [
      startPosition,
      startTravelPosition,
      endTravelPosition,
      endPosition,
    ];
    const distance = path.slice(1).reduce((total, point, index) => total + point.distanceTo(path[index]), 0);

    this.elevatorRide = {
      elapsed: 0,
      duration: Math.max(
        ELEVATOR_MIN_MOVE_SECONDS,
        Math.min(ELEVATOR_MAX_MOVE_SECONDS, distance / ELEVATOR_MOVE_SPEED),
      ),
      path,
      segmentLengths: path.slice(1).map((point, index) => point.distanceTo(path[index])),
      endPosition,
      targetFloor: floor,
      elevator: elevatorInfo,
    };
    this.player.body.velocity.set(0, 0, 0);
    this.player.body.grounded = false;
    this.player.setHovering?.(false);
    this.player.setGliding?.(false);
    this.player.setLyingDown?.(false);
    this.updateElevatorPanel();
  }

  updateElevatorMovement(deltaTime) {
    if (!this.elevatorRide) {
      return;
    }

    const ride = this.elevatorRide;
    ride.elapsed = Math.min(ride.duration, ride.elapsed + deltaTime);
    const progress = ride.duration <= 0 ? 1 : ride.elapsed / ride.duration;
    const easedProgress = progress * progress * (3 - 2 * progress);
    const totalLength = ride.segmentLengths.reduce((total, length) => total + length, 0);
    let remainingDistance = totalLength * easedProgress;
    let segmentIndex = 0;

    while (
      segmentIndex < ride.segmentLengths.length - 1 &&
      remainingDistance > ride.segmentLengths[segmentIndex]
    ) {
      remainingDistance -= ride.segmentLengths[segmentIndex];
      segmentIndex += 1;
    }

    const segmentLength = Math.max(0.0001, ride.segmentLengths[segmentIndex]);
    const segmentProgress = Math.min(1, remainingDistance / segmentLength);
    const segmentStart = ride.path[segmentIndex];
    const segmentEnd = ride.path[segmentIndex + 1];

    this.player.position.lerpVectors(segmentStart, segmentEnd, segmentProgress);
    this.player.body.velocity.set(0, 0, 0);
    this.player.body.grounded = false;
    this.player.setHovering?.(false);
    this.player.setGliding?.(false);
    this.player.setLyingDown?.(false);
    this.player.update?.(0, this.worldManager);
    this.syncElevatorCabin();

    if (progress < 1) {
      return;
    }

    this.player.position.copy(ride.endPosition);
    this.player.body.velocity.set(0, 0, 0);
    this.player.body.grounded = true;
    this.player.update?.(0, this.worldManager);
    this.elevatorRide = null;
    this.syncElevatorCabin();
  }

  syncElevatorCabin() {
    if (!this.elevatorCabin || !this.elevator) {
      return;
    }

    this.elevatorCabin.visible = Boolean(this.elevatorRide || this.isNearElevator);
    this.elevatorCabin.position.set(
      this.player.position.x,
      this.player.position.y + 0.08,
      this.player.position.z,
    );
  }

  update(deltaTime = 0) {
    this.refreshAccumulator += deltaTime;
    this.updateElevatorExitTimers(deltaTime);

    if (this.refreshAccumulator >= 0.5) {
      this.refreshAccumulator = 0;
      this.applyLoadedVillageChunks();
    }

    this.updateElevatorMovement(deltaTime);
    this.updateElevatorPanel();
    this.syncElevatorCabin();

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const projected = new THREE.Vector3();

    this.labels.forEach((label) => {
      projected.copy(label.position).project(this.camera);
      const distance = this.player.position.distanceTo(label.position);
      const isVisible =
        projected.z >= -1 &&
        projected.z <= 1 &&
        distance < 42;

      label.element.classList.toggle('is-hidden', !isVisible);

      if (!isVisible) {
        return;
      }

      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;

      label.element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    });
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.labels.forEach((label) => label.element.remove());
    this.labels = [];
    this.labelLayer.remove();
    this.elevatorPanel.remove();
    this.elevatorCabin?.userData.dispose?.();
    if (this.elevatorCabin) {
      this.scene.remove(this.elevatorCabin);
    }
    this.elevatorCurtain?.userData.dispose?.();
    if (this.elevatorCurtain) {
      this.scene.remove(this.elevatorCurtain);
    }
  }
}
