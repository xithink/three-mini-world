import * as THREE from 'three';

const SAMPLE_EPSILON = 0.03;
const MAX_STEP_HEIGHT = 1.05;

function getSampleRange(min, max) {
  const start = Math.floor(min + 0.5);
  const end = Math.floor(max + 0.5);
  const samples = [];

  for (let value = start; value <= end; value += 1) {
    samples.push(value);
  }

  return samples;
}

function hasSolidOverlap(body, position, worldManager) {
  const bounds = body.getBoundsAt(position);
  const sampleXs = [
    bounds.minX + SAMPLE_EPSILON,
    bounds.maxX - SAMPLE_EPSILON,
  ];
  const sampleZs = [
    bounds.minZ + SAMPLE_EPSILON,
    bounds.maxZ - SAMPLE_EPSILON,
  ];
  const sampleYs = getSampleRange(
    bounds.minY + SAMPLE_EPSILON,
    bounds.maxY - SAMPLE_EPSILON,
  );

  // 碰撞原理：人物刚体用竖直 AABB 近似，检测包围盒角点覆盖到的体素。
  // AIR、WATER 和 LAVA 不阻挡；其它方块视为固体，任一采样点落入固体即发生碰撞。
  for (const y of sampleYs) {
    for (const x of sampleXs) {
      for (const z of sampleZs) {
        if (worldManager.isSolidAt(x, y, z)) {
          return true;
        }
      }
    }
  }

  return false;
}

export function isBodyOverlappingSolid(body, worldManager, position = body.position) {
  return hasSolidOverlap(body, position, worldManager);
}

export function findNearestOpenBodyPosition(body, worldManager, {
  maxHorizontalRadius = 5,
  maxVerticalOffset = 5,
} = {}) {
  if (!hasSolidOverlap(body, body.position, worldManager)) {
    return null;
  }

  const baseX = Math.round(body.position.x);
  const baseY = Math.floor(body.position.y);
  const baseZ = Math.round(body.position.z);
  const candidates = [];

  for (let radius = 0; radius <= maxHorizontalRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) {
          continue;
        }

        for (let dy = 0; dy <= maxVerticalOffset; dy += 1) {
          candidates.push(new THREE.Vector3(baseX + dx, baseY + dy + 0.52, baseZ + dz));

          if (dy > 0) {
            candidates.push(new THREE.Vector3(baseX + dx, baseY - dy + 0.52, baseZ + dz));
          }
        }
      }
    }
  }

  return candidates
    .filter((candidate) => !hasSolidOverlap(body, candidate, worldManager))
    .sort((a, b) => a.distanceToSquared(body.position) - b.distanceToSquared(body.position))[0] ?? null;
}

function tryStepUp(body, candidate, worldManager) {
  if (!body.grounded) {
    return false;
  }

  const probe = candidate.clone();
  probe.y += MAX_STEP_HEIGHT;

  if (hasSolidOverlap(body, probe, worldManager)) {
    return false;
  }

  const groundY = worldManager.getHighestSolidBelow(probe.x, probe.y + 0.05, probe.z);

  if (groundY === null) {
    return false;
  }

  const stepHeight = groundY - body.position.y;

  if (stepHeight <= SAMPLE_EPSILON || stepHeight > MAX_STEP_HEIGHT) {
    return false;
  }

  const stepped = candidate.clone();
  stepped.y = groundY;

  if (hasSolidOverlap(body, stepped, worldManager)) {
    return false;
  }

  candidate.copy(stepped);

  return true;
}

export function moveBodyWithCollisions(body, delta, worldManager) {
  const result = {
    collidedX: false,
    collidedY: false,
    collidedZ: false,
    grounded: false,
    impactVelocity: body.velocity.clone(),
  };
  const candidate = body.position.clone();

  if (delta.x !== 0) {
    candidate.x += delta.x;

    if (hasSolidOverlap(body, candidate, worldManager)) {
      if (tryStepUp(body, candidate, worldManager)) {
        result.grounded = true;
      } else {
        candidate.x = body.position.x;
        result.collidedX = true;
      }
    }
  }

  if (delta.z !== 0) {
    candidate.z += delta.z;

    if (hasSolidOverlap(body, candidate, worldManager)) {
      if (tryStepUp(body, candidate, worldManager)) {
        result.grounded = true;
      } else {
        candidate.z = body.position.z;
        result.collidedZ = true;
      }
    }
  }

  if (delta.y !== 0) {
    const beforeY = candidate.y;
    candidate.y += delta.y;

    if (hasSolidOverlap(body, candidate, worldManager)) {
      candidate.y = beforeY;
      result.collidedY = true;
      result.grounded = delta.y < 0;
    }
  }

  const groundY = worldManager.getHighestSolidBelow(candidate.x, candidate.y + 0.05, candidate.z);

  if (groundY !== null && candidate.y < groundY) {
    candidate.y = groundY;
    result.collidedY = true;
    result.grounded = true;
  }

  body.position.copy(candidate);
  body.grounded = result.grounded || Boolean(
    groundY !== null && Math.abs(body.position.y - groundY) <= 0.02,
  );

  return result;
}

export function createDelta(x = 0, y = 0, z = 0) {
  return new THREE.Vector3(x, y, z);
}
