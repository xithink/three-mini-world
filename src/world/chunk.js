import * as THREE from 'three';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 258;
const GRASS_TEXTURE_URL = '/assets/textwatercaodi.png';
const SNOW_TEXTURE_URL = '/assets/textwaterxuedi16.png';
const SNOW_MOUNTAIN_TEXTURE_URL = '/assets/textwaterxueshan.png';
const ROCK_MOUNTAIN_TEXTURE_URL = '/assets/textwateryanshishan.png';
const FOREST_MOUNTAIN_TEXTURE_URL = '/assets/textwatershenlinshan.png';
const CAVE_TEXTURE_URL = '/assets/textwaterdongxue.png';
const LEAF_TEXTURE_URL = '/assets/textwateryezi.png';

export const BLOCK_IDS = Object.freeze({
  AIR: 0,
  GRASS: 1,
  WATER: 2,
  STONE: 3,
  LAVA: 4,
  SAND: 5,
  DIRT: 6,
  WOOD: 7,
  LEAVES: 8,
  SNOW: 9,
  DRY_GRASS: 10,
  ICE: 11,
  CAVE_STONE: 12,
  SNOW_MOUNTAIN: 13,
  ROCK_MOUNTAIN: 14,
  FOREST_MOUNTAIN: 15,
  BIRCH_WOOD: 16,
  CACTUS: 17,
  TNT: 18,
  CRAFTING_TABLE: 19,
  STONE_SLAB: 20,
  STEEL_BLOCK: 21,
  BRICK: 22,
  GLASS: 23,
  CONCRETE: 24,
  WOOD_PLANKS: 25,
  ROOF_TILES: 26,
  COBBLESTONE: 27,
  SANDSTONE: 28,
  QUARTZ: 29,
  LAMP: 30,
  METAL_PANEL: 31,
  SNOW_LOTUS: 32,
  WATER_FLOW_DECOR: 33,
  MARBLE: 34,
  DARK_STONE: 35,
  TERRACOTTA: 36,
  COPPER_PANEL: 37,
  BLACK_GLASS: 38,
  BLUE_ROOF_TILES: 39,
  BAMBOO: 40,
  WHITE_WALL: 41,
});

export const DEFAULT_BLOCK_PALETTE = Object.freeze({
  [BLOCK_IDS.GRASS]: { name: 'grass', color: 0x4fb06d, opaque: true },
  [BLOCK_IDS.WATER]: { name: 'water', color: 0x3d8fd8, opaque: false, render: false },
  [BLOCK_IDS.DIRT]: { name: 'dirt', color: 0x8a5a34, opaque: true },
  [BLOCK_IDS.STONE]: { name: 'stone', color: 0x8e9391, opaque: true },
  [BLOCK_IDS.LAVA]: { name: 'lava', color: 0xff5a18, opaque: false, render: false },
  [BLOCK_IDS.WOOD]: { name: 'wood', color: 0x8b5a2b, opaque: true },
  [BLOCK_IDS.LEAVES]: { name: 'leaves', color: 0x2f8f4e, opaque: true },
  [BLOCK_IDS.SAND]: { name: 'sand', color: 0xd9bf78, opaque: true },
  [BLOCK_IDS.DRY_GRASS]: { name: 'dry grass', color: 0x9d9a55, opaque: true },
  [BLOCK_IDS.SNOW]: { name: 'snow', color: 0xeef6f3, opaque: true },
  [BLOCK_IDS.ICE]: { name: 'ice', color: 0x9fd8e8, opaque: true },
  [BLOCK_IDS.CAVE_STONE]: { name: 'cave stone', color: 0x4e5453, opaque: true },
  [BLOCK_IDS.SNOW_MOUNTAIN]: { name: 'snow mountain', color: 0xf4fbf8, opaque: true },
  [BLOCK_IDS.ROCK_MOUNTAIN]: { name: 'rock mountain', color: 0x6f7674, opaque: true },
  [BLOCK_IDS.FOREST_MOUNTAIN]: { name: 'forest high mountain', color: 0x3f7f55, opaque: true },
  [BLOCK_IDS.BIRCH_WOOD]: { name: 'birch wood', color: 0xf3eee1, opaque: true },
  [BLOCK_IDS.CACTUS]: { name: 'cactus', color: 0x3f8f55, opaque: true },
  [BLOCK_IDS.TNT]: { name: 'TNT', color: 0xc8332b, opaque: true },
  [BLOCK_IDS.CRAFTING_TABLE]: { name: 'crafting table', color: 0x9c6a32, opaque: true },
  [BLOCK_IDS.STONE_SLAB]: { name: 'stone slab', color: 0x9aa09d, opaque: true },
  [BLOCK_IDS.STEEL_BLOCK]: { name: 'steel block', color: 0xaeb8bd, opaque: true },
  [BLOCK_IDS.BRICK]: { name: 'brick', color: 0xac6a53, opaque: true },
  // Chunk meshes use one opaque material. Treat glass as solid so neighbouring
  // blocks do not expose their internal faces and make buildings look see-through.
  [BLOCK_IDS.GLASS]: { name: 'glass', color: 0x8bd8ea, opaque: true },
  [BLOCK_IDS.CONCRETE]: { name: 'concrete', color: 0xb7bdc0, opaque: true },
  [BLOCK_IDS.WOOD_PLANKS]: { name: 'wood planks', color: 0x9b613a, opaque: true },
  [BLOCK_IDS.ROOF_TILES]: { name: 'roof tiles', color: 0x813f35, opaque: true },
  [BLOCK_IDS.COBBLESTONE]: { name: 'cobblestone', color: 0x6f7475, opaque: true },
  [BLOCK_IDS.SANDSTONE]: { name: 'sandstone', color: 0xd3ae72, opaque: true },
  [BLOCK_IDS.QUARTZ]: { name: 'quartz', color: 0xe8e7df, opaque: true },
  [BLOCK_IDS.LAMP]: { name: 'lamp', color: 0xffd36a, opaque: true },
  [BLOCK_IDS.METAL_PANEL]: { name: 'metal panel', color: 0x8fa0aa, opaque: true },
  [BLOCK_IDS.SNOW_LOTUS]: { name: 'snow lotus block', color: 0xd6f4ff, opaque: true },
  [BLOCK_IDS.WATER_FLOW_DECOR]: { name: 'flowing water decor', color: 0x4aaee8, opaque: true },
  [BLOCK_IDS.MARBLE]: { name: 'marble', color: 0xe8e3d8, opaque: true },
  [BLOCK_IDS.DARK_STONE]: { name: 'dark stone', color: 0x34383d, opaque: true },
  [BLOCK_IDS.TERRACOTTA]: { name: 'terracotta', color: 0xb76045, opaque: true },
  [BLOCK_IDS.COPPER_PANEL]: { name: 'copper panel', color: 0xb66f45, opaque: true },
  [BLOCK_IDS.BLACK_GLASS]: { name: 'black glass', color: 0x26313a, opaque: true },
  [BLOCK_IDS.BLUE_ROOF_TILES]: { name: 'blue roof tiles', color: 0x3f6fa1, opaque: true },
  [BLOCK_IDS.BAMBOO]: { name: 'bamboo', color: 0xb2a94a, opaque: true },
  [BLOCK_IDS.WHITE_WALL]: { name: 'white wall', color: 0xe9ebe4, opaque: true },
});

const BUILDING_TEXTURE_KINDS = Object.freeze([
  'brick',
  'glass',
  'concrete',
  'planks',
  'roof',
  'cobble',
  'sandstone',
  'quartz',
  'lamp',
  'metal',
  'snowLotus',
  'waterFlow',
  'marble',
  'darkStone',
  'terracotta',
  'copper',
  'blackGlass',
  'blueRoof',
  'bamboo',
  'whiteWall',
]);

function createBlockTexture(textureUrl) {
  const texture = new THREE.TextureLoader().load(textureUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = 8;

  return texture;
}

function createBuildingTexture(kind) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const size = 96;

  canvas.width = size;
  canvas.height = size;
  context.imageSmoothingEnabled = false;

  const fillNoise = (base, variance, seed) => {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);

    for (let index = 0; index < 340; index += 1) {
      const value = (Math.imul(index + seed, 1103515245) >>> 0) % 100;
      const offset = Math.round((value / 100 - 0.5) * variance);
      const x = (Math.imul(index + seed, 37) >>> 0) % size;
      const y = (Math.imul(index + seed, 71) >>> 0) % size;
      const shade = Math.max(0, Math.min(255, 144 + offset));

      context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.12)`;
      context.fillRect(x, y, 2, 2);
    }
  };

  if (kind === 'brick') {
    context.fillStyle = '#875042';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#d3aa93';

    for (let y = 0; y < size; y += 16) {
      context.fillRect(0, y, size, 2);
      const offset = (y / 16) % 2 === 0 ? -8 : 8;

      for (let x = offset; x < size; x += 24) {
        context.fillRect(x, y, 2, 16);
      }
    }
  } else if (kind === 'glass') {
    context.fillStyle = '#66b9d2';
    context.fillRect(0, 0, size, size);
    context.fillStyle = 'rgba(235, 255, 255, 0.72)';
    context.fillRect(7, 7, 3, 82);
    context.fillRect(7, 7, 82, 3);
    context.fillStyle = 'rgba(17, 80, 105, 0.55)';
    context.fillRect(45, 0, 4, size);
    context.fillRect(0, 45, size, 4);
    context.fillStyle = 'rgba(255, 255, 255, 0.42)';
    context.fillRect(13, 13, 25, 8);
  } else if (kind === 'planks') {
    context.fillStyle = '#83502e';
    context.fillRect(0, 0, size, size);

    for (let y = 0; y < size; y += 19) {
      context.fillStyle = '#4e2d1e';
      context.fillRect(0, y, size, 3);
      context.fillStyle = 'rgba(239, 182, 112, 0.28)';
      context.fillRect(0, y + 5, size, 2);

      for (let x = (y / 19) % 2 === 0 ? 8 : 31; x < size; x += 35) {
        context.fillStyle = '#4e2d1e';
        context.fillRect(x, y, 3, 19);
      }
    }
  } else if (kind === 'roof') {
    context.fillStyle = '#71382f';
    context.fillRect(0, 0, size, size);

    for (let y = -4; y < size; y += 16) {
      const offset = (y / 16) % 2 === 0 ? 0 : 12;

      for (let x = offset - 12; x < size; x += 24) {
        context.fillStyle = '#a95443';
        context.fillRect(x + 2, y + 2, 20, 13);
        context.fillStyle = 'rgba(255, 207, 164, 0.22)';
        context.fillRect(x + 4, y + 4, 16, 2);
        context.fillStyle = '#4f2926';
        context.fillRect(x, y + 14, 24, 3);
      }
    }
  } else if (kind === 'cobble') {
    context.fillStyle = '#4f575c';
    context.fillRect(0, 0, size, size);

    for (let y = 2; y < size; y += 22) {
      const offset = (y / 22) % 2 === 0 ? 2 : 12;

      for (let x = offset; x < size; x += 26) {
        context.fillStyle = '#7c8587';
        context.fillRect(x, y, 19, 15);
        context.fillStyle = '#a7afb0';
        context.fillRect(x + 3, y + 2, 12, 3);
        context.fillStyle = '#333b40';
        context.fillRect(x + 19, y + 2, 3, 15);
        context.fillRect(x + 2, y + 15, 19, 3);
      }
    }
  } else if (kind === 'sandstone') {
    context.fillStyle = '#c79556';
    context.fillRect(0, 0, size, size);
    context.fillStyle = 'rgba(255, 232, 176, 0.42)';

    for (let y = 4; y < size; y += 18) {
      context.fillRect(0, y, size, 3);
    }

    context.fillStyle = 'rgba(102, 67, 34, 0.28)';

    for (let x = 11; x < size; x += 27) {
      context.fillRect(x, 0, 2, size);
    }
  } else if (kind === 'quartz') {
    context.fillStyle = '#dfe3df';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#aeb7b1';
    context.fillRect(0, 46, size, 3);
    context.fillRect(46, 0, 3, size);
    context.fillStyle = 'rgba(255, 255, 255, 0.72)';
    context.fillRect(7, 7, 32, 6);
    context.fillRect(56, 56, 29, 6);
  } else if (kind === 'lamp') {
    context.fillStyle = '#303a42';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#63717a';
    context.fillRect(11, 11, 74, 74);
    context.fillStyle = '#1d262b';
    context.fillRect(17, 17, 62, 62);
    context.fillStyle = '#ffd45a';
    context.fillRect(26, 26, 44, 44);
    context.fillStyle = '#fff2ae';
    context.fillRect(35, 32, 26, 26);
  } else if (kind === 'metal') {
    context.fillStyle = '#71828d';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#41505a';

    for (let x = 0; x < size; x += 24) {
      context.fillRect(x, 0, 4, size);
      context.fillStyle = '#aebdc3';
      context.fillRect(x + 4, 0, 3, size);
      context.fillStyle = '#41505a';
    }

    context.fillStyle = '#25323a';
    [16, 72].forEach((x) => {
      [16, 72].forEach((y) => context.fillRect(x, y, 5, 5));
    });
  } else if (kind === 'snowLotus') {
    context.fillStyle = '#d9f1fb';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#a8d7e8';

    for (let y = 0; y < size; y += 16) {
      context.fillRect(0, y, size, 2);
    }

    for (let y = 12; y < size; y += 32) {
      for (let x = 12; x < size; x += 32) {
        context.fillStyle = '#eefcff';
        context.fillRect(x + 6, y, 8, 24);
        context.fillRect(x, y + 8, 24, 8);
        context.fillStyle = '#b7ecff';
        context.fillRect(x + 3, y + 3, 18, 18);
        context.fillStyle = '#f7f6a4';
        context.fillRect(x + 9, y + 9, 6, 6);
      }
    }
  } else if (kind === 'waterFlow') {
    context.fillStyle = '#2f8fd0';
    context.fillRect(0, 0, size, size);

    for (let y = -10; y < size; y += 18) {
      context.fillStyle = '#79d8ff';
      context.fillRect(0, y, size, 5);
      context.fillStyle = 'rgba(255, 255, 255, 0.46)';
      context.fillRect(10, y + 6, 27, 3);
      context.fillRect(55, y + 10, 25, 3);
    }

    context.fillStyle = 'rgba(10, 56, 112, 0.38)';
    context.fillRect(0, 0, 5, size);
    context.fillRect(size - 5, 0, 5, size);
  } else if (kind === 'marble') {
    context.fillStyle = '#dfddd5';
    context.fillRect(0, 0, size, size);
    context.strokeStyle = 'rgba(120, 125, 124, 0.42)';
    context.lineWidth = 3;
    for (let index = 0; index < 7; index += 1) {
      context.beginPath();
      context.moveTo(-8, index * 17 + 6);
      context.bezierCurveTo(24, index * 12, 45, index * 22 + 9, size + 8, index * 14 + 2);
      context.stroke();
    }
    context.fillStyle = 'rgba(255, 255, 255, 0.46)';
    context.fillRect(8, 8, 42, 5);
  } else if (kind === 'darkStone') {
    fillNoise('#30363d', 26, 31);
    context.fillStyle = 'rgba(165, 176, 184, 0.22)';
    for (let y = 10; y < size; y += 22) {
      context.fillRect(0, y, size, 2);
    }
  } else if (kind === 'terracotta') {
    fillNoise('#aa573f', 38, 43);
    context.fillStyle = 'rgba(91, 39, 29, 0.34)';
    for (let y = 0; y < size; y += 18) {
      context.fillRect(0, y, size, 3);
    }
    context.fillStyle = 'rgba(237, 156, 103, 0.24)';
    context.fillRect(9, 9, 78, 4);
  } else if (kind === 'copper') {
    context.fillStyle = '#a7653f';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#d19062';
    for (let x = 4; x < size; x += 24) {
      context.fillRect(x, 0, 5, size);
    }
    context.fillStyle = 'rgba(70, 185, 148, 0.42)';
    context.fillRect(12, 14, 24, 5);
    context.fillRect(52, 58, 29, 5);
  } else if (kind === 'blackGlass') {
    context.fillStyle = '#1b2630';
    context.fillRect(0, 0, size, size);
    context.fillStyle = 'rgba(121, 178, 204, 0.48)';
    context.fillRect(9, 9, 78, 3);
    context.fillRect(9, 9, 3, 78);
    context.fillStyle = 'rgba(255, 255, 255, 0.28)';
    context.fillRect(18, 16, 30, 6);
  } else if (kind === 'blueRoof') {
    context.fillStyle = '#315f8f';
    context.fillRect(0, 0, size, size);
    for (let y = -4; y < size; y += 16) {
      const offset = (y / 16) % 2 === 0 ? 0 : 12;
      for (let x = offset - 12; x < size; x += 24) {
        context.fillStyle = '#4c83ba';
        context.fillRect(x + 2, y + 2, 20, 13);
        context.fillStyle = '#203f68';
        context.fillRect(x, y + 14, 24, 3);
      }
    }
  } else if (kind === 'bamboo') {
    context.fillStyle = '#9b9139';
    context.fillRect(0, 0, size, size);
    for (let x = 6; x < size; x += 20) {
      context.fillStyle = '#c4bc58';
      context.fillRect(x, 0, 9, size);
      context.fillStyle = '#5d6b2b';
      for (let y = 9; y < size; y += 20) {
        context.fillRect(x - 2, y, 13, 3);
      }
    }
  } else if (kind === 'whiteWall') {
    fillNoise('#e4e6dd', 18, 59);
    context.fillStyle = 'rgba(172, 176, 169, 0.35)';
    context.fillRect(0, 46, size, 2);
    context.fillRect(46, 0, 2, size);
  } else {
    fillNoise('#a7adb0', 34, 17);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipMapNearestFilter;
  texture.anisotropy = 4;

  return texture;
}

function createBuildingTextureAtlas() {
  const kinds = BUILDING_TEXTURE_KINDS;
  const tileSize = 96;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = tileSize * kinds.length;
  canvas.height = tileSize;
  context.imageSmoothingEnabled = false;

  const sourceTextures = kinds.map((kind) => createBuildingTexture(kind));
  sourceTextures.forEach((texture, index) => {
    context.drawImage(texture.image, index * tileSize, 0);
    texture.dispose();
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipMapNearestFilter;
  texture.anisotropy = 4;

  return texture;
}

function normalizeCustomBlockTextureDataUrl(value) {
  const text = String(value ?? '').trim();

  return /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(text) ? text : '';
}

function createCustomBlockTextureAtlas(customBlocks = []) {
  const blocks = Array.isArray(customBlocks)
    ? customBlocks
      .filter((block) => block && Number.isInteger(Number(block.blockId)))
      .slice()
      .sort((left, right) => Math.trunc(Number(left.blockId)) - Math.trunc(Number(right.blockId)))
    : [];
  const count = Math.max(1, blocks.length);
  const tileSize = 96;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = tileSize * count;
  canvas.height = tileSize;
  context.imageSmoothingEnabled = false;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.anisotropy = 4;

  const fillPlaceholder = (index, block) => {
    const color = Number.isFinite(Number(block?.color)) ? Math.trunc(Number(block.color)) : 0xd8d0c5;
    const red = (color >> 16) & 0xff;
    const green = (color >> 8) & 0xff;
    const blue = color & 0xff;

    context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    context.fillRect(index * tileSize, 0, tileSize, tileSize);
    context.fillStyle = 'rgba(255, 255, 255, 0.18)';
    context.fillRect(index * tileSize + 8, 8, tileSize - 16, 10);
    context.fillStyle = 'rgba(0, 0, 0, 0.12)';
    context.fillRect(index * tileSize, tileSize - 10, tileSize, 10);
  };

  blocks.forEach((block, index) => {
    fillPlaceholder(index, block);
    const textureDataUrl = normalizeCustomBlockTextureDataUrl(block.textureDataUrl);

    if (!textureDataUrl) {
      return;
    }

    const image = new Image();
    image.onload = () => {
      context.clearRect(index * tileSize, 0, tileSize, tileSize);
      context.drawImage(image, index * tileSize, 0, tileSize, tileSize);
      texture.needsUpdate = true;
    };
    image.onerror = () => {
      texture.needsUpdate = true;
    };
    image.src = textureDataUrl;
  });

  if (!blocks.length) {
    fillPlaceholder(0, { color: 0xffffff });
  }

  texture.userData.customBlocks = blocks;
  texture.userData.tileSize = tileSize;

  return {
    texture,
    count,
    blocks,
  };
}

function createChunkMaterial({ customBlocks = [] } = {}) {
  const grassTexture = createBlockTexture(GRASS_TEXTURE_URL);
  const snowTexture = createBlockTexture(SNOW_TEXTURE_URL);
  const snowMountainTexture = createBlockTexture(SNOW_MOUNTAIN_TEXTURE_URL);
  const rockMountainTexture = createBlockTexture(ROCK_MOUNTAIN_TEXTURE_URL);
  const forestMountainTexture = createBlockTexture(FOREST_MOUNTAIN_TEXTURE_URL);
  const caveTexture = createBlockTexture(CAVE_TEXTURE_URL);
  const leafTexture = createBlockTexture(LEAF_TEXTURE_URL);
  const buildingTextureAtlas = createBuildingTextureAtlas();
  const customBlockTextureAtlas = createCustomBlockTextureAtlas(customBlocks);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: snowTexture,
    roughness: 0.72,
    metalness: 0.02,
  });

  material.userData.extraTextures = [
    grassTexture,
    snowMountainTexture,
    rockMountainTexture,
    forestMountainTexture,
    caveTexture,
    leafTexture,
    buildingTextureAtlas,
    customBlockTextureAtlas.texture,
  ];

  material.onBeforeCompile = (shader) => {
    shader.uniforms.grassMap = { value: grassTexture };
    shader.uniforms.snowMountainMap = { value: snowMountainTexture };
    shader.uniforms.rockMountainMap = { value: rockMountainTexture };
    shader.uniforms.forestMountainMap = { value: forestMountainTexture };
    shader.uniforms.caveMap = { value: caveTexture };
    shader.uniforms.leafMap = { value: leafTexture };
    shader.uniforms.buildingMap = { value: buildingTextureAtlas };
    shader.uniforms.customBlockMap = { value: customBlockTextureAtlas.texture };
    shader.uniforms.customBlockCount = { value: Math.max(1, customBlockTextureAtlas.count) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'attribute float instanceBlockId;',
          'varying float vInstanceBlockId;',
          'attribute float instanceCustomTextureIndex;',
          'varying float vInstanceCustomTextureIndex;',
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vInstanceBlockId = instanceBlockId;',
          'vInstanceCustomTextureIndex = instanceCustomTextureIndex;',
        ].join('\n'),
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying float vInstanceBlockId;',
          'uniform sampler2D grassMap;',
          'uniform sampler2D snowMountainMap;',
          'uniform sampler2D rockMountainMap;',
          'uniform sampler2D forestMountainMap;',
          'uniform sampler2D caveMap;',
          'uniform sampler2D leafMap;',
          'uniform sampler2D buildingMap;',
          'uniform sampler2D customBlockMap;',
          'uniform float customBlockCount;',
          'varying float vInstanceCustomTextureIndex;',
        ].join('\n'),
      )
      .replace(
        '#include <map_fragment>',
        [
          '#ifdef USE_MAP',
          '  vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
          '  #ifdef DECODE_VIDEO_TEXTURE',
          '    sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );',
          '  #endif',
          '  vec4 grassDiffuseColor = texture2D( grassMap, vMapUv );',
          '  vec4 snowMountainDiffuseColor = texture2D( snowMountainMap, vMapUv );',
          '  vec4 rockMountainDiffuseColor = texture2D( rockMountainMap, vMapUv );',
          '  vec4 forestMountainDiffuseColor = texture2D( forestMountainMap, vMapUv );',
          '  vec4 caveDiffuseColor = texture2D( caveMap, vMapUv );',
          '  vec4 leafDiffuseColor = texture2D( leafMap, vMapUv );',
          `  float snowTextureMix = max(1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.SNOW}.0), 1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.ICE}.0));`,
          '  snowTextureMix = clamp(snowTextureMix, 0.0, 1.0);',
          `  float grassTextureMix = max(1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.GRASS}.0), 1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.DRY_GRASS}.0));`,
          `  grassTextureMix = max(grassTextureMix, 1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.FOREST_MOUNTAIN}.0));`,
          '  grassTextureMix = clamp(grassTextureMix, 0.0, 1.0);',
          `  float caveTextureMix = clamp(1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.CAVE_STONE}.0), 0.0, 1.0);`,
          `  float snowMountainTextureMix = clamp(1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.SNOW_MOUNTAIN}.0), 0.0, 1.0);`,
          `  float rockMountainTextureMix = clamp(1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.ROCK_MOUNTAIN}.0), 0.0, 1.0);`,
          `  float forestMountainTextureMix = clamp(1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.FOREST_MOUNTAIN}.0), 0.0, 1.0);`,
          `  float leafTextureMix = clamp(1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.LEAVES}.0), 0.0, 1.0);`,
          `  float buildingTextureMix = step(${BLOCK_IDS.BRICK}.0, vInstanceBlockId) * step(vInstanceBlockId, ${BLOCK_IDS.WHITE_WALL}.0);`,
          `  buildingTextureMix = max(buildingTextureMix, 1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.WOOD}.0));`,
          `  buildingTextureMix = max(buildingTextureMix, 1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.STEEL_BLOCK}.0));`,
          '  float customBlockMix = step(1000.0, vInstanceBlockId) * step(vInstanceBlockId, 60000.0);',
          '  buildingTextureMix *= 1.0 - customBlockMix;',
          `  float buildingTile = vInstanceBlockId - ${BLOCK_IDS.BRICK}.0;`,
          `  buildingTile = mix(buildingTile, 3.0, clamp(1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.WOOD}.0), 0.0, 1.0));`,
          `  buildingTile = mix(buildingTile, 9.0, clamp(1.0 - abs(vInstanceBlockId - ${BLOCK_IDS.STEEL_BLOCK}.0), 0.0, 1.0));`,
          `  vec2 buildingUv = vec2((vMapUv.x + buildingTile) / ${BUILDING_TEXTURE_KINDS.length}.0, vMapUv.y);`,
          '  vec4 buildingDiffuseColor = texture2D( buildingMap, buildingUv );',
          '  float customTextureMix = customBlockMix * step(0.0, vInstanceCustomTextureIndex) * step(vInstanceCustomTextureIndex, customBlockCount - 1.0);',
          '  vec2 customBlockUv = vec2((vMapUv.x + vInstanceCustomTextureIndex) / customBlockCount, vMapUv.y);',
          '  vec4 customBlockDiffuseColor = texture2D( customBlockMap, customBlockUv );',
          '  vec4 terrainDiffuseColor = mix(vec4(1.0), sampledDiffuseColor, snowTextureMix);',
          '  terrainDiffuseColor = mix(terrainDiffuseColor, grassDiffuseColor, grassTextureMix);',
          '  terrainDiffuseColor = mix(terrainDiffuseColor, caveDiffuseColor, caveTextureMix);',
          '  terrainDiffuseColor = mix(terrainDiffuseColor, snowMountainDiffuseColor, snowMountainTextureMix);',
          '  terrainDiffuseColor = mix(terrainDiffuseColor, rockMountainDiffuseColor, rockMountainTextureMix);',
          '  terrainDiffuseColor = mix(terrainDiffuseColor, forestMountainDiffuseColor, forestMountainTextureMix);',
          '  terrainDiffuseColor = mix(terrainDiffuseColor, leafDiffuseColor, leafTextureMix);',
          '  terrainDiffuseColor = mix(terrainDiffuseColor, buildingDiffuseColor, buildingTextureMix);',
          '  terrainDiffuseColor = mix(terrainDiffuseColor, customBlockDiffuseColor, customTextureMix);',
          '  terrainDiffuseColor = mix(terrainDiffuseColor, vec4(1.0), customBlockMix * (1.0 - customTextureMix));',
          '  diffuseColor *= terrainDiffuseColor;',
          '#endif',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => `chunk-terrain-building-atlas-v3-${customBlockTextureAtlas.count}`;

  return material;
}

function normalizeSize(size) {
  if (typeof size === 'number') {
    return { x: size, y: size, z: size };
  }

  return {
    x: size?.x ?? CHUNK_SIZE,
    y: size?.y ?? CHUNK_HEIGHT,
    z: size?.z ?? CHUNK_SIZE,
  };
}

export class Chunk {
  constructor({
    size = { x: CHUNK_SIZE, y: CHUNK_HEIGHT, z: CHUNK_SIZE },
    blockSize = 1,
    position = new THREE.Vector3(),
    palette = DEFAULT_BLOCK_PALETTE,
    biomeId = 0,
    lod = 0,
    customBlocks = [],
    geometry = null,
    material = null,
  } = {}) {
    this.size = normalizeSize(size);
    this.blockSize = blockSize;
    this.position = position.clone();
    this.palette = Object.fromEntries(
      Object.entries(palette).map(([blockId, definition]) => [blockId, { ...definition }]),
    );
    this.lod = lod;
    this.customBlocks = Array.isArray(customBlocks) ? customBlocks.slice() : [];

    this.volume = this.size.x * this.size.y * this.size.z;
    this.blocks = new Uint16Array(this.volume);
    this.light = new Uint8Array(this.volume);
    this.biomes = new Uint8Array(this.size.x * this.size.z);
    this.biomes.fill(biomeId);

    this.geometry = geometry ?? new THREE.BoxGeometry(1, 1, 1);
    this.material = material ?? createChunkMaterial({ customBlocks: this.customBlocks });
    this.ownsGeometry = geometry === null;
    this.ownsMaterial = material === null;
    this.mesh = null;
    this.dirty = true;

    this._matrix = new THREE.Matrix4();
    this._color = new THREE.Color();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3(1, 1, 1);
    this.instanceBlockIds = new Float32Array(this.volume);
    this.instanceBlockIdAttribute = null;
    this.instanceCustomTextureIndices = new Float32Array(this.volume);
    this.instanceCustomTextureIndexAttribute = null;
  }

  getRenderStep() {
    return Math.max(1, 2 ** this.lod);
  }

  contains(x, y, z) {
    return (
      x >= 0 && x < this.size.x &&
      y >= 0 && y < this.size.y &&
      z >= 0 && z < this.size.z
    );
  }

  getIndex(x, y, z) {
    return x + this.size.x * (z + this.size.z * y);
  }

  getColumnIndex(x, z) {
    return x + this.size.x * z;
  }

  getBlock(x, y, z) {
    if (!this.contains(x, y, z)) {
      return BLOCK_IDS.AIR;
    }

    return this.blocks[this.getIndex(x, y, z)];
  }

  setBlock(x, y, z, blockId) {
    if (!this.contains(x, y, z)) {
      return false;
    }

    const index = this.getIndex(x, y, z);
    this.blocks[index] = blockId;
    this.dirty = true;

    return true;
  }

  getBiome(x, z) {
    if (x < 0 || x >= this.size.x || z < 0 || z >= this.size.z) {
      return 0;
    }

    return this.biomes[this.getColumnIndex(x, z)];
  }

  setBiome(x, z, biomeId) {
    if (x < 0 || x >= this.size.x || z < 0 || z >= this.size.z) {
      return false;
    }

    this.biomes[this.getColumnIndex(x, z)] = biomeId;
    this.dirty = true;

    return true;
  }

  getLight(x, y, z) {
    if (!this.contains(x, y, z)) {
      return 0;
    }

    return this.light[this.getIndex(x, y, z)];
  }

  setLight(x, y, z, lightLevel) {
    if (!this.contains(x, y, z)) {
      return false;
    }

    this.light[this.getIndex(x, y, z)] = lightLevel;
    this.dirty = true;

    return true;
  }

  setLOD(lod) {
    this.lod = Math.max(0, lod);
    this.dirty = true;
  }

  buildMesh() {
    if (this.mesh) {
      return this.mesh;
    }

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.volume);
    this.mesh.name = `Chunk(${this.position.x}, ${this.position.y}, ${this.position.z})`;
    this.mesh.position.copy(this.position);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instanceBlockIdAttribute = new THREE.InstancedBufferAttribute(this.instanceBlockIds, 1);
    this.instanceBlockIdAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instanceBlockId', this.instanceBlockIdAttribute);
    this.instanceCustomTextureIndexAttribute = new THREE.InstancedBufferAttribute(this.instanceCustomTextureIndices, 1);
    this.instanceCustomTextureIndexAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instanceCustomTextureIndex', this.instanceCustomTextureIndexAttribute);

    this.updateMesh();

    return this.mesh;
  }

  updateMesh() {
    if (!this.mesh) {
      return this.buildMesh();
    }

    const step = this.getRenderStep();
    let instanceIndex = 0;

    for (let y = 0; y < this.size.y; y += step) {
      for (let z = 0; z < this.size.z; z += step) {
        for (let x = 0; x < this.size.x; x += step) {
          const blockId = this.getBlock(x, y, z);

          if (!this.isRenderable(blockId) || !this.hasVisibleFace(x, y, z, step)) {
            continue;
          }

          this.writeInstance(instanceIndex, x, y, z, blockId, step);
          instanceIndex += 1;
        }
      }
    }

    this.mesh.count = instanceIndex;
    this.mesh.instanceMatrix.needsUpdate = true;

    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }

    if (this.instanceBlockIdAttribute) {
      this.instanceBlockIdAttribute.needsUpdate = true;
    }

    if (this.instanceCustomTextureIndexAttribute) {
      this.instanceCustomTextureIndexAttribute.needsUpdate = true;
    }

    this.dirty = false;

    return this.mesh;
  }

  hasVisibleFace(x, y, z, step = 1) {
    return (
      this.isTransparent(x - step, y, z) ||
      this.isTransparent(x + step, y, z) ||
      this.isTransparent(x, y - step, z) ||
      this.isTransparent(x, y + step, z) ||
      this.isTransparent(x, y, z - step) ||
      this.isTransparent(x, y, z + step)
    );
  }

  isTransparent(x, y, z) {
    const blockId = this.getBlock(x, y, z);
    const blockType = this.palette[blockId];

    return blockId === BLOCK_IDS.AIR || blockType?.opaque === false;
  }

  isRenderable(blockId) {
    const blockType = this.palette[blockId];

    return blockId !== BLOCK_IDS.AIR && blockType?.render !== false;
  }

  setCustomBlocks(customBlocks = []) {
    this.customBlocks = Array.isArray(customBlocks) ? customBlocks.slice() : [];

    if (this.ownsMaterial && this.material) {
      this.material.map?.dispose();
      this.material.userData.extraTextures?.forEach((texture) => texture.dispose());
      this.material.dispose();
    }

    this.material = createChunkMaterial({ customBlocks: this.customBlocks });
    this.ownsMaterial = true;

    if (this.mesh) {
      this.mesh.material = this.material;
    }

    this.dirty = true;
    return this.material;
  }

  writeInstance(instanceIndex, x, y, z, blockId, step) {
    const scale = this.blockSize * step;
    const localX = (x + (step - 1) / 2 - (this.size.x - 1) / 2) * this.blockSize;
    const localY = (y + (step - 1) / 2) * this.blockSize;
    const localZ = (z + (step - 1) / 2 - (this.size.z - 1) / 2) * this.blockSize;

    this._position.set(localX, localY, localZ);
    this._scale.set(scale, scale, scale);
    this._matrix.compose(this._position, this._quaternion, this._scale);
    this.mesh.setMatrixAt(instanceIndex, this._matrix);
    this.instanceBlockIds[instanceIndex] = blockId;
    this.instanceCustomTextureIndices[instanceIndex] = Number(this.palette[blockId]?.customTextureIndex ?? -1);

    this._color.setHex(this.palette[blockId]?.color ?? 0xff00ff);
    this.applyLightToColor(this._color, x, y, z);
    this.mesh.setColorAt(instanceIndex, this._color);
  }

  applyLightToColor(color, x, y, z) {
    const storedLight = this.getLight(x, y, z);
    const heightLight = 0.55 + 0.45 * (y / Math.max(1, this.size.y - 1));
    const lightScale = storedLight > 0 ? storedLight / 255 : heightLight;

    color.multiplyScalar(lightScale);
  }

  dispose() {
    if (this.mesh?.parent) {
      this.mesh.parent.remove(this.mesh);
    }

    if (this.ownsGeometry) {
      this.geometry.dispose();
    }

    if (this.ownsMaterial) {
      this.material.map?.dispose();
      this.material.userData.extraTextures?.forEach((texture) => texture.dispose());
      this.material.dispose();
    }

    this.mesh = null;
  }
}
