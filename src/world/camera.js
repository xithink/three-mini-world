import * as THREE from 'three';

export function createCamera(container) {
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    180,
  );

  camera.position.set(0, 12, -12);
  camera.lookAt(0, 2.8, 0);

  return camera;
}
