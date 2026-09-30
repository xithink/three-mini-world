import * as THREE from 'three';
import {
  appendPlayerBuildingRecord,
  clearPlayerBuildingRecord as clearRemotePlayerBuildingRecord,
  deleteLocalBuildingRecord,
  deletePlayerBuildingRecord,
  formatSaveTime,
  getLocalBuildingRecord,
  getLocalBuildingRecords,
  resolveBuildingModule,
  setLocalBuildingRecordStatus,
  updatePlayerBuildingRecord,
  upsertLocalBuildingRecord,
} from '../saveStorage.js';

const DEFAULT_API_BASE = import.meta.env.VITE_AI_API_BASE ?? '';
const DEFAULT_API_PATH = '/api/ai/building';
const DEFAULT_ROTATION = 0;
const BUILD_PADDING = 2;
const BUILD_BASE_OFFSET = 4;
const BUILD_NEAR_EDGE_DISTANCE = 7;
const WORLD_BUILD_HEIGHT = 258;
const MAX_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_MANUAL_BUILDING_BLOCKS = 10000;

const BLOCK_LABELS = Object.freeze({
  0: '空气',
  1: '草地',
  2: '水',
  3: '石头',
  5: '沙子',
  6: '泥土',
  7: '木材',
  8: '树叶',
  9: '雪块',
  10: '枯草地',
  11: '冰块',
  12: '洞穴石',
  13: '雪山方块',
  14: '岩山石',
  15: '森林山体方块',
  16: '白桦木',
  17: '仙人掌',
  18: 'TNT',
  19: '工具台',
  20: '石板',
  21: '钢材',
  22: '砖块',
  23: '玻璃',
  24: '混凝土',
  25: '木板',
  26: '屋顶瓦片',
  27: '鹅卵石',
  28: '砂岩',
  29: '石英',
  30: '灯具',
  31: '金属板',
  32: '雪莲方块',
  33: '水流装饰',
  34: '大理石',
  35: '深色石材',
  36: '陶土',
  37: '铜板',
  38: '黑色玻璃',
  39: '蓝色瓦片',
  40: '竹材',
  41: '白墙',
});

const BLOCK_ID_SET = new Set(Object.keys(BLOCK_LABELS).map(Number));
const CUSTOM_BLOCK_ID_MIN = 1000;
const CUSTOM_BLOCK_ID_MAX = 60000;

function isAllowedBlockId(blockId) {
  return BLOCK_ID_SET.has(blockId) || (blockId > 0 && blockId <= CUSTOM_BLOCK_ID_MAX);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCardinalDirection(vector) {
  const direction = vector.clone();
  direction.y = 0;

  if (direction.lengthSq() === 0) {
    return { x: 0, z: -1, rotation: DEFAULT_ROTATION };
  }

  direction.normalize();
  const angle = Math.atan2(direction.x, -direction.z);
  const quarterTurns = ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4;

  switch (quarterTurns) {
    case 0:
      return { x: 0, z: -1, rotation: 0 };
    case 1:
      return { x: 1, z: 0, rotation: 1 };
    case 2:
      return { x: 0, z: 1, rotation: 2 };
    default:
      return { x: -1, z: 0, rotation: 3 };
  }
}

function rotateLocalPoint(point, rotation) {
  const rot = ((rotation % 4) + 4) % 4;

  switch (rot) {
    case 1:
      return { x: point.z, z: -point.x };
    case 2:
      return { x: -point.x, z: -point.z };
    case 3:
      return { x: -point.z, z: point.x };
    default:
      return { x: point.x, z: point.z };
  }
}

function getRotatedBounds(bounds, rotation) {
  if (!bounds) {
    return null;
  }

  const corners = [
    rotateLocalPoint({ x: bounds.minX, z: bounds.minZ }, rotation),
    rotateLocalPoint({ x: bounds.minX, z: bounds.maxZ }, rotation),
    rotateLocalPoint({ x: bounds.maxX, z: bounds.minZ }, rotation),
    rotateLocalPoint({ x: bounds.maxX, z: bounds.maxZ }, rotation),
  ];

  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minZ: Math.min(...corners.map((corner) => corner.z)),
    maxZ: Math.max(...corners.map((corner) => corner.z)),
  };
}

function normalizeBuildingList(blocks) {
  return Array.isArray(blocks) ? blocks : [];
}

function dedupeBlocks(blocks) {
  const seen = new Map();

  blocks.forEach((block) => {
    const key = `${block.x},${block.y},${block.z}`;
    seen.set(key, block);
  });

  return [...seen.values()].sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
}

function parseManualBuildingArray(rawValue) {
  let parsed;

  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error('建筑数组不是有效 JSON');
  }

  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.localBlocks)
      ? parsed.localBlocks
      : Array.isArray(parsed?.blocks)
        ? parsed.blocks
        : null;

  if (!source) {
    throw new Error('请输入方块数组，或包含 blocks 数组的对象');
  }

  if (source.length === 0) {
    throw new Error('建筑数组不能为空');
  }

  if (source.length > MAX_MANUAL_BUILDING_BLOCKS) {
    throw new Error(`建筑数组最多支持 ${MAX_MANUAL_BUILDING_BLOCKS} 个方块`);
  }

  const invalidIndex = source.findIndex((block) => {
    if (!block || typeof block !== 'object') {
      return true;
    }

    const x = Number(block.x);
    const y = Number(block.y);
    const z = Number(block.z);
    const blockId = Number(block.blockId ?? block.id);

    return ![x, y, z, blockId].every(Number.isFinite)
      || ![x, y, z, blockId].every(Number.isInteger)
      || !isAllowedBlockId(blockId);
  });

  if (invalidIndex >= 0) {
    throw new Error(`第 ${invalidIndex + 1} 项坐标或 blockId 无效，可用 blockId 为 0-3、5-41`);
  }

  const blocks = source.map((block) => ({
    x: Math.trunc(Number(block.x)),
    y: Math.trunc(Number(block.y)),
    z: Math.trunc(Number(block.z)),
    blockId: Math.trunc(Number(block.blockId ?? block.id)),
    part: typeof block.part === 'string' && block.part.trim() ? block.part.trim().slice(0, 24) : 'detail',
  }));
  const bounds = getBounds(blocks);

  return {
    blocks: blocks.map((block) => ({
      ...block,
      x: block.x - bounds.minX,
      y: block.y - bounds.minY,
      z: block.z - bounds.minZ,
    })),
    sourceCount: source.length,
    meta: parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed.meta ?? {} : {},
    referenceMaterials: parsed && !Array.isArray(parsed) && Array.isArray(parsed.referenceMaterials) ? parsed.referenceMaterials : [],
    customBlocks: parsed && !Array.isArray(parsed) && Array.isArray(parsed.customBlocks) ? parsed.customBlocks : [],
  };
}

function getPlanCustomBlocks(plan) {
  return [
    ...(Array.isArray(plan?.customBlocks) ? plan.customBlocks : []),
    ...(Array.isArray(plan?.meta?.customBlocks) ? plan.meta.customBlocks : []),
  ];
}

function applyReferenceMaterialsToManualBlocks(blocks, referenceMaterials = []) {
  const customMaterials = referenceMaterials
    .filter((material) => Number.isInteger(Number(material.blockId)) && Number(material.blockId) >= CUSTOM_BLOCK_ID_MIN);

  if (!customMaterials.length) {
    return blocks;
  }

  const match = (pattern) => customMaterials.find((material) => (
    pattern.test(`${material.name ?? ''} ${material.label ?? ''} ${material.usage ?? ''}`)
  ));
  const materialByPart = {
    wall: match(/wall|facade|立面|墙|墙面|白墙/i) ?? customMaterials[0],
    foundation: match(/foundation|base|floor|地基|基座|大理石/i) ?? customMaterials[1] ?? customMaterials[0],
    window: match(/window|glass|窗|玻璃/i),
    roof: match(/roof|tile|顶|瓦/i),
    facility: match(/decor|facility|装饰|设施/i),
  };
  const materialBySourceBlockId = new Map();

  customMaterials.forEach((material) => {
    const sourceBlockId = Math.trunc(Number(material.sourceBlockId));

    if (Number.isInteger(sourceBlockId) && sourceBlockId > 0 && sourceBlockId < CUSTOM_BLOCK_ID_MIN) {
      materialBySourceBlockId.set(sourceBlockId, material);
    }
  });

  return blocks.map((block) => {
    const material = materialBySourceBlockId.get(Math.trunc(Number(block.blockId)))
      ?? materialByPart[block.part];

    if (!material || block.part === 'door' || block.blockId === 0) {
      return block;
    }

    return {
      ...block,
      blockId: Math.trunc(Number(material.blockId)),
    };
  });
}

function getBounds(blocks) {
  if (!blocks.length) {
    return null;
  }

  return blocks.reduce((acc, block) => ({
    minX: Math.min(acc.minX, block.x),
    minY: Math.min(acc.minY, block.y),
    minZ: Math.min(acc.minZ, block.z),
    maxX: Math.max(acc.maxX, block.x),
    maxY: Math.max(acc.maxY, block.y),
    maxZ: Math.max(acc.maxZ, block.z),
  }), {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  });
}

function summarizeCounts(blocks) {
  const counts = new Map();

  blocks.forEach((block) => {
    const label = block.part ?? 'detail';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return [...counts.entries()]
    .map(([part, count]) => `${part}:${count}`)
    .join(' · ');
}

function createLocalRecordId() {
  return `local-building-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, milliseconds) / 1000;

  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function getRecordStatusLabel(record) {
  if (record.status === 'generating') {
    return '生成中';
  }

  if (record.status === 'preview') {
    return '预览中';
  }

  if (record.status === 'cleared') {
    return '已清除';
  }

  if (record.status === 'active') {
    return record.serverRecordId ? '已应用' : '应用失败';
  }

  if (record.error) {
    return '生成失败';
  }

  return '生成完成';
}

function getReferenceImageSummary(referenceImage) {
  if (!referenceImage) {
    return null;
  }

  return {
    name: referenceImage.name,
    mimeType: referenceImage.mimeType,
    sizeBytes: referenceImage.sizeBytes,
  };
}

const REFERENCE_TEXTURE_REGION_PRESETS = Object.freeze([
  { id: 'roof_region', role: 'roof', label: '屋顶纹理', x: 0.14, y: 0.02, width: 0.72, height: 0.24, slot: 'tile', part: 'roof', confidence: 0.88 },
  { id: 'facade_region', role: 'facade', label: '立面纹理', x: 0.10, y: 0.22, width: 0.80, height: 0.42, slot: 'wall', part: 'wall', confidence: 0.85 },
  { id: 'door_region', role: 'door', label: '门廊纹理', x: 0.28, y: 0.58, width: 0.44, height: 0.30, slot: 'door', part: 'door', confidence: 0.82 },
  { id: 'window_region', role: 'window', label: '窗格纹理', x: 0.56, y: 0.28, width: 0.26, height: 0.34, slot: 'window', part: 'window', confidence: 0.8 },
  { id: 'ornament_region', role: 'ornament', label: '装饰纹理', x: 0.18, y: 0.04, width: 0.22, height: 0.18, slot: 'dougong', part: 'facility', confidence: 0.78 },
  { id: 'overall_region', role: 'overall', label: '整体纹理', x: 0.08, y: 0.08, width: 0.84, height: 0.84, slot: 'wall', part: 'wall', confidence: 0.72 },
]);

function clamp01(value, fallback = 0) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  if (numeric > 1.5) {
    return Math.max(0, Math.min(1, numeric / 100));
  }

  return Math.max(0, Math.min(1, numeric));
}

function hashTextToNumber(text) {
  let hash = 2166136261;
  const value = String(text ?? '');

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法解析参考图像'));
    image.src = dataUrl;
  });
}

function extractAverageColor(imageData) {
  const data = imageData?.data;

  if (!data || data.length < 4) {
    return 0xd8d0c5;
  }

  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let index = 0; index < data.length; index += 4) {
    red += data[index];
    green += data[index + 1];
    blue += data[index + 2];
    count += 1;
  }

  if (!count) {
    return 0xd8d0c5;
  }

  return ((Math.round(red / count) & 0xff) << 16)
    | ((Math.round(green / count) & 0xff) << 8)
    | (Math.round(blue / count) & 0xff);
}

function cropReferenceImageRegion(image, referenceImage, preset) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const sx = Math.max(0, Math.min(sourceWidth - 1, Math.floor(sourceWidth * clamp01(preset.x, 0.5))));
  const sy = Math.max(0, Math.min(sourceHeight - 1, Math.floor(sourceHeight * clamp01(preset.y, 0.5))));
  const sw = Math.max(1, Math.min(sourceWidth - sx, Math.floor(sourceWidth * clamp01(preset.width, 0.24))));
  const sh = Math.max(1, Math.min(sourceHeight - sy, Math.floor(sourceHeight * clamp01(preset.height, 0.24))));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = 96;
  canvas.height = 96;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const sampleCanvas = document.createElement('canvas');
  const sampleContext = sampleCanvas.getContext('2d');

  sampleCanvas.width = 8;
  sampleCanvas.height = 8;
  sampleContext.imageSmoothingEnabled = true;
  sampleContext.drawImage(image, sx, sy, sw, sh, 0, 0, sampleCanvas.width, sampleCanvas.height);

  const sample = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
  const color = extractAverageColor(sample);
  const textureDataUrl = canvas.toDataURL('image/jpeg', 0.84);
  const imageFingerprint = [
    referenceImage.name,
    referenceImage.mimeType,
    referenceImage.sizeBytes,
    referenceImage.dataUrl.length,
    referenceImage.dataUrl.slice(0, 512),
    referenceImage.dataUrl.slice(-512),
  ].join(':');
  const regionHash = hashTextToNumber(`${imageFingerprint}:${preset.id}:${sx}:${sy}:${sw}:${sh}:${textureDataUrl.slice(0, 512)}:${textureDataUrl.slice(-512)}`);

  return {
    key: `region-${preset.id}-${regionHash.toString(36)}`,
    name: `${preset.label} ${regionHash.toString(36).slice(0, 6)}`,
    label: preset.label,
    usage: `reference-image ${preset.role} region`,
    slot: preset.slot,
    proceduralSlot: preset.slot,
    part: preset.part,
    color,
    opacity: 1,
    opaque: true,
    custom: true,
    confidence: preset.confidence ?? 0.7,
    textureDataUrl,
    textureSource: 'reference-image-region',
    textureRegion: {
      id: preset.id,
      role: preset.role,
      label: preset.label,
      x: sx / sourceWidth,
      y: sy / sourceHeight,
      width: sw / sourceWidth,
      height: sh / sourceHeight,
      confidence: preset.confidence ?? 0.7,
    },
  };
}

async function buildReferenceTextureMaterials(referenceImage) {
  if (!referenceImage?.dataUrl) {
    return [];
  }

  const image = await createImageElement(referenceImage.dataUrl);
  const presets = REFERENCE_TEXTURE_REGION_PRESETS;
  return presets.map((preset) => {
    try {
      return cropReferenceImageRegion(image, referenceImage, preset);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function formatPromptTrace(prompts, referenceDescription = null) {
  if ((!prompts || typeof prompts !== 'object') && !referenceDescription) {
    return '';
  }

  const referenceAnalysis = prompts?.referenceAnalysis ?? (referenceDescription
    ? { result: JSON.stringify(referenceDescription, null, 2) }
    : null);
  const buildingPrompt = prompts?.building
    ? `系统提示词：\n${prompts.building.system ?? ''}\n\n公共用户提示词：\n${prompts.building.user ?? ''}`
    : '';
  const chunkSections = Array.isArray(prompts?.building?.chunks)
    ? prompts.building.chunks.map((chunk, index) => [
      `建筑数组分片 ${chunk.index ?? index + 1}/${prompts.building.chunks.length}：${chunk.title ?? chunk.key ?? '未命名'}`,
      `系统提示词：\n${chunk.system ?? ''}\n\n用户提示词：\n${chunk.user ?? ''}`,
    ].join('\n'))
    : [];
  const generationTrace = Array.isArray(prompts?.generationTrace)
    ? prompts.generationTrace.map((event, index) => [
      `步骤 ${index + 1}`,
      event.type ?? '',
      event.message ?? event.summary ?? '',
    ].filter(Boolean).join(' · '))
    : [];
  const sections = [
    ['原始建筑指令', prompts?.input],
    ['参考图分析提示词', referenceAnalysis
      ? `系统提示词：\n${referenceAnalysis.system ?? ''}\n\n用户提示词：\n${referenceAnalysis.user ?? ''}`
      : ''],
    ['大模型建筑描述分析结果', referenceAnalysis?.result ?? ''],
    ['建筑数组生成公共提示词', buildingPrompt],
    ['建筑数组分片提示词', chunkSections.join('\n\n')],
    ['生成过程摘要', generationTrace.join('\n')],
    ['AI 建筑器最终整合提示词', prompts?.integrated],
  ];

  return sections
    .filter(([, content]) => String(content ?? '').trim())
    .map(([title, content]) => `${title}\n${String(content).trim()}`)
    .join('\n\n');
}

function formatProgressPercent(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatGenerationEvent(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }

  const parts = [
    event.type === 'reference-analysis-result' ? '参考图分析' : '',
    event.type === 'chunk-start' ? `分片 ${event.chunk}/${event.chunkCount}` : '',
    event.type === 'chunk-complete' ? `分片 ${event.chunk}/${event.chunkCount}` : '',
    event.type === 'merge-complete' ? '合并完成' : '',
    event.message ?? '',
    event.summary ? String(event.summary).slice(0, 160) : '',
  ].filter(Boolean);

  return parts.join(' · ');
}

function formatGenerationStreamText(state) {
  if (!state) {
    return '';
  }

  const progressPercent = formatProgressPercent((state.progress ?? 0) * 100);
  const promptTraceText = formatPromptTrace(state.prompts ?? null, state.finalPayload?.meta?.referenceDescription ?? null);
  const timelineText = Array.isArray(state.timeline) && state.timeline.length
    ? state.timeline.map((event) => {
      const time = String(event.at ?? '').slice(11, 19) || '--:--:--';
      const label = formatGenerationEvent(event) || event.type || '事件';
      return `[${time}] ${label}`;
    }).join('\n')
    : '';
  const chunkText = Array.isArray(state.chunks) && state.chunks.length
    ? state.chunks.map((chunk) => {
      const lines = [
        `分片 ${chunk.index}/${state.chunkCount || '?'} · ${chunk.title || chunk.key || '未命名'} · ${chunk.blockCount || 0} 方块`,
      ];

      if (chunk.contentPreview) {
        lines.push(String(chunk.contentPreview).trim());
      } else if (Array.isArray(chunk.blocks) && chunk.blocks.length) {
        lines.push(JSON.stringify({
          blockCount: chunk.blocks.length,
          firstBlock: chunk.blocks[0] ?? null,
          lastBlock: chunk.blocks.at(-1) ?? null,
        }, null, 2));
      }

      return lines.join('\n');
    }).join('\n\n')
    : '';
  const mergedBlocks = Array.isArray(state.finalPayload?.building)
    ? state.finalPayload.building
    : Array.isArray(state.outputBlocks)
      ? state.outputBlocks
      : [];
  const mergedText = mergedBlocks.length
    ? JSON.stringify({
      blockCount: mergedBlocks.length,
      blocks: mergedBlocks,
    }, null, 2)
    : '';

  return [
    `状态：${state.status ?? '未知'}`,
    `进度：${progressPercent}`,
    state.progressLabel ? `阶段：${state.progressLabel}` : '',
    state.prompt ? `原始指令：${state.prompt}` : '',
    promptTraceText ? `提示词与分析\n${promptTraceText}` : '',
    timelineText ? `过程日志\n${timelineText}` : '',
    chunkText ? `分片结果\n${chunkText}` : '',
    mergedText ? `最终合并结果\n${mergedText}` : '',
  ].filter(Boolean).join('\n\n');
}

async function readNdjsonResponse(response, onEvent) {
  if (!response.body?.getReader) {
    const text = await response.text();
    text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
      onEvent(JSON.parse(line));
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let lineBreakIndex = buffer.indexOf('\n');
    while (lineBreakIndex >= 0) {
      const line = buffer.slice(0, lineBreakIndex).trim();
      buffer = buffer.slice(lineBreakIndex + 1);

      if (line) {
        onEvent(JSON.parse(line));
      }

      lineBreakIndex = buffer.indexOf('\n');
    }
  }

  const trailing = buffer.trim();

  if (trailing) {
    onEvent(JSON.parse(trailing));
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('读取参考图失败')));
    reader.readAsDataURL(file);
  });
}

export class AiBuildingSystem {
  constructor({
    container,
    worldManager,
    player,
    eventBus,
    session = null,
    apiBase = DEFAULT_API_BASE,
    apiPath = DEFAULT_API_PATH,
  }) {
    this.container = container;
    this.worldManager = worldManager;
    this.player = player;
    this.eventBus = eventBus;
    this.session = session;
    this.currentUser = session?.user ?? null;
    this.currentPlayerId = import.meta.env.VITE_PLAYER_ID ?? 'local-player';
    this.apiBase = apiBase.replace(/\/$/, '');
    this.apiPath = apiPath;
    this.isOpen = false;
    this.isGenerating = false;
    this.currentPlan = null;
    this.currentPlacement = null;
    this.referenceImage = null;
    this.inputMode = 'prompt';
    this.localRecords = getLocalBuildingRecords();
    this.selectedRecordId = null;
    this.activeGenerationLocalId = null;
    this.arrayEditorValue = '';
    this.generationStartedAt = 0;
    this.generationTimer = 0;
    this.generationState = null;
    this.element = this.createElement();
    this.container.append(this.element);

    this.unsubscribe = [
      eventBus.on('player:update', () => this.syncPreview()),
      eventBus.on('building:clear-request', (record) => void this.clearSavedBuilding(record)),
    ];
    this.renderReferenceImage();
    this.renderRecordList();
    this.render();
  }

  createElement() {
    const element = document.createElement('section');
    element.className = 'ai-building';
    element.setAttribute('aria-label', 'AI 建筑生成器');
    element.innerHTML = `
      <div class="ai-building__workspace">
        <div class="ai-building__panel" data-ai-panel>
          <div class="ai-building__header">
            <strong>AI 建筑生成器</strong>
            <span data-ai-status>准备</span>
          </div>
          <div class="ai-building__mode" role="tablist" aria-label="建筑输入模式">
            <button class="ai-building__mode-button is-active" type="button" role="tab" aria-selected="true" data-ai-mode="prompt">AI 指令</button>
            <button class="ai-building__mode-button" type="button" role="tab" aria-selected="false" data-ai-mode="array">建筑数组</button>
          </div>
          <label class="ai-building__prompt" data-ai-prompt-field>
            <span>生成指令</span>
            <textarea data-ai-prompt rows="4" placeholder="例如：做一个三层石木混合小屋，带门廊、窗户、厨房和床铺"></textarea>
          </label>
          <div class="ai-building__reference" data-ai-reference-field>
            <label class="ai-building__upload">
              <span>参考图</span>
              <input data-ai-reference type="file" accept="image/png,image/jpeg,image/webp">
            </label>
            <button class="ai-building__button ai-building__button--subtle" type="button" data-ai-reference-clear disabled>移除参考图</button>
            <div class="ai-building__reference-preview" data-ai-reference-preview>未上传参考图</div>
          </div>
          <div class="ai-building__actions">
            <button class="ai-building__button" type="button" data-ai-generate>生成</button>
            <button class="ai-building__button" type="button" data-ai-apply disabled>应用</button>
            <button class="ai-building__button" type="button" data-ai-clear>清除</button>
          </div>
          <div class="ai-building__progress" data-ai-progress hidden>
            <div class="ai-building__progress-track">
              <i data-ai-progress-bar></i>
            </div>
            <div class="ai-building__progress-meta">
              <strong data-ai-progress-label>准备</strong>
              <span data-ai-progress-percent>0%</span>
            </div>
          </div>
          <details class="ai-building__timeline" data-ai-timeline hidden>
            <summary>生成过程</summary>
            <div class="ai-building__timeline-list" data-ai-timeline-list></div>
          </details>
          <div class="ai-building__meta" data-ai-meta>未生成</div>
          <div class="ai-building__timer" data-ai-timer>状态：准备</div>
          <details class="ai-building__prompts" data-ai-prompts hidden>
            <summary>生成提示词</summary>
            <pre data-ai-prompts-content></pre>
          </details>
          <div class="ai-building__records">
            <div class="ai-building__records-title">本地生成记录</div>
            <div class="ai-building__record-list" data-ai-records></div>
          </div>
          <pre class="ai-building__json" data-ai-json hidden>{}</pre>
        </div>
        <div class="ai-building__array-panel" data-ai-array-panel hidden>
          <label class="ai-building__prompt" data-ai-array-field>
            <span data-ai-array-title>建筑数组 JSON</span>
            <textarea data-ai-array rows="8" spellcheck="false" readonly placeholder='等待生成结果或切换到建筑数组模式进行编辑'></textarea>
            <small data-ai-array-hint>生成结果会显示在这里，切换到建筑数组模式后可直接编辑。</small>
          </label>
        </div>
      </div>
      <button class="ai-building__toggle" type="button" data-ai-toggle aria-pressed="false">AI</button>
    `;

    [
      'pointerdown',
      'pointerup',
      'pointermove',
      'mousedown',
      'mouseup',
      'mousemove',
      'click',
      'contextmenu',
    ].forEach((eventName) => {
      element.addEventListener(eventName, (event) => event.stopPropagation());
    });
    element.addEventListener('pointerdown', () => {
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
    });
    element.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    const onMouseOnlyClick = (selector, handler) => {
      const control = element.querySelector(selector);

      control.addEventListener('click', (event) => {
        if (event.detail === 0) {
          return;
        }

        if (event.currentTarget instanceof HTMLElement) {
          event.currentTarget.blur();
        }

        handler(event);
      });
    };

    onMouseOnlyClick('[data-ai-toggle]', () => this.toggle());
    onMouseOnlyClick('[data-ai-generate]', () => void this.generate());
    onMouseOnlyClick('[data-ai-apply]', () => void this.applyCurrentPlan());
    onMouseOnlyClick('[data-ai-clear]', () => void this.handleClearAction());
    onMouseOnlyClick('[data-ai-reference-clear]', () => this.clearReferenceImage());
    element.querySelectorAll('[data-ai-mode]').forEach((button) => {
      onMouseOnlyClick(`[data-ai-mode="${button.dataset.aiMode}"]`, () => this.setInputMode(button.dataset.aiMode));
    });
    element.querySelector('[data-ai-reference]').addEventListener('change', (event) => {
      void this.setReferenceImageFromFile(event.currentTarget.files?.[0] ?? null);
    });
    element.querySelector('[data-ai-array]').addEventListener('input', (event) => {
      if (this.inputMode !== 'array' || !(event.currentTarget instanceof HTMLTextAreaElement)) {
        return;
      }

      this.arrayEditorValue = event.currentTarget.value;
    });
    element.querySelector('[data-ai-records]').addEventListener('click', (event) => {
      if (event.detail === 0) {
        return;
      }

      if (event.target instanceof HTMLElement) {
        event.target.blur();
      }

      const deleteButton = event.target.closest('[data-ai-record-delete]');

      if (deleteButton) {
        void this.deleteRecord(deleteButton.dataset.aiRecordDelete);
        return;
      }

      const recordButton = event.target.closest('[data-ai-record-id]');

      if (recordButton) {
        this.showRecordDetail(recordButton.dataset.aiRecordId);
      }
    });

    return element;
  }

  setInputMode(mode) {
    if (!['prompt', 'array'].includes(mode) || this.inputMode === mode) {
      return;
    }

    this.inputMode = mode;
    this.arrayEditorValue = '';
    this.setStatus(mode === 'array' ? '数组模式' : 'AI 指令模式');
    this.render();

    if (this.currentPlan) {
      this.renderCurrentPlan();
    }
  }

  toggle(force = null) {
    this.isOpen = typeof force === 'boolean' ? force : !this.isOpen;
    if (!this.isOpen) {
      this.blurFocusedInput();
    }
    this.render();
  }

  blurFocusedInput() {
    const activeElement = document.activeElement;

    if (activeElement instanceof HTMLElement && this.element.contains(activeElement)) {
      activeElement.blur();
    }
  }

  setStatus(message) {
    const status = this.element.querySelector('[data-ai-status]');

    if (status) {
      status.textContent = message;
    }
  }

  setTimerText(message) {
    const timer = this.element.querySelector('[data-ai-timer]');

    if (timer) {
      timer.textContent = message;
    }
  }

  startGenerationTimer() {
    this.generationStartedAt = performance.now();
    clearInterval(this.generationTimer);
    this.setTimerText('状态：生成中 · 0.0s');
    this.generationTimer = window.setInterval(() => {
      this.setTimerText(`状态：生成中 · ${formatDuration(performance.now() - this.generationStartedAt)}`);
    }, 250);
  }

  stopGenerationTimer(status = '生成完成') {
    const elapsed = this.generationStartedAt > 0 ? performance.now() - this.generationStartedAt : 0;

    clearInterval(this.generationTimer);
    this.generationTimer = 0;
    this.setTimerText(`状态：${status} · ${formatDuration(elapsed)}`);

    return elapsed;
  }

  startGenerationState(prompt) {
    this.generationState = {
      prompt,
      stage: 'building-generation',
      status: '开始生成',
      progress: 0,
      progressLabel: '准备',
      chunkCount: 0,
      completedChunks: 0,
      prompts: null,
      timeline: [],
      chunks: [],
      outputBlocks: [],
      outputText: '',
      lastEvent: null,
      finalPayload: null,
      error: null,
      createdAt: Date.now(),
    };
    this.renderGenerationState();
  }

  getArrayPanelSnapshot() {
    const selectedRecord = this.getSelectedRecord();
    const isLiveGeneration = Boolean(
      this.isGenerating
      && this.generationState
      && this.activeGenerationLocalId
      && this.selectedRecordId === this.activeGenerationLocalId
      && !this.generationState.finalPayload,
    );

    if (this.inputMode === 'array') {
      return {
        title: '建筑数组输入',
        hint: '在这里直接粘贴或编辑建筑数组 JSON，切换模式时会自动清空。',
        readOnly: false,
        value: this.arrayEditorValue ?? '',
        show: this.isOpen,
      };
    }

    if (isLiveGeneration) {
      return {
        title: '建筑数据数组输出',
        hint: '这里会实时显示生成过程、提示词、分片结果和最终合并结果。',
        readOnly: true,
        value: this.generationState?.outputText ?? '',
        show: this.isOpen,
      };
    }

    if (selectedRecord) {
      return {
        title: '建筑数据数组输出',
        hint: '点击历史记录后，会显示已生成好的建筑数据。',
        readOnly: true,
        value: JSON.stringify(selectedRecord, null, 2),
        show: this.isOpen,
      };
    }

    if (this.currentPlan) {
      return {
        title: '建筑数据数组输出',
        hint: '这里会显示当前建筑预览数据。',
        readOnly: true,
        value: JSON.stringify({
          prompt: this.currentPlan.prompt,
          localId: this.currentPlan.localId,
          inputMode: this.inputMode,
          model: this.currentPlan.model,
          anchor: this.currentPlan.anchor,
          rotation: this.currentPlan.rotation,
          localBounds: this.currentPlan.localBounds,
          generationMs: this.currentPlan.generationMs,
          blockCount: this.currentPlan.blocks.length,
          meta: this.currentPlan.meta,
          prompts: this.currentPlan.prompts,
          collisionAdjustment: this.currentPlan.collisionAdjustment ?? null,
          blocks: this.currentPlan.localBlocks ?? this.currentPlan.blocks,
          worldBlocks: this.currentPlan.blocks,
        }, null, 2),
        show: this.isOpen,
      };
    }

    if (this.generationState) {
      return {
        title: '建筑数据数组输出',
        hint: '这里会实时显示生成过程、提示词、分片结果和最终合并结果。',
        readOnly: true,
        value: this.generationState.outputText ?? '',
        show: this.isOpen,
      };
    }

    return {
      title: this.inputMode === 'array' ? '建筑数组输入' : '建筑数据数组输出',
      hint: this.inputMode === 'array'
        ? '在这里直接粘贴或编辑建筑数组 JSON，切换模式时会自动清空。'
        : '生成结果会在这里显示。',
      readOnly: this.inputMode !== 'array',
      value: '',
      show: this.isOpen && this.inputMode === 'array',
    };
  }

  pushGenerationEvent(event) {
    if (!this.generationState) {
      return;
    }

    const nextTimeline = [...this.generationState.timeline, {
      type: event?.type ?? 'event',
      stage: event?.stage ?? null,
      chunk: Number.isFinite(Number(event?.chunk)) ? Math.trunc(Number(event.chunk)) : null,
      chunkCount: Number.isFinite(Number(event?.chunkCount)) ? Math.trunc(Number(event.chunkCount)) : null,
      title: event?.title ?? '',
      message: event?.message ?? event?.summary ?? '',
      at: event?.at ?? new Date().toISOString(),
    }].slice(-60);

    const nextState = { ...this.generationState, timeline: nextTimeline, lastEvent: event };
    let progress = nextState.progress ?? 0;

    switch (event?.type) {
      case 'meta':
        nextState.status = '已连接 AI 接口';
        nextState.progressLabel = '连接中';
        progress = Math.max(progress, 0.05);
        nextState.chunkCount = Number.isFinite(Number(event?.chunkCount))
          ? Math.max(nextState.chunkCount, Math.trunc(Number(event.chunkCount)))
          : nextState.chunkCount;
        break;
      case 'start':
        nextState.status = event?.message ?? 'AI 建筑生成开始';
        nextState.progressLabel = '准备';
        progress = Math.max(progress, 0.1);
        break;
      case 'reference-analysis-start':
        nextState.status = event?.message ?? '开始分析参考图';
        nextState.progressLabel = '分析参考图';
        progress = Math.max(progress, 0.2);
        break;
      case 'reference-analysis-result':
        nextState.status = event?.message ?? '参考图分析完成';
        nextState.progressLabel = '参考图分析';
        progress = Math.max(progress, 0.3);
        break;
      case 'prompt-trace':
        nextState.prompts = event?.prompts ?? nextState.prompts;
        nextState.status = '提示词已整合';
        nextState.progressLabel = '提示词';
        progress = Math.max(progress, 0.4);
        break;
      case 'chunk-start':
        nextState.chunkCount = Number.isFinite(Number(event?.chunkCount))
          ? Math.max(nextState.chunkCount, Math.trunc(Number(event.chunkCount)))
          : nextState.chunkCount;
        nextState.status = event?.message ?? `请求分片 ${event?.chunk ?? ''}`;
        nextState.progressLabel = `分片 ${event?.chunk ?? ''}`;
        if (nextState.chunkCount > 0) {
          const chunkIndex = Math.max(1, Math.trunc(Number(event?.chunk ?? 1)));
          progress = Math.max(progress, 0.4 + ((chunkIndex - 1) / nextState.chunkCount) * 0.5);
        }
        break;
      case 'chunk-complete': {
        const chunkIndex = Math.max(1, Math.trunc(Number(event?.chunk ?? 0)));
        const chunkEntry = {
          index: chunkIndex,
          key: event?.chunkKey ?? '',
          title: event?.title ?? '',
          attempt: Number.isFinite(Number(event?.attempt)) ? Math.trunc(Number(event.attempt)) : 1,
          blockCount: Number.isFinite(Number(event?.blockCount)) ? Math.trunc(Number(event.blockCount)) : 0,
          blocks: Array.isArray(event?.blocks) ? event.blocks : [],
          contentPreview: event?.contentPreview ?? '',
        };
        const chunks = [...nextState.chunks.filter((chunk) => chunk.index !== chunkEntry.index), chunkEntry]
          .sort((a, b) => a.index - b.index);
        nextState.chunks = chunks;
        nextState.outputBlocks = chunks.flatMap((chunk) => chunk.blocks ?? []);
        nextState.completedChunks = Math.max(
          nextState.completedChunks,
          chunks.length,
        );
        nextState.chunkCount = Number.isFinite(Number(event?.chunkCount))
          ? Math.max(nextState.chunkCount, Math.trunc(Number(event.chunkCount)))
          : nextState.chunkCount;
        if (nextState.chunkCount > 0) {
          progress = Math.max(progress, 0.4 + (nextState.completedChunks / nextState.chunkCount) * 0.5);
        }
        nextState.status = event?.message ?? `分片 ${chunkIndex} 完成`;
        nextState.progressLabel = `分片 ${chunkIndex}/${nextState.chunkCount || '?'}`;
        break;
      }
      case 'merge-complete':
        nextState.status = event?.message ?? '建筑分片已合并完成';
        nextState.progressLabel = '合并';
        progress = Math.max(progress, 0.95);
        break;
      case 'final':
        nextState.finalPayload = event;
        progress = 1;
        nextState.status = event?.ok === false ? '生成失败' : '生成完成';
        nextState.progressLabel = event?.ok === false ? '失败' : '完成';
        nextState.error = event?.ok === false ? event?.error ?? '生成失败' : null;
        break;
      case 'error':
        nextState.error = event?.error ?? '生成失败';
        nextState.status = nextState.error;
        nextState.progressLabel = '错误';
        progress = Math.max(progress, 1);
        break;
      default:
        if (typeof event?.progress === 'number') {
          progress = event.progress;
        }
        nextState.status = event?.message ?? nextState.status;
        break;
    }

    const promptSnapshot = event?.prompts ?? event?.promptTrace ?? null;

    if (promptSnapshot && typeof promptSnapshot === 'object') {
      nextState.prompts = promptSnapshot;
    }

    nextState.progress = clamp(progress, 0, 1);
    nextState.outputText = formatGenerationStreamText(nextState);

    this.generationState = nextState;
    this.setStatus(nextState.status);
    this.renderGenerationState();
  }

  clearGenerationState() {
    this.generationState = null;
    this.renderGenerationState();
  }

  renderGenerationState() {
    const meta = this.element.querySelector('[data-ai-meta]');
    const progress = this.element.querySelector('[data-ai-progress]');
    const progressBar = this.element.querySelector('[data-ai-progress-bar]');
    const progressLabel = this.element.querySelector('[data-ai-progress-label]');
    const progressPercent = this.element.querySelector('[data-ai-progress-percent]');
    const timeline = this.element.querySelector('[data-ai-timeline]');
    const timelineList = this.element.querySelector('[data-ai-timeline-list]');
    const arrayTitle = this.element.querySelector('[data-ai-array-title]');
    const arrayHint = this.element.querySelector('[data-ai-array-hint]');
    const arrayInput = this.element.querySelector('[data-ai-array]');
    const arrayPanel = this.element.querySelector('[data-ai-array-panel]');
    const isLiveGeneration = Boolean(this.isGenerating && this.generationState && !this.generationState.finalPayload);
    const selectedRecord = this.getSelectedRecord();
    const arraySnapshot = this.getArrayPanelSnapshot();
    const shouldShowArrayPanel = Boolean(arraySnapshot.show && (arraySnapshot.value || this.inputMode === 'array' || isLiveGeneration || this.currentPlan || this.getSelectedRecord()));

    if (meta && isLiveGeneration) {
      meta.textContent = [
        this.generationState.status,
        `进度 ${formatProgressPercent((this.generationState?.progress ?? 0) * 100)}`,
        this.generationState.chunkCount ? `分片 ${this.generationState.completedChunks}/${this.generationState.chunkCount}` : '',
      ].filter(Boolean).join(' · ');
    }

    if (progress) {
      progress.hidden = !isLiveGeneration;
    }

    if (progressBar) {
      progressBar.style.width = `${Math.max(0, Math.min(100, Math.round((this.generationState?.progress ?? 0) * 100)))}%`;
    }

    if (progressLabel) {
      progressLabel.textContent = this.generationState?.progressLabel ?? '准备';
    }

    if (progressPercent) {
      progressPercent.textContent = formatProgressPercent((this.generationState?.progress ?? 0) * 100);
    }

    if (timeline) {
      timeline.hidden = !isLiveGeneration || this.generationState.timeline.length === 0;
      timeline.open = isLiveGeneration && this.generationState.timeline.length > 0;
    }

    if (timelineList) {
      timelineList.replaceChildren();
      this.generationState?.timeline.forEach((event) => {
        const row = document.createElement('div');
        row.className = 'ai-building__timeline-row';

        const label = document.createElement('strong');
        label.textContent = formatGenerationEvent(event) || event.type || '事件';

        const time = document.createElement('span');
        time.textContent = String(event.at ?? '').slice(11, 19) || '--:--:--';

        row.append(time, label);
        timelineList.append(row);
      });
    }

    if (arrayTitle) {
      arrayTitle.textContent = arraySnapshot.title;
    }

    if (arrayHint) {
      arrayHint.textContent = arraySnapshot.hint;
    }

    if (arrayInput) {
      arrayInput.readOnly = arraySnapshot.readOnly;
      arrayInput.setAttribute('aria-readonly', String(arraySnapshot.readOnly));
      arrayInput.value = arraySnapshot.value ?? '';
    }

    if (arrayPanel) {
      arrayPanel.toggleAttribute('hidden', !shouldShowArrayPanel);
      arrayPanel.setAttribute('aria-hidden', String(!shouldShowArrayPanel));
    }

    this.renderPromptTrace(
      isLiveGeneration
        ? this.generationState?.prompts ?? null
        : selectedRecord?.prompts ?? this.currentPlan?.prompts ?? null,
      isLiveGeneration
        ? this.generationState?.finalPayload?.meta?.referenceDescription ?? null
        : selectedRecord?.meta?.referenceDescription ?? this.currentPlan?.meta?.referenceDescription ?? null,
    );

    this.element.classList.toggle('is-array-open', shouldShowArrayPanel);
  }

  async setReferenceImageFromFile(file) {
    if (!file) {
      this.clearReferenceImage();
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.setStatus('参考图必须是图片文件');
      return;
    }

    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
      this.setStatus('参考图不能超过 4MB');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);

      if (this.currentPlacement?.status === 'preview') {
        this.clearCurrentPlanPreview();
      } else {
        this.currentPlan = null;
        this.currentPlacement = null;
        this.renderCurrentPlan();
      }

      this.clearGenerationState();
      this.selectedRecordId = null;
      this.referenceImage = {
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        dataUrl,
      };
      this.renderReferenceImage();
      this.setStatus('已上传参考图');
    } catch (error) {
      this.setStatus(error.message);
    }
  }

  clearReferenceImage() {
    this.referenceImage = null;
    const input = this.element.querySelector('[data-ai-reference]');

    if (input) {
      input.value = '';
    }

    this.renderReferenceImage();
    this.setStatus('已移除参考图');
  }

  renderReferenceImage() {
    const preview = this.element.querySelector('[data-ai-reference-preview]');
    const clearButton = this.element.querySelector('[data-ai-reference-clear]');

    if (clearButton) {
      clearButton.disabled = !this.referenceImage;
    }

    if (!preview) {
      return;
    }

    preview.replaceChildren();

    if (!this.referenceImage) {
      preview.textContent = '未上传参考图';
      return;
    }

    const image = document.createElement('img');
    image.src = this.referenceImage.dataUrl;
    image.alt = this.referenceImage.name;

    const text = document.createElement('span');
    text.textContent = `${this.referenceImage.name} · ${Math.ceil(this.referenceImage.sizeBytes / 1024)}KB`;
    preview.append(image, text);
  }

  refreshLocalRecords() {
    this.localRecords = getLocalBuildingRecords();
    this.renderRecordList();
  }

  getPlacementSnapshot() {
    return {
      position: this.player.position.clone(),
      facing: (this.player.characterFacingDirection ?? new THREE.Vector3(0, 0, -1)).clone(),
    };
  }

  findNearbyPlacementTarget(playerPosition, facing, targetDistance) {
    const baseX = Math.round(playerPosition.x);
    const baseZ = Math.round(playerPosition.z);
    const playerSurfaceY = this.worldManager.getSurfaceHeightAt(baseX, baseZ);
    const fallbackSurfaceY = Number.isFinite(playerSurfaceY)
      ? playerSurfaceY
      : Math.floor(playerPosition.y);
    const side = { x: -facing.z, z: facing.x };
    const forwardOffsets = [
      targetDistance,
      targetDistance - 1,
      targetDistance + 1,
      targetDistance - 2,
      targetDistance + 2,
      targetDistance - 3,
      targetDistance + 3,
      targetDistance - 4,
      targetDistance + 4,
    ].filter((value) => value >= 3);
    const sideOffsets = [0, -3, 3, -6, 6, -9, 9, -12, 12];
    let best = null;

    for (const forward of forwardOffsets) {
      for (const lateral of sideOffsets) {
        const x = Math.round(playerPosition.x + facing.x * forward + side.x * lateral);
        const z = Math.round(playerPosition.z + facing.z * forward + side.z * lateral);
        const surfaceY = this.worldManager.getSurfaceHeightAt(x, z);

        if (!Number.isFinite(surfaceY)) {
          continue;
        }

        const heightDelta = Math.abs(surfaceY - fallbackSurfaceY);
        const score = heightDelta * 1000
          + Math.abs(forward - targetDistance) * 30
          + Math.abs(lateral);
        const candidate = { x, z, surfaceY, score };

        if (!best || candidate.score < best.score) {
          best = candidate;
        }
      }
    }

    return best ?? {
      x: Math.round(playerPosition.x + facing.x * targetDistance),
      z: Math.round(playerPosition.z + facing.z * targetDistance),
      surfaceY: fallbackSurfaceY,
      score: 0,
    };
  }

  getPlayerPlacement(localBounds = null, placementSnapshot = null) {
    const facing = getCardinalDirection(placementSnapshot?.facing ?? this.player.characterFacingDirection ?? new THREE.Vector3(0, 0, -1));
    const playerPosition = placementSnapshot?.position?.clone?.() ?? this.player.position.clone();
    const targetDistance = BUILD_NEAR_EDGE_DISTANCE;
    const placementTarget = this.findNearbyPlacementTarget(playerPosition, facing, targetDistance);
    const targetX = placementTarget.x;
    const targetZ = placementTarget.z;
    const localCenter = localBounds
      ? {
        x: Math.round((localBounds.minX + localBounds.maxX) / 2),
        z: Math.round((localBounds.minZ + localBounds.maxZ) / 2),
      }
      : { x: 0, z: 0 };
    const rotatedCenter = rotateLocalPoint(localCenter, facing.rotation);
    const rotatedBounds = getRotatedBounds(localBounds, facing.rotation) ?? {
      minX: rotatedCenter.x,
      maxX: rotatedCenter.x,
      minZ: rotatedCenter.z,
      maxZ: rotatedCenter.z,
    };
    let anchorX = Math.round(playerPosition.x - rotatedCenter.x);
    let anchorZ = Math.round(playerPosition.z - rotatedCenter.z);

    if (facing.x > 0) {
      anchorX = Math.round(targetX - rotatedBounds.minX);
    } else if (facing.x < 0) {
      anchorX = Math.round(targetX - rotatedBounds.maxX);
    }

    if (facing.z > 0) {
      anchorZ = Math.round(targetZ - rotatedBounds.minZ);
    } else if (facing.z < 0) {
      anchorZ = Math.round(targetZ - rotatedBounds.maxZ);
    }

    const anchor = new THREE.Vector3(
      anchorX,
      (placementTarget.surfaceY ?? Math.floor(playerPosition.y)) + 1,
      anchorZ,
    );

    return { anchor, rotation: facing.rotation };
  }

  toWorldBlocks(localBlocks, anchor, rotation) {
    return localBlocks.map((block) => {
      const rotatedPoint = rotateLocalPoint({ x: block.x, z: block.z }, rotation);

      return {
        x: anchor.x + rotatedPoint.x,
        y: anchor.y + block.y,
        z: anchor.z + rotatedPoint.z,
        blockId: block.blockId,
        part: block.part,
      };
    });
  }

  buildPlacementPlan(blocks, { placementSnapshot = null } = {}) {
    const visibleBlocks = normalizeBuildingList(blocks)
      .filter((block) => Number.isFinite(Number(block.blockId)))
      .map((block) => ({
        x: Math.trunc(block.x),
        y: Math.trunc(block.y),
        z: Math.trunc(block.z),
        blockId: Math.trunc(block.blockId),
        part: typeof block.part === 'string' ? block.part : 'detail',
      }));

    if (visibleBlocks.length === 0) {
      return null;
    }

    const localBounds = getBounds(visibleBlocks);

    const rotationInfo = this.getPlayerPlacement(localBounds, placementSnapshot);
    const worldBlocks = this.toWorldBlocks(visibleBlocks, rotationInfo.anchor, rotationInfo.rotation);
    const basePlan = {
      anchor: rotationInfo.anchor,
      rotation: rotationInfo.rotation,
      localBounds,
      bounds: getBounds(worldBlocks),
      blocks: dedupeBlocks(worldBlocks),
      localBlocks: dedupeBlocks(visibleBlocks),
    };

    return this.adjustPlanForCollisions(basePlan);
  }

  getCollisionIgnoreKeys() {
    const keys = new Set();
    const sources = this.currentPlacement?.status === 'preview'
      ? [
        this.currentPlacement?.blocks,
        this.currentPlan?.blocks,
      ]
      : [];

    sources.forEach((blocks) => {
      if (!Array.isArray(blocks)) {
        return;
      }

      blocks.forEach((block) => {
        if (!block || !Number.isFinite(Number(block.x)) || !Number.isFinite(Number(block.y)) || !Number.isFinite(Number(block.z))) {
          return;
        }

        keys.add(`${Math.trunc(Number(block.x))},${Math.trunc(Number(block.y))},${Math.trunc(Number(block.z))}`);
      });
    });

    return keys;
  }

  countPlanCollisions(worldBlocks, ignoreKeys = new Set()) {
    let collisionCount = 0;

    worldBlocks.forEach((block) => {
      if (!block || Number(block.blockId) === 0) {
        return;
      }

      const key = `${Math.trunc(block.x)},${Math.trunc(block.y)},${Math.trunc(block.z)}`;

      if (ignoreKeys.has(key)) {
        return;
      }

      if (this.worldManager.isSolidAt(block.x, block.y, block.z)) {
        collisionCount += 1;
      }
    });

    return collisionCount;
  }

  adjustPlanForCollisions(plan) {
    if (!plan?.localBlocks?.length) {
      return plan;
    }

    const ignoreKeys = this.getCollisionIgnoreKeys();
    const visibleBlockCount = plan.localBlocks.reduce((count, block) => (
      count + (Math.trunc(Number(block.blockId) || 0) === 0 ? 0 : 1)
    ), 0);
    const initialCollisionCount = this.countPlanCollisions(plan.blocks, ignoreKeys);
    const acceptableCollisionCount = Math.max(12, Math.ceil(visibleBlockCount * 0.2));

    if (initialCollisionCount <= acceptableCollisionCount) {
      return {
        ...plan,
        collisionAdjustment: {
          applied: initialCollisionCount === 0,
          collisionCount: initialCollisionCount,
          offset: { x: 0, y: 0, z: 0 },
          searchOffset: { x: 0, y: 0, z: 0 },
          rotation: plan.rotation,
          originalAnchor: {
            x: plan.anchor.x,
            y: plan.anchor.y,
            z: plan.anchor.z,
          },
          originalRotation: plan.rotation,
          tolerated: initialCollisionCount > 0,
        },
      };
    }

    const candidateRotations = [
      plan.rotation,
      (plan.rotation + 1) % 4,
      (plan.rotation + 3) % 4,
      (plan.rotation + 2) % 4,
    ];
    const best = {
      score: Number.POSITIVE_INFINITY,
      plan,
    };
    const localBounds = plan.localBounds ?? getBounds(plan.localBlocks);
    const localCenter = localBounds
      ? {
        x: Math.round((localBounds.minX + localBounds.maxX) / 2),
        z: Math.round((localBounds.minZ + localBounds.maxZ) / 2),
      }
      : { x: 0, z: 0 };
    const originalRotatedCenter = rotateLocalPoint(localCenter, plan.rotation);
    const placementCenter = {
      x: Math.trunc(plan.anchor.x) + originalRotatedCenter.x,
      z: Math.trunc(plan.anchor.z) + originalRotatedCenter.z,
    };
    const getRotationBaseAnchor = (rotation) => {
      const rotatedCenter = rotateLocalPoint(localCenter, rotation);

      return new THREE.Vector3(
        Math.round(placementCenter.x - rotatedCenter.x),
        Math.trunc(plan.anchor.y),
        Math.round(placementCenter.z - rotatedCenter.z),
      );
    };
    const seenCandidates = new Set();
    const evaluateCandidate = (anchor, rotation, searchOffset, rotationPenalty = 0) => {
      const key = `${anchor.x},${anchor.y},${anchor.z},${rotation}`;

      if (seenCandidates.has(key)) {
        return null;
      }

      seenCandidates.add(key);
      const worldBlocks = dedupeBlocks(this.toWorldBlocks(plan.localBlocks, anchor, rotation));
      const bounds = getBounds(worldBlocks);

      if (!bounds || bounds.maxY >= WORLD_BUILD_HEIGHT) {
        return null;
      }

      const collisionCount = this.countPlanCollisions(worldBlocks, ignoreKeys);
      const score = collisionCount * 100000
        + (Math.abs(searchOffset.x) + Math.abs(searchOffset.z)) * 120
        + Math.abs(searchOffset.y) * 140
        + rotationPenalty;
      const anchorOffset = {
        x: anchor.x - Math.trunc(plan.anchor.x),
        y: anchor.y - Math.trunc(plan.anchor.y),
        z: anchor.z - Math.trunc(plan.anchor.z),
      };

      return {
        score,
        collisionCount,
        plan: {
          ...plan,
          anchor,
          rotation,
          blocks: worldBlocks,
          bounds,
          collisionAdjustment: {
            applied: collisionCount === 0,
            collisionCount,
            offset: anchorOffset,
            searchOffset,
            rotation,
            originalAnchor: {
              x: plan.anchor.x,
              y: plan.anchor.y,
              z: plan.anchor.z,
            },
            originalRotation: plan.rotation,
          },
        },
      };
    };

    const candidateOffsets = [];
    const isLargePlan = visibleBlockCount >= 800;

    if (isLargePlan) {
      const horizontalOffsets = [0, -4, 4, -8, 8, -12, 12, -16, 16, -24, 24];

      for (let y = 0; y <= 6; y += 2) {
        for (const dx of horizontalOffsets) {
          for (const dz of horizontalOffsets) {
            candidateOffsets.push({ x: dx, y, z: dz });
          }
        }
      }
    } else {
      for (let y = 0; y <= 8; y += 1) {
        for (let radius = 0; radius <= 6; radius += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            for (let dz = -radius; dz <= radius; dz += 1) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) {
                continue;
              }

              candidateOffsets.push({ x: dx, y, z: dz });
            }
          }
        }
      }
    }

    candidateOffsets.sort((a, b) => (
      Math.abs(a.x) + Math.abs(a.z) + a.y * 1.5
    ) - (
      Math.abs(b.x) + Math.abs(b.z) + b.y * 1.5
    ));

    for (const rotation of candidateRotations) {
      const rotationPenalty = rotation === plan.rotation ? 0 : 8000 + Math.min((rotation - plan.rotation + 4) % 4, (plan.rotation - rotation + 4) % 4) * 1000;
      const baseAnchor = getRotationBaseAnchor(rotation);

      for (const offset of candidateOffsets) {
        const rotatedCenter = rotateLocalPoint(localCenter, rotation);
        const centerX = baseAnchor.x + offset.x + rotatedCenter.x;
        const centerZ = baseAnchor.z + offset.z + rotatedCenter.z;
        const surfaceY = isLargePlan
          ? this.worldManager.getSurfaceHeightAt(centerX, centerZ)
          : null;
        const baseY = isLargePlan && Number.isFinite(surfaceY)
          ? surfaceY + 1
          : baseAnchor.y;
        const anchor = new THREE.Vector3(
          baseAnchor.x + offset.x,
          Math.max(0, baseY + offset.y),
          baseAnchor.z + offset.z,
        );
        const candidate = evaluateCandidate(anchor, rotation, offset, rotationPenalty);

        if (!candidate) {
          continue;
        }

        if (candidate.collisionCount === 0) {
          return candidate.plan;
        }

        if (candidate.score < best.score) {
          best.score = candidate.score;
          best.plan = candidate.plan;
        }
      }
    }

    return best.plan;
  }

  getClearVolume(plan) {
    if (!plan?.bounds) {
      return null;
    }

    return {
      minX: plan.bounds.minX - BUILD_PADDING,
      minY: Math.max(0, plan.bounds.minY),
      minZ: plan.bounds.minZ - BUILD_PADDING,
      maxX: plan.bounds.maxX + BUILD_PADDING,
      maxY: plan.bounds.maxY + BUILD_PADDING,
      maxZ: plan.bounds.maxZ + BUILD_PADDING,
    };
  }

  clearVolume(volume) {
    const blocks = [];

    for (let y = volume.minY; y <= volume.maxY; y += 1) {
      for (let x = volume.minX; x <= volume.maxX; x += 1) {
        for (let z = volume.minZ; z <= volume.maxZ; z += 1) {
          blocks.push({ x, y, z, blockId: 0, part: 'clear' });
        }
      }
    }

    this.worldManager.setBlocksAt(blocks);
  }

  buildRuntimeRecord(plan, status, localRecord = null, extra = {}) {
    const id = extra.id ?? localRecord?.serverRecordId ?? plan.localId;
    const referenceMaterials = Array.isArray(plan.meta?.referenceMaterials) ? plan.meta.referenceMaterials : [];
    const customBlocks = getPlanCustomBlocks(plan);
    const creator = this.buildCreatorPayload();

    return {
      id,
      localId: plan.localId,
      status,
      prompt: plan.prompt,
      title: localRecord?.title ?? plan.prompt ?? 'AI 建筑',
      generationMs: Number.isFinite(localRecord?.generationMs) ? localRecord.generationMs : plan.generationMs,
      anchor: plan.anchor,
      rotation: plan.rotation,
      bounds: plan.bounds,
      blocks: plan.blocks,
      localBlocks: plan.localBlocks,
      counts: plan.counts,
      model: plan.model,
      fallback: plan.fallback,
      meta: plan.meta,
      customBlocks,
      prompts: plan.prompts,
      mergedPrompt: plan.mergedPrompt ?? plan.prompts?.integrated ?? '',
      aiAccess: plan.aiAccess ?? null,
      collisionAdjustment: plan.collisionAdjustment ?? null,
      referenceImage: getReferenceImageSummary(this.referenceImage ?? localRecord?.referenceImage ?? null),
      referenceMaterials,
      creator,
      userId: creator.userId,
      playerId: creator.playerId,
      isCreator: true,
      ...extra,
    };
  }

  applyPlan(plan, { status = 'preview', record = null } = {}) {
    if (!plan?.blocks?.length) {
      this.lastApplyResult = {
        requested: 0,
        visible: 0,
        changed: 0,
        changedVisible: 0,
      };
      return 0;
    }

    if (this.currentPlacement?.status === 'preview' && this.currentPlacement?.volume) {
      this.clearVolume(this.currentPlacement.volume);
    }

    if (this.currentPlacement?.status === 'preview' && this.currentPlacement?.recordId) {
      this.worldManager.unregisterPlayerBuildingRecord(this.currentPlacement.recordId);
    }

    const volume = this.getClearVolume(plan);

    const blocks = plan.blocks.map((block) => ({
      x: block.x,
      y: block.y,
      z: block.z,
      blockId: block.blockId,
      part: block.part,
    }));

    this.worldManager.registerCustomBlocks?.(getPlanCustomBlocks(plan), { refreshMesh: false });
    const results = this.worldManager.setBlocksAt(blocks);
    const visible = blocks.filter((block) => Math.trunc(Number(block.blockId) || 0) !== 0).length;
    const changed = results.filter((result) => result.changed).length;
    const changedVisible = results.filter((result, index) => (
      result.changed && Math.trunc(Number(blocks[index]?.blockId) || 0) !== 0
    )).length;

    this.lastApplyResult = {
      requested: blocks.length,
      visible,
      changed,
      changedVisible,
    };
    const runtimeRecord = record ?? this.buildRuntimeRecord(plan, status);
    this.worldManager.registerPlayerBuildingRecord(runtimeRecord);
    this.currentPlacement = { ...plan, volume, recordId: runtimeRecord.id, status };
    return visible;
  }

  createStoredRecord(localId, status, extra = {}) {
    return upsertLocalBuildingRecord({
      localId,
      status,
      createdAt: extra.createdAt ?? Date.now(),
      prompt: extra.prompt ?? '',
      title: (extra.prompt ?? 'AI 建筑').slice(0, 48),
      referenceImage: getReferenceImageSummary(extra.referenceImage ?? this.referenceImage),
      ...extra,
    });
  }

  getSelectedRecord() {
    return this.localRecords.find((record) => record.localId === this.selectedRecordId) ?? null;
  }

  getRecordReferenceSummary(record) {
    const referenceImage = record.referenceImage ?? null;
    const referenceMaterials = Array.isArray(record.referenceMaterials)
      ? record.referenceMaterials
      : [];

    return [
      referenceImage?.name ?? '',
      referenceMaterials.length ? `${referenceMaterials.length} 项材料` : '',
    ].filter(Boolean).join(' · ') || '无';
  }

  buildCreatorPayload() {
    const user = this.currentUser ?? {};

    return {
      userId: String(user.userId ?? user.id ?? '').trim() || null,
      nickname: String(user.nickname ?? user.name ?? user.username ?? '').trim().slice(0, 24) || null,
      playerId: String(this.currentPlayerId ?? '').trim() || null,
    };
  }

  buildAppliedPayload(plan, localRecord) {
    const referenceMaterials = Array.isArray(plan.meta?.referenceMaterials) ? plan.meta.referenceMaterials : [];
    const customBlocks = getPlanCustomBlocks(plan);
    const referenceImage = getReferenceImageSummary(this.referenceImage ?? localRecord?.referenceImage ?? null);

    return {
      status: 'active',
      prompt: plan.prompt,
      title: localRecord?.title ?? plan.prompt,
      generationMs: Number.isFinite(localRecord?.generationMs) ? localRecord.generationMs : Math.round(plan.generationMs ?? 0),
      anchor: plan.anchor,
      rotation: plan.rotation,
      bounds: plan.bounds,
      blocks: plan.blocks,
      localBlocks: plan.localBlocks,
      counts: plan.counts,
      model: plan.model,
      fallback: plan.fallback,
      meta: plan.meta,
      customBlocks,
      prompts: plan.prompts,
      mergedPrompt: plan.mergedPrompt ?? plan.prompts?.integrated ?? '',
      aiAccess: plan.aiAccess ?? null,
      collisionAdjustment: plan.collisionAdjustment ?? null,
      referenceMaterials,
      referenceImage,
      creator: this.buildCreatorPayload(),
      userId: this.currentUser?.userId ?? null,
      playerId: this.currentPlayerId,
    };
  }

  buildPreviewPayload(plan, generationMs) {
    const customBlocks = getPlanCustomBlocks(plan);

    return {
      createdAt: Date.now(),
      prompt: plan.prompt,
      title: plan.prompt,
      generationMs,
      anchor: plan.anchor,
      rotation: plan.rotation,
      bounds: plan.bounds,
      blocks: plan.blocks,
      localBlocks: plan.localBlocks,
      counts: plan.counts,
      model: plan.model,
      fallback: plan.fallback,
      meta: plan.meta,
      customBlocks,
      prompts: plan.prompts,
      mergedPrompt: plan.mergedPrompt ?? plan.prompts?.integrated ?? '',
      aiAccess: plan.aiAccess ?? null,
      collisionAdjustment: plan.collisionAdjustment ?? null,
      referenceMaterials: plan.meta?.referenceMaterials ?? [],
      referenceImage: getReferenceImageSummary(this.referenceImage),
      creator: this.buildCreatorPayload(),
      userId: this.currentUser?.userId ?? null,
      playerId: this.currentPlayerId,
    };
  }

  syncCurrentPlacementRecord(localRecord) {
    if (!this.currentPlan || !this.currentPlacement || !localRecord?.serverRecordId) {
      return;
    }

    const previousRecordId = this.currentPlacement.recordId;
    const runtimeRecord = this.buildRuntimeRecord(this.currentPlan, 'preview', localRecord, {
      id: localRecord.serverRecordId,
      serverRecordId: localRecord.serverRecordId,
    });

    if (previousRecordId && previousRecordId !== runtimeRecord.id) {
      this.worldManager.unregisterPlayerBuildingRecord(previousRecordId);
    }

    this.worldManager.registerPlayerBuildingRecord(runtimeRecord);
    this.currentPlacement = {
      ...this.currentPlacement,
      recordId: runtimeRecord.id,
    };
  }

  async storePreviewPlan(localId, generationMs, plan = this.currentPlan) {
    if (!plan) {
      return null;
    }

    const previewPayload = this.buildPreviewPayload(plan, generationMs);
    this.createStoredRecord(localId, 'preview', previewPayload);

    let serverRecord = null;
    let serverError = '';

    try {
      serverRecord = await appendPlayerBuildingRecord({
        ...previewPayload,
        status: 'preview',
      });
    } catch (error) {
      serverError = error.message;
    }

    upsertLocalBuildingRecord({
      localId,
      status: 'preview',
      serverRecordId: serverRecord?.id ?? null,
      serverError,
      prompts: plan.prompts,
    });
    this.refreshLocalRecords();
    return getLocalBuildingRecord(localId);
  }

  async requestAiBuildingPlan(prompt) {
    let referenceMaterials = [];

    try {
      referenceMaterials = await buildReferenceTextureMaterials(this.referenceImage);
    } catch {
      referenceMaterials = [];
    }

    const response = await fetch(`${this.apiBase}${this.apiPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson, application/json',
        'X-AI-Progress': '1',
      },
      body: JSON.stringify({
        prompt,
        referenceImage: this.referenceImage,
        referenceMaterials,
      }),
    });
    const contentType = String(response.headers.get('content-type') ?? '');

    if (contentType.includes('application/x-ndjson')) {
      let finalPayload = null;

      await readNdjsonResponse(response, (event) => {
        this.pushGenerationEvent(event);

        if (event?.type === 'final') {
          finalPayload = event;
        }

        if (event?.type === 'error' && !finalPayload) {
          finalPayload = event;
        }
      });

      if (!finalPayload) {
        throw new Error('AI 流式响应没有返回最终结果。');
      }

      if (finalPayload.ok === false) {
        const error = new Error(finalPayload.error ?? 'AI 建筑生成失败');
        error.aiAccess = finalPayload.aiAccess ?? null;
        error.prompts = finalPayload.prompts ?? null;
        error.meta = finalPayload.meta ?? null;
        error.generationTrace = finalPayload.meta?.generationTrace ?? null;
        throw error;
      }

      return finalPayload;
    }

    const payload = await response.json();

    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error ?? `大模型请求失败：HTTP ${response.status}`);
      error.aiAccess = payload?.aiAccess ?? null;
      error.prompts = payload?.prompts ?? null;
      error.meta = payload?.meta ?? null;
      throw error;
    }

    return payload;
  }

  renderRecordList() {
    const list = this.element.querySelector('[data-ai-records]');

    if (!list) {
      return;
    }

    list.replaceChildren();

    if (!this.localRecords.length) {
      const empty = document.createElement('div');
      empty.className = 'ai-building__record-empty';
      empty.textContent = '暂无记录';
      list.append(empty);
      return;
    }

    this.localRecords.slice(0, 20).forEach((record) => {
      const row = document.createElement('button');
      row.className = 'ai-building__record';
      row.classList.toggle('is-selected', record.localId === this.selectedRecordId);
      row.type = 'button';
      row.dataset.aiRecordId = record.localId;

      const title = document.createElement('strong');
      title.textContent = record.prompt || 'AI 建筑';
      const meta = document.createElement('span');
      const count = Number.isFinite(record.blockCount)
        ? record.blockCount
        : Array.isArray(record.blocks)
          ? record.blocks.length
          : 0;
      meta.textContent = [
        getRecordStatusLabel(record),
        formatSaveTime(record.createdAt),
        count ? `${count} 方块` : '',
        Number.isFinite(record.generationMs) && record.generationMs > 0 ? formatDuration(record.generationMs) : '',
      ].filter(Boolean).join(' · ');

      const remove = document.createElement('button');
      remove.className = 'ai-building__record-delete';
      remove.type = 'button';
      remove.dataset.aiRecordDelete = record.localId;
      remove.textContent = '删除';

      row.append(title, meta);
      const wrapper = document.createElement('div');
      wrapper.className = 'ai-building__record-row';
      wrapper.append(row, remove);
      list.append(wrapper);
    });
  }

  showRecordDetail(localId) {
    const record = this.localRecords.find((item) => item.localId === localId);

    if (!record) {
      return;
    }

    this.selectedRecordId = localId;
    this.renderRecordList();
    this.render();

    const meta = this.element.querySelector('[data-ai-meta]');
    const json = this.element.querySelector('[data-ai-json]');

    if (meta) {
      meta.textContent = [
        getRecordStatusLabel(record),
        record.aiAccess?.success ? '大模型访问成功' : record.aiAccess?.message ?? '',
        Number.isFinite(record.generationMs) && record.generationMs > 0 ? `耗时 ${formatDuration(record.generationMs)}` : '',
        record.serverRecordId ? '已保存数据库' : record.status === 'active' ? '数据库保存失败' : '本地记录',
        this.getRecordReferenceSummary(record),
      ].filter(Boolean).join(' · ');
    }

    this.renderPromptTrace(record.prompts, record.meta?.referenceDescription);

    if (json) {
      json.hidden = this.inputMode !== 'array';
      json.textContent = this.inputMode === 'array'
        ? JSON.stringify(record, null, 2)
        : '';
    }
  }

  async deleteRecord(localId) {
    const record = this.localRecords.find((item) => item.localId === localId);

    if (!record) {
      return;
    }

    if (!window.confirm(`确认删除记录「${record.title || record.prompt || 'AI 建筑'}」吗？`)) {
      return;
    }

    if (record.serverRecordId) {
      try {
        await deletePlayerBuildingRecord(record.serverRecordId);
      } catch (error) {
        this.setStatus(`数据库删除失败：${error.message}`);
      }
    }

    deleteLocalBuildingRecord(localId);

    if (this.selectedRecordId === localId) {
      this.selectedRecordId = null;
      this.renderCurrentPlan(this.currentPlan ? null : undefined);
    }

    this.refreshLocalRecords();
    this.render();
    this.setStatus('已删除记录');
  }

  async generate() {
    if (this.inputMode === 'array') {
      this.generateFromArray();
      return;
    }

    const prompt = this.element.querySelector('[data-ai-prompt]')?.value.trim();

    if (!prompt) {
      this.setStatus('请输入生成指令');
      return;
    }

    if (this.isGenerating) {
      this.setStatus('正在生成');
      return;
    }

    this.isGenerating = true;
    const localId = createLocalRecordId();
    const createdAt = Date.now();
    const placementSnapshot = this.getPlacementSnapshot();
    this.activeGenerationLocalId = localId;
    this.startGenerationState(prompt);
    this.createStoredRecord(localId, 'generating', {
      createdAt,
      prompt,
      referenceImage: getReferenceImageSummary(this.referenceImage),
    });
    this.selectedRecordId = localId;
    this.refreshLocalRecords();
    this.setStatus('生成中');
    this.startGenerationTimer();

    try {
      const payload = await this.requestAiBuildingPlan(prompt);
      const finalPayload = payload?.type === 'final' ? payload : payload;
      const buildingBlocks = finalPayload.building ?? payload.building ?? [];
      const plan = this.buildPlacementPlan(buildingBlocks, { placementSnapshot });

      if (!plan) {
        throw new Error('模型没有返回可用建筑方块');
      }

      const customBlocks = [
        ...(Array.isArray(finalPayload.customBlocks) ? finalPayload.customBlocks : []),
        ...(Array.isArray(finalPayload.meta?.customBlocks) ? finalPayload.meta.customBlocks : []),
      ];
      const meta = {
        ...(finalPayload.meta ?? {}),
        customBlocks,
      };
      this.worldManager.registerCustomBlocks?.(customBlocks, { refreshMesh: true });
      this.currentPlan = {
        prompt,
        ...plan,
        counts: finalPayload.counts ?? null,
        meta,
        customBlocks,
        prompts: finalPayload.prompts ?? finalPayload.meta?.prompts ?? null,
        mergedPrompt: finalPayload.mergedPrompt
          ?? finalPayload.prompts?.integrated
          ?? finalPayload.meta?.prompts?.integrated
          ?? '',
        aiAccess: finalPayload.aiAccess ?? null,
        fallback: Boolean(finalPayload.fallback),
        model: finalPayload.model ?? 'unknown',
        localId,
        generationMs: Math.round(this.stopGenerationTimer('生成完成')),
      };

      const previewRecord = this.createStoredRecord(localId, 'preview', this.buildPreviewPayload(
        this.currentPlan,
        this.currentPlan.generationMs,
      ));
      const count = this.applyPlan(this.currentPlan, {
        status: 'preview',
        record: this.buildRuntimeRecord(this.currentPlan, 'preview', previewRecord),
      });
      this.renderCurrentPlan(finalPayload);
      this.renderGenerationState();
      this.selectedRecordId = localId;
      this.refreshLocalRecords();
      this.render();

      const localRecord = await this.storePreviewPlan(localId, this.currentPlan.generationMs, this.currentPlan);
      this.syncCurrentPlacementRecord(localRecord);
      this.refreshLocalRecords();

      const accessMessage = finalPayload.aiAccess?.message ?? '大模型访问成功：建筑生成已完成。';
      const collisionAdjustment = this.currentPlan.collisionAdjustment ?? null;
      const moved = Boolean(
        collisionAdjustment
        && (
          (Math.abs(Number(collisionAdjustment.offset?.x ?? 0)) + Math.abs(Number(collisionAdjustment.offset?.y ?? 0)) + Math.abs(Number(collisionAdjustment.offset?.z ?? 0)) > 0)
          || collisionAdjustment.rotation !== collisionAdjustment.originalRotation
        ),
      );
      const collisionNote = moved
        ? `，已自动调整摆放${collisionAdjustment?.collisionCount > 0 ? `以避开 ${collisionAdjustment.collisionCount} 处碰撞` : ''}`
        : '';
      const applyResult = this.lastApplyResult ?? null;
      const writeNote = applyResult && applyResult.changedVisible === 0 && count > 0
        ? '，地图方块已存在或未产生新的可见变化'
        : '';
      this.setStatus(`${accessMessage} 已生成预览 ${count} 个可见方块${collisionNote}${writeNote}，点击应用保存`);
    } catch (error) {
      this.stopGenerationTimer('生成中断');
      this.setStatus(error.aiAccess?.message ?? `大模型访问失败：${error.message}`);
      this.pushGenerationEvent({
        type: 'error',
        error: error.message,
        aiAccess: error.aiAccess ?? null,
      });
      this.currentPlan = null;
      this.createStoredRecord(localId, 'completed', {
        createdAt,
        prompt,
        error: error.message,
        generationMs: Math.round(performance.now() - this.generationStartedAt),
        referenceImage: getReferenceImageSummary(this.referenceImage),
        prompts: error.prompts ?? null,
        meta: {
          ...(error.meta ?? {}),
          generationTrace: error.generationTrace ?? this.generationState?.timeline ?? null,
        },
        aiAccess: error.aiAccess ?? null,
      });
      this.refreshLocalRecords();
      this.renderCurrentPlan({
        error: error.message,
        prompts: error.prompts ?? null,
        meta: {
          ...(error.meta ?? {}),
          generationTrace: error.generationTrace ?? this.generationState?.timeline ?? null,
        },
        aiAccess: error.aiAccess ?? null,
      });
    } finally {
      clearInterval(this.generationTimer);
      this.generationTimer = 0;
      this.isGenerating = false;
      if (this.activeGenerationLocalId === localId) {
        this.activeGenerationLocalId = null;
      }
      this.renderGenerationState();
    }
  }

  async generateFromArray() {
    const rawValue = this.element.querySelector('[data-ai-array]')?.value.trim();

    if (!rawValue) {
      this.setStatus('请输入建筑数组');
      return;
    }

    if (this.isGenerating) {
      this.setStatus('正在生成');
      return;
    }

    const localId = createLocalRecordId();
    const startedAt = performance.now();
    const previousPlan = this.currentPlan;
    const placementSnapshot = this.getPlacementSnapshot();

    try {
      const parsed = parseManualBuildingArray(rawValue);
      let referenceMaterials = [
        ...(Array.isArray(parsed.meta?.referenceMaterials) ? parsed.meta.referenceMaterials : []),
        ...parsed.referenceMaterials,
      ];
      let customBlocks = [
        ...(Array.isArray(parsed.meta?.customBlocks) ? parsed.meta.customBlocks : []),
        ...parsed.customBlocks,
      ];

      let resolvedBlocks = parsed.blocks;

      if (referenceMaterials.length > 0) {
        try {
          const resolved = await resolveBuildingModule({
            blocks: parsed.blocks,
            referenceMaterials,
            customBlocks,
            meta: parsed.meta,
            prompt: 'manual-array',
          });

          resolvedBlocks = resolved.blocks.length ? resolved.blocks : resolvedBlocks;
          referenceMaterials = resolved.referenceMaterials.length ? resolved.referenceMaterials : referenceMaterials;
          customBlocks = [
            ...customBlocks,
            ...resolved.customBlocks,
          ];
          parsed.meta = {
            ...parsed.meta,
            ...resolved.meta,
          };
        } catch (error) {
          this.setStatus(`鑷缓鏂瑰潡瑙ｆ瀽澶辫触锛?${error.message}`);
        }
      }

      this.worldManager.registerCustomBlocks?.(customBlocks, { refreshMesh: true });
      const plan = this.buildPlacementPlan(applyReferenceMaterialsToManualBlocks(resolvedBlocks, referenceMaterials), { placementSnapshot });

      if (!plan) {
        throw new Error('建筑数组没有可用方块');
      }

      const prompt = `手动建筑数组 · ${parsed.sourceCount} 个方块`;
      this.currentPlan = {
        prompt,
        ...plan,
        counts: null,
        meta: {
          ...parsed.meta,
          inputMode: 'array',
          sourceCount: parsed.sourceCount,
          normalized: true,
          referenceMaterials,
          customBlocks,
        },
        customBlocks,
        prompts: {
          input: prompt,
          integrated: prompt,
        },
        mergedPrompt: prompt,
        fallback: false,
        model: 'manual-array',
        localId,
        generationMs: Math.round(performance.now() - startedAt),
      };

      const localRecord = this.createStoredRecord(localId, 'preview', {
        createdAt: Date.now(),
        prompt,
        title: '手动建筑数组',
        generationMs: this.currentPlan.generationMs,
        anchor: this.currentPlan.anchor,
        rotation: this.currentPlan.rotation,
        bounds: this.currentPlan.bounds,
        blocks: this.currentPlan.blocks,
        localBlocks: this.currentPlan.localBlocks,
        counts: this.currentPlan.counts,
        model: this.currentPlan.model,
        fallback: false,
        meta: this.currentPlan.meta,
        customBlocks: this.currentPlan.customBlocks,
        prompts: this.currentPlan.prompts,
        aiAccess: this.currentPlan.aiAccess ?? null,
        referenceMaterials,
      });
      const count = this.applyPlan(this.currentPlan, {
        status: 'preview',
        record: this.buildRuntimeRecord(this.currentPlan, 'preview', localRecord),
      });

      this.selectedRecordId = localId;
      this.refreshLocalRecords();
      this.renderCurrentPlan();
      this.render();
      this.setTimerText(`状态：数组解析完成 · ${formatDuration(this.currentPlan.generationMs)}`);
      this.setStatus(`已生成数组预览 ${count} 个方块，点击应用保存`);
    } catch (error) {
      if (!previousPlan) {
        this.renderCurrentPlan({ error: error.message });
      }
      this.setStatus(error.message);
    }
  }

  renderCurrentPlan(payload = null) {
    const meta = this.element.querySelector('[data-ai-meta]');
    const json = this.element.querySelector('[data-ai-json]');
    const applyButton = this.element.querySelector('[data-ai-apply]');

    if (!this.currentPlan) {
      meta.textContent = payload?.aiAccess?.message
        ?? (payload?.error ? `错误：${payload.error}` : '未生成');
      json.hidden = true;
      json.textContent = '';
      applyButton.disabled = true;
      this.renderPromptTrace(
        payload?.prompts ?? null,
        payload?.meta?.referenceDescription ?? null,
      );
      return;
    }

    const summary = [
      `模型 ${this.currentPlan.model ?? 'unknown'}`,
      this.currentPlan.aiAccess?.success ? '大模型访问成功' : '',
      this.currentPlan.fallback ? '已修复' : '正常',
      `方块 ${this.currentPlan.blocks.length}`,
      Boolean(
        this.currentPlan.collisionAdjustment
        && (
          (Math.abs(Number(this.currentPlan.collisionAdjustment.offset?.x ?? 0)) + Math.abs(Number(this.currentPlan.collisionAdjustment.offset?.y ?? 0)) + Math.abs(Number(this.currentPlan.collisionAdjustment.offset?.z ?? 0)) > 0)
          || this.currentPlan.collisionAdjustment.rotation !== this.currentPlan.collisionAdjustment.originalRotation
        ),
      )
        ? `已自动调整摆放${this.currentPlan.collisionAdjustment?.collisionCount > 0 ? `，避开 ${this.currentPlan.collisionAdjustment.collisionCount} 处碰撞` : ''}`
        : '',
      this.currentPlan.counts ? summarizeCounts(this.currentPlan.localBlocks ?? this.currentPlan.blocks) : '',
    ].filter(Boolean).join(' · ');

    meta.textContent = summary;
    this.renderPromptTrace(this.currentPlan.prompts, this.currentPlan.meta?.referenceDescription);
    json.hidden = this.inputMode !== 'array';
    json.textContent = this.inputMode === 'array'
      ? JSON.stringify({
        prompt: this.currentPlan.prompt,
        localId: this.currentPlan.localId,
        inputMode: this.inputMode,
        model: this.currentPlan.model,
        anchor: this.currentPlan.anchor,
        rotation: this.currentPlan.rotation,
        localBounds: this.currentPlan.localBounds,
        generationMs: this.currentPlan.generationMs,
        blockCount: this.currentPlan.blocks.length,
        meta: this.currentPlan.meta,
        prompts: this.currentPlan.prompts,
        collisionAdjustment: this.currentPlan.collisionAdjustment ?? null,
        blocks: this.currentPlan.localBlocks ?? this.currentPlan.blocks,
        worldBlocks: this.currentPlan.blocks,
      }, null, 2)
      : '';
    applyButton.disabled = false;
  }

  renderPromptTrace(prompts, referenceDescription = null) {
    const panel = this.element.querySelector('[data-ai-prompts]');
    const content = this.element.querySelector('[data-ai-prompts-content]');

    if (!panel || !content) {
      return;
    }

    const text = formatPromptTrace(prompts, referenceDescription);
    content.textContent = text;
    panel.hidden = !text;
    panel.open = Boolean(text);
  }

  async applyCurrentPlan() {
    if (!this.currentPlan) {
      return;
    }

    const localRecord = getLocalBuildingRecord(this.currentPlan.localId) ?? this.localRecords.find((record) => record.localId === this.currentPlan.localId) ?? null;
    const count = this.applyPlan(this.currentPlan, {
      status: 'preview',
      record: this.buildRuntimeRecord(this.currentPlan, 'preview', localRecord),
    });

    if (count <= 0) {
      this.setStatus('没有可应用的方块');
      return;
    }

    if (localRecord?.status === 'preview' && localRecord.serverRecordId) {
      const payload = this.buildAppliedPayload(this.currentPlan, localRecord);

      try {
        const serverRecord = await updatePlayerBuildingRecord(localRecord.serverRecordId, payload);
        const runtimeRecord = this.buildRuntimeRecord(this.currentPlan, 'active', localRecord, {
          id: serverRecord?.id ?? localRecord.serverRecordId,
          serverRecordId: serverRecord?.id ?? localRecord.serverRecordId,
        });
        this.worldManager.unregisterPlayerBuildingRecord(this.currentPlan.localId);
        this.worldManager.registerPlayerBuildingRecord(runtimeRecord);
        this.currentPlacement = {
          ...this.currentPlacement,
          recordId: runtimeRecord.id,
          status: 'active',
        };
        upsertLocalBuildingRecord({
          ...localRecord,
          ...payload,
          status: 'active',
          serverRecordId: serverRecord?.id ?? localRecord.serverRecordId,
          serverError: '',
          appliedAt: Date.now(),
        });
        this.refreshLocalRecords();
        this.setStatus(`已应用并保存 ${count} 个方块`);
        return;
      } catch (error) {
        // If the preview record cannot be updated, fall through to the existing insert path.
        this.setStatus(`预览记录更新失败，将重新保存：${error.message}`);
      }
    }

    if (localRecord?.status === 'active' && localRecord.serverRecordId) {
      const runtimeRecord = this.buildRuntimeRecord(this.currentPlan, 'active', localRecord, {
        id: localRecord.serverRecordId,
      });
      this.worldManager.unregisterPlayerBuildingRecord(this.currentPlan.localId);
      this.worldManager.registerPlayerBuildingRecord(runtimeRecord);
      this.currentPlacement = {
        ...this.currentPlacement,
        recordId: runtimeRecord.id,
        status: 'active',
      };
      upsertLocalBuildingRecord({
        ...localRecord,
        ...this.buildAppliedPayload(this.currentPlan, localRecord),
        status: 'active',
        serverError: '',
        appliedAt: Date.now(),
      });
      this.refreshLocalRecords();
      this.setStatus(`已重新应用 ${count} 个方块`);
      return;
    }

    const payload = this.buildAppliedPayload(this.currentPlan, localRecord);
    let serverRecord = null;
    let serverError = '';

    try {
      serverRecord = await appendPlayerBuildingRecord(payload);
    } catch (error) {
      serverError = error.message;
    }

    upsertLocalBuildingRecord({
      ...(localRecord ?? {}),
      ...payload,
      localId: this.currentPlan.localId,
      status: 'active',
      serverRecordId: serverRecord?.id ?? null,
      serverError,
      appliedAt: Date.now(),
      referenceImage: getReferenceImageSummary(this.referenceImage ?? localRecord?.referenceImage ?? null),
    });
    const runtimeRecord = this.buildRuntimeRecord(this.currentPlan, 'active', localRecord, {
      id: serverRecord?.id ?? this.currentPlan.localId,
      serverRecordId: serverRecord?.id ?? null,
      serverError,
    });
    this.worldManager.unregisterPlayerBuildingRecord(this.currentPlan.localId);
    this.worldManager.registerPlayerBuildingRecord(runtimeRecord);
    this.currentPlacement = {
      ...this.currentPlacement,
      recordId: runtimeRecord.id,
      status: 'active',
    };
    this.refreshLocalRecords();
    this.render();

    if (serverRecord) {
      this.setStatus(`已应用并保存 ${count} 个方块`);
    } else {
      this.setStatus(`已应用 ${count} 个方块，数据库保存失败：${serverError || '未知错误'}`);
    }
  }

  async handleClearAction() {
    const selectedRecord = this.getSelectedRecord() ?? this.getCurrentBuildingRecordForClear();

    if (selectedRecord) {
      await this.clearSavedBuilding(selectedRecord);
      return;
    }

    if (!this.currentPlacement?.volume) {
      this.currentPlan = null;
      this.renderCurrentPlan();
      this.setStatus('已清空');
      return;
    }

    if (!window.confirm('确认清除当前建筑预览吗？')) {
      return;
    }

    this.clearCurrentPlanPreview();
  }

  getCurrentBuildingRecordForClear() {
    const recordId = this.currentPlacement?.recordId;

    if (recordId && typeof this.worldManager.getPlayerBuildingRecord === 'function') {
      const runtimeRecord = this.worldManager.getPlayerBuildingRecord(recordId);

      if (runtimeRecord) {
        return runtimeRecord;
      }
    }

    if (this.currentPlan?.localId) {
      return this.localRecords.find((record) => record.localId === this.currentPlan.localId) ?? null;
    }

    return null;
  }

  clearCurrentPlanPreview() {
    if (this.currentPlacement?.recordId) {
      this.worldManager.unregisterPlayerBuildingRecord(this.currentPlacement.recordId);
    }

    if (this.currentPlacement?.volume) {
      this.clearVolume(this.currentPlacement.volume);
    }
    this.currentPlacement = null;
    this.currentPlan = null;
    this.renderCurrentPlan();
    this.setStatus('已清除建筑');
  }

  async clearSavedBuilding(record) {
    const localRecord = this.localRecords.find((item) => (
      item.localId === record?.localId ||
      item.localId === record?.id ||
      item.serverRecordId === record?.serverRecordId ||
      item.serverRecordId === record?.id
    )) ?? null;
    const serverRecordId = record?.serverRecordId
      ?? localRecord?.serverRecordId
      ?? (record?.status === 'active' ? record?.id : null);
    const worldRecordIds = [...new Set([
      record?.id,
      record?.serverRecordId,
      localRecord?.localId,
      localRecord?.serverRecordId,
      this.currentPlacement?.recordId,
      this.currentPlan?.localId,
    ].filter(Boolean))];
    const recordId = serverRecordId ?? worldRecordIds[0] ?? null;

    if (!recordId && !this.currentPlacement?.volume) {
      return;
    }

    const title = record?.title || localRecord?.title || record?.prompt || localRecord?.prompt || 'AI 建筑';

    if (!window.confirm(`确认清除建筑「${title}」吗？`)) {
      return;
    }

    let clearedBlocks = 0;
    worldRecordIds.forEach((id) => {
      clearedBlocks = Math.max(
        clearedBlocks,
        this.worldManager.clearPlayerBuildingRecord(id),
      );
    });

    const clearVolume = this.currentPlacement?.volume
      ?? (record?.bounds || localRecord?.bounds
        ? this.getClearVolume({ bounds: record?.bounds ?? localRecord.bounds })
        : null);

    if (clearVolume) {
      this.clearVolume(clearVolume);
    }

    let remoteError = '';

    if (serverRecordId) {
      try {
        await clearRemotePlayerBuildingRecord(serverRecordId);
      } catch (error) {
        try {
          await deletePlayerBuildingRecord(serverRecordId);
        } catch (deleteError) {
          remoteError = deleteError.message || error.message;
        }
      }
    }

    if (localRecord) {
      setLocalBuildingRecordStatus(localRecord.localId, 'cleared', {
        clearedAt: Date.now(),
        serverRecordId: serverRecordId ?? localRecord.serverRecordId ?? null,
        serverError: remoteError,
      });
    }

    if (
      this.currentPlan?.localId === localRecord?.localId ||
      worldRecordIds.includes(this.currentPlacement?.recordId)
    ) {
      this.currentPlacement = null;
      this.currentPlan = null;
      this.renderCurrentPlan();
    }

    this.refreshLocalRecords();
    this.render();

    if (remoteError) {
      this.setStatus(`已清除地图建筑，但数据库清除失败：${remoteError}`);
      return;
    }

    this.setStatus(clearedBlocks > 0 ? `已清除建筑 · ${clearedBlocks} 个方块` : '已清除建筑');
  }

  syncPreview() {
    if (!this.currentPlan || this.currentPlacement) {
      return;
    }

    const placement = this.getPlayerPlacement(this.currentPlan.localBounds ?? null);
    const normalizedBlocks = this.toWorldBlocks(this.currentPlan.localBlocks ?? [], placement.anchor, placement.rotation);
    const adjustedPlan = this.adjustPlanForCollisions({
      ...this.currentPlan,
      anchor: placement.anchor,
      rotation: placement.rotation,
      blocks: dedupeBlocks(normalizedBlocks),
      bounds: getBounds(normalizedBlocks),
    });

    this.currentPlan = adjustedPlan;

    this.renderCurrentPlan();
  }

  render() {
    this.element.querySelector('[data-ai-toggle]')?.setAttribute('aria-pressed', String(this.isOpen));
    this.element.querySelector('[data-ai-panel]')?.classList.toggle('is-open', this.isOpen);
    this.element.querySelectorAll('[data-ai-mode]').forEach((button) => {
      const isActive = button.dataset.aiMode === this.inputMode;

      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });
    this.element.querySelector('[data-ai-prompt-field]')?.toggleAttribute('hidden', this.inputMode !== 'prompt');
    this.element.querySelector('[data-ai-reference-field]')?.toggleAttribute('hidden', this.inputMode !== 'prompt');
    const generateButton = this.element.querySelector('[data-ai-generate]');

    if (generateButton) {
      generateButton.textContent = this.inputMode === 'array' ? '解析预览' : '生成';
    }

    const clearButton = this.element.querySelector('[data-ai-clear]');
    const selectedRecord = this.getSelectedRecord();

    if (clearButton) {
      clearButton.textContent = selectedRecord?.serverRecordId && selectedRecord.status !== 'cleared'
        ? '清除建筑'
        : '清除';
    }

    this.renderGenerationState();
  }

  dispose() {
    clearInterval(this.generationTimer);
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.element.remove();
  }
}
