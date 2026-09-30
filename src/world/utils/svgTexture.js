import * as THREE from 'three';

export function createRasterSvgTexture(url, {
  width = 256,
  height = 256,
  minFilter = THREE.LinearFilter,
  magFilter = THREE.LinearFilter,
} = {}) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);

  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = minFilter;
  texture.magFilter = magFilter;
  texture.generateMipmaps = minFilter !== THREE.NearestFilter && minFilter !== THREE.LinearFilter;
  texture.needsUpdate = true;

  fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load SVG texture: ${url}`);
      }

      return response.text();
    })
    .then((svgText) => new Promise((resolve, reject) => {
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Failed to rasterize SVG texture: ${url}`));
      };
      image.src = objectUrl;
    }))
    .then((image) => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      texture.needsUpdate = true;
    })
    .catch((error) => {
      console.warn(error);
    });

  return texture;
}
