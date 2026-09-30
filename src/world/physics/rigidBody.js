import * as THREE from 'three';

export class RigidBody {
  constructor({
    position = new THREE.Vector3(),
    radius = 0.34,
    height = 1.82,
    mass = 72,
  } = {}) {
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.radius = radius;
    this.height = height;
    this.mass = mass;
    this.grounded = false;
  }

  getBoundsAt(position = this.position) {
    return {
      minX: position.x - this.radius,
      maxX: position.x + this.radius,
      minY: position.y,
      maxY: position.y + this.height,
      minZ: position.z - this.radius,
      maxZ: position.z + this.radius,
    };
  }
}
