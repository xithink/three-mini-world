import * as THREE from 'three';

export function createHexBlock() {
  const geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  const material = new THREE.MeshStandardMaterial({
    color: 0xf6d32d,
    roughness: 0.42,
    metalness: 0.08,
  });

  const block = new THREE.Mesh(geometry, material);
  block.rotation.set(0.45, 0.6, 0.1);

  return block;
}
