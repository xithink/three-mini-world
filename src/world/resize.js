export function resizeRendererToContainer(renderer, camera, container) {
  const width = container.clientWidth;
  const height = container.clientHeight;
  const canvas = renderer.domElement;
  const pixelRatio = renderer.getPixelRatio();
  const displayWidth = Math.floor(width * pixelRatio);
  const displayHeight = Math.floor(height * pixelRatio);
  const needsResize = canvas.width !== displayWidth || canvas.height !== displayHeight;

  if (!needsResize) {
    return;
  }

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
