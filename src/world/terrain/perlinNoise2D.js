function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function createSeededRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createPermutation(seed) {
  const source = Array.from({ length: 256 }, (_, index) => index);
  const random = createSeededRandom(seed);

  for (let index = source.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [source[index], source[swapIndex]] = [source[swapIndex], source[index]];
  }

  return [...source, ...source];
}

function gradient(hash, x, y) {
  switch (hash & 3) {
    case 0:
      return x + y;
    case 1:
      return -x + y;
    case 2:
      return x - y;
    default:
      return -x - y;
  }
}

export class PerlinNoise2D {
  constructor({ seed = 1337 } = {}) {
    this.permutation = createPermutation(seed);
  }

  // 返回标准 Perlin 噪声值，范围约为 -1 到 1。
  noise(x, y) {
    const cellX = Math.floor(x) & 255;
    const cellY = Math.floor(y) & 255;
    const localX = x - Math.floor(x);
    const localY = y - Math.floor(y);
    const u = fade(localX);
    const v = fade(localY);

    const aa = this.permutation[this.permutation[cellX] + cellY];
    const ab = this.permutation[this.permutation[cellX] + cellY + 1];
    const ba = this.permutation[this.permutation[cellX + 1] + cellY];
    const bb = this.permutation[this.permutation[cellX + 1] + cellY + 1];

    const lower = lerp(
      gradient(aa, localX, localY),
      gradient(ba, localX - 1, localY),
      u,
    );
    const upper = lerp(
      gradient(ab, localX, localY - 1),
      gradient(bb, localX - 1, localY - 1),
      u,
    );

    return lerp(lower, upper, v);
  }

  // 多倍频叠加，让 Chunk 高度更自然，避免单层噪声过于平滑。
  octaveNoise(x, y, { octaves = 4, persistence = 0.5, lacunarity = 2 } = {}) {
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    let maxAmplitude = 0;

    for (let octave = 0; octave < octaves; octave += 1) {
      total += this.noise(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxAmplitude;
  }
}
