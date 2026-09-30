import * as THREE from 'three';

const GRASS_TEXTURE_URL = '/assets/textwatercaodi.png';

function getLocalPosition(chunk, x, y, z) {
  return new THREE.Vector3(
    (x - (chunk.size.x - 1) / 2) * chunk.blockSize,
    y * chunk.blockSize,
    (z - (chunk.size.z - 1) / 2) * chunk.blockSize,
  );
}

function createTexture(textureUrl) {
  const texture = new THREE.TextureLoader().load(textureUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = 8;

  return texture;
}

function createGrassMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x2f9b53,
    map: createTexture(GRASS_TEXTURE_URL),
    roughness: 0.82,
    metalness: 0,
  });
}

function createRockMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x777c78,
    roughness: 0.9,
    metalness: 0.01,
  });
}

function createSnowdriftMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xf2f7f4,
    roughness: 0.95,
    metalness: 0,
  });
}

export class SurfaceDetails {
  constructor({ chunk, grassTufts = [], rocks = [], snowdrifts = [] }) {
    this.chunk = chunk;
    this.grassTufts = grassTufts;
    this.rocks = rocks;
    this.snowdrifts = snowdrifts;
    this.group = new THREE.Group();
    this.group.name = 'SurfaceDetails';
    this.group.position.copy(chunk.position);

    this.grassGeometry = new THREE.ConeGeometry(0.08, 0.58, 5);
    this.rockGeometry = new THREE.DodecahedronGeometry(0.38, 0);
    this.snowdriftGeometry = new THREE.SphereGeometry(0.5, 8, 5);
    this.grassMaterial = createGrassMaterial();
    this.rockMaterial = createRockMaterial();
    this.snowdriftMaterial = createSnowdriftMaterial();
    this.grassMesh = null;
    this.rockMesh = null;
    this.snowdriftMesh = null;

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._rotation = new THREE.Euler();
    this._scale = new THREE.Vector3();
  }

  buildGroup() {
    this.createGrassMesh();
    this.createRockMesh();
    this.createSnowdriftMesh();

    return this.group;
  }

  createGrassMesh() {
    if (this.grassTufts.length === 0) {
      return;
    }

    this.grassMesh = new THREE.InstancedMesh(this.grassGeometry, this.grassMaterial, this.grassTufts.length);
    this.grassMesh.name = 'GrassTufts';
    this.grassMesh.castShadow = true;
    this.grassMesh.receiveShadow = true;

    this.writeInstances(this.grassMesh, this.grassTufts, (tuft) => ({
      position: getLocalPosition(
        this.chunk,
        tuft.x + tuft.offsetX,
        tuft.y + 0.5 + 0.29 * tuft.height,
        tuft.z + tuft.offsetZ,
      ),
      rotation: [tuft.tiltX, tuft.rotationY, tuft.tiltZ],
      scale: [tuft.width, tuft.height, tuft.width],
    }));

    this.group.add(this.grassMesh);
  }

  createRockMesh() {
    if (this.rocks.length === 0) {
      return;
    }

    this.rockMesh = new THREE.InstancedMesh(this.rockGeometry, this.rockMaterial, this.rocks.length);
    this.rockMesh.name = 'Rocks';
    this.rockMesh.castShadow = true;
    this.rockMesh.receiveShadow = true;

    this.writeInstances(this.rockMesh, this.rocks, (rock) => ({
      position: getLocalPosition(
        this.chunk,
        rock.x + rock.offsetX,
        rock.y + 0.5 + 0.38 * rock.scaleY,
        rock.z + rock.offsetZ,
      ),
      rotation: [rock.rotationX, rock.rotationY, rock.rotationZ],
      scale: [rock.scaleX, rock.scaleY, rock.scaleZ],
    }));

    this.group.add(this.rockMesh);
  }

  createSnowdriftMesh() {
    if (this.snowdrifts.length === 0) {
      return;
    }

    this.snowdriftMesh = new THREE.InstancedMesh(
      this.snowdriftGeometry,
      this.snowdriftMaterial,
      this.snowdrifts.length,
    );
    this.snowdriftMesh.name = 'Snowdrifts';
    this.snowdriftMesh.castShadow = true;
    this.snowdriftMesh.receiveShadow = true;

    this.writeInstances(this.snowdriftMesh, this.snowdrifts, (drift) => ({
      position: getLocalPosition(
        this.chunk,
        drift.x + drift.offsetX,
        drift.y + 0.5 + 0.09 * drift.scaleY,
        drift.z + drift.offsetZ,
      ),
      rotation: [0, drift.rotationY, 0],
      scale: [drift.scaleX, drift.scaleY, drift.scaleZ],
    }));

    this.group.add(this.snowdriftMesh);
  }

  writeInstances(mesh, items, getTransform) {
    items.forEach((item, index) => {
      const transform = getTransform(item);

      this._position.copy(transform.position);
      this._rotation.set(...transform.rotation);
      this._quaternion.setFromEuler(this._rotation);
      this._scale.set(...transform.scale);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      mesh.setMatrixAt(index, this._matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }

    this.grassGeometry.dispose();
    this.rockGeometry.dispose();
    this.snowdriftGeometry.dispose();
    this.grassMaterial.map?.dispose();
    this.grassMaterial.dispose();
    this.rockMaterial.dispose();
    this.snowdriftMaterial.dispose();
  }
}
