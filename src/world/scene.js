import * as THREE from 'three';

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x172029);
  scene.fog = new THREE.FogExp2(0x9fb5bf, 0.018);

  return scene;
}
