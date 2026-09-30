const SAVE_API_BASE = import.meta.env.VITE_SAVE_API_BASE ?? '';
const PLAYER_ID = import.meta.env.VITE_PLAYER_ID ?? 'local-player';
const LOCAL_BUILDING_RECORDS_KEY = 'three-mini-world-ai-building-records';
const LOCAL_BUILDING_RECORD_LIMIT = 10;
const LOCAL_BUILDING_RECORD_FALLBACK_LIMIT = 5;
const LOCAL_BUILDING_BLOCK_PREVIEW_LIMIT = 500;
const LOCAL_BUILDING_BLOCK_FALLBACK_LIMIT = 120;
const LOCAL_BUILDING_TEXT_LIMIT = 8000;
const LOCAL_BUILDING_TEXT_FALLBACK_LIMIT = 1200;
const LOCAL_BUILDING_PROMPT_LIMIT = 4000;
const LOCAL_BUILDING_PROMPT_FALLBACK_LIMIT = 800;
const LOCAL_BUILDING_MATERIAL_LIMIT = 80;

export function getAuthToken() {
  return localStorage.getItem('three-mini-world-auth-token') ?? '';
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem('three-mini-world-auth-token', token);
  } else {
    localStorage.removeItem('three-mini-world-auth-token');
  }
}

export async function requestJson(path, options = {}) {
  const token = getAuthToken();
  const response = await fetch(`${SAVE_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Player-Id': PLAYER_ID,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error ?? `保存服务器请求失败：${response.status}`);
  }

  return payload;
}

export async function getSaveRecords() {
  const payload = await requestJson('/api/saves');
  const records = Array.isArray(payload.records) ? payload.records : [];

  return records.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function appendSaveRecord(payload) {
  const result = await requestJson('/api/saves', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return result.record;
}

export async function getSaveRecord(id) {
  if (!id) {
    return null;
  }

  const payload = await requestJson(`/api/saves/${encodeURIComponent(id)}`);

  return payload.record ?? null;
}

export function formatSaveTime(createdAt) {
  if (typeof createdAt !== 'number') {
    return '未知时间';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(createdAt));
}

export async function getPlayerBuildingRecordsInBounds(bounds = {}) {
  const params = new URLSearchParams();

  ['minX', 'maxX', 'minZ', 'maxZ'].forEach((key) => {
    if (Number.isFinite(bounds[key])) {
      params.set(key, String(Math.trunc(bounds[key])));
    }
  });

  const query = params.toString();
  const payload = await requestJson(`/api/player-buildings${query ? `?${query}` : ''}`);

  return Array.isArray(payload.records) ? payload.records : [];
}

export async function appendPlayerBuildingRecord(payload) {
  const result = await requestJson('/api/player-buildings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return result.record ?? null;
}

export async function updatePlayerBuildingRecord(id, payload) {
  if (!id) {
    return null;
  }

  const result = await requestJson(`/api/player-buildings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  return result.record ?? null;
}

export async function deletePlayerBuildingRecord(id) {
  if (!id) {
    return false;
  }

  await requestJson(`/api/player-buildings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  return true;
}

export async function clearPlayerBuildingRecord(id) {
  if (!id) {
    return null;
  }

  const result = await requestJson(`/api/player-buildings/${encodeURIComponent(id)}/clear`, {
    method: 'POST',
  });

  return result.record ?? null;
}

export async function getCustomBlocks() {
  const payload = await requestJson('/api/custom-blocks');

  return Array.isArray(payload.customBlocks) ? payload.customBlocks : [];
}

export async function resolveCustomBlocks(materials = []) {
  const payload = await requestJson('/api/custom-blocks/resolve', {
    method: 'POST',
    body: JSON.stringify({ materials }),
  });

  return {
    referenceMaterials: Array.isArray(payload.referenceMaterials) ? payload.referenceMaterials : [],
    customBlocks: Array.isArray(payload.customBlocks) ? payload.customBlocks : [],
  };
}

export async function resolveBuildingModule(payload = {}) {
  const result = await requestJson('/api/building-module/resolve', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    blocks: Array.isArray(result.blocks) ? result.blocks : [],
    localBlocks: Array.isArray(result.localBlocks) ? result.localBlocks : [],
    referenceMaterials: Array.isArray(result.referenceMaterials) ? result.referenceMaterials : [],
    customBlocks: Array.isArray(result.customBlocks) ? result.customBlocks : [],
    meta: result.meta && typeof result.meta === 'object' ? result.meta : {},
  };
}

function truncateLocalText(value, limit) {
  if (typeof value !== 'string') {
    return value;
  }

  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function compactTextureRegion(region) {
  if (!region || typeof region !== 'object') {
    return null;
  }

  return {
    id: region.id,
    role: region.role,
    label: region.label,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    confidence: region.confidence,
  };
}

function compactLocalMaterial(material) {
  if (!material || typeof material !== 'object') {
    return material;
  }

  const compacted = {
    blockId: material.blockId,
    sourceBlockId: material.sourceBlockId,
    key: material.key,
    name: material.name,
    label: material.label,
    usage: material.usage,
    confidence: material.confidence,
    color: material.color,
    opacity: material.opacity,
    opaque: material.opaque,
    custom: material.custom,
    slot: material.slot,
    proceduralSlot: material.proceduralSlot,
    part: material.part,
    textureSource: material.textureSource,
    textureRegion: compactTextureRegion(material.textureRegion),
  };

  return Object.fromEntries(Object.entries(compacted).filter(([, value]) => value !== undefined && value !== null));
}

function compactLocalMaterials(materials) {
  if (!Array.isArray(materials)) {
    return materials;
  }

  return materials.slice(0, LOCAL_BUILDING_MATERIAL_LIMIT).map(compactLocalMaterial);
}

function compactLocalBlock(block) {
  if (!block || typeof block !== 'object') {
    return block;
  }

  return {
    x: block.x,
    y: block.y,
    z: block.z,
    blockId: block.blockId ?? block.id,
    part: block.part,
  };
}

function compactLocalBlocks(blocks, limit) {
  if (!Array.isArray(blocks)) {
    return blocks;
  }

  return blocks.slice(0, limit).map(compactLocalBlock);
}

function compactLocalPromptTrace(prompts, { aggressive = false } = {}) {
  if (!prompts || typeof prompts !== 'object') {
    return prompts;
  }

  const promptLimit = aggressive ? LOCAL_BUILDING_PROMPT_FALLBACK_LIMIT : LOCAL_BUILDING_PROMPT_LIMIT;
  const compacted = {
    input: truncateLocalText(prompts.input, promptLimit),
    integrated: truncateLocalText(prompts.integrated, promptLimit),
  };

  if (!aggressive && prompts.referenceAnalysis && typeof prompts.referenceAnalysis === 'object') {
    compacted.referenceAnalysis = {
      result: truncateLocalText(prompts.referenceAnalysis.result, promptLimit),
    };
  }

  return Object.fromEntries(Object.entries(compacted).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function compactLocalGenerationTrace(trace, { aggressive = false } = {}) {
  if (!Array.isArray(trace)) {
    return trace;
  }

  return trace.slice(0, aggressive ? 10 : 30).map((event) => {
    if (!event || typeof event !== 'object') {
      return event;
    }

    return {
      at: event.at,
      type: event.type,
      message: truncateLocalText(event.message, aggressive ? 160 : 320),
      summary: truncateLocalText(event.summary, aggressive ? 160 : 320),
      progress: event.progress,
      chunk: event.chunk,
      chunkCount: event.chunkCount,
    };
  });
}

function compactLocalMeta(meta, { aggressive = false } = {}) {
  if (!meta || typeof meta !== 'object') {
    return meta;
  }

  const compacted = {
    ...meta,
    referenceMaterials: compactLocalMaterials(meta.referenceMaterials),
    customBlocks: compactLocalMaterials(meta.customBlocks),
    prompts: compactLocalPromptTrace(meta.prompts, { aggressive }),
    referenceDescription: meta.referenceDescription && typeof meta.referenceDescription === 'object'
      ? {
        result: truncateLocalText(
          meta.referenceDescription.result,
          aggressive ? LOCAL_BUILDING_TEXT_FALLBACK_LIMIT : LOCAL_BUILDING_TEXT_LIMIT,
        ),
      }
      : truncateLocalText(
        meta.referenceDescription,
        aggressive ? LOCAL_BUILDING_TEXT_FALLBACK_LIMIT : LOCAL_BUILDING_TEXT_LIMIT,
      ),
    generationTrace: compactLocalGenerationTrace(meta.generationTrace, { aggressive }),
  };

  delete compacted.blocks;
  delete compacted.localBlocks;
  delete compacted.worldBlocks;
  delete compacted.textureDataUrl;
  delete compacted.dataUrl;

  return Object.fromEntries(Object.entries(compacted).filter(([, value]) => value !== undefined && value !== null));
}

function compactLocalBuildingRecord(record, { aggressive = false } = {}) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const blockLimit = aggressive ? LOCAL_BUILDING_BLOCK_FALLBACK_LIMIT : LOCAL_BUILDING_BLOCK_PREVIEW_LIMIT;
  const textLimit = aggressive ? LOCAL_BUILDING_TEXT_FALLBACK_LIMIT : LOCAL_BUILDING_TEXT_LIMIT;
  const blocks = compactLocalBlocks(record.blocks, blockLimit);
  const localBlocks = compactLocalBlocks(record.localBlocks, blockLimit);
  const blockCount = Array.isArray(record.blocks)
    ? record.blocks.length
    : Array.isArray(record.localBlocks)
      ? record.localBlocks.length
      : record.blockCount;

  const compacted = {
    ...record,
    prompt: truncateLocalText(record.prompt, textLimit),
    title: truncateLocalText(record.title, 96),
    blocks,
    localBlocks,
    blockCount,
    meta: compactLocalMeta(record.meta, { aggressive }),
    customBlocks: compactLocalMaterials(record.customBlocks),
    referenceMaterials: compactLocalMaterials(record.referenceMaterials),
    prompts: compactLocalPromptTrace(record.prompts, { aggressive }),
    mergedPrompt: truncateLocalText(record.mergedPrompt, aggressive ? LOCAL_BUILDING_TEXT_FALLBACK_LIMIT : LOCAL_BUILDING_TEXT_LIMIT),
    truncated: true,
  };

  delete compacted.worldBlocks;
  delete compacted.textureDataUrl;
  delete compacted.dataUrl;

  return compacted;
}

function compactMinimalLocalBuildingRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    localId: record.localId,
    serverRecordId: record.serverRecordId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    appliedAt: record.appliedAt,
    prompt: truncateLocalText(record.prompt, 240),
    title: truncateLocalText(record.title, 96),
    generationMs: record.generationMs,
    model: record.model,
    fallback: record.fallback,
    blockCount: Array.isArray(record.blocks)
      ? record.blocks.length
      : Array.isArray(record.localBlocks)
        ? record.localBlocks.length
        : record.blockCount,
    counts: record.counts,
    aiAccess: record.aiAccess,
    serverError: truncateLocalText(record.serverError, 240),
    referenceImage: record.referenceImage,
    referenceMaterials: compactLocalMaterials(record.referenceMaterials),
    customBlocks: compactLocalMaterials(record.customBlocks),
    truncated: true,
  };
}

function tryWriteLocalBuildingRecords(records) {
  try {
    localStorage.setItem(LOCAL_BUILDING_RECORDS_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

function readLocalBuildingRecords() {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_BUILDING_RECORDS_KEY) ?? '[]');

    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeLocalBuildingRecords(records) {
  const recentRecords = records
    .slice(0, LOCAL_BUILDING_RECORD_LIMIT)
    .map((record) => compactLocalBuildingRecord(record));

  if (tryWriteLocalBuildingRecords(recentRecords)) {
    return;
  }

  const fallbackRecords = records
    .slice(0, LOCAL_BUILDING_RECORD_FALLBACK_LIMIT)
    .map((record) => compactLocalBuildingRecord(record, { aggressive: true }));

  if (tryWriteLocalBuildingRecords(fallbackRecords)) {
    return;
  }

  if (tryWriteLocalBuildingRecords(records.slice(0, 1).map(compactMinimalLocalBuildingRecord))) {
    return;
  }

  if (!tryWriteLocalBuildingRecords([])) {
    try {
      localStorage.removeItem(LOCAL_BUILDING_RECORDS_KEY);
    } catch {
      // Ignore browser storage failures so generation is not interrupted by cache cleanup.
    }
  }
}

export function getLocalBuildingRecords() {
  return readLocalBuildingRecords()
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function upsertLocalBuildingRecord(record) {
  const records = readLocalBuildingRecords();
  const index = records.findIndex((item) => item.localId === record.localId);
  const nextRecord = {
    ...record,
    updatedAt: Date.now(),
  };

  if (index >= 0) {
    records[index] = {
      ...records[index],
      ...nextRecord,
    };
  } else {
    records.unshift(nextRecord);
  }

  writeLocalBuildingRecords(records);
  return nextRecord;
}

export function getLocalBuildingRecord(localId) {
  return readLocalBuildingRecords().find((record) => record.localId === localId) ?? null;
}

export function setLocalBuildingRecordStatus(localId, status, extra = {}) {
  const records = readLocalBuildingRecords();
  const index = records.findIndex((record) => record.localId === localId);

  if (index < 0) {
    return null;
  }

  records[index] = {
    ...records[index],
    status,
    updatedAt: Date.now(),
    ...extra,
  };
  writeLocalBuildingRecords(records);

  return records[index];
}

export function deleteLocalBuildingRecord(localId) {
  const before = readLocalBuildingRecords();
  const after = before.filter((record) => record.localId !== localId);

  writeLocalBuildingRecords(after);
  return before.length !== after.length;
}
