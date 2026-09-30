import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { loadProjectEnv } from '../scripts/loadEnv.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');
const distRoot = resolve(projectRoot, 'dist');

loadProjectEnv(projectRoot);

const PORT = Number(process.env.SAVE_SERVER_PORT ?? process.env.PORT ?? 3001);
const ADMIN_PORT = Number(process.env.ADMIN_SERVER_PORT ?? 3002);
const MONGO_URLS = process.env.MONGO_URL
  ? [process.env.MONGO_URL]
  : ['mongodb://127.0.0.1:27017', 'mongodb://127.0.0.1:27018'];
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'three_mini_world';
const SAVE_COLLECTION = process.env.MONGO_SAVE_COLLECTION ?? 'save_records';
const USER_COLLECTION = process.env.MONGO_USER_COLLECTION ?? 'users';
const PROFILE_COLLECTION = process.env.MONGO_PROFILE_COLLECTION ?? 'player_profiles';
const PLAYER_BUILDING_COLLECTION = process.env.MONGO_PLAYER_BUILDING_COLLECTION ?? 'player_buildings';
const CUSTOM_BLOCK_COLLECTION = process.env.MONGO_CUSTOM_BLOCK_COLLECTION ?? 'custom_blocks';
const MONGO_CONNECT_TIMEOUT_MS = Number(process.env.MONGO_CONNECT_TIMEOUT_MS ?? 3500);
const AI_API_BASE_URL = process.env.AI_API_BASE_URL ?? 'https://api.runningrun.org';
const AI_API_KEY = process.env.AI_API_KEY ?? '';
const AI_MODEL = normalizeAiModel(process.env.AI_MODEL ?? 'gpt-5.5');
const AI_REFERENCE_MODEL = normalizeAiModel(process.env.AI_REFERENCE_MODEL ?? AI_MODEL);
const AI_BUILD_API_BASE_URL = process.env.AI_BUILD_API_BASE_URL ?? AI_API_BASE_URL;
const AI_BUILD_API_KEY = process.env.AI_BUILD_API_KEY ?? AI_API_KEY;
const AI_BUILD_MODEL = normalizeAiModel(process.env.AI_BUILD_MODEL ?? 'deepseek-ai/DeepSeek-V4-Flash');
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 60000);
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET ?? 'three-mini-world-dev-secret';
const AUTH_TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);
const CONFIGURED_ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? '';
const CONFIGURED_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const CONFIGURED_ADMIN_NICKNAME = process.env.ADMIN_NICKNAME ?? '系统管理员';
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const DEFAULT_PLAYER_ID = 'local-player';
const DEFAULT_COINS = 120;
const AI_BUILD_LIMIT = clampInteger(process.env.AI_BUILD_LIMIT ?? 10000, 1000, 10000);
const AI_BUILD_DEFAULT_CHUNK_COUNT = 8;
const AI_BUILD_CHUNK_SIZE = Math.max(
  120,
  Math.min(
    200,
    Math.trunc(Number(process.env.AI_BUILD_CHUNK_SIZE ?? 180)) || 180,
  ),
);
const AI_BUILD_CONCURRENCY = Math.max(
  1,
  Math.min(2, Math.trunc(Number(process.env.AI_BUILD_CONCURRENCY ?? 2) || 2)),
);
const AI_BUILD_CHUNKS = Object.freeze([
  {
    key: 'base-platform',
    title: '地基、台基、主平台和建筑 footprint',
    instruction: '生成完整建筑的地基、台基、主殿平台、侧翼基础和明确 footprint。必须确定整体 x/z 范围、入口方向和中轴，不要生成墙体、屋顶或庭院装饰。',
  },
  {
    key: 'main-structure',
    title: '主殿墙体、红柱和承重结构',
    instruction: '生成主殿墙体、柱廊、梁柱、承重结构和主体开间轮廓。必须落实中心主殿体量和左右对称关系，不要生成屋顶、侧翼屋身或庭院设施。',
  },
  {
    key: 'wings-corridors',
    title: '两侧配殿、廊房和围墙',
    instruction: '生成左右两侧配殿、廊房、院落围墙和连接主殿的侧向结构。必须与主殿共享坐标系并保持镜像对称，不要生成主屋顶或庭院装饰。',
  },
  {
    key: 'doors-windows',
    title: '主门、侧门、窗户和立面开间',
    instruction: '生成主殿中央入口、侧门、格栅门窗、侧廊门窗和立面开间细节。门洞可以用 blockId 0，窗户优先使用玻璃，必须按参考图的重复节奏布置。',
  },
  {
    key: 'main-roof',
    title: '主殿屋顶、重檐、深出檐和屋脊',
    instruction: '生成主殿完整屋顶、重檐、深出檐、上翘檐角、正脊、垂脊和屋顶层次。必须覆盖主殿屋顶主体，不要生成侧翼屋顶或庭院设施。',
  },
  {
    key: 'wing-roofs-decor',
    title: '配殿屋顶、廊檐、斗拱和彩绘装饰',
    instruction: '生成两侧配殿屋顶、廊檐、檐下斗拱、彩绘梁枋、屋脊小装饰和侧翼屋顶补全。必须与主殿屋顶高度比例协调。',
  },
  {
    key: 'courtyard-stairs-boundary',
    title: '台阶、御道、铺地、栏杆和院落边界',
    instruction: '生成中央台阶、左右分叉台阶、御道、庭院铺地、石栏杆、院落边界和入口前庭。必须连接主殿入口并保持中轴对称。',
  },
  {
    key: 'facilities-completion',
    title: '灯具、石兽、绿植、室内设施和最终补全',
    instruction: '生成灯具、牌匾、石狮/石兽、香炉/铜缸、绿植、室内家具、生活设施和遗漏细节。必须补齐 foundation、wall、door、window、roof、facility 六类部件中缺失或过少的内容，不能重复已有主体坐标。',
  },
]);
const AI_BUILD_MAX_TOKENS = clampInteger(process.env.AI_BUILD_MAX_TOKENS ?? 7000, 3000, 9000);
const AI_BUILD_FULL_MAX_TOKENS = clampInteger(process.env.AI_BUILD_FULL_MAX_TOKENS ?? 9000, AI_BUILD_MAX_TOKENS, 10000);
const AI_BUILD_SEGMENT_MAX_TOKENS = clampInteger(
  process.env.AI_BUILD_SEGMENT_MAX_TOKENS ?? 7000,
  5000,
  9000,
);
const AI_BUILD_BLUEPRINT_MAX_TOKENS = clampInteger(process.env.AI_BUILD_BLUEPRINT_MAX_TOKENS ?? 6000, 3500, 8000);
const AI_BUILD_CHUNK_TIMEOUT_MS = clampInteger(process.env.AI_BUILD_CHUNK_TIMEOUT_MS ?? 90000, 45000, 120000);
const AI_BUILD_TOTAL_TIMEOUT_MS = clampInteger(process.env.AI_BUILD_TOTAL_TIMEOUT_MS ?? 600000, 240000, 720000);
const AI_BUILD_ENABLE_THINKING = String(process.env.AI_BUILD_ENABLE_THINKING ?? 'false').trim().toLowerCase() === 'true';
const AI_BUILD_RESPONSE_FORMAT = String(process.env.AI_BUILD_RESPONSE_FORMAT ?? 'json_object').trim();
const AI_REQUIRED_PARTS = ['foundation', 'wall', 'door', 'window', 'roof', 'facility'];
const AI_BUILD_MAX_FOOTPRINT = 48;
const AI_BUILD_MAX_LOCAL_HEIGHT = 72;
const LOG_LEVELS = Object.freeze({
  error: 0,
  warning: 1,
  info: 2,
  trace: 3,
  debug: 4,
});
const LOG_LEVEL = normalizeLogLevel(process.env.LOG_LEVEL ?? process.env.SERVER_LOG_LEVEL ?? 'info');
const LOG_PROMPT_MAX_CHARS = Number(process.env.LOG_PROMPT_MAX_CHARS ?? 20000);
const CUSTOM_BLOCK_ID_MIN = clampInteger(process.env.CUSTOM_BLOCK_ID_MIN ?? 1000, 1000, 60000);
const CUSTOM_BLOCK_ID_MAX = clampInteger(process.env.CUSTOM_BLOCK_ID_MAX ?? 60000, CUSTOM_BLOCK_ID_MIN, 60000);
const AI_ALLOWED_BLOCK_IDS = new Set([
  0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41,
]);

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
});

let mongoClient = null;
let saveCollectionPromise = null;
let userCollectionPromise = null;
let profileCollectionPromise = null;
let playerBuildingCollectionPromise = null;
let customBlockCollectionPromise = null;

const pbkdf2 = promisify(pbkdf2Callback);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Player-Id, Authorization, X-AI-Progress',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(html);
}

function readJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeLogLevel(value) {
  const normalized = String(value ?? '').trim().toLowerCase();

  return Object.hasOwn(LOG_LEVELS, normalized) ? normalized : 'info';
}

function shouldLog(level) {
  return LOG_LEVELS[level] <= LOG_LEVELS[LOG_LEVEL];
}

function clampLogText(value, maxLength = LOG_PROMPT_MAX_CHARS) {
  const text = String(value ?? '');

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...[truncated ${text.length - maxLength} chars]`;
}

function sanitizeLogValue(value, key = '') {
  const keyText = String(key).toLowerCase();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (
    /authorization|api[_-]?key|password|secret/i.test(keyText)
    || keyText === 'token'
    || keyText.endsWith('token')
  ) {
    return '[redacted]';
  }

  if (typeof value === 'string') {
    if (/^data:image\/[^;]+;base64,/i.test(value)) {
      const header = value.slice(0, value.indexOf(',') + 1);
      return `${header}[base64 omitted ${value.length - header.length} chars]`;
    }

    return clampLogText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeLogValue(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

function log(level, message, data = null) {
  if (!shouldLog(level)) {
    return;
  }

  const prefix = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const suffix = data === null || data === undefined
    ? ''
    : ` ${JSON.stringify(sanitizeLogValue(data))}`;
  const line = `${prefix}${suffix}`;

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warning') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function summarizeReferenceImage(referenceImage) {
  if (!referenceImage) {
    return null;
  }

  return {
    name: referenceImage.name ?? null,
    mimeType: referenceImage.mimeType ?? null,
    sizeBytes: referenceImage.sizeBytes ?? null,
    dataUrlPresent: Boolean(referenceImage.dataUrl),
  };
}

function normalizeAiModel(model) {
  const trimmed = String(model ?? '').trim();

  if (!trimmed) {
    return 'gpt-5.5';
  }

  const normalized = trimmed.toLowerCase().replace(/_/g, '-');

  if (normalized === 'gtp5.5' || normalized === 'gpt5.5') {
    return 'gpt-5.5';
  }

  return trimmed;
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('AI 请求超时。')), timeoutMs);

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    },
  };
}

function createChildTimeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason ?? new Error('AI 请求超时。'));
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timer = setTimeout(() => {
    controller.abort(new Error('AI 单片请求超时。'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function getPlayerId(request) {
  const authUser = request.authUser;

  if (authUser?.userId) {
    return authUser.userId;
  }

  const headerValue = request.headers['x-player-id'];

  return typeof headerValue === 'string' && headerValue.trim()
    ? headerValue.trim().slice(0, 80)
    : DEFAULT_PLAYER_ID;
}

function getClientPlayerId(request) {
  const headerValue = request.headers['x-player-id'];

  return typeof headerValue === 'string' && headerValue.trim()
    ? headerValue.trim().slice(0, 80)
    : DEFAULT_PLAYER_ID;
}

function isCustomBlockId(blockId) {
  return Number.isInteger(blockId) && blockId >= CUSTOM_BLOCK_ID_MIN && blockId <= CUSTOM_BLOCK_ID_MAX;
}

function isAllowedBlockId(blockId) {
  return AI_ALLOWED_BLOCK_IDS.has(blockId) || isCustomBlockId(blockId);
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input) {
  return Buffer.from(String(input), 'base64url').toString('utf8');
}

function createUserId() {
  return `user-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
}

function normalizeLoginId(value) {
  return String(value ?? '').trim().toLowerCase().slice(0, 40);
}

function normalizeNickname(value) {
  return String(value ?? '').trim().slice(0, 24);
}

function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    userId: user.userId,
    username: user.username,
    nickname: user.nickname,
    role: user.role ?? 'player',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const iterations = 120000;
  const digest = 'sha256';
  const derivedKey = await pbkdf2(String(password), salt, iterations, 32, digest);

  return `pbkdf2$${digest}$${iterations}$${salt}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, digest, iterationText, salt, expectedHex] = String(storedHash ?? '').split('$');

  if (scheme !== 'pbkdf2' || !digest || !iterationText || !salt || !expectedHex) {
    return false;
  }

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await pbkdf2(String(password), salt, Number(iterationText), expected.length, digest);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function signTokenPayload(payloadJson) {
  return createHmac('sha256', AUTH_TOKEN_SECRET).update(payloadJson).digest('base64url');
}

function createAuthToken(user) {
  const payload = {
    userId: user.userId,
    role: user.role ?? 'player',
    exp: Date.now() + AUTH_TOKEN_TTL_MS,
  };
  const payloadText = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadText);

  return `${encodedPayload}.${signTokenPayload(payloadText)}`;
}

function parseAuthToken(request) {
  const headerValue = request.headers.authorization;

  if (typeof headerValue !== 'string' || !headerValue.startsWith('Bearer ')) {
    return null;
  }

  const [encodedPayload, signature] = headerValue.slice(7).split('.');

  if (!encodedPayload || !signature) {
    return null;
  }

  const payloadText = base64UrlDecode(encodedPayload);
  const expectedSignature = signTokenPayload(payloadText);

  if (signature !== expectedSignature) {
    return null;
  }

  const payload = readJsonMaybe(payloadText);

  if (!payload?.userId || Number(payload.exp ?? 0) < Date.now()) {
    return null;
  }

  return {
    userId: String(payload.userId),
    role: payload.role === 'admin' ? 'admin' : 'player',
  };
}

async function getSaveCollection() {
  if (!saveCollectionPromise) {
    saveCollectionPromise = connectMongo()
      .then((client) => client.db(MONGO_DB_NAME).collection(SAVE_COLLECTION))
      .then(async (collection) => {
        await collection.createIndex({ playerId: 1, createdAt: -1 });
        await collection.createIndex({ userId: 1, createdAt: -1 });
        await collection.createIndex({ id: 1 }, { unique: true });

        return collection;
      })
      .catch((error) => {
        saveCollectionPromise = null;
        throw error;
      });
  }

  return saveCollectionPromise;
}

async function getUserCollection() {
  if (!userCollectionPromise) {
    userCollectionPromise = connectMongo()
      .then((client) => client.db(MONGO_DB_NAME).collection(USER_COLLECTION))
      .then(async (collection) => {
        await collection.createIndex({ username: 1 }, { unique: true });
        await collection.createIndex({ nickname: 1 }, { unique: true });
        await collection.createIndex({ userId: 1 }, { unique: true });
        await ensureConfiguredAdminUser(collection);

        return collection;
      })
      .catch((error) => {
        userCollectionPromise = null;
        throw error;
      });
  }

  return userCollectionPromise;
}

async function ensureConfiguredAdminUser(collection) {
  const username = normalizeLoginId(CONFIGURED_ADMIN_USERNAME);
  const password = String(CONFIGURED_ADMIN_PASSWORD ?? '');
  const nickname = normalizeNickname(CONFIGURED_ADMIN_NICKNAME) || '系统管理员';

  if (!username || !password) {
    return;
  }

  if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 6) {
    log('warning', 'Configured admin account ignored: ADMIN_USERNAME must be 3-24 lowercase letters/digits/underscore and ADMIN_PASSWORD must be at least 6 chars.');
    return;
  }

  const now = Date.now();
  const existingAdmin = await collection.findOne({ username });
  const passwordHash = await hashPassword(password);

  try {
    if (existingAdmin) {
      await collection.updateOne(
        { username },
        {
          $set: {
            passwordHash,
            nickname,
            role: 'admin',
            updatedAt: now,
          },
        },
      );
      await ensureUserProfile({ ...existingAdmin, nickname, role: 'admin' });
      return;
    }

    const adminUser = {
      userId: createUserId(),
      username,
      nickname,
      passwordHash,
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    };

    await collection.insertOne(adminUser);
    await ensureUserProfile(adminUser);
  } catch (error) {
    if (error.code === 11000) {
      log('warning', 'Configured admin account nickname already exists.', { username, nickname });
      return;
    }

    throw error;
  }
}

async function getProfileCollection() {
  if (!profileCollectionPromise) {
    profileCollectionPromise = connectMongo()
      .then((client) => client.db(MONGO_DB_NAME).collection(PROFILE_COLLECTION))
      .then(async (collection) => {
        await collection.createIndex({ userId: 1 }, { unique: true });

        return collection;
      })
      .catch((error) => {
        profileCollectionPromise = null;
        throw error;
      });
  }

  return profileCollectionPromise;
}

async function getPlayerBuildingCollection() {
  if (!playerBuildingCollectionPromise) {
    playerBuildingCollectionPromise = connectMongo()
      .then((client) => client.db(MONGO_DB_NAME).collection(PLAYER_BUILDING_COLLECTION))
      .then(async (collection) => {
        await collection.createIndex({ id: 1 }, { unique: true });
        await collection.createIndex({ userId: 1, createdAt: -1 });
        await collection.createIndex({ playerId: 1, createdAt: -1 });
        await collection.createIndex({ userId: 1, 'bounds.minX': 1, 'bounds.maxX': 1, 'bounds.minZ': 1, 'bounds.maxZ': 1 });

        return collection;
      })
      .catch((error) => {
        playerBuildingCollectionPromise = null;
        throw error;
      });
  }

  return playerBuildingCollectionPromise;
}

async function getCustomBlockCollection() {
  if (!customBlockCollectionPromise) {
    customBlockCollectionPromise = connectMongo()
      .then((client) => client.db(MONGO_DB_NAME).collection(CUSTOM_BLOCK_COLLECTION))
      .then(async (collection) => {
        await collection.createIndex({ key: 1 }, { unique: true });
        await collection.createIndex({ blockId: 1 }, { unique: true });
        await collection.createIndex({ aliases: 1 });

        return collection;
      })
      .catch((error) => {
        customBlockCollectionPromise = null;
        throw error;
      });
  }

  return customBlockCollectionPromise;
}

async function ensureUserProfile(user) {
  const collection = await getProfileCollection();
  const now = Date.now();
  const profile = {
    userId: user.userId,
    coins: DEFAULT_COINS,
    createdAt: now,
  };

  await collection.updateOne(
    { userId: user.userId },
    { $setOnInsert: profile, $set: { nickname: user.nickname, updatedAt: now } },
    { upsert: true },
  );

  return collection.findOne({ userId: user.userId }, { projection: { _id: 0 } });
}

async function connectMongo() {
  if (mongoClient) {
    return mongoClient;
  }

  let lastError = null;

  for (const mongoUrl of MONGO_URLS) {
    const client = new MongoClient(mongoUrl, {
      serverSelectionTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
    });

    try {
      await client.connect();
      mongoClient = client;
      log('info', 'MongoDB connected.', { mongoUrl, database: MONGO_DB_NAME, collection: SAVE_COLLECTION });

      return client;
    } catch (error) {
      lastError = error;
      await client.close().catch(() => {});
      log('warning', 'MongoDB connection failed.', { mongoUrl, error });
    }
  }

  throw lastError ?? new Error('MongoDB connect failed.');
}

function normalizeRecord(document) {
  if (!document) {
    return null;
  }

  const { _id, ...record } = document;

  return record;
}

function buildSaveRecord(payload, playerId) {
  const createdAt = Date.now();

  return {
    id: `save-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    playerId,
    userId: payload.userId ?? (playerId !== DEFAULT_PLAYER_ID ? playerId : null),
    version: Number(payload.version ?? 1),
    player: payload.player ?? null,
    inventory: payload.inventory ?? null,
    codex: payload.codex ?? null,
    summary: payload.summary ?? {},
  };
}

function normalizeBounds(value, blocks = []) {
  const direct = value && typeof value === 'object'
    ? {
      minX: Math.trunc(Number(value.minX)),
      minY: Math.trunc(Number(value.minY)),
      minZ: Math.trunc(Number(value.minZ)),
      maxX: Math.trunc(Number(value.maxX)),
      maxY: Math.trunc(Number(value.maxY)),
      maxZ: Math.trunc(Number(value.maxZ)),
    }
    : null;

  if (
    direct &&
    Object.values(direct).every(Number.isFinite) &&
    direct.minX <= direct.maxX &&
    direct.minY <= direct.maxY &&
    direct.minZ <= direct.maxZ
  ) {
    return direct;
  }

  return getBuildingBounds(blocks);
}

function normalizeWorldBuildingBlock(block) {
  const normalized = normalizeBuildingBlock(block);

  if (!normalized) {
    return null;
  }

  return normalized;
}

function buildPlayerBuildingRecord(payload, { playerId, userId }) {
  const now = Date.now();
  const blocks = Array.isArray(payload.blocks)
    ? payload.blocks.map(normalizeWorldBuildingBlock).filter(Boolean).slice(0, AI_BUILD_LIMIT)
    : [];
  const localBlocks = Array.isArray(payload.localBlocks)
    ? payload.localBlocks.map(normalizeWorldBuildingBlock).filter(Boolean).slice(0, AI_BUILD_LIMIT)
    : [];
  const bounds = normalizeBounds(payload.bounds, blocks);

  if (!blocks.length || !bounds) {
    throw new Error('PLAYER_BUILDING_EMPTY');
  }

  const anchor = payload.anchor && typeof payload.anchor === 'object'
    ? {
      x: Math.trunc(Number(payload.anchor.x)),
      y: Math.trunc(Number(payload.anchor.y)),
      z: Math.trunc(Number(payload.anchor.z)),
    }
    : {
      x: bounds.minX,
      y: bounds.minY,
      z: bounds.minZ,
    };

  const creator = payload.creator && typeof payload.creator === 'object'
    ? {
      userId: String(payload.creator.userId ?? userId ?? '').trim() || null,
      nickname: String(payload.creator.nickname ?? '').trim().slice(0, 24) || null,
      playerId: String(payload.creator.playerId ?? playerId ?? '').trim() || null,
    }
    : {
      userId: userId ?? null,
      nickname: null,
      playerId,
    };
  const referenceMaterials = Array.isArray(payload.referenceMaterials)
    ? payload.referenceMaterials.slice(0, 32)
    : Array.isArray(payload.meta?.referenceMaterials)
      ? payload.meta.referenceMaterials.slice(0, 32)
      : [];
  const customBlocks = normalizeStoredCustomBlocks([
    ...(Array.isArray(payload.customBlocks) ? payload.customBlocks : []),
    ...(Array.isArray(payload.meta?.customBlocks) ? payload.meta.customBlocks : []),
    ...referenceMaterials.filter((material) => isCustomBlockId(Math.trunc(Number(material?.blockId)))),
  ]);

  return {
    id: `building-${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    playerId,
    userId: userId ?? null,
    status: ['cleared', 'preview'].includes(payload.status) ? payload.status : 'active',
    generationMs: Math.max(0, Math.trunc(Number(payload.generationMs) || 0)),
    prompt: String(payload.prompt ?? '').trim().slice(0, 1000),
    title: String(payload.title ?? payload.prompt ?? 'AI 建筑').trim().slice(0, 48) || 'AI 建筑',
    anchor,
    rotation: clampInteger(payload.rotation ?? 0, 0, 3),
    bounds,
    blocks,
    localBlocks,
    counts: payload.counts ?? null,
    model: String(payload.model ?? 'unknown').slice(0, 80),
    fallback: Boolean(payload.fallback),
    prompts: normalizePromptTrace(payload.prompts ?? payload.meta?.prompts, payload.prompt),
    mergedPrompt: String(
      payload.mergedPrompt
        ?? payload.prompts?.integrated
        ?? payload.meta?.prompts?.integrated
        ?? '',
    ).trim().slice(0, 100000),
    aiAccess: payload.aiAccess && typeof payload.aiAccess === 'object'
      ? {
        success: Boolean(payload.aiAccess.success),
        model: String(payload.aiAccess.model ?? '').trim().slice(0, 80) || null,
        stage: String(payload.aiAccess.stage ?? '').trim().slice(0, 80) || null,
        message: String(payload.aiAccess.message ?? '').trim().slice(0, 240) || null,
      }
      : null,
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
    creator,
    referenceImage: payload.referenceImage && typeof payload.referenceImage === 'object'
      ? {
        name: String(payload.referenceImage.name ?? '').trim().slice(0, 120) || null,
        mimeType: String(payload.referenceImage.mimeType ?? '').trim().slice(0, 80) || null,
        sizeBytes: Math.max(0, Math.trunc(Number(payload.referenceImage.sizeBytes) || 0)),
      }
      : payload.meta?.referenceImage && typeof payload.meta.referenceImage === 'object'
        ? {
          name: String(payload.meta.referenceImage.name ?? '').trim().slice(0, 120) || null,
          mimeType: String(payload.meta.referenceImage.mimeType ?? '').trim().slice(0, 80) || null,
          sizeBytes: Math.max(0, Math.trunc(Number(payload.meta.referenceImage.sizeBytes) || 0)),
        }
        : null,
    referenceMaterials,
    customBlocks,
  };
}

async function readRequestBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;

    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }

    chunks.push(chunk);
  }

  if (chunks.length <= 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(Number(value) || 0)));
}

function normalizeBuildingBlock(block) {
  if (!block || typeof block !== 'object') {
    return null;
  }

  const position = block.position && typeof block.position === 'object' ? block.position : null;
  const x = Math.trunc(Number(block.x ?? position?.x));
  const y = Math.trunc(Number(block.y ?? position?.y));
  const z = Math.trunc(Number(block.z ?? position?.z));
  const blockId = Math.trunc(Number(block.blockId));

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(blockId)) {
    return null;
  }

  if (!isAllowedBlockId(blockId)) {
    return null;
  }

  return {
    x,
    y,
    z,
    blockId,
    part: typeof block.part === 'string' && block.part.trim() ? block.part.trim().slice(0, 24) : 'detail',
  };
}

function normalizeBuildingArray(payload) {
  const source = Array.isArray(payload?.blocks)
    ? payload.blocks
    : Array.isArray(payload)
      ? payload
      : [];
  const blocks = source.map(normalizeBuildingBlock).filter(Boolean).slice(0, AI_BUILD_LIMIT);

  if (blocks.length === 0) {
    return [];
  }

  const bounds = getBuildingBounds(blocks);

  return blocks.map((block) => ({
    ...block,
    x: block.x - bounds.minX,
    y: block.y - bounds.minY,
    z: block.z - bounds.minZ,
  }));
}

function normalizeBuildingChunk(payload, limit = AI_BUILD_CHUNK_SIZE) {
  const source = Array.isArray(payload?.blocks)
    ? payload.blocks
    : Array.isArray(payload)
      ? payload
      : [];

  return source
    .map(normalizeBuildingBlock)
    .filter(Boolean)
    .slice(0, limit);
}

function dedupeBuildingBlocks(blocks) {
  const byPosition = new Map();

  for (const block of blocks) {
    const normalized = normalizeBuildingBlock(block);

    if (normalized) {
      byPosition.set(createPositionKey(normalized), normalized);
    }
  }

  return [...byPosition.values()];
}

function limitBuildingBlocks(blocks, limit = AI_BUILD_LIMIT) {
  if (blocks.length <= limit) {
    return blocks;
  }

  const requiredByPart = new Map(AI_REQUIRED_PARTS.map((part) => [part, []]));
  const details = [];

  for (const block of blocks) {
    if (requiredByPart.has(block.part)) {
      requiredByPart.get(block.part).push(block);
    } else {
      details.push(block);
    }
  }

  const required = [];

  for (const part of AI_REQUIRED_PARTS) {
    const partBlocks = requiredByPart.get(part) ?? [];

    if (partBlocks.length > 0) {
      required.push(partBlocks.shift());
    }
  }

  const remainingRequired = AI_REQUIRED_PARTS.flatMap((part) => requiredByPart.get(part) ?? []);

  return [...required, ...remainingRequired, ...details].slice(0, limit);
}

function getBuildingBounds(blocks) {
  if (!blocks.length) {
    return null;
  }

  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };

  for (const block of blocks) {
    bounds.minX = Math.min(bounds.minX, block.x);
    bounds.minY = Math.min(bounds.minY, block.y);
    bounds.minZ = Math.min(bounds.minZ, block.z);
    bounds.maxX = Math.max(bounds.maxX, block.x);
    bounds.maxY = Math.max(bounds.maxY, block.y);
    bounds.maxZ = Math.max(bounds.maxZ, block.z);
  }

  return bounds;
}

function inferPartCounts(blocks) {
  const counts = Object.fromEntries(AI_REQUIRED_PARTS.map((part) => [part, 0]));

  for (const block of blocks) {
    if (counts[block.part] !== undefined) {
      counts[block.part] += 1;
    }
  }

  return counts;
}

function quantile(values, ratio) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)));

  return sorted[index];
}

function trimCoordinateOutliers(blocks) {
  if (blocks.length < 80) {
    return blocks;
  }

  const bounds = getBuildingBounds(blocks);

  if (!bounds) {
    return blocks;
  }

  const width = bounds.maxX - bounds.minX + 1;
  const depth = bounds.maxZ - bounds.minZ + 1;

  if (width <= AI_BUILD_MAX_FOOTPRINT * 2 && depth <= AI_BUILD_MAX_FOOTPRINT * 2) {
    return blocks;
  }

  const xs = blocks.map((block) => block.x);
  const zs = blocks.map((block) => block.z);
  const minX = quantile(xs, 0.02);
  const maxX = quantile(xs, 0.98);
  const minZ = quantile(zs, 0.02);
  const maxZ = quantile(zs, 0.98);
  const trimmed = blocks.filter((block) => (
    block.x >= minX && block.x <= maxX && block.z >= minZ && block.z <= maxZ
  ));

  return trimmed.length >= Math.max(50, Math.floor(blocks.length * 0.6)) ? trimmed : blocks;
}

function normalizeArchitecturalCoordinates(blocks) {
  const source = normalizeBuildingArray({ blocks: trimCoordinateOutliers(blocks) });
  const bounds = getBuildingBounds(source);

  if (!bounds) {
    return source;
  }

  const width = bounds.maxX - bounds.minX + 1;
  const depth = bounds.maxZ - bounds.minZ + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const needsScale = width > AI_BUILD_MAX_FOOTPRINT
    || depth > AI_BUILD_MAX_FOOTPRINT
    || height > AI_BUILD_MAX_LOCAL_HEIGHT;

  if (!needsScale) {
    return source;
  }

  const scaleX = width > AI_BUILD_MAX_FOOTPRINT ? (AI_BUILD_MAX_FOOTPRINT - 1) / Math.max(1, width - 1) : 1;
  const scaleZ = depth > AI_BUILD_MAX_FOOTPRINT ? (AI_BUILD_MAX_FOOTPRINT - 1) / Math.max(1, depth - 1) : 1;
  const scaleY = height > AI_BUILD_MAX_LOCAL_HEIGHT ? (AI_BUILD_MAX_LOCAL_HEIGHT - 1) / Math.max(1, height - 1) : 1;
  const scaled = source.map((block) => ({
    ...block,
    x: Math.round((block.x - bounds.minX) * scaleX),
    y: Math.round((block.y - bounds.minY) * scaleY),
    z: Math.round((block.z - bounds.minZ) * scaleZ),
  }));

  return normalizeBuildingArray({ blocks: dedupeBuildingBlocks(scaled) });
}

function createPositionKey(block) {
  return `${block.x},${block.y},${block.z}`;
}

function ensureRequiredParts(blocks, prompt) {
  const repaired = [...blocks];
  const counts = inferPartCounts(repaired);
  const missingParts = AI_REQUIRED_PARTS.filter((part) => (counts[part] ?? 0) <= 0);

  if (missingParts.length === 0) {
    return repaired;
  }

  const fallback = buildFallbackBuilding(prompt).blocks;
  const usedPositions = new Set(repaired.map(createPositionKey));

  for (const part of missingParts) {
    for (const block of fallback) {
      if (block.part !== part) {
        continue;
      }

      const key = createPositionKey(block);

      if (!usedPositions.has(key)) {
        repaired.push(block);
        usedPositions.add(key);
        break;
      }

      for (let offset = 1; offset <= AI_BUILD_LIMIT; offset += 1) {
        const replacement = {
          ...block,
          x: block.x + offset,
        };
        const replacementKey = createPositionKey(replacement);

        if (usedPositions.has(replacementKey)) {
          continue;
        }

        repaired.push(replacement);
        usedPositions.add(replacementKey);
        break;
      }
    }
  }

  return repaired;
}

const BUILDING_BLOCK_IDS = Object.freeze({
  AIR: 0,
  WATER: 2,
  STONE: 3,
  WOOD: 7,
  SNOW: 9,
  ICE: 11,
  SNOW_MOUNTAIN: 13,
  CRAFTING_TABLE: 19,
  STONE_SLAB: 20,
  STEEL: 21,
  BRICK: 22,
  GLASS: 23,
  CONCRETE: 24,
  PLANKS: 25,
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

const BLOCK_LABELS = Object.freeze({
  [BUILDING_BLOCK_IDS.AIR]: '空气',
  [BUILDING_BLOCK_IDS.STONE]: '石头',
  [BUILDING_BLOCK_IDS.WOOD]: '原木',
  [BUILDING_BLOCK_IDS.SNOW]: '雪块',
  [BUILDING_BLOCK_IDS.ICE]: '冰块',
  [BUILDING_BLOCK_IDS.SNOW_MOUNTAIN]: '雪山方块',
  [BUILDING_BLOCK_IDS.CRAFTING_TABLE]: '工具台',
  [BUILDING_BLOCK_IDS.STONE_SLAB]: '石板',
  [BUILDING_BLOCK_IDS.STEEL]: '钢材',
  [BUILDING_BLOCK_IDS.BRICK]: '砖块',
  [BUILDING_BLOCK_IDS.GLASS]: '玻璃',
  [BUILDING_BLOCK_IDS.CONCRETE]: '混凝土',
  [BUILDING_BLOCK_IDS.PLANKS]: '木板',
  [BUILDING_BLOCK_IDS.ROOF_TILES]: '屋顶瓦片',
  [BUILDING_BLOCK_IDS.COBBLESTONE]: '鹅卵石',
  [BUILDING_BLOCK_IDS.SANDSTONE]: '砂岩',
  [BUILDING_BLOCK_IDS.QUARTZ]: '石英',
  [BUILDING_BLOCK_IDS.LAMP]: '灯具',
  [BUILDING_BLOCK_IDS.METAL_PANEL]: '金属板',
  [BUILDING_BLOCK_IDS.SNOW_LOTUS]: '雪莲方块',
  [BUILDING_BLOCK_IDS.WATER_FLOW_DECOR]: '水流装饰方块',
  [BUILDING_BLOCK_IDS.MARBLE]: '大理石',
  [BUILDING_BLOCK_IDS.DARK_STONE]: '深色石材',
  [BUILDING_BLOCK_IDS.TERRACOTTA]: '陶土',
  [BUILDING_BLOCK_IDS.COPPER_PANEL]: '铜板',
  [BUILDING_BLOCK_IDS.BLACK_GLASS]: '黑色玻璃',
  [BUILDING_BLOCK_IDS.BLUE_ROOF_TILES]: '蓝色瓦片',
  [BUILDING_BLOCK_IDS.BAMBOO]: '竹材',
  [BUILDING_BLOCK_IDS.WHITE_WALL]: '白墙',
});

const MATERIAL_ALIASES = Object.freeze([
  { names: ['雪山的雪', '雪山雪', '雪山方块', '雪山'], blockId: BUILDING_BLOCK_IDS.SNOW_MOUNTAIN },
  { names: ['雪莲花', '雪莲'], blockId: BUILDING_BLOCK_IDS.SNOW_LOTUS },
  { names: ['水流', '流水', '瀑布', '水幕', '装饰水'], blockId: BUILDING_BLOCK_IDS.WATER_FLOW_DECOR },
  { names: ['水方块', '水'], blockId: BUILDING_BLOCK_IDS.WATER_FLOW_DECOR },
  { names: ['大理石', '白色石材', '白石'], blockId: BUILDING_BLOCK_IDS.MARBLE },
  { names: ['深色石材', '黑石', '玄武岩', '深灰石材'], blockId: BUILDING_BLOCK_IDS.DARK_STONE },
  { names: ['陶土', '赤陶', '红陶', '土陶'], blockId: BUILDING_BLOCK_IDS.TERRACOTTA },
  { names: ['铜板', '铜', '铜金属'], blockId: BUILDING_BLOCK_IDS.COPPER_PANEL },
  { names: ['黑色玻璃', '深色玻璃', '黑玻璃'], blockId: BUILDING_BLOCK_IDS.BLACK_GLASS },
  { names: ['蓝色瓦片', '蓝瓦', '琉璃瓦'], blockId: BUILDING_BLOCK_IDS.BLUE_ROOF_TILES },
  { names: ['竹材', '竹子', '竹'], blockId: BUILDING_BLOCK_IDS.BAMBOO },
  { names: ['白墙', '粉刷墙', '白色墙面', '灰泥'], blockId: BUILDING_BLOCK_IDS.WHITE_WALL },
  { names: ['鹅卵石', '圆石'], blockId: BUILDING_BLOCK_IDS.COBBLESTONE },
  { names: ['屋顶瓦片', '瓦片', '瓦'], blockId: BUILDING_BLOCK_IDS.ROOF_TILES },
  { names: ['雪块', '雪'], blockId: BUILDING_BLOCK_IDS.SNOW },
  { names: ['冰块', '冰'], blockId: BUILDING_BLOCK_IDS.ICE },
  { names: ['木板'], blockId: BUILDING_BLOCK_IDS.PLANKS },
  { names: ['原木', '木材'], blockId: BUILDING_BLOCK_IDS.WOOD },
  { names: ['玻璃'], blockId: BUILDING_BLOCK_IDS.GLASS },
  { names: ['砖块', '红砖', '砖'], blockId: BUILDING_BLOCK_IDS.BRICK },
  { names: ['混凝土'], blockId: BUILDING_BLOCK_IDS.CONCRETE },
  { names: ['砂岩'], blockId: BUILDING_BLOCK_IDS.SANDSTONE },
  { names: ['石英'], blockId: BUILDING_BLOCK_IDS.QUARTZ },
  { names: ['金属板', '金属'], blockId: BUILDING_BLOCK_IDS.METAL_PANEL },
  { names: ['钢材', '钢'], blockId: BUILDING_BLOCK_IDS.STEEL },
  { names: ['石板'], blockId: BUILDING_BLOCK_IDS.STONE_SLAB },
  { names: ['石头'], blockId: BUILDING_BLOCK_IDS.STONE },
  { names: ['灯具', '灯'], blockId: BUILDING_BLOCK_IDS.LAMP },
]);

const PART_ALIASES = Object.freeze({
  foundation: ['地基', '基础', '底座', '底部', 'foundation'],
  wall: ['围墙', '墙面', '墙体', '外墙', '墙', 'wall'],
  door: ['门洞', '门', 'door'],
  window: ['窗户', '窗', 'window'],
  roof: ['屋顶', '房顶', '顶', 'roof'],
  facility: ['生活设施', '设施', '装饰', '水流装饰', '室内', '摆设', 'facility', 'decoration'],
});

function hashPrompt(prompt) {
  let hash = 2166136261;

  for (let index = 0; index < prompt.length; index += 1) {
    hash ^= prompt.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function includesAny(prompt, keywords) {
  return keywords.some((keyword) => prompt.includes(keyword));
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findAlias(text, aliases) {
  return aliases.find((alias) => text.includes(alias)) ?? '';
}

function parseChineseNumber(value) {
  const text = String(value ?? '').trim();
  const digit = Number.parseInt(text, 10);

  if (Number.isFinite(digit)) {
    return digit;
  }

  const numerals = new Map([
    ['一', 1],
    ['二', 2],
    ['两', 2],
    ['三', 3],
    ['四', 4],
    ['五', 5],
    ['六', 6],
    ['七', 7],
    ['八', 8],
    ['九', 9],
    ['十', 10],
  ]);

  if (numerals.has(text)) {
    return numerals.get(text);
  }

  if (text.includes('十')) {
    const [left, right] = text.split('十');
    const tens = left ? numerals.get(left) ?? 1 : 1;
    const ones = right ? numerals.get(right) ?? 0 : 0;

    return tens * 10 + ones;
  }

  return 0;
}

function extractRequestedFloors(prompt) {
  const match = String(prompt).match(/([0-9]+|[一二两三四五六七八九十]{1,3})\s*层/);
  const floors = parseChineseNumber(match?.[1]);

  return floors > 0 ? clampInteger(floors, 1, 12) : 0;
}

function matchMaterialAlias(text) {
  let best = null;

  for (const material of MATERIAL_ALIASES) {
    for (const name of material.names) {
      if (!text.includes(name)) {
        continue;
      }

      if (!best || name.length > best.name.length) {
        best = { name, blockId: material.blockId };
      }
    }
  }

  return best;
}

function normalizeCustomBlockKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function getCustomMaterialText(item) {
  return String(
    item?.name
      ?? item?.label
      ?? item?.material
      ?? item?.usage
      ?? '',
  ).trim();
}

function normalizeCustomBlockAliases(item) {
  const values = isImageScopedCustomMaterial(item)
    ? [
      item?.key,
      item?.name,
      ...(Array.isArray(item?.aliases) ? item.aliases : []),
    ]
    : [
    item?.key,
    item?.name,
    item?.label,
    item?.material,
    ...(Array.isArray(item?.aliases) ? item.aliases : []),
  ];
  const aliases = values
    .map(normalizeCustomBlockKey)
    .filter(Boolean);

  return [...new Set(aliases)].slice(0, 12);
}

function isImageScopedCustomMaterial(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const textureSource = String(item.textureSource ?? '').toLowerCase();
  const key = String(item.key ?? '').toLowerCase();

  return Boolean(item.textureDataUrl)
    || textureSource.includes('reference-image')
    || key.startsWith('region-')
    || key.startsWith('image-palette-');
}

function getCustomBlockSimilarityScore(material, block) {
  const materialAliases = normalizeCustomBlockAliases(material);
  const blockAliases = normalizeCustomBlockAliases(block);

  if (!materialAliases.length || !blockAliases.length) {
    return 0;
  }

  let score = 0;

  for (const left of materialAliases) {
    for (const right of blockAliases) {
      if (left === right) {
        score = Math.max(score, 1);
      } else if (left.length >= 2 && right.includes(left)) {
        score = Math.max(score, 0.86);
      } else if (right.length >= 2 && left.includes(right)) {
        score = Math.max(score, 0.82);
      }
    }
  }

  return score;
}

function hashTextToColor(text) {
  const palette = [
    0xf1eee6, 0xcfc6b8, 0x9aa8ad, 0x4f5b66, 0x6f7771, 0xd8d0c5,
    0xb8a68f, 0x8b6f5a, 0x6d8695, 0x87936f, 0xa65f4e, 0xd7dbe1,
  ];
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return palette[(hash >>> 0) % palette.length];
}

function normalizeCustomBlockDocument(document) {
  if (!document) {
    return null;
  }

  const blockId = Math.trunc(Number(document.blockId));

  if (!isCustomBlockId(blockId)) {
    return null;
  }

  const name = String(document.name ?? document.label ?? `custom-${blockId}`).trim().slice(0, 32) || `custom-${blockId}`;
  const label = String(document.label ?? name).trim().slice(0, 32) || name;

  return {
    blockId,
    key: normalizeCustomBlockKey(document.key ?? name),
    name,
    label,
    aliases: normalizeCustomBlockAliases(document),
    usage: String(document.usage ?? '').trim().slice(0, 80),
    color: Math.trunc(Number(document.color)) || hashTextToColor(name),
    opacity: Math.max(0.05, Math.min(1, Number(document.opacity ?? 1))),
    opaque: document.opaque === false ? false : true,
    textureDataUrl: normalizeDataUrlImage(document.textureDataUrl),
    textureRegion: normalizeTextureRegion(document.textureRegion, document.key ?? name),
    textureSource: String(document.textureSource ?? '').trim().slice(0, 120),
    custom: true,
    createdAt: Number(document.createdAt ?? 0) || null,
    updatedAt: Number(document.updatedAt ?? 0) || null,
  };
}

function normalizeCustomBlockInput(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const name = getCustomMaterialText(item);
  const key = normalizeCustomBlockKey(item.key ?? name);

  if (!key) {
    return null;
  }

  const label = String(item.label ?? item.name ?? name).trim().slice(0, 32) || name.slice(0, 32);
  const color = Math.trunc(Number(item.color ?? item.hexColor));

  return {
    key,
    name: String(item.name ?? label).trim().slice(0, 32) || label,
    label,
    aliases: normalizeCustomBlockAliases({ ...item, key, name, label }),
    usage: String(item.usage ?? 'custom').trim().slice(0, 80),
    color: Number.isFinite(color) && color > 0 ? color : hashTextToColor(`${key}:${label}`),
    opacity: Math.max(0.05, Math.min(1, Number(item.opacity ?? 1))),
    opaque: item.opaque === false ? false : true,
    confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.72))),
    textureDataUrl: normalizeDataUrlImage(item.textureDataUrl),
    textureRegion: normalizeTextureRegion(item.textureRegion, key),
    textureSource: String(item.textureSource ?? '').trim().slice(0, 120),
  };
}

async function findSimilarCustomBlock(collection, material) {
  const aliases = normalizeCustomBlockAliases(material);

  if (!aliases.length) {
    return null;
  }

  if (isImageScopedCustomMaterial(material)) {
    const directByKey = await collection.findOne(
      { key: material.key },
      { projection: { _id: 0 } },
    );

    return directByKey
      ? normalizeCustomBlockDocument(directByKey)
        ?? await migrateCustomBlockToCurrentRange(collection, directByKey, material)
      : null;
  }

  const direct = await collection.findOne(
    {
      $or: [
        { key: { $in: aliases } },
        { aliases: { $in: aliases } },
      ],
    },
    { projection: { _id: 0 } },
  );

  if (direct) {
    return normalizeCustomBlockDocument(direct)
      ?? await migrateCustomBlockToCurrentRange(collection, direct, material);
  }

  const candidates = await collection
    .find({ blockId: { $gte: CUSTOM_BLOCK_ID_MIN, $lte: CUSTOM_BLOCK_ID_MAX } }, { projection: { _id: 0 } })
    .sort({ updatedAt: -1, blockId: 1 })
    .limit(400)
    .toArray();
  let best = null;

  for (const candidate of candidates) {
    const score = getCustomBlockSimilarityScore(material, candidate);

    if (score >= 0.82 && (!best || score > best.score)) {
      best = { score, candidate };
    }
  }

  return best ? normalizeCustomBlockDocument(best.candidate) : null;
}

async function migrateCustomBlockToCurrentRange(collection, document, material = null) {
  if (!document) {
    return null;
  }

  const blockId = Math.trunc(Number(document.blockId));

  if (isCustomBlockId(blockId)) {
    return normalizeCustomBlockDocument(document);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextBlockId = await getNextCustomBlockId(collection);
    const now = Date.now();

    try {
      const result = await collection.findOneAndUpdate(
        { key: document.key },
        {
          $set: {
            blockId: nextBlockId,
            aliases: normalizeCustomBlockAliases({ ...document, ...(material ?? {}) }),
            updatedAt: now,
          },
        },
        { returnDocument: 'after', projection: { _id: 0 } },
      );

      return normalizeCustomBlockDocument(result);
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }
    }
  }

  return null;
}

function normalizeStoredCustomBlocks(source) {
  const blocks = Array.isArray(source) ? source : [];
  const seen = new Set();
  const normalized = [];

  for (const block of blocks) {
    const item = normalizeCustomBlockDocument(block);

    if (!item || seen.has(item.blockId)) {
      continue;
    }

    seen.add(item.blockId);
    normalized.push(item);
  }

  return normalized.slice(0, 32);
}

async function getNextCustomBlockId(collection) {
  const usedIds = await collection
    .find({ blockId: { $gte: CUSTOM_BLOCK_ID_MIN, $lte: CUSTOM_BLOCK_ID_MAX } }, { projection: { _id: 0, blockId: 1 } })
    .sort({ blockId: 1 })
    .toArray();
  const used = new Set(usedIds.map((item) => Math.trunc(Number(item.blockId))).filter(isCustomBlockId));

  for (let blockId = CUSTOM_BLOCK_ID_MIN; blockId <= CUSTOM_BLOCK_ID_MAX; blockId += 1) {
    if (!used.has(blockId)) {
      return blockId;
    }
  }

  throw new Error('CUSTOM_BLOCK_RANGE_FULL');
}

async function resolveCustomBlock(input) {
  const material = normalizeCustomBlockInput(input);

  if (!material) {
    return null;
  }

  const collection = await getCustomBlockCollection();
  const existing = await findSimilarCustomBlock(collection, material);

  if (existing) {
    return existing;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = Date.now();
    const blockId = await getNextCustomBlockId(collection);
    const document = {
      blockId,
      key: material.key,
      name: material.name,
      label: material.label,
      aliases: material.aliases,
      usage: material.usage,
      color: material.color,
      opacity: material.opacity,
      opaque: material.opaque,
      textureDataUrl: material.textureDataUrl,
      textureRegion: material.textureRegion,
      textureSource: material.textureSource,
      custom: true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await collection.insertOne(document);
      return normalizeCustomBlockDocument(document);
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }

      const raced = await findSimilarCustomBlock(collection, material);

      if (raced) {
        return raced;
      }
    }
  }

  return findSimilarCustomBlock(collection, material);
}

async function resolveCustomBlocks(materials) {
  const inputs = Array.isArray(materials) ? materials : [];
  const byKey = new Map();

  inputs.forEach((item) => {
    const normalized = normalizeCustomBlockInput(item);

    if (normalized && !byKey.has(normalized.key)) {
      byKey.set(normalized.key, normalized);
    }
  });

  const resolved = [];

  for (const item of byKey.values()) {
    const block = await resolveCustomBlock(item);

    if (block) {
      resolved.push(block);
    }
  }

  return resolved;
}

function getPartFromText(text) {
  for (const [part, aliases] of Object.entries(PART_ALIASES)) {
    if (findAlias(text, aliases)) {
      return part;
    }
  }

  return '';
}

function extractMaterialDirectives(prompt) {
  const text = String(prompt ?? '').replace(/\s+/g, '');
  const directives = {};

  for (const [part, partAliases] of Object.entries(PART_ALIASES)) {
    for (const partAlias of partAliases) {
      const partPattern = escapeRegex(partAlias);
      const beforePart = new RegExp(`用(.{1,16}?)做${partPattern}`);
      const afterPart = new RegExp(`${partPattern}用(.{1,16})`);
      const beforeMatch = text.match(beforePart);
      const afterMatch = text.match(afterPart);
      const material = matchMaterialAlias(beforeMatch?.[1] ?? afterMatch?.[1] ?? '');

      if (material) {
        directives[part] = {
          blockId: material.blockId,
          material: material.name,
          label: BLOCK_LABELS[material.blockId] ?? `方块 ${material.blockId}`,
        };
      }
    }
  }

  const genericMatches = [...text.matchAll(/用(.{1,16}?)做(.{1,12}?)(?=，|,|。|\.|用|$)/g)];

  for (const match of genericMatches) {
    const material = matchMaterialAlias(match[1]);
    const part = getPartFromText(match[2]);

    if (material && part) {
      directives[part] = {
        blockId: material.blockId,
        material: material.name,
        label: BLOCK_LABELS[material.blockId] ?? `方块 ${material.blockId}`,
      };
    }
  }

  return directives;
}

function formatMaterialDirectives(directives) {
  const entries = Object.entries(directives);

  if (!entries.length) {
    return '';
  }

  return entries
    .map(([part, directive]) => `${part} 必须使用 blockId ${directive.blockId}（${directive.label}，来自“${directive.material}”）`)
    .join('；');
}

function normalizeReferenceImage(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl.trim() : '';
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType.trim().toLowerCase() : '';
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : 'reference-image';
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,[a-z0-9+/=]+$/i);

  if (!match) {
    return null;
  }

  return {
    name,
    mimeType: mimeType || match[1].toLowerCase(),
    dataUrl,
    sizeBytes: Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75),
  };
}

function normalizeDataUrlImage(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i);

  if (!match || text.length > 260000) {
    return '';
  }

  return text;
}

function normalizeTextureRegion(value, fallbackRole = 'region') {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const toRatio = (input, fallback = 0) => {
    const numeric = Number(input);

    if (!Number.isFinite(numeric)) {
      return fallback;
    }

    if (numeric > 1.5) {
      return Math.max(0, Math.min(1, numeric / 100));
    }

    return Math.max(0, Math.min(1, numeric));
  };

  return {
    id: String(value.id ?? value.key ?? fallbackRole).trim().slice(0, 48) || fallbackRole,
    role: String(value.role ?? value.kind ?? fallbackRole).trim().slice(0, 48) || fallbackRole,
    label: String(value.label ?? value.name ?? fallbackRole).trim().slice(0, 64) || fallbackRole,
    x: toRatio(value.x ?? value.left ?? value.cx ?? 0.5, 0.5),
    y: toRatio(value.y ?? value.top ?? value.cy ?? 0.5, 0.5),
    width: Math.max(0.02, toRatio(value.width ?? value.w ?? 0.24, 0.24)),
    height: Math.max(0.02, toRatio(value.height ?? value.h ?? 0.24, 0.24)),
    confidence: Math.max(0, Math.min(1, Number(value.confidence ?? value.score ?? 0.7))),
  };
}

function normalizeFeatureList(source, limit = 12) {
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: String(item.id ?? item.key ?? item.name ?? `feature-${index + 1}`).trim().slice(0, 48) || `feature-${index + 1}`,
      label: String(item.label ?? item.name ?? item.description ?? `feature-${index + 1}`).trim().slice(0, 96) || `feature-${index + 1}`,
      part: String(item.part ?? item.slot ?? '').trim().slice(0, 32),
      description: String(item.description ?? item.label ?? item.name ?? '').trim().slice(0, 220),
      generatorHint: String(item.generatorHint ?? item.hint ?? item.type ?? '').trim().slice(0, 120),
      anchor: String(item.anchor ?? item.position ?? item.location ?? '').trim().slice(0, 48),
      importance: Math.max(0, Math.min(1, Number(item.importance ?? item.weight ?? 0.7))),
      confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.7))),
    }))
    .slice(0, limit);
}

function normalizeRegionList(source, limit = 12) {
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((item, index) => normalizeTextureRegion(item, `region-${index + 1}`))
    .filter(Boolean)
    .slice(0, limit);
}

function parseHexColorToNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  }

  const text = String(value ?? '').trim();
  const hexMatch = text.match(/#?([0-9a-f]{6})\b/i);

  if (hexMatch) {
    return Number.parseInt(hexMatch[1], 16);
  }

  const rgbMatch = text.match(/rgb[a]?\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);

  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbMatch[1])));
    const g = Math.max(0, Math.min(255, Number(rgbMatch[2])));
    const b = Math.max(0, Math.min(255, Number(rgbMatch[3])));

    return (r << 16) | (g << 8) | b;
  }

  return 0;
}

function normalizeMaterialPalette(source, limit = 10) {
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map((item, index) => {
      if (item && typeof item === 'object') {
        const color = parseHexColorToNumber(item.color ?? item.hexColor ?? item.value);
        const slot = String(item.slot ?? item.part ?? item.role ?? '').trim().toLowerCase();

        return {
          slot: PROCEDURAL_MATERIAL_SLOTS.includes(slot) ? slot : slot,
          name: String(item.name ?? item.label ?? item.material ?? `image color ${index + 1}`).trim().slice(0, 48),
          label: String(item.label ?? item.name ?? item.material ?? `image color ${index + 1}`).trim().slice(0, 48),
          color: color || hashTextToColor(JSON.stringify(item)),
          areaRatio: Math.max(0, Math.min(1, Number(item.areaRatio ?? item.ratio ?? item.weight ?? 0))),
          custom: item.custom !== false,
          confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.72))),
        };
      }

      const color = parseHexColorToNumber(item);

      return {
        slot: '',
        name: String(item ?? `image color ${index + 1}`).trim().slice(0, 48) || `image color ${index + 1}`,
        label: String(item ?? `image color ${index + 1}`).trim().slice(0, 48) || `image color ${index + 1}`,
        color: color || hashTextToColor(String(item ?? index)),
        areaRatio: 0,
        custom: true,
        confidence: 0.58,
      };
    })
    .filter((item) => item.name)
    .slice(0, limit);
}

function normalizeVisualFingerprint(source = {}) {
  const fingerprint = source && typeof source === 'object' && !Array.isArray(source)
    ? source
    : {};
  const proportions = fingerprint.proportions && typeof fingerprint.proportions === 'object'
    ? fingerprint.proportions
    : {};
  const silhouette = fingerprint.silhouette && typeof fingerprint.silhouette === 'object'
    ? fingerprint.silhouette
    : {};
  const facade = fingerprint.facade && typeof fingerprint.facade === 'object'
    ? fingerprint.facade
    : {};

  return {
    apparentType: String(fingerprint.apparentType ?? fingerprint.type ?? fingerprint.buildingType ?? '').trim().slice(0, 48),
    view: String(fingerprint.view ?? fingerprint.cameraView ?? '').trim().slice(0, 32),
    proportions: {
      widthToHeight: Math.max(0.3, Math.min(5, Number(proportions.widthToHeight ?? fingerprint.widthToHeight ?? 1.8) || 1.8)),
      roofToBodyRatio: Math.max(0.05, Math.min(0.8, Number(proportions.roofToBodyRatio ?? fingerprint.roofToBodyRatio ?? 0.28) || 0.28)),
      symmetry: String(proportions.symmetry ?? fingerprint.symmetry ?? '').trim().slice(0, 32),
    },
    silhouette: {
      roofShape: String(silhouette.roofShape ?? fingerprint.roofShape ?? '').trim().slice(0, 32),
      hasTallCenter: Boolean(silhouette.hasTallCenter ?? fingerprint.hasTallCenter),
      hasSideWings: Boolean(silhouette.hasSideWings ?? fingerprint.hasSideWings),
      towerCount: Math.max(0, Math.min(6, Math.trunc(Number(silhouette.towerCount ?? fingerprint.towerCount ?? 0) || 0))),
    },
    facade: {
      floors: Math.max(1, Math.min(12, Math.trunc(Number(facade.floors ?? fingerprint.floors ?? 1) || 1))),
      baysX: Math.max(1, Math.min(12, Math.trunc(Number(facade.baysX ?? fingerprint.baysX ?? 3) || 3))),
      windowRhythm: String(facade.windowRhythm ?? fingerprint.facadeRhythm ?? '').trim().slice(0, 48),
      mainEntrance: String(facade.mainEntrance ?? fingerprint.mainEntrance ?? 'center').trim().slice(0, 32),
    },
    materials: normalizeMaterialPalette(fingerprint.materials ?? fingerprint.materialPalette ?? fingerprint.dominantColors, 10),
    colorPalette: normalizeMaterialPalette(fingerprint.colorPalette ?? fingerprint.dominantColors, 10),
  };
}

function createPaletteReferenceMaterials(referenceDescription = null, existingMaterials = []) {
  const fingerprint = normalizeVisualFingerprint(referenceDescription?.visualFingerprint ?? {});
  const sourcePalette = [
    ...normalizeMaterialPalette(referenceDescription?.materials, 10),
    ...normalizeMaterialPalette(referenceDescription?.colors, 10),
    ...normalizeMaterialPalette(referenceDescription?.dominantColors, 10),
    ...fingerprint.materials,
    ...fingerprint.colorPalette,
  ];
  const slotFallbacks = ['wall', 'tile', 'window', 'door', 'ridge', 'podium', 'dougong'];
  const byKey = new Map();

  sourcePalette.forEach((material, index) => {
    const slot = PROCEDURAL_MATERIAL_SLOTS.includes(material.slot)
      ? material.slot
      : slotFallbacks[index % slotFallbacks.length];
    const key = `${slot}:${material.color}:${normalizeCustomBlockKey(material.name)}`;

    if (byKey.has(key)) {
      return;
    }

    byKey.set(key, {
      key: `image-palette-${slot}-${material.color.toString(16).padStart(6, '0')}-${hashPrompt(material.name).toString(36).slice(0, 8)}`,
      name: material.name || `image ${slot} color`,
      label: material.label || material.name || `image ${slot}`,
      slot,
      proceduralSlot: slot,
      part: PROCEDURAL_MATERIAL_PARTS[slot] ?? '',
      usage: `reference image ${slot} dominant color`,
      color: material.color,
      opacity: slot === 'window' ? 0.58 : 1,
      opaque: slot !== 'window',
      custom: true,
      confidence: material.confidence,
      areaRatio: material.areaRatio,
      textureSource: 'reference-image-color-palette',
    });
  });

  existingMaterials.forEach((material) => {
    const slot = String(material?.proceduralSlot ?? material?.slot ?? '').trim();

    if (!slot || !PROCEDURAL_MATERIAL_SLOTS.includes(slot)) {
      return;
    }

    const key = `${slot}:existing`;

    if (!byKey.has(key)) {
      byKey.set(key, material);
    }
  });

  return [...byKey.values()].slice(0, 24);
}

function normalizeReferenceMaterials(source, referenceImage, prompt) {
  const materials = Array.isArray(source) ? source : [];
  const normalized = materials
    .map((item) => {
      const text = `${item?.name ?? ''}${item?.label ?? ''}${item?.material ?? ''}${item?.usage ?? ''}`;
      const matched = matchMaterialAlias(text);
      const blockId = AI_ALLOWED_BLOCK_IDS.has(Math.trunc(Number(item?.blockId)))
        ? Math.trunc(Number(item.blockId))
        : matched?.blockId;

      if (!blockId || blockId === BUILDING_BLOCK_IDS.AIR || blockId === BUILDING_BLOCK_IDS.WATER) {
        return null;
      }

      return {
        name: String(item?.name ?? matched?.name ?? BLOCK_LABELS[blockId] ?? `方块 ${blockId}`).trim().slice(0, 32),
        label: BLOCK_LABELS[blockId] ?? `方块 ${blockId}`,
        blockId,
        usage: String(item?.usage ?? 'reference').trim().slice(0, 40),
        confidence: Math.max(0, Math.min(1, Number(item?.confidence ?? 0.72))),
      };
    })
    .filter(Boolean);

  if (normalized.length > 0) {
    return normalized.slice(0, 8);
  }

  if (!referenceImage) {
    return [];
  }

  const text = `${prompt} ${referenceImage.name}`.replace(/\s+/g, '');
  const inferred = [];

  for (const material of MATERIAL_ALIASES) {
    if (!material.names.some((name) => text.includes(name))) {
      continue;
    }

    inferred.push({
      name: material.names[0],
      label: BLOCK_LABELS[material.blockId] ?? `方块 ${material.blockId}`,
      blockId: material.blockId,
      usage: '参考图/文件名推断',
      confidence: 0.58,
    });
  }

  if (inferred.length > 0) {
    return inferred.slice(0, 6);
  }

  return [
    { name: '粉刷白墙', label: BLOCK_LABELS[BUILDING_BLOCK_IDS.WHITE_WALL], blockId: BUILDING_BLOCK_IDS.WHITE_WALL, usage: '参考图兜底墙面', confidence: 0.48 },
    { name: '大理石', label: BLOCK_LABELS[BUILDING_BLOCK_IDS.MARBLE], blockId: BUILDING_BLOCK_IDS.MARBLE, usage: '参考图兜底地基/立面', confidence: 0.44 },
    { name: '黑色玻璃', label: BLOCK_LABELS[BUILDING_BLOCK_IDS.BLACK_GLASS], blockId: BUILDING_BLOCK_IDS.BLACK_GLASS, usage: '参考图兜底窗户', confidence: 0.42 },
  ];
}

async function getCustomBlockById(blockId) {
  if (!isCustomBlockId(blockId)) {
    return null;
  }

  const collection = await getCustomBlockCollection();
  const document = await collection.findOne({ blockId }, { projection: { _id: 0 } });

  return normalizeCustomBlockDocument(document);
}

async function normalizeReferenceMaterialsWithCustom(source, referenceImage, prompt) {
  const materials = Array.isArray(source) ? source : [];
  const normalized = [];
  const customBlocks = [];

  for (const item of materials) {
    const text = `${item?.name ?? ''}${item?.label ?? ''}${item?.material ?? ''}${item?.usage ?? ''}`;
    const matched = matchMaterialAlias(text);
    const requestedBlockId = Math.trunc(Number(item?.blockId));
    const preferCustom = item?.custom !== false && item?.fixed !== true && Boolean(getCustomMaterialText(item));
    let blockId = !preferCustom && AI_ALLOWED_BLOCK_IDS.has(requestedBlockId)
      ? requestedBlockId
      : matched?.blockId;

    if (preferCustom) {
      const resolved = await resolveCustomBlock(item);

      if (resolved) {
        blockId = resolved.blockId;
        customBlocks.push(resolved);
      }
    } else if (isCustomBlockId(requestedBlockId)) {
      const stored = await getCustomBlockById(requestedBlockId);
      const resolved = stored ?? await resolveCustomBlock(item);

      if (resolved) {
        blockId = resolved.blockId;
        customBlocks.push(resolved);
      }
    } else if (!blockId) {
      const resolved = await resolveCustomBlock(item);

      if (resolved) {
        blockId = resolved.blockId;
        customBlocks.push(resolved);
      }
    }

    if (!blockId || blockId === BUILDING_BLOCK_IDS.AIR || blockId === BUILDING_BLOCK_IDS.WATER) {
      continue;
    }

    const customBlock = isCustomBlockId(blockId)
      ? customBlocks.find((block) => block.blockId === blockId) ?? await getCustomBlockById(blockId)
      : null;

    if (customBlock && !customBlocks.some((block) => block.blockId === customBlock.blockId)) {
      customBlocks.push(customBlock);
    }

    normalized.push({
      name: String(item?.name ?? customBlock?.name ?? matched?.name ?? BLOCK_LABELS[blockId] ?? `block ${blockId}`).trim().slice(0, 32),
      label: String(customBlock?.label ?? BLOCK_LABELS[blockId] ?? item?.label ?? `block ${blockId}`).trim().slice(0, 32),
      blockId,
      sourceBlockId: Number.isInteger(requestedBlockId) ? requestedBlockId : null,
      slot: typeof item?.slot === 'string' ? item.slot.trim().slice(0, 32) : '',
      proceduralSlot: typeof item?.proceduralSlot === 'string' ? item.proceduralSlot.trim().slice(0, 32) : '',
      part: typeof item?.part === 'string' ? item.part.trim().slice(0, 24) : '',
      usage: String(item?.usage ?? customBlock?.usage ?? 'reference').trim().slice(0, 40),
      confidence: Math.max(0, Math.min(1, Number(item?.confidence ?? 0.72))),
      textureDataUrl: normalizeDataUrlImage(item?.textureDataUrl ?? customBlock?.textureDataUrl),
      textureRegion: normalizeTextureRegion(item?.textureRegion ?? customBlock?.textureRegion, item?.proceduralSlot ?? item?.slot ?? matched?.name ?? 'region'),
      textureSource: String(item?.textureSource ?? customBlock?.textureSource ?? '').trim().slice(0, 120),
      custom: Boolean(customBlock),
    });
  }

  if (normalized.length > 0) {
    return {
      referenceMaterials: normalized.slice(0, 32),
      customBlocks: normalizeStoredCustomBlocks(customBlocks),
    };
  }

  return {
    referenceMaterials: normalizeReferenceMaterials([], referenceImage, prompt),
    customBlocks: [],
  };
}

function formatReferenceMaterials(materials) {
  if (!materials.length) {
    return '';
  }

  return materials
    .map((material) => `${material.name}: blockId ${material.blockId}（${material.label}，用于 ${material.usage}）`)
    .join('；');
}

function applyReferenceMaterialsToProfile(profile, referenceMaterials = []) {
  if (!referenceMaterials.length) {
    return profile;
  }

  const byBlockId = new Map(referenceMaterials.map((material) => [material.blockId, material]));
  const has = (blockId) => byBlockId.has(blockId);
  const firstBlockId = (...blockIds) => blockIds.find(has);
  const customMaterials = referenceMaterials.filter((material) => isCustomBlockId(Math.trunc(Number(material.blockId))));
  const customByUsage = (pattern) => customMaterials.find((material) => pattern.test(`${material.name ?? ''} ${material.label ?? ''} ${material.usage ?? ''}`));
  const customWall = customByUsage(/wall|facade|立面|墙|墙面|白墙/i) ?? customMaterials[0];
  const customFoundation = customByUsage(/foundation|base|floor|地基|基座|大理石/i) ?? customMaterials[1] ?? customWall;
  const customWindow = customByUsage(/window|glass|窗|玻璃/i);
  const customRoof = customByUsage(/roof|tile|顶|瓦/i);
  const wall = firstBlockId(
    BUILDING_BLOCK_IDS.WHITE_WALL,
    BUILDING_BLOCK_IDS.MARBLE,
    BUILDING_BLOCK_IDS.TERRACOTTA,
    BUILDING_BLOCK_IDS.DARK_STONE,
    BUILDING_BLOCK_IDS.QUARTZ,
    BUILDING_BLOCK_IDS.BRICK,
  ) ?? referenceMaterials[0].blockId;
  const roof = firstBlockId(
    BUILDING_BLOCK_IDS.BLUE_ROOF_TILES,
    BUILDING_BLOCK_IDS.COPPER_PANEL,
    BUILDING_BLOCK_IDS.ROOF_TILES,
    BUILDING_BLOCK_IDS.DARK_STONE,
  );
  const window = firstBlockId(BUILDING_BLOCK_IDS.BLACK_GLASS, BUILDING_BLOCK_IDS.GLASS);
  const trim = firstBlockId(BUILDING_BLOCK_IDS.COPPER_PANEL, BUILDING_BLOCK_IDS.BAMBOO, BUILDING_BLOCK_IDS.DARK_STONE, BUILDING_BLOCK_IDS.METAL_PANEL);

  return {
    ...profile,
    foundation: customFoundation?.blockId ?? firstBlockId(BUILDING_BLOCK_IDS.MARBLE, BUILDING_BLOCK_IDS.DARK_STONE, BUILDING_BLOCK_IDS.TERRACOTTA) ?? profile.foundation,
    wall: customWall?.blockId ?? wall ?? profile.wall,
    roof: customRoof?.blockId ?? roof ?? profile.roof,
    window: customWindow?.blockId ?? window ?? profile.window,
    trim: customWall?.blockId ?? trim ?? wall ?? profile.trim,
    referenceMaterials,
  };
}

function applyMaterialDirectivesToProfile(profile, prompt) {
  const directives = extractMaterialDirectives(prompt);
  const floors = extractRequestedFloors(prompt);
  const nextProfile = {
    ...profile,
    materialDirectives: directives,
    requestedFloors: floors,
  };

  for (const [part, directive] of Object.entries(directives)) {
    if (part === 'wall') {
      nextProfile.wall = directive.blockId;
      nextProfile.trim = directive.blockId;
    } else if (part === 'facility') {
      nextProfile.facility = directive.blockId;
    } else {
      nextProfile[part] = directive.blockId;
    }
  }

  if (floors > 0) {
    nextProfile.wallHeight = Math.max(nextProfile.wallHeight ?? 4, floors * 3);
    nextProfile.roofHeight = Math.max(nextProfile.roofHeight ?? 1, nextProfile.id === 'castle' ? 3 : 2);
  }

  return nextProfile;
}

function applyMaterialDirectivesToBlocks(blocks, prompt) {
  const directives = extractMaterialDirectives(prompt);

  if (!Object.keys(directives).length) {
    return blocks;
  }

  return blocks.map((block) => {
    const directive = directives[block.part];

    if (!directive || block.part === 'door') {
      return block;
    }

    return {
      ...block,
      blockId: directive.blockId,
    };
  });
}

function applyReferenceMaterialsToBlocks(blocks, referenceMaterials = [], { usePartFallback = true } = {}) {
  const customMaterials = referenceMaterials
    .filter((material) => isCustomBlockId(Math.trunc(Number(material.blockId))));

  if (!customMaterials.length) {
    return blocks;
  }

  const match = (pattern) => customMaterials.find((material) => (
    pattern.test(`${material.name ?? ''} ${material.label ?? ''} ${material.usage ?? ''}`)
  ));
  const materialBySourceBlockId = new Map();
  customMaterials.forEach((material) => {
    const sourceBlockId = Math.trunc(Number(material.sourceBlockId));

    if (Number.isInteger(sourceBlockId) && sourceBlockId > 0 && sourceBlockId < CUSTOM_BLOCK_ID_MIN) {
      materialBySourceBlockId.set(sourceBlockId, material);
    }
  });
  const materialByPart = usePartFallback ? {
    wall: match(/wall|facade|立面|墙|墙面|白墙/i) ?? customMaterials[0],
    foundation: match(/foundation|base|floor|地基|基座|大理石/i) ?? customMaterials[1] ?? customMaterials[0],
    window: match(/window|glass|窗|玻璃/i),
    roof: match(/roof|tile|顶|瓦/i),
    facility: match(/decor|facility|装饰|设施/i),
  } : {};

  return blocks.map((block) => {
    const material = materialBySourceBlockId.get(Math.trunc(Number(block.blockId)))
      ?? materialByPart[block.part];

    if (
      !material ||
      block.part === 'door' ||
      block.blockId === BUILDING_BLOCK_IDS.AIR ||
      isCustomBlockId(Math.trunc(Number(block.blockId)))
    ) {
      return block;
    }

    return {
      ...block,
      blockId: material.blockId,
    };
  });
}

async function resolveBuildingMaterialModule(payload, { referenceImage = null, prompt = '' } = {}) {
  const referenceSource = Array.isArray(payload?.referenceMaterials)
    ? payload.referenceMaterials
    : Array.isArray(payload?.meta?.referenceMaterials)
      ? payload.meta.referenceMaterials
      : [];
  const materialSet = await normalizeReferenceMaterialsWithCustom(referenceSource, referenceImage, prompt);
  const referenceMaterials = materialSet.referenceMaterials;
  const customBlocks = normalizeStoredCustomBlocks([
    ...(Array.isArray(payload?.customBlocks) ? payload.customBlocks : []),
    ...(Array.isArray(payload?.meta?.customBlocks) ? payload.meta.customBlocks : []),
    ...materialSet.customBlocks,
  ]);
  const updateBlocks = (blocks) => Array.isArray(blocks)
    ? applyReferenceMaterialsToBlocks(blocks, referenceMaterials)
    : blocks;

  return {
    ...payload,
    blocks: updateBlocks(payload?.blocks),
    localBlocks: updateBlocks(payload?.localBlocks),
    referenceMaterials,
    customBlocks,
    meta: {
      ...(payload?.meta && typeof payload.meta === 'object' ? payload.meta : {}),
      referenceMaterials,
      customBlocks,
      buildingMaterialModule: {
        resolvedAt: Date.now(),
        customBlockIdRange: [CUSTOM_BLOCK_ID_MIN, CUSTOM_BLOCK_ID_MAX],
      },
    },
  };
}

function getBuildingProfile(prompt) {
  const text = prompt.toLowerCase();

  if (includesAny(text, ['金字塔', 'pyramid'])) {
    return {
      id: 'pyramid',
      label: '砂岩金字塔',
      foundation: BUILDING_BLOCK_IDS.SANDSTONE,
      wall: BUILDING_BLOCK_IDS.SANDSTONE,
      roof: BUILDING_BLOCK_IDS.SANDSTONE,
      window: BUILDING_BLOCK_IDS.LAMP,
      facility: BUILDING_BLOCK_IDS.LAMP,
    };
  }

  if (includesAny(text, ['城堡', '堡垒', '要塞', 'castle', 'fortress'])) {
    return {
      id: 'castle',
      label: '鹅卵石城堡',
      width: 11,
      depth: 11,
      wallHeight: 6,
      roofHeight: 2,
      foundation: BUILDING_BLOCK_IDS.COBBLESTONE,
      wall: BUILDING_BLOCK_IDS.COBBLESTONE,
      roof: BUILDING_BLOCK_IDS.ROOF_TILES,
      window: BUILDING_BLOCK_IDS.GLASS,
      trim: BUILDING_BLOCK_IDS.STONE,
      facility: BUILDING_BLOCK_IDS.LAMP,
      towers: true,
    };
  }

  if (includesAny(text, ['工厂', '工业', '仓库', '车库', 'factory', 'industrial', 'warehouse', 'garage'])) {
    return {
      id: 'industrial',
      label: '工业厂房',
      width: 12,
      depth: 9,
      wallHeight: 5,
      roofHeight: 1,
      foundation: BUILDING_BLOCK_IDS.CONCRETE,
      wall: BUILDING_BLOCK_IDS.BRICK,
      roof: BUILDING_BLOCK_IDS.METAL_PANEL,
      window: BUILDING_BLOCK_IDS.GLASS,
      trim: BUILDING_BLOCK_IDS.STEEL,
      facility: BUILDING_BLOCK_IDS.METAL_PANEL,
      flatRoof: true,
      chimney: true,
    };
  }

  if (includesAny(text, ['神庙', '寺庙', '神社', '日式', 'temple', 'shrine'])) {
    return {
      id: 'temple',
      label: '木构神庙',
      width: 11,
      depth: 9,
      wallHeight: 4,
      roofHeight: 3,
      foundation: BUILDING_BLOCK_IDS.STONE_SLAB,
      wall: BUILDING_BLOCK_IDS.PLANKS,
      roof: BUILDING_BLOCK_IDS.ROOF_TILES,
      window: BUILDING_BLOCK_IDS.GLASS,
      trim: BUILDING_BLOCK_IDS.WOOD,
      facility: BUILDING_BLOCK_IDS.LAMP,
      porch: true,
    };
  }

  if (includesAny(text, ['冰屋', '雪屋', '冰', '雪', 'ice', 'snow'])) {
    return {
      id: 'ice-house',
      label: includesAny(text, ['城堡', 'castle']) ? '冰雪城堡' : '冰雪小屋',
      width: 8,
      depth: 8,
      wallHeight: 4,
      roofHeight: 2,
      foundation: BUILDING_BLOCK_IDS.SNOW,
      wall: BUILDING_BLOCK_IDS.ICE,
      roof: BUILDING_BLOCK_IDS.SNOW,
      window: BUILDING_BLOCK_IDS.GLASS,
      trim: BUILDING_BLOCK_IDS.SNOW,
      facility: BUILDING_BLOCK_IDS.LAMP,
      towers: includesAny(text, ['城堡', 'castle']),
    };
  }

  if (includesAny(text, ['现代', '别墅', '玻璃', '公寓', 'modern', 'villa', 'apartment'])) {
    return {
      id: 'modern',
      label: '现代玻璃别墅',
      width: 10,
      depth: 8,
      wallHeight: 4,
      roofHeight: 1,
      foundation: BUILDING_BLOCK_IDS.CONCRETE,
      wall: BUILDING_BLOCK_IDS.QUARTZ,
      roof: BUILDING_BLOCK_IDS.CONCRETE,
      window: BUILDING_BLOCK_IDS.GLASS,
      trim: BUILDING_BLOCK_IDS.METAL_PANEL,
      facility: BUILDING_BLOCK_IDS.LAMP,
      flatRoof: true,
      largeWindows: true,
    };
  }

  if (includesAny(text, ['木屋', '小屋', '森林', '乡村', 'cabin', 'cottage', 'wood'])) {
    return {
      id: 'cabin',
      label: '森林木屋',
      width: 8,
      depth: 7,
      wallHeight: 4,
      roofHeight: 2,
      foundation: BUILDING_BLOCK_IDS.COBBLESTONE,
      wall: BUILDING_BLOCK_IDS.PLANKS,
      roof: BUILDING_BLOCK_IDS.ROOF_TILES,
      window: BUILDING_BLOCK_IDS.GLASS,
      trim: BUILDING_BLOCK_IDS.WOOD,
      facility: BUILDING_BLOCK_IDS.CRAFTING_TABLE,
      porch: true,
    };
  }

  return {
    id: 'house',
    label: '砖石住宅',
    width: 8,
    depth: 8,
    wallHeight: 4,
    roofHeight: 2,
    foundation: BUILDING_BLOCK_IDS.COBBLESTONE,
    wall: BUILDING_BLOCK_IDS.BRICK,
    roof: BUILDING_BLOCK_IDS.ROOF_TILES,
    window: BUILDING_BLOCK_IDS.GLASS,
    trim: BUILDING_BLOCK_IDS.PLANKS,
    facility: BUILDING_BLOCK_IDS.CRAFTING_TABLE,
  };
}

function createBlockCollector() {
  const blocks = new Map();

  return {
    add(x, y, z, blockId, part) {
      blocks.set(`${x},${y},${z}`, { x, y, z, blockId, part });
    },
    values() {
      return [...blocks.values()];
    },
  };
}

function addRect(collector, {
  minX,
  maxX,
  minY,
  maxY,
  minZ,
  maxZ,
  blockId,
  part,
  shell = false,
}) {
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        if (
          shell &&
          x > minX &&
          x < maxX &&
          y > minY &&
          y < maxY &&
          z > minZ &&
          z < maxZ
        ) {
          continue;
        }

        collector.add(x, y, z, blockId, part);
      }
    }
  }
}

function addHouseRoof(collector, profile, width, depth, wallHeight) {
  if (profile.flatRoof) {
    addRect(collector, {
      minX: 0,
      maxX: width - 1,
      minY: wallHeight + 1,
      maxY: wallHeight + 1,
      minZ: 0,
      maxZ: depth - 1,
      blockId: profile.roof,
      part: 'roof',
    });
    return;
  }

  for (let layer = 0; layer < profile.roofHeight; layer += 1) {
    const inset = layer;
    const minX = inset;
    const maxX = width - 1 - inset;
    const minZ = inset;
    const maxZ = depth - 1 - inset;

    if (minX > maxX || minZ > maxZ) {
      break;
    }

    addRect(collector, {
      minX,
      maxX,
      minY: wallHeight + 1 + layer,
      maxY: wallHeight + 1 + layer,
      minZ,
      maxZ,
      blockId: profile.roof,
      part: 'roof',
      shell: true,
    });
  }
}

function buildHouse(profile, prompt) {
  const random = hashPrompt(prompt);
  const width = profile.width + (random % 2 === 0 ? 0 : 1);
  const depth = profile.depth + ((random >>> 3) % 2 === 0 ? 0 : 1);
  const wallHeight = profile.wallHeight;
  const doorZ = Math.floor(depth / 2);
  const collector = createBlockCollector();

  addRect(collector, {
    minX: 0,
    maxX: width - 1,
    minY: 0,
    maxY: 0,
    minZ: 0,
    maxZ: depth - 1,
    blockId: profile.foundation,
    part: 'foundation',
  });

  for (let y = 1; y <= wallHeight; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let z = 0; z < depth; z += 1) {
        if (x !== 0 && x !== width - 1 && z !== 0 && z !== depth - 1) {
          continue;
        }

        collector.add(x, y, z, profile.wall, 'wall');
      }
    }
  }

  collector.add(0, 1, doorZ, BUILDING_BLOCK_IDS.AIR, 'door');
  collector.add(0, 2, doorZ, BUILDING_BLOCK_IDS.AIR, 'door');

  const windowY = Math.min(wallHeight - 1, 2);
  const windowPositions = [
    [Math.floor(width / 2), windowY, 0],
    [Math.floor(width / 2), windowY, depth - 1],
    [0, windowY, Math.max(1, doorZ - 2)],
    [width - 1, windowY, Math.min(depth - 2, doorZ + 2)],
  ];

  windowPositions.forEach(([x, y, z]) => collector.add(x, y, z, profile.window, 'window'));

  if (profile.largeWindows) {
    for (let z = 1; z < depth - 1; z += 1) {
      collector.add(width - 1, 2, z, profile.window, 'window');
      collector.add(width - 1, 3, z, profile.window, 'window');
    }
  }

  for (let y = 1; y <= wallHeight; y += 1) {
    collector.add(0, y, 0, profile.trim, 'wall');
    collector.add(0, y, depth - 1, profile.trim, 'wall');
    collector.add(width - 1, y, 0, profile.trim, 'wall');
    collector.add(width - 1, y, depth - 1, profile.trim, 'wall');
  }

  addHouseRoof(collector, profile, width, depth, wallHeight);

  if (profile.porch) {
    addRect(collector, {
      minX: -2,
      maxX: 0,
      minY: 0,
      maxY: 0,
      minZ: doorZ - 1,
      maxZ: doorZ + 1,
      blockId: profile.trim,
      part: 'foundation',
    });
    collector.add(-1, 1, doorZ - 1, profile.trim, 'wall');
    collector.add(-1, 1, doorZ + 1, profile.trim, 'wall');
  }

  if (profile.towers) {
    const towerCorners = [
      [0, 0],
      [0, depth - 3],
      [width - 3, 0],
      [width - 3, depth - 3],
    ];

    towerCorners.forEach(([x, z]) => {
      addRect(collector, {
        minX: x,
        maxX: x + 2,
        minY: 1,
        maxY: wallHeight + 2,
        minZ: z,
        maxZ: z + 2,
        blockId: profile.wall,
        part: 'wall',
        shell: true,
      });
      addRect(collector, {
        minX: x,
        maxX: x + 2,
        minY: wallHeight + 3,
        maxY: wallHeight + 3,
        minZ: z,
        maxZ: z + 2,
        blockId: profile.roof,
        part: 'roof',
      });
    });
  }

  if (profile.facility === BUILDING_BLOCK_IDS.WATER_FLOW_DECOR) {
    const waterX = Math.max(1, width - 2);

    for (let y = wallHeight; y >= 1; y -= 1) {
      collector.add(waterX, y, -1, BUILDING_BLOCK_IDS.WATER_FLOW_DECOR, 'facility');
    }

    collector.add(waterX - 1, 1, -1, BUILDING_BLOCK_IDS.WATER_FLOW_DECOR, 'facility');
    collector.add(waterX + 1, 1, -1, BUILDING_BLOCK_IDS.WATER_FLOW_DECOR, 'facility');
  }

  if (profile.chimney) {
    addRect(collector, {
      minX: width - 3,
      maxX: width - 2,
      minY: wallHeight + 2,
      maxY: wallHeight + 5,
      minZ: 1,
      maxZ: 2,
      blockId: BUILDING_BLOCK_IDS.METAL_PANEL,
      part: 'facility',
    });
  }

  const facilities = [
    [1, 1, 1, profile.facility],
    [width - 2, 1, 1, BUILDING_BLOCK_IDS.LAMP],
    [1, 1, depth - 2, BUILDING_BLOCK_IDS.PLANKS],
    [width - 2, 1, depth - 2, profile.id === 'industrial' ? BUILDING_BLOCK_IDS.STEEL : BUILDING_BLOCK_IDS.CRAFTING_TABLE],
  ];

  facilities.forEach(([x, y, z, blockId]) => collector.add(x, y, z, blockId, 'facility'));

  return {
    meta: {
      type: profile.id,
      label: profile.label,
      prompt,
      materialDirectives: profile.materialDirectives ?? {},
      requestedFloors: profile.requestedFloors ?? 0,
    },
    blocks: collector.values(),
  };
}

function buildPyramid(profile, prompt) {
  const random = hashPrompt(prompt);
  const size = 11 + ((random >>> 2) % 2) * 2;
  const center = Math.floor(size / 2);
  const collector = createBlockCollector();

  for (let level = 0; level <= center; level += 1) {
    const min = level;
    const max = size - 1 - level;

    addRect(collector, {
      minX: min,
      maxX: max,
      minY: level,
      maxY: level,
      minZ: min,
      maxZ: max,
      blockId: profile.wall,
      part: level === 0 ? 'foundation' : level === center ? 'roof' : 'wall',
      shell: level > 0,
    });
  }

  collector.add(0, 1, center, BUILDING_BLOCK_IDS.AIR, 'door');
  collector.add(0, 2, center, BUILDING_BLOCK_IDS.AIR, 'door');
  collector.add(1, 2, center - 2, profile.window, 'window');
  collector.add(1, 2, center + 2, profile.window, 'window');
  collector.add(center, 1, center, BUILDING_BLOCK_IDS.LAMP, 'facility');
  collector.add(center - 1, 1, center, BUILDING_BLOCK_IDS.CRAFTING_TABLE, 'facility');

  return {
    meta: {
      type: profile.id,
      label: profile.label,
      prompt,
      materialDirectives: profile.materialDirectives ?? {},
      requestedFloors: profile.requestedFloors ?? 0,
    },
    blocks: collector.values(),
  };
}

function makeOdd(value, fallback, min, max) {
  let next = clampInteger(value ?? fallback, min, max);

  if (next % 2 === 0) {
    next += next >= max ? -1 : 1;
  }

  return clampInteger(next, min, max);
}

const PROCEDURAL_MATERIAL_SLOTS = Object.freeze([
  'podium',
  'stair',
  'balustrade',
  'column',
  'wall',
  'door',
  'window',
  'dougong',
  'tile',
  'ridge',
]);

const PROCEDURAL_MATERIAL_PARTS = Object.freeze({
  podium: 'foundation',
  stair: 'foundation',
  balustrade: 'foundation',
  column: 'wall',
  wall: 'wall',
  door: 'door',
  window: 'window',
  dougong: 'facility',
  tile: 'roof',
  ridge: 'roof',
});

function getProceduralMaterialBlockId(value) {
  if (value && typeof value === 'object') {
    return Math.trunc(Number(value.blockId ?? value.id));
  }

  return Math.trunc(Number(value));
}

function normalizeProceduralMaterialReference(slot, value) {
  if (!PROCEDURAL_MATERIAL_SLOTS.includes(slot) || !value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const name = getCustomMaterialText(value);

  if (!name) {
    return null;
  }

  const sourceBlockId = getProceduralMaterialBlockId(value);

  return {
    ...value,
    name: String(value.name ?? value.label ?? value.material ?? name).trim().slice(0, 32),
    label: String(value.label ?? value.name ?? value.material ?? name).trim().slice(0, 32),
    blockId: Number.isInteger(sourceBlockId) ? sourceBlockId : value.blockId,
    sourceBlockId: Number.isInteger(sourceBlockId) ? sourceBlockId : null,
    slot,
    proceduralSlot: slot,
    part: String(value.part ?? PROCEDURAL_MATERIAL_PARTS[slot] ?? '').trim().slice(0, 24),
    usage: String(value.usage ?? `${slot} material`).trim().slice(0, 80),
    custom: value.custom !== false && value.fixed !== true,
  };
}

function collectProceduralReferenceMaterials(source = {}) {
  const materials = source.materials && typeof source.materials === 'object' ? source.materials : {};
  const references = Array.isArray(source.referenceMaterials) ? source.referenceMaterials : [];
  const detailPoints = Array.isArray(source.detailPoints)
    ? source.detailPoints
    : Array.isArray(source.descriptionPoints)
      ? source.descriptionPoints
      : [];
  const fromSlots = PROCEDURAL_MATERIAL_SLOTS
    .map((slot) => normalizeProceduralMaterialReference(slot, materials[slot]))
    .filter(Boolean);
  const fromDetails = detailPoints
    .map((point) => {
      const material = point?.material && typeof point.material === 'object'
        ? point.material
        : null;

      if (!material) {
        return null;
      }

      const detailId = String(point?.id ?? '').trim();
      const definition = PROCEDURAL_DETAIL_POINT_BY_ID.get(detailId) ?? null;
      const slot = String(point?.materialSlot ?? definition?.materialSlot ?? '').trim();

      return normalizeProceduralMaterialReference(slot, {
        ...material,
        slot,
        proceduralSlot: slot,
        part: point?.part ?? definition?.part ?? PROCEDURAL_MATERIAL_PARTS[slot],
        usage: material.usage ?? `${detailId || slot} detail material`,
      });
    })
    .filter(Boolean);

  return [...references, ...fromSlots, ...fromDetails].slice(0, 32);
}

const PROCEDURAL_SLOT_ALIASES = Object.freeze({
  podium: ['podium', 'base', '\u53f0\u57fa', '\u57fa\u5ea7', '\u5730\u57fa'],
  stair: ['stair', 'steps', '\u53f0\u9636', '\u697c\u68af', '\u8e0f\u6b65'],
  balustrade: ['balustrade', 'railing', '\u680f\u6746', '\u77f3\u680f\u6746'],
  column: ['column', 'pillar', '\u67f1', '\u67f1\u5b50', '\u7ea2\u67f1'],
  wall: ['wall', 'facade', '\u5899', '\u5899\u9762', '\u5bab\u5899', '\u7acb\u9762'],
  door: ['door', '\u95e8', '\u683c\u6805\u95e8'],
  window: ['window', 'glass', '\u7a97', '\u7a97\u6237', '\u73bb\u7483'],
  dougong: ['dougong', '\u6597\u62f1', '\u5f69\u753b\u6597\u62f1'],
  tile: ['tile', 'roof', '\u74e6', '\u5c4b\u9876', '\u7409\u7483\u74e6', '\u6bbf\u9876'],
  ridge: ['ridge', '\u5c4b\u810a', '\u6b63\u810a', '\u5782\u810a'],
});

const PROCEDURAL_DETAIL_CORE_DEFINITIONS = Object.freeze([
  ['podium_upper_surface', 'podium top surface', 'foundation', 'podium'],
  ['podium_lower_plinth', 'lower plinth tiers', 'foundation', 'podium'],
  ['podium_corner_blocks', 'podium corner stones', 'foundation', 'podium'],
  ['podium_drain_spouts', 'podium drain spouts', 'facility', 'ridge'],
  ['imperial_way_center_slab', 'central imperial way slab', 'foundation', 'podium'],
  ['imperial_way_side_stairs', 'side stairs', 'foundation', 'stair'],
  ['stair_side_cheeks', 'stair side cheek walls', 'foundation', 'balustrade'],
  ['front_landing', 'front landing platform', 'foundation', 'podium'],
  ['balustrade_front', 'front balustrade', 'foundation', 'balustrade'],
  ['balustrade_back', 'rear balustrade', 'foundation', 'balustrade'],
  ['balustrade_left', 'left balustrade', 'foundation', 'balustrade'],
  ['balustrade_right', 'right balustrade', 'foundation', 'balustrade'],
  ['balustrade_posts', 'balustrade posts', 'foundation', 'balustrade'],
  ['outer_column_grid', 'outer column grid', 'wall', 'column'],
  ['inner_column_grid', 'inner column grid', 'wall', 'column'],
  ['column_bases', 'column bases', 'foundation', 'podium'],
  ['column_capitals', 'column capitals', 'facility', 'dougong'],
  ['front_central_doors', 'front central doors', 'door', 'door'],
  ['front_side_doors', 'front side doors', 'door', 'door'],
  ['rear_service_door', 'rear service door', 'door', 'door'],
  ['front_lattice_panels', 'front lattice panels', 'door', 'door'],
  ['side_lattice_panels', 'side lattice panels', 'window', 'window'],
  ['rear_lattice_panels', 'rear lattice panels', 'window', 'window'],
  ['rear_windows', 'rear windows', 'window', 'window'],
  ['side_windows', 'side windows', 'window', 'window'],
  ['wall_spandrels', 'wall spandrels', 'wall', 'wall'],
  ['painted_wall_panels', 'painted wall panels', 'wall', 'wall'],
  ['front_dougong', 'front dougong', 'facility', 'dougong'],
  ['rear_dougong', 'rear dougong', 'facility', 'dougong'],
  ['side_dougong', 'side dougong', 'facility', 'dougong'],
  ['painted_beam_band', 'painted beam band', 'facility', 'dougong'],
  ['lower_eave', 'lower eave', 'roof', 'tile'],
  ['upper_eave', 'upper eave', 'roof', 'tile'],
  ['lower_hip_roof_tiles', 'lower hip roof tiles', 'roof', 'tile'],
  ['upper_hip_roof_tiles', 'upper hip roof tiles', 'roof', 'tile'],
  ['roof_ridge_line', 'roof ridge line', 'roof', 'ridge'],
  ['ridge_beasts', 'ridge beasts', 'facility', 'ridge'],
  ['corner_chiwen', 'corner chiwen ornaments', 'facility', 'ridge'],
  ['upturned_roof_corners', 'upturned roof corners', 'roof', 'ridge'],
  ['courtyard_paving', 'courtyard paving', 'foundation', 'stair'],
  ['lanterns', 'lanterns', 'facility', 'ridge'],
  ['planters', 'planters', 'facility', 'balustrade'],
  ['stone_lions', 'stone lions', 'facility', 'ridge'],
  ['bronze_vats', 'bronze vats', 'facility', 'ridge'],
  ['front_plaque', 'front plaque', 'facility', 'ridge'],
  ['interior_throne', 'interior throne', 'facility', 'door'],
  ['screen_wall', 'screen wall', 'wall', 'wall'],
  ['axis_markers', 'central axis markers', 'facility', 'ridge'],
  ['rear_steps', 'rear steps', 'foundation', 'stair'],
  ['corner_lamps', 'corner lamps', 'facility', 'ridge'],
].map(([id, label, part, materialSlot], index) => ({
  id,
  index: index + 1,
  label,
  part,
  materialSlot,
  enabled: true,
  intensity: 1,
})));

function createProceduralDetailSeries({
  group,
  prefix,
  labelPrefix,
  part,
  materialSlot,
  kind,
  count = 10,
  edge = '',
  zone = '',
  intensity = 0.8,
}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}_${String(index + 1).padStart(2, '0')}`,
    group,
    index: index + 1,
    label: `${labelPrefix} ${index + 1}`,
    part,
    materialSlot,
    kind,
    edge,
    zone,
    enabled: true,
    intensity,
  }));
}

const PROCEDURAL_DETAIL_SERIES_DEFINITIONS = Object.freeze([
  ...createProceduralDetailSeries({
    group: 'front_facade_bays',
    prefix: 'front_facade_bay',
    labelPrefix: 'front facade bay',
    part: 'wall',
    materialSlot: 'wall',
    kind: 'facade-edge',
    edge: 'front',
  }),
  ...createProceduralDetailSeries({
    group: 'rear_facade_bays',
    prefix: 'rear_facade_bay',
    labelPrefix: 'rear facade bay',
    part: 'wall',
    materialSlot: 'wall',
    kind: 'facade-edge',
    edge: 'rear',
  }),
  ...createProceduralDetailSeries({
    group: 'left_facade_bays',
    prefix: 'left_facade_bay',
    labelPrefix: 'left facade bay',
    part: 'wall',
    materialSlot: 'wall',
    kind: 'facade-edge',
    edge: 'left',
  }),
  ...createProceduralDetailSeries({
    group: 'right_facade_bays',
    prefix: 'right_facade_bay',
    labelPrefix: 'right facade bay',
    part: 'wall',
    materialSlot: 'wall',
    kind: 'facade-edge',
    edge: 'right',
  }),
  ...createProceduralDetailSeries({
    group: 'lower_roof_front_segments',
    prefix: 'lower_roof_front',
    labelPrefix: 'lower roof front segment',
    part: 'roof',
    materialSlot: 'tile',
    kind: 'roof-band',
    edge: 'front',
  }),
  ...createProceduralDetailSeries({
    group: 'lower_roof_back_segments',
    prefix: 'lower_roof_back',
    labelPrefix: 'lower roof back segment',
    part: 'roof',
    materialSlot: 'tile',
    kind: 'roof-band',
    edge: 'rear',
  }),
  ...createProceduralDetailSeries({
    group: 'lower_roof_left_segments',
    prefix: 'lower_roof_left',
    labelPrefix: 'lower roof left segment',
    part: 'roof',
    materialSlot: 'tile',
    kind: 'roof-band',
    edge: 'left',
  }),
  ...createProceduralDetailSeries({
    group: 'lower_roof_right_segments',
    prefix: 'lower_roof_right',
    labelPrefix: 'lower roof right segment',
    part: 'roof',
    materialSlot: 'tile',
    kind: 'roof-band',
    edge: 'right',
  }),
  ...createProceduralDetailSeries({
    group: 'upper_roof_front_segments',
    prefix: 'upper_roof_front',
    labelPrefix: 'upper roof front segment',
    part: 'roof',
    materialSlot: 'tile',
    kind: 'roof-band-upper',
    edge: 'front',
  }),
  ...createProceduralDetailSeries({
    group: 'upper_roof_back_segments',
    prefix: 'upper_roof_back',
    labelPrefix: 'upper roof back segment',
    part: 'roof',
    materialSlot: 'tile',
    kind: 'roof-band-upper',
    edge: 'rear',
  }),
  ...createProceduralDetailSeries({
    group: 'upper_roof_left_segments',
    prefix: 'upper_roof_left',
    labelPrefix: 'upper roof left segment',
    part: 'roof',
    materialSlot: 'tile',
    kind: 'roof-band-upper',
    edge: 'left',
  }),
  ...createProceduralDetailSeries({
    group: 'upper_roof_right_segments',
    prefix: 'upper_roof_right',
    labelPrefix: 'upper roof right segment',
    part: 'roof',
    materialSlot: 'tile',
    kind: 'roof-band-upper',
    edge: 'right',
  }),
  ...createProceduralDetailSeries({
    group: 'courtyard_edge_lamps',
    prefix: 'courtyard_edge_lamp',
    labelPrefix: 'courtyard edge lamp',
    part: 'facility',
    materialSlot: 'ridge',
    kind: 'courtyard-edge',
    edge: 'perimeter',
  }),
  ...createProceduralDetailSeries({
    group: 'courtyard_edge_planters',
    prefix: 'courtyard_edge_planter',
    labelPrefix: 'courtyard edge planter',
    part: 'facility',
    materialSlot: 'balustrade',
    kind: 'courtyard-edge',
    edge: 'perimeter',
  }),
  ...createProceduralDetailSeries({
    group: 'interior_support_modules',
    prefix: 'interior_support',
    labelPrefix: 'interior support',
    part: 'wall',
    materialSlot: 'column',
    kind: 'interior-support',
    edge: 'interior',
  }),
]);

const PROCEDURAL_DETAIL_POINT_DEFINITIONS = Object.freeze([
  ...PROCEDURAL_DETAIL_CORE_DEFINITIONS,
  ...PROCEDURAL_DETAIL_SERIES_DEFINITIONS,
]);

const PROCEDURAL_DETAIL_POINT_BY_ID = new Map(
  PROCEDURAL_DETAIL_POINT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCustomProceduralMaterialsFromPrompt(prompt = '') {
  const text = String(prompt ?? '');
  const results = [];
  const seen = new Set();
  const customWords = '(?:\u81ea\u5b9a\u4e49\u6750\u8d28|\u81ea\u5b9a\u4e49\u6750\u6599|custom\\s+material|custom\\s+block|material)';
  const quoteOpen = '[\u201c"\'\u300c\u300e\u300a]';
  const quoteClose = '[\u201d"\'\u300d\u300f\u300b]';
  const nearText = '[^\u3002\uff0c\uff1b\uff1a,.;:\\n]{0,18}';

  for (const slot of PROCEDURAL_MATERIAL_SLOTS) {
    const aliases = PROCEDURAL_SLOT_ALIASES[slot] ?? [slot];
    const aliasPattern = aliases.map(escapeRegExp).join('|');
    const patterns = [
      new RegExp(`(?:${aliasPattern})${nearText}${customWords}${nearText}${quoteOpen}([^\\u201c\\u201d"'\\u300c\\u300d\\u300e\\u300f\\u300a\\u300b]{1,32})${quoteClose}`, 'i'),
      new RegExp(`${customWords}${nearText}${quoteOpen}([^\\u201c\\u201d"'\\u300c\\u300d\\u300e\\u300f\\u300a\\u300b]{1,32})${quoteClose}${nearText}(?:${aliasPattern})`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const name = String(match?.[1] ?? '').trim();

      if (!name) {
        continue;
      }

      const key = `${slot}:${name}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      results.push({
        name,
        label: name,
        slot,
        proceduralSlot: slot,
        part: PROCEDURAL_MATERIAL_PARTS[slot] ?? '',
        usage: `${slot} custom material from prompt`,
        custom: true,
        confidence: 0.86,
      });
      break;
    }
  }

  return results;
}

function dedupeProceduralReferenceSource(source = []) {
  const items = Array.isArray(source) ? source : [];
  const byKey = new Map();

  items.forEach((item, index) => {
    const slot = String(item?.proceduralSlot ?? item?.slot ?? '').trim();
    const name = normalizeCustomBlockKey(getCustomMaterialText(item));
    const key = slot
      ? `slot:${slot}`
      : `item:${name || index}`;

    byKey.set(key, item);
  });

  return [...byKey.values()].slice(0, 32);
}

function normalizeProceduralDetailPoints(source = {}) {
  const candidateLists = [
    source.detailPoints,
    source.descriptionPoints,
    source.details,
    source.features,
    source.parts,
  ];
  const incoming = candidateLists.find(Array.isArray) ?? [];
  const byId = new Map();

  incoming.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const id = String(item.id ?? item.key ?? item.name ?? '').trim();
    const definition = PROCEDURAL_DETAIL_POINT_BY_ID.get(id);

    if (!definition) {
      return;
    }

    const materialSlot = String(item.materialSlot ?? item.slot ?? definition.materialSlot).trim();

    byId.set(definition.id, {
      ...definition,
      enabled: item.enabled !== false,
      intensity: Math.max(0, Math.min(1, Number(item.intensity ?? item.weight ?? 1))),
      description: String(item.description ?? item.label ?? definition.label).trim().slice(0, 180),
      materialSlot: PROCEDURAL_MATERIAL_SLOTS.includes(materialSlot) ? materialSlot : definition.materialSlot,
      sourceIndex: Number.isFinite(Number(item.index)) ? Math.trunc(Number(item.index)) : index + 1,
    });
  });

  return PROCEDURAL_DETAIL_POINT_DEFINITIONS.map((definition) => ({
    ...definition,
    ...(byId.get(definition.id) ?? {
      description: definition.label,
    }),
  }));
}

function normalizeProceduralMaterials(source = {}) {
  return {
    podium: isAllowedBlockId(getProceduralMaterialBlockId(source.podium)) ? getProceduralMaterialBlockId(source.podium) : BUILDING_BLOCK_IDS.MARBLE,
    stair: isAllowedBlockId(getProceduralMaterialBlockId(source.stair)) ? getProceduralMaterialBlockId(source.stair) : BUILDING_BLOCK_IDS.STONE_SLAB,
    balustrade: isAllowedBlockId(getProceduralMaterialBlockId(source.balustrade)) ? getProceduralMaterialBlockId(source.balustrade) : BUILDING_BLOCK_IDS.QUARTZ,
    column: isAllowedBlockId(getProceduralMaterialBlockId(source.column)) ? getProceduralMaterialBlockId(source.column) : BUILDING_BLOCK_IDS.TERRACOTTA,
    wall: isAllowedBlockId(getProceduralMaterialBlockId(source.wall)) ? getProceduralMaterialBlockId(source.wall) : BUILDING_BLOCK_IDS.TERRACOTTA,
    door: isAllowedBlockId(getProceduralMaterialBlockId(source.door)) ? getProceduralMaterialBlockId(source.door) : BUILDING_BLOCK_IDS.PLANKS,
    window: isAllowedBlockId(getProceduralMaterialBlockId(source.window)) ? getProceduralMaterialBlockId(source.window) : BUILDING_BLOCK_IDS.GLASS,
    dougong: isAllowedBlockId(getProceduralMaterialBlockId(source.dougong)) ? getProceduralMaterialBlockId(source.dougong) : BUILDING_BLOCK_IDS.WHITE_WALL,
    tile: isAllowedBlockId(getProceduralMaterialBlockId(source.tile)) ? getProceduralMaterialBlockId(source.tile) : BUILDING_BLOCK_IDS.SANDSTONE,
    ridge: isAllowedBlockId(getProceduralMaterialBlockId(source.ridge)) ? getProceduralMaterialBlockId(source.ridge) : BUILDING_BLOCK_IDS.DARK_STONE,
  };
}

function applyResolvedProceduralMaterials(parameters, referenceMaterials = []) {
  const config = normalizeProceduralParameters(parameters);
  const materials = { ...config.materials };

  for (const material of referenceMaterials) {
    const slot = String(material?.proceduralSlot ?? material?.slot ?? '').trim();
    const blockId = Math.trunc(Number(material?.blockId));

    if (PROCEDURAL_MATERIAL_SLOTS.includes(slot) && isAllowedBlockId(blockId)) {
      materials[slot] = blockId;
    }
  }

  return {
    ...config,
    materials: normalizeProceduralMaterials(materials),
    referenceMaterials,
    detailPoints: normalizeProceduralDetailPoints({
      ...parameters,
      detailPoints: parameters?.detailPoints ?? config.detailPoints,
    }),
  };
}

function normalizeProceduralParameters(source = {}, prompt = '') {
  const dimensions = source.dimensions && typeof source.dimensions === 'object' ? source.dimensions : {};
  const layout = source.layout && typeof source.layout === 'object' ? source.layout : {};
  const visualFingerprint = normalizeVisualFingerprint(source.visualFingerprint ?? source.fingerprint ?? {});
  const text = `${prompt} ${JSON.stringify(source).toLowerCase()}`;
  const large = /palace|imperial|hall|宫|殿|庑殿|重檐/.test(text);
  const width = makeOdd(dimensions.width, large ? 31 : 23, 15, 47);
  const depth = makeOdd(dimensions.depth, large ? 21 : 15, 11, 35);
  const baysX = clampInteger(layout.baysX ?? (width >= 29 ? 5 : 3), 3, 7);
  const baysZ = clampInteger(layout.baysZ ?? (depth >= 19 ? 3 : 2), 1, 5);
  const floors = clampInteger(layout.floors ?? visualFingerprint.facade.floors ?? 1, 1, 12);

  return {
    buildingType: String(source.buildingType ?? visualFingerprint.apparentType ?? 'generic_building').trim().slice(0, 64) || 'generic_building',
    apparentType: String(source.apparentType ?? visualFingerprint.apparentType ?? '').trim().slice(0, 64),
    visualFingerprint,
    materialPalette: normalizeMaterialPalette(
      source.materialPalette
        ?? source.palette
        ?? source.visualFingerprint?.materials
        ?? source.visualFingerprint?.colorPalette
        ?? source.dominantColors,
      10,
    ),
    dominantColors: normalizeMaterialPalette(source.dominantColors, 8),
    signatureFeatures: normalizeFeatureList(source.signatureFeatures, 24),
    imageRegions: normalizeRegionList(source.imageRegions, 24),
    dimensions: {
      width,
      depth,
      podiumHeight: clampInteger(dimensions.podiumHeight ?? 3, 1, 5),
      columnHeight: clampInteger(dimensions.columnHeight ?? Math.max(4, floors * 3), 3, 18),
    },
    layout: {
      baysX: baysX % 2 === 0 ? baysX + 1 : baysX,
      baysZ,
      hasDoubleEave: layout.hasDoubleEave !== false,
      hasImperialWay: layout.hasImperialWay !== false,
      floors,
      roofShape: String(layout.roofShape ?? visualFingerprint.silhouette.roofShape ?? '').trim().slice(0, 32),
      windowRhythm: String(layout.windowRhythm ?? visualFingerprint.facade.windowRhythm ?? '').trim().slice(0, 48),
      mainEntrance: String(layout.mainEntrance ?? visualFingerprint.facade.mainEntrance ?? 'center').trim().slice(0, 32),
      hasTallCenter: Boolean(layout.hasTallCenter ?? visualFingerprint.silhouette.hasTallCenter),
      hasSideWings: Boolean(layout.hasSideWings ?? visualFingerprint.silhouette.hasSideWings),
      towerCount: clampInteger(layout.towerCount ?? visualFingerprint.silhouette.towerCount ?? 0, 0, 6),
    },
    materials: normalizeProceduralMaterials(source.materials),
    referenceMaterials: collectProceduralReferenceMaterials(source),
    detailPoints: normalizeProceduralDetailPoints(source),
  };
}

function addSparseSurface(collector, { minX, maxX, y, minZ, maxZ, blockId, part, step = 1 }) {
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      if (step > 1 && (Math.abs(x - minX) + Math.abs(z - minZ)) % step !== 0) {
        continue;
      }

      collector.add(x, y, z, blockId, part);
    }
  }
}

function addPerimeter(collector, { minX, maxX, y, minZ, maxZ, blockId, part, step = 1 }) {
  for (let x = minX; x <= maxX; x += step) {
    collector.add(x, y, minZ, blockId, part);
    collector.add(x, y, maxZ, blockId, part);
  }

  for (let z = minZ; z <= maxZ; z += step) {
    collector.add(minX, y, z, blockId, part);
    collector.add(maxX, y, z, blockId, part);
  }
}

function addColumn(collector, x, z, minY, maxY, blockId) {
  for (let y = minY; y <= maxY; y += 1) {
    collector.add(x, y, z, blockId, 'wall');
  }
}

function getGridPositions(min, max, bays) {
  const positions = [];

  for (let index = 0; index <= bays; index += 1) {
    positions.push(Math.round(min + ((max - min) * index) / bays));
  }

  return [...new Set(positions)];
}

function addLatticePanel(collector, { minX, maxX, minY, maxY, z, blockId, part }) {
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (y === minY || y === maxY || x === minX || x === maxX || (x - minX) % 2 === 0) {
        collector.add(x, y, z, blockId, part);
      }
    }
  }
}

function addHipRoof(collector, { minX, maxX, minZ, maxZ, baseY, layers, tile, ridge }) {
  for (let layer = 0; layer < layers; layer += 1) {
    const x0 = minX + layer;
    const x1 = maxX - layer;
    const z0 = minZ + layer;
    const z1 = maxZ - layer;
    const y = baseY + Math.floor(layer / 2);

    if (x0 > x1 || z0 > z1) {
      break;
    }

    addPerimeter(collector, { minX: x0, maxX: x1, y, minZ: z0, maxZ: z1, blockId: tile, part: 'roof', step: 2 });

    for (let x = x0 + 2; x <= x1 - 2; x += 5) {
      collector.add(x, y, z0 + 1, tile, 'roof');
      collector.add(x, y, z1 - 1, tile, 'roof');
    }

    for (let z = z0 + 2; z <= z1 - 2; z += 5) {
      collector.add(x0 + 1, y, z, tile, 'roof');
      collector.add(x1 - 1, y, z, tile, 'roof');
    }

    collector.add(x0, y, z0, ridge, 'roof');
    collector.add(x1, y, z0, ridge, 'roof');
    collector.add(x0, y, z1, ridge, 'roof');
    collector.add(x1, y, z1, ridge, 'roof');
  }

  const topY = baseY + Math.floor((layers - 1) / 2) + 1;
  const centerZ = Math.round((minZ + maxZ) / 2);
  const ridgeMinX = minX + layers + 1;
  const ridgeMaxX = maxX - layers - 1;

  for (let x = ridgeMinX; x <= ridgeMaxX; x += 1) {
    collector.add(x, topY, centerZ, ridge, 'roof');
  }

  collector.add(ridgeMinX - 1, topY, centerZ, ridge, 'roof');
  collector.add(ridgeMaxX + 1, topY, centerZ, ridge, 'roof');
}

function getDetailPointMap(config) {
  return new Map((Array.isArray(config?.detailPoints) ? config.detailPoints : [])
    .map((point) => [point.id, point]));
}

function isDetailEnabled(detailMap, id) {
  const point = detailMap.get(id);

  return !point || point.enabled !== false;
}

function getDetailMaterial(detailMap, id, materials, fallbackSlot) {
  const point = detailMap.get(id);
  const slot = String(point?.materialSlot ?? fallbackSlot ?? '').trim();
  const blockId = materials[slot];

  return isAllowedBlockId(blockId) ? blockId : materials[fallbackSlot];
}

function addPost(collector, x, z, minY, maxY, blockId, part = 'facility') {
  for (let y = minY; y <= maxY; y += 1) {
    collector.add(x, y, z, blockId, part);
  }
}

function addProceduralDetailBlocks(collector, context) {
  const {
    detailMap,
    materials: m,
    width,
    depth,
    podiumHeight,
    columnHeight,
    maxX,
    maxZ,
    centerX,
    hallMinX,
    hallMaxX,
    hallMinZ,
    hallMaxZ,
    floorY,
    topY,
    firstRoofY,
    hasDoubleEave,
    columnXs,
    columnZs,
  } = context;
  const detail = (id) => isDetailEnabled(detailMap, id);
  const material = (id, slot) => getDetailMaterial(detailMap, id, m, slot);

  if (detail('podium_corner_blocks')) {
    [[0, 0], [maxX, 0], [0, maxZ], [maxX, maxZ]].forEach(([x, z]) => {
      addPost(collector, x, z, 0, podiumHeight, material('podium_corner_blocks', 'podium'), 'foundation');
    });
  }

  if (detail('podium_drain_spouts')) {
    for (let x = 3; x < maxX; x += 6) {
      collector.add(x, podiumHeight, -1, material('podium_drain_spouts', 'ridge'), 'facility');
      collector.add(x, podiumHeight, maxZ + 1, material('podium_drain_spouts', 'ridge'), 'facility');
    }
  }

  if (detail('stair_side_cheeks')) {
    const stairHalf = Math.min(4, Math.max(2, Math.floor(width / 8)));

    for (let z = -podiumHeight - 2; z <= -1; z += 1) {
      collector.add(centerX - stairHalf - 1, 0, z, material('stair_side_cheeks', 'balustrade'), 'foundation');
      collector.add(centerX + stairHalf + 1, 0, z, material('stair_side_cheeks', 'balustrade'), 'foundation');
    }
  }

  if (detail('front_landing')) {
    addSparseSurface(collector, {
      minX: Math.max(0, centerX - 5),
      maxX: Math.min(maxX, centerX + 5),
      y: podiumHeight,
      minZ: -1,
      maxZ: -1,
      blockId: material('front_landing', 'podium'),
      part: 'foundation',
    });
  }

  if (detail('balustrade_posts')) {
    for (let x = 0; x <= maxX; x += Math.max(3, Math.floor(width / 8))) {
      addPost(collector, x, 0, podiumHeight, podiumHeight + 1, material('balustrade_posts', 'balustrade'), 'foundation');
      addPost(collector, x, maxZ, podiumHeight, podiumHeight + 1, material('balustrade_posts', 'balustrade'), 'foundation');
    }
    for (let z = 0; z <= maxZ; z += Math.max(3, Math.floor(depth / 6))) {
      addPost(collector, 0, z, podiumHeight, podiumHeight + 1, material('balustrade_posts', 'balustrade'), 'foundation');
      addPost(collector, maxX, z, podiumHeight, podiumHeight + 1, material('balustrade_posts', 'balustrade'), 'foundation');
    }
  }

  if (detail('inner_column_grid')) {
    const innerXs = getGridPositions(hallMinX + 2, hallMaxX - 2, Math.max(2, Math.floor(columnXs.length / 2)));
    const innerZs = getGridPositions(hallMinZ + 2, hallMaxZ - 2, Math.max(1, Math.floor(columnZs.length / 2)));

    innerXs.forEach((x) => {
      innerZs.forEach((z) => addColumn(collector, x, z, floorY, topY - 1, material('inner_column_grid', 'column')));
    });
  }

  if (detail('column_bases')) {
    columnXs.forEach((x) => {
      columnZs.forEach((z) => {
        collector.add(x, floorY, z, material('column_bases', 'podium'), 'foundation');
        collector.add(x - 1, floorY, z, material('column_bases', 'podium'), 'foundation');
        collector.add(x + 1, floorY, z, material('column_bases', 'podium'), 'foundation');
      });
    });
  }

  if (detail('column_capitals')) {
    columnXs.forEach((x) => {
      columnZs.forEach((z) => collector.add(x, topY, z, material('column_capitals', 'dougong'), 'facility'));
    });
  }

  if (detail('front_side_doors')) {
    [hallMinX + 3, hallMaxX - 3].forEach((x) => {
      collector.add(x, floorY + 1, hallMinZ, material('front_side_doors', 'door'), 'door');
      collector.add(x, floorY + 2, hallMinZ, material('front_side_doors', 'door'), 'door');
    });
  }

  if (detail('rear_service_door')) {
    collector.add(centerX, floorY + 1, hallMaxZ, material('rear_service_door', 'door'), 'door');
    collector.add(centerX, floorY + 2, hallMaxZ, material('rear_service_door', 'door'), 'door');
  }

  if (detail('painted_wall_panels')) {
    for (let x = hallMinX + 2; x < hallMaxX; x += 4) {
      collector.add(x, floorY + 1, hallMinZ + 1, material('painted_wall_panels', 'wall'), 'wall');
      collector.add(x, floorY + 1, hallMaxZ - 1, material('painted_wall_panels', 'wall'), 'wall');
    }
  }

  if (detail('painted_beam_band')) {
    for (let x = hallMinX; x <= hallMaxX; x += 1) {
      collector.add(x, topY, hallMinZ, material('painted_beam_band', 'dougong'), 'facility');
      collector.add(x, topY, hallMaxZ, material('painted_beam_band', 'dougong'), 'facility');
    }
  }

  if (detail('lower_eave')) {
    addPerimeter(collector, {
      minX: hallMinX - 4,
      maxX: hallMaxX + 4,
      y: firstRoofY - 1,
      minZ: hallMinZ - 4,
      maxZ: hallMaxZ + 4,
      blockId: material('lower_eave', 'tile'),
      part: 'roof',
      step: 2,
    });
  }

  if (hasDoubleEave && detail('upper_eave')) {
    addPerimeter(collector, {
      minX: hallMinX - 3,
      maxX: hallMaxX + 3,
      y: firstRoofY + 3,
      minZ: hallMinZ - 3,
      maxZ: hallMaxZ + 3,
      blockId: material('upper_eave', 'tile'),
      part: 'roof',
      step: 2,
    });
  }

  if (detail('ridge_beasts')) {
    const ridgeY = firstRoofY + (hasDoubleEave ? 7 : 4);
    [centerX - 5, centerX - 2, centerX + 2, centerX + 5].forEach((x) => {
      collector.add(x, ridgeY, Math.round((hallMinZ + hallMaxZ) / 2), material('ridge_beasts', 'ridge'), 'facility');
    });
  }

  if (detail('corner_chiwen') || detail('upturned_roof_corners')) {
    const cornerY = firstRoofY + (hasDoubleEave ? 5 : 3);

    [[hallMinX - 3, hallMinZ - 3], [hallMaxX + 3, hallMinZ - 3], [hallMinX - 3, hallMaxZ + 3], [hallMaxX + 3, hallMaxZ + 3]].forEach(([x, z]) => {
      collector.add(x, cornerY, z, material('corner_chiwen', 'ridge'), 'facility');
      if (detail('upturned_roof_corners')) {
        collector.add(x, cornerY + 1, z, material('upturned_roof_corners', 'ridge'), 'roof');
      }
    });
  }

  if (detail('courtyard_paving')) {
    addSparseSurface(collector, {
      minX: Math.max(2, centerX - Math.floor(width / 3)),
      maxX: Math.min(maxX - 2, centerX + Math.floor(width / 3)),
      y: 0,
      minZ: -podiumHeight - 7,
      maxZ: -podiumHeight - 3,
      blockId: material('courtyard_paving', 'stair'),
      part: 'foundation',
      step: 2,
    });
  }

  if (detail('lanterns')) {
    [centerX - 5, centerX + 5].forEach((x) => {
      addPost(collector, x, hallMinZ - 2, floorY + 1, floorY + 3, material('lanterns', 'ridge'), 'facility');
    });
  }

  if (detail('planters')) {
    [centerX - 8, centerX + 8].forEach((x) => {
      collector.add(x, 1, -podiumHeight - 4, material('planters', 'balustrade'), 'facility');
      collector.add(x, 2, -podiumHeight - 4, BUILDING_BLOCK_IDS.BAMBOO, 'facility');
    });
  }

  if (detail('stone_lions')) {
    [centerX - 6, centerX + 6].forEach((x) => {
      collector.add(x, 1, -2, material('stone_lions', 'ridge'), 'facility');
      collector.add(x, 2, -2, material('stone_lions', 'ridge'), 'facility');
    });
  }

  if (detail('bronze_vats')) {
    [hallMinX + 2, hallMaxX - 2].forEach((x) => {
      collector.add(x, floorY + 1, hallMinZ - 1, BUILDING_BLOCK_IDS.COPPER_PANEL, 'facility');
    });
  }

  if (detail('front_plaque')) {
    for (let x = centerX - 2; x <= centerX + 2; x += 1) {
      collector.add(x, topY - 1, hallMinZ - 1, material('front_plaque', 'ridge'), 'facility');
    }
  }

  if (detail('interior_throne')) {
    collector.add(centerX, floorY + 1, hallMaxZ - 3, material('interior_throne', 'door'), 'facility');
    collector.add(centerX, floorY + 2, hallMaxZ - 3, material('interior_throne', 'door'), 'facility');
    collector.add(centerX - 1, floorY + 1, hallMaxZ - 3, material('interior_throne', 'door'), 'facility');
    collector.add(centerX + 1, floorY + 1, hallMaxZ - 3, material('interior_throne', 'door'), 'facility');
  }

  if (detail('screen_wall')) {
    for (let x = centerX - 4; x <= centerX + 4; x += 1) {
      collector.add(x, 1, -podiumHeight - 6, material('screen_wall', 'wall'), 'wall');
      if (Math.abs(x - centerX) > 1) {
        collector.add(x, 2, -podiumHeight - 6, material('screen_wall', 'wall'), 'wall');
      }
    }
  }

  if (detail('axis_markers')) {
    for (let z = -podiumHeight - 7; z <= hallMinZ - 1; z += 2) {
      collector.add(centerX, 1, z, material('axis_markers', 'ridge'), 'facility');
    }
  }

  if (detail('rear_steps')) {
    for (let step = 0; step < podiumHeight; step += 1) {
      for (let x = centerX - 2; x <= centerX + 2; x += 1) {
        collector.add(x, Math.max(0, podiumHeight - 1 - step), maxZ + 1 + step, material('rear_steps', 'stair'), 'foundation');
      }
    }
  }

  if (detail('corner_lamps')) {
    [[1, 1], [maxX - 1, 1], [1, maxZ - 1], [maxX - 1, maxZ - 1]].forEach(([x, z]) => {
      addPost(collector, x, z, podiumHeight + 1, podiumHeight + 3, material('corner_lamps', 'ridge'), 'facility');
    });
  }
}

function getDetailPointsByGroup(detailPoints = []) {
  const byGroup = new Map();

  for (const point of Array.isArray(detailPoints) ? detailPoints : []) {
    if (!point || typeof point !== 'object' || point.enabled === false) {
      continue;
    }

    const group = String(point.group ?? point.kind ?? '').trim();

    if (!group) {
      continue;
    }

    if (!byGroup.has(group)) {
      byGroup.set(group, []);
    }

    byGroup.get(group).push(point);
  }

  for (const points of byGroup.values()) {
    points.sort((left, right) => (Number(left.index) || 0) - (Number(right.index) || 0));
  }

  return byGroup;
}

function getSeriesPointCoordinate(index, count, min, max) {
  if (count <= 1) {
    return Math.round((min + max) / 2);
  }

  return Math.round(min + ((max - min) * index) / (count - 1));
}

function addSeriesFacadeBlocks(collector, { points, edge, materials, hallMinX, hallMaxX, hallMinZ, hallMaxZ, floorY, columnHeight, centerX }) {
  const count = points.length;
  const height = Math.min(4, Math.max(2, columnHeight - 1));

  points.forEach((point, index) => {
    const x = edge === 'left' || edge === 'right'
      ? (edge === 'left' ? hallMinX : hallMaxX)
      : getSeriesPointCoordinate(index, count, hallMinX + 1, hallMaxX - 1);
    const z = edge === 'front' || edge === 'rear'
      ? (edge === 'front' ? hallMinZ : hallMaxZ)
      : getSeriesPointCoordinate(index, count, hallMinZ + 1, hallMaxZ - 1);
    const blockId = index % 4 === 0
      ? materials.window
      : index % 7 === 0
        ? materials.door
        : materials.wall;
    const part = blockId === materials.window ? 'window' : blockId === materials.door ? 'door' : 'wall';
    const offset = edge === 'front' || edge === 'rear' ? 0 : 0;

    for (let y = 0; y < height; y += 1) {
      collector.add(x, floorY + 1 + y, z + offset, blockId, part);
    }

    if (Math.abs(x - centerX) <= 2 && edge === 'front' && index >= Math.floor(count / 2) - 1 && index <= Math.floor(count / 2) + 1) {
      collector.add(x, floorY + 1, z, materials.door, 'door');
      collector.add(x, floorY + 2, z, materials.door, 'door');
    }
  });
}

function addSeriesRoofBlocks(collector, { points, edge, roofBaseY, materials, hallMinX, hallMaxX, hallMinZ, hallMaxZ }) {
  const count = points.length;

  points.forEach((point, index) => {
    const x = edge === 'left' || edge === 'right'
      ? (edge === 'left' ? hallMinX - 2 : hallMaxX + 2)
      : getSeriesPointCoordinate(index, count, hallMinX - 2, hallMaxX + 2);
    const z = edge === 'front' || edge === 'rear'
      ? (edge === 'front' ? hallMinZ - 2 : hallMaxZ + 2)
      : getSeriesPointCoordinate(index, count, hallMinZ - 2, hallMaxZ + 2);
    const y = roofBaseY + (index % 2);

    collector.add(x, y, z, materials.tile, 'roof');

    if (index % 3 === 0) {
      collector.add(x, y + 1, z, materials.ridge, 'roof');
    }
  });
}

function addSeriesCourtyardBlocks(collector, { points, materials, maxX, maxZ, podiumHeight, centerX }) {
  const count = points.length;
  const edgeSpanX = Math.max(2, Math.floor(maxX / 2) - 1);
  const edgeSpanZ = Math.max(2, Math.floor(maxZ / 2) - 1);

  points.forEach((point, index) => {
    const edgeIndex = index % 4;
    const offset = Math.floor(index / 4);
    let x = centerX;
    let z = -podiumHeight - 4;

    if (edgeIndex === 0) {
      x = getSeriesPointCoordinate(offset, Math.max(1, Math.ceil(count / 4) - 1), centerX - edgeSpanX, centerX + edgeSpanX);
      z = -podiumHeight - 5;
    } else if (edgeIndex === 1) {
      x = maxX - 2;
      z = getSeriesPointCoordinate(offset, Math.max(1, Math.ceil(count / 4) - 1), -podiumHeight - 6, maxZ + 1);
    } else if (edgeIndex === 2) {
      x = getSeriesPointCoordinate(offset, Math.max(1, Math.ceil(count / 4) - 1), centerX + edgeSpanX, centerX - edgeSpanX);
      z = maxZ + 4;
    } else {
      x = 1;
      z = getSeriesPointCoordinate(offset, Math.max(1, Math.ceil(count / 4) - 1), maxZ + 2, -podiumHeight - 2);
    }

    if (point.group === 'courtyard_edge_lamps') {
      addPost(collector, x, z, 1, 3, materials.ridge, 'facility');
    } else {
      collector.add(x, 1, z, materials.balustrade, 'facility');
      collector.add(x, 2, z, BUILDING_BLOCK_IDS.BAMBOO, 'facility');
    }
  });
}

function addSeriesInteriorBlocks(collector, { points, materials, hallMinX, hallMaxX, hallMinZ, hallMaxZ, floorY, topY }) {
  const count = points.length;
  const columns = Math.max(2, Math.min(5, Math.ceil(count / 2)));
  const rows = Math.max(2, Math.min(4, Math.ceil(count / columns)));

  points.forEach((point, index) => {
    const xIndex = index % columns;
    const zIndex = Math.floor(index / columns) % rows;
    const x = getSeriesPointCoordinate(xIndex, columns, hallMinX + 1, hallMaxX - 1);
    const z = getSeriesPointCoordinate(zIndex, rows, hallMinZ + 1, hallMaxZ - 1);
    const height = Math.max(3, Math.round((topY - floorY) * 0.75));

    for (let y = 0; y < height; y += 1) {
      collector.add(x, floorY + y, z, materials.column, 'wall');
    }

    collector.add(x, topY, z, materials.dougong, 'facility');
  });
}

function addProceduralExtendedDetailBlocks(collector, context) {
  const {
    detailPointsByGroup,
    materials,
    hallMinX,
    hallMaxX,
    hallMinZ,
    hallMaxZ,
    floorY,
    firstRoofY,
    columnHeight,
    maxX,
    maxZ,
    centerX,
    podiumHeight,
  } = context;

  const seriesHandlers = [
    { group: 'front_facade_bays', kind: 'facade-edge', edge: 'front' },
    { group: 'rear_facade_bays', kind: 'facade-edge', edge: 'rear' },
    { group: 'left_facade_bays', kind: 'facade-edge', edge: 'left' },
    { group: 'right_facade_bays', kind: 'facade-edge', edge: 'right' },
    { group: 'lower_roof_front_segments', kind: 'roof-band', edge: 'front' },
    { group: 'lower_roof_back_segments', kind: 'roof-band', edge: 'rear' },
    { group: 'lower_roof_left_segments', kind: 'roof-band', edge: 'left' },
    { group: 'lower_roof_right_segments', kind: 'roof-band', edge: 'right' },
    { group: 'upper_roof_front_segments', kind: 'roof-band-upper', edge: 'front' },
    { group: 'upper_roof_back_segments', kind: 'roof-band-upper', edge: 'rear' },
    { group: 'upper_roof_left_segments', kind: 'roof-band-upper', edge: 'left' },
    { group: 'upper_roof_right_segments', kind: 'roof-band-upper', edge: 'right' },
    { group: 'courtyard_edge_lamps', kind: 'courtyard-edge' },
    { group: 'courtyard_edge_planters', kind: 'courtyard-edge' },
    { group: 'interior_support_modules', kind: 'interior-support' },
  ];

  for (const handler of seriesHandlers) {
    const points = detailPointsByGroup.get(handler.group) ?? [];

    if (!points.length) {
      continue;
    }

    if (handler.kind === 'facade-edge') {
      addSeriesFacadeBlocks(collector, {
        points,
        edge: handler.edge,
        materials,
        hallMinX,
        hallMaxX,
        hallMinZ,
        hallMaxZ,
        floorY,
        columnHeight,
        centerX,
      });
    } else if (handler.kind === 'roof-band' || handler.kind === 'roof-band-upper') {
      addSeriesRoofBlocks(collector, {
        points,
        edge: handler.edge,
        roofBaseY: handler.kind === 'roof-band-upper' ? firstRoofY + 4 : firstRoofY - 1,
        materials,
        hallMinX,
        hallMaxX,
        hallMinZ,
        hallMaxZ,
      });
    } else if (handler.kind === 'courtyard-edge') {
      addSeriesCourtyardBlocks(collector, {
        points,
        materials,
        maxX,
        maxZ,
        podiumHeight,
        centerX,
      });
    } else if (handler.kind === 'interior-support') {
      addSeriesInteriorBlocks(collector, {
        points,
        materials,
        hallMinX,
        hallMaxX,
        hallMinZ,
        hallMaxZ,
        floorY,
        topY: floorY + columnHeight,
      });
    }
  }
}

function buildProceduralPalaceHall(parameters, prompt) {
  const config = normalizeProceduralParameters(parameters, prompt);
  const { width, depth, podiumHeight, columnHeight } = config.dimensions;
  const { baysX, baysZ, hasDoubleEave, hasImperialWay } = config.layout;
  const m = config.materials;
  const detailMap = getDetailPointMap(config);
  const detailPointsByGroup = getDetailPointsByGroup(config.detailPoints);
  const collector = createBlockCollector();
  const maxX = width - 1;
  const maxZ = depth - 1;
  const centerX = Math.floor(width / 2);
  const frontZ = 0;
  const backZ = maxZ;
  const hallMinX = 3;
  const hallMaxX = maxX - 3;
  const hallMinZ = 4;
  const hallMaxZ = maxZ - 3;
  const floorY = podiumHeight;
  const topY = floorY + columnHeight;

  if (isDetailEnabled(detailMap, 'podium_upper_surface')) {
    addSparseSurface(collector, {
      minX: 0,
      maxX,
      y: podiumHeight - 1,
      minZ: 0,
      maxZ,
      blockId: m.podium,
      part: 'foundation',
    });
  }

  if (isDetailEnabled(detailMap, 'podium_lower_plinth')) {
    for (let y = 0; y < podiumHeight - 1; y += 1) {
      addPerimeter(collector, { minX: 0, maxX, y, minZ: 0, maxZ, blockId: m.podium, part: 'foundation' });
    }
  }

  if (hasImperialWay && (isDetailEnabled(detailMap, 'imperial_way_center_slab') || isDetailEnabled(detailMap, 'imperial_way_side_stairs'))) {
    const stairWidth = Math.min(9, Math.max(5, Math.floor(width / 4) | 1));
    const sideWidth = Math.max(3, Math.floor(stairWidth / 2));
    const stairCenters = [centerX - stairWidth, centerX, centerX + stairWidth];

    stairCenters.forEach((stairCenter, index) => {
      const currentWidth = index === 1 ? stairWidth : sideWidth;

      for (let step = 0; step < podiumHeight + 1; step += 1) {
        const y = Math.max(0, podiumHeight - 1 - step);
        const z = -1 - step;

        const enabled = index === 1
          ? isDetailEnabled(detailMap, 'imperial_way_center_slab')
          : isDetailEnabled(detailMap, 'imperial_way_side_stairs');

        if (enabled) {
          for (let x = stairCenter - Math.floor(currentWidth / 2); x <= stairCenter + Math.floor(currentWidth / 2); x += 1) {
            collector.add(x, y, z, index === 1 ? m.podium : m.stair, 'foundation');
          }
        }
      }
    });

    for (let z = -podiumHeight - 3; z <= -1; z += 1) {
      for (let x = centerX - 1; x <= centerX + 1; x += 1) {
        collector.add(x, 0, z, m.ridge, 'facility');
      }
    }
  }

  for (let x = 1; x < maxX; x += 3) {
    if (isDetailEnabled(detailMap, 'balustrade_front')) {
      collector.add(x, podiumHeight, frontZ, m.balustrade, 'foundation');
    }
    if (isDetailEnabled(detailMap, 'balustrade_back')) {
      collector.add(x, podiumHeight, backZ, m.balustrade, 'foundation');
    }
  }

  for (let z = 1; z < maxZ; z += 3) {
    if (isDetailEnabled(detailMap, 'balustrade_left')) {
      collector.add(0, podiumHeight, z, m.balustrade, 'foundation');
    }
    if (isDetailEnabled(detailMap, 'balustrade_right')) {
      collector.add(maxX, podiumHeight, z, m.balustrade, 'foundation');
    }
  }

  const columnXs = getGridPositions(hallMinX, hallMaxX, baysX);
  const columnZs = getGridPositions(hallMinZ, hallMaxZ, baysZ);

  if (isDetailEnabled(detailMap, 'outer_column_grid')) {
    columnXs.forEach((x) => {
      columnZs.forEach((z) => addColumn(collector, x, z, floorY, topY, m.column));
    });
  }

  for (let x = hallMinX + 1; x < hallMaxX; x += 1) {
    const isCentralDoor = Math.abs(x - centerX) <= 2 && isDetailEnabled(detailMap, 'front_central_doors');
    const material = isCentralDoor ? m.door : m.wall;
    const part = isCentralDoor ? 'door' : 'wall';

    if (part === 'door' || isDetailEnabled(detailMap, 'wall_spandrels') || isDetailEnabled(detailMap, 'front_lattice_panels')) {
      addLatticePanel(collector, {
        minX: x,
        maxX: x,
        minY: floorY + 1,
        maxY: floorY + Math.min(3, columnHeight - 1),
        z: hallMinZ,
        blockId: material,
        part,
      });
    }
  }

  if (isDetailEnabled(detailMap, 'rear_windows') || isDetailEnabled(detailMap, 'rear_lattice_panels')) {
    for (let x = hallMinX + 1; x < hallMaxX; x += 2) {
      collector.add(x, floorY + 2, hallMaxZ, m.window, 'window');
      collector.add(x, floorY + 3, hallMaxZ, m.window, 'window');
    }
  }

  if (isDetailEnabled(detailMap, 'side_windows') || isDetailEnabled(detailMap, 'side_lattice_panels')) {
    for (let z = hallMinZ + 2; z < hallMaxZ; z += 3) {
      collector.add(hallMinX, floorY + 2, z, m.window, 'window');
      collector.add(hallMaxX, floorY + 2, z, m.window, 'window');
      collector.add(hallMinX, floorY + 3, z, m.window, 'window');
      collector.add(hallMaxX, floorY + 3, z, m.window, 'window');
    }
  }

  columnXs.forEach((x) => {
    if (isDetailEnabled(detailMap, 'front_dougong')) {
      collector.add(x, topY + 1, hallMinZ, m.dougong, 'facility');
      collector.add(x, topY + 2, hallMinZ, m.dougong, 'facility');
    }
    if (isDetailEnabled(detailMap, 'rear_dougong')) {
      collector.add(x, topY + 1, hallMaxZ, m.dougong, 'facility');
      collector.add(x, topY + 2, hallMaxZ, m.dougong, 'facility');
    }
  });

  if (isDetailEnabled(detailMap, 'side_dougong')) {
    columnZs.forEach((z) => {
      collector.add(hallMinX, topY + 1, z, m.dougong, 'facility');
      collector.add(hallMaxX, topY + 1, z, m.dougong, 'facility');
    });
  }

  const firstRoofY = topY + 2;

  if (isDetailEnabled(detailMap, 'lower_hip_roof_tiles')) {
    addHipRoof(collector, {
      minX: hallMinX - 3,
      maxX: hallMaxX + 3,
      minZ: hallMinZ - 3,
      maxZ: hallMaxZ + 3,
      baseY: firstRoofY,
      layers: hasDoubleEave ? 4 : 6,
      tile: m.tile,
      ridge: m.ridge,
    });
  }

  if (hasDoubleEave && isDetailEnabled(detailMap, 'upper_hip_roof_tiles')) {
    const upperBaseY = firstRoofY + 4;

    addPerimeter(collector, {
      minX: hallMinX - 1,
      maxX: hallMaxX + 1,
      y: upperBaseY - 1,
      minZ: hallMinZ - 1,
      maxZ: hallMaxZ + 1,
      blockId: m.dougong,
      part: 'facility',
      step: 2,
    });
    addHipRoof(collector, {
      minX: hallMinX - 2,
      maxX: hallMaxX + 2,
      minZ: hallMinZ - 2,
      maxZ: hallMaxZ + 2,
      baseY: upperBaseY,
      layers: 5,
      tile: m.tile,
      ridge: m.ridge,
    });
  }

  addProceduralDetailBlocks(collector, {
    detailMap,
    materials: m,
    width,
    depth,
    podiumHeight,
    columnHeight,
    maxX,
    maxZ,
    centerX,
    hallMinX,
    hallMaxX,
    hallMinZ,
    hallMaxZ,
    floorY,
    topY,
    firstRoofY,
    hasDoubleEave,
    columnXs,
    columnZs,
  });
  addProceduralExtendedDetailBlocks(collector, {
    detailPointsByGroup,
    materials: m,
    hallMinX,
    hallMaxX,
    hallMinZ,
    hallMaxZ,
    floorY,
    firstRoofY,
    columnHeight,
    maxX,
    maxZ,
    centerX,
    podiumHeight,
  });

  const blocks = normalizeArchitecturalCoordinates(collector.values());

  return {
    meta: {
      type: config.buildingType,
      label: 'procedural imperial palace hall',
      prompt,
      proceduralParameters: config,
      proceduralBuilder: 'imperial-palace-hall-v1',
    },
    blocks,
  };
}

function getProceduralBuilderKind(config) {
  const text = [
    config?.buildingType,
    config?.apparentType,
    config?.visualFingerprint?.apparentType,
    config?.visualFingerprint?.silhouette?.roofShape,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/pagoda|tower/.test(text)) {
    return 'pagoda-tower-v1';
  }

  if (/courtyard|siheyuan/.test(text)) {
    return 'courtyard-house-v1';
  }

  if (/modern|apartment|office|block|villa|house/.test(text)) {
    return 'modern-block-building-v1';
  }

  if (/temple|pavilion/.test(text)) {
    return 'temple-pavilion-v1';
  }

  if (/palace|imperial|hall/.test(text)) {
    return 'imperial-palace-hall-v1';
  }

  return 'generic-image-mass-builder-v1';
}

function getGenericMaterials(config) {
  const m = config.materials;

  return {
    foundation: m.podium,
    wall: m.wall,
    trim: m.dougong,
    door: m.door,
    window: m.window,
    roof: m.tile,
    ridge: m.ridge,
    facility: m.ridge,
  };
}

function addGenericRoof(collector, { minX, maxX, minZ, maxZ, baseY, shape, materials, tower = false }) {
  const roofShape = String(shape || '').toLowerCase();

  if (/flat|modern/.test(roofShape)) {
    addRect(collector, {
      minX,
      maxX,
      minY: baseY,
      maxY: baseY,
      minZ,
      maxZ,
      blockId: materials.roof,
      part: 'roof',
    });
    addPerimeter(collector, { minX, maxX, y: baseY + 1, minZ, maxZ, blockId: materials.ridge, part: 'roof' });
    return;
  }

  if (/tier|pagoda/.test(roofShape) || tower) {
    const layers = Math.max(3, Math.min(7, Math.floor((maxX - minX + maxZ - minZ) / 8)));

    for (let layer = 0; layer < layers; layer += 1) {
      const inset = layer;
      addPerimeter(collector, {
        minX: minX + inset,
        maxX: maxX - inset,
        y: baseY + layer,
        minZ: minZ + inset,
        maxZ: maxZ - inset,
        blockId: layer === layers - 1 ? materials.ridge : materials.roof,
        part: 'roof',
      });
    }
    return;
  }

  if (/gable/.test(roofShape)) {
    const half = Math.floor((maxZ - minZ) / 2);

    for (let layer = 0; layer <= half; layer += 1) {
      const z0 = minZ + layer;
      const z1 = maxZ - layer;
      const y = baseY + layer;

      for (let x = minX - 1; x <= maxX + 1; x += 1) {
        collector.add(x, y, z0, materials.roof, 'roof');
        collector.add(x, y, z1, materials.roof, 'roof');
      }
    }
    return;
  }

  addHipRoof(collector, {
    minX: minX - 1,
    maxX: maxX + 1,
    minZ: minZ - 1,
    maxZ: maxZ + 1,
    baseY,
    layers: Math.max(4, Math.min(8, Math.floor(Math.min(maxX - minX, maxZ - minZ) / 2))),
    tile: materials.roof,
    ridge: materials.ridge,
  });
}

function addGenericFacade(collector, { minX, maxX, minZ, baseY, floors, baysX, heightPerFloor, materials, centeredDoor = true }) {
  const width = maxX - minX + 1;
  const bayCount = Math.max(2, Math.min(12, baysX || Math.floor(width / 4)));
  const centerX = Math.round((minX + maxX) / 2);

  if (centeredDoor) {
    collector.add(centerX, baseY + 1, minZ - 1, materials.door, 'door');
    collector.add(centerX, baseY + 2, minZ - 1, materials.door, 'door');
  }

  for (let floor = 0; floor < floors; floor += 1) {
    const y = baseY + 1 + floor * heightPerFloor + Math.min(2, heightPerFloor - 1);

    for (let bay = 0; bay < bayCount; bay += 1) {
      const x = Math.round(minX + 1 + ((width - 3) * bay) / Math.max(1, bayCount - 1));

      if (centeredDoor && floor === 0 && Math.abs(x - centerX) <= 1) {
        continue;
      }

      collector.add(x, y, minZ - 1, materials.window, 'window');

      if (heightPerFloor >= 4) {
        collector.add(x, y + 1, minZ - 1, materials.window, 'window');
      }
    }
  }
}

function addGenericSignatureFeatureBlocks(collector, { config, bounds, materials }) {
  const features = Array.isArray(config.signatureFeatures) ? config.signatureFeatures : [];
  const important = features
    .filter((feature) => feature.importance >= 0.72)
    .slice(0, 12);
  const centerX = Math.round((bounds.minX + bounds.maxX) / 2);
  const frontZ = bounds.minZ - 2;
  const roofY = bounds.maxY + 1;

  important.forEach((feature, index) => {
    const text = `${feature.id} ${feature.label} ${feature.description} ${feature.generatorHint} ${feature.anchor}`.toLowerCase();

    if (/door|entrance|gate/.test(text) || feature.part === 'door') {
      const x = /side|left/.test(text) ? bounds.minX + 2 : /right/.test(text) ? bounds.maxX - 2 : centerX;
      collector.add(x, bounds.minY + 1, frontZ, materials.door, 'door');
      collector.add(x, bounds.minY + 2, frontZ, materials.door, 'door');
      collector.add(x, bounds.minY + 3, frontZ, materials.trim, 'facility');
    } else if (/window|vertical|rhythm|repeated/.test(text) || feature.part === 'window') {
      const x = bounds.minX + 2 + ((index * 3) % Math.max(3, bounds.maxX - bounds.minX - 3));
      collector.add(x, Math.min(bounds.maxY - 1, bounds.minY + 3 + (index % 3) * 2), frontZ, materials.window, 'window');
    } else if (/roof|ridge|tier|curved|eave/.test(text) || feature.part === 'roof') {
      collector.add(centerX - 2 + (index % 5), roofY, Math.round((bounds.minZ + bounds.maxZ) / 2), materials.ridge, 'roof');
    } else {
      collector.add(bounds.minX + 1 + (index % Math.max(1, bounds.maxX - bounds.minX - 1)), bounds.minY + 1, frontZ, materials.facility, 'facility');
    }
  });
}

function buildGenericImageMassBuilding(parameters, prompt, builderKind) {
  const config = normalizeProceduralParameters(parameters, prompt);
  const materials = getGenericMaterials(config);
  const collector = createBlockCollector();
  const { width, depth, podiumHeight, columnHeight } = config.dimensions;
  const floors = builderKind === 'pagoda-tower-v1'
    ? Math.max(4, config.layout.floors)
    : Math.max(1, config.layout.floors);
  const heightPerFloor = builderKind === 'pagoda-tower-v1' ? 3 : Math.max(3, Math.floor(columnHeight / Math.max(1, floors)));
  const bodyHeight = builderKind === 'pagoda-tower-v1'
    ? floors * heightPerFloor
    : Math.max(columnHeight, floors * heightPerFloor);
  const centerX = Math.floor(width / 2);
  const centerZ = Math.floor(depth / 2);
  const tower = builderKind === 'pagoda-tower-v1';
  const bodyWidth = tower ? Math.max(7, makeOdd(Math.floor(width * 0.58), 9, 7, width)) : width - 4;
  const bodyDepth = tower ? Math.max(7, makeOdd(Math.floor(depth * 0.58), 9, 7, depth)) : depth - 4;
  const minX = centerX - Math.floor(bodyWidth / 2);
  const maxX = minX + bodyWidth - 1;
  const minZ = centerZ - Math.floor(bodyDepth / 2);
  const maxZ = minZ + bodyDepth - 1;

  addRect(collector, {
    minX: 0,
    maxX: width - 1,
    minY: 0,
    maxY: Math.max(0, podiumHeight - 1),
    minZ: 0,
    maxZ: depth - 1,
    blockId: materials.foundation,
    part: 'foundation',
    shell: podiumHeight > 1,
  });

  if (builderKind === 'courtyard-house-v1') {
    addPerimeter(collector, { minX: 1, maxX: width - 2, y: podiumHeight, minZ: 1, maxZ: depth - 2, blockId: materials.wall, part: 'wall' });
    addPerimeter(collector, { minX: 2, maxX: width - 3, y: podiumHeight + 1, minZ: 2, maxZ: depth - 3, blockId: materials.window, part: 'window', step: 4 });
  }

  for (let y = podiumHeight; y <= podiumHeight + bodyHeight; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const edge = x === minX || x === maxX || z === minZ || z === maxZ;

        if (!edge) {
          continue;
        }

        const isFloorBand = (y - podiumHeight) % heightPerFloor === 0;
        const blockId = isFloorBand ? materials.trim : materials.wall;

        collector.add(x, y, z, blockId, 'wall');
      }
    }
  }

  addGenericFacade(collector, {
    minX,
    maxX,
    minZ,
    baseY: podiumHeight,
    floors,
    baysX: config.layout.baysX,
    heightPerFloor,
    materials,
    centeredDoor: true,
  });

  if (config.layout.hasSideWings && !tower) {
    const wingHeight = Math.max(3, Math.floor(bodyHeight * 0.58));
    [
      { minX: 1, maxX: Math.max(2, minX - 1), minZ: minZ + 2, maxZ: maxZ },
      { minX: Math.min(width - 3, maxX + 1), maxX: width - 2, minZ: minZ + 2, maxZ: maxZ },
    ].forEach((wing) => {
      addRect(collector, {
        ...wing,
        minY: podiumHeight,
        maxY: podiumHeight + wingHeight,
        blockId: materials.wall,
        part: 'wall',
        shell: true,
      });
      addGenericRoof(collector, {
        ...wing,
        baseY: podiumHeight + wingHeight + 1,
        shape: config.layout.roofShape || 'gable',
        materials,
      });
    });
  }

  if (config.layout.hasTallCenter || tower) {
    addPost(collector, centerX, centerZ, podiumHeight + bodyHeight + 1, podiumHeight + bodyHeight + 4, materials.ridge, 'facility');
  }

  addGenericRoof(collector, {
    minX,
    maxX,
    minZ,
    maxZ,
    baseY: podiumHeight + bodyHeight + 1,
    shape: config.layout.roofShape || (tower ? 'tiered' : builderKind === 'modern-block-building-v1' ? 'flat' : 'hip'),
    materials,
    tower,
  });

  addGenericSignatureFeatureBlocks(collector, {
    config,
    bounds: {
      minX,
      maxX,
      minY: podiumHeight,
      maxY: podiumHeight + bodyHeight + 1,
      minZ,
      maxZ,
    },
    materials,
  });

  const blocks = normalizeArchitecturalCoordinates(collector.values());

  return {
    meta: {
      type: config.buildingType,
      label: builderKind,
      prompt,
      proceduralParameters: config,
      proceduralBuilder: builderKind,
    },
    blocks,
  };
}

function scoreProceduralFeatureMatches(blocks, config, builderKind) {
  const counts = inferPartCounts(blocks);
  const roofShape = String(config.layout?.roofShape ?? config.visualFingerprint?.silhouette?.roofShape ?? '').toLowerCase();
  const features = Array.isArray(config.signatureFeatures) ? config.signatureFeatures : [];
  const matchedFeatures = [];
  const addMatch = (source, status, part, weight = 0.7) => {
    matchedFeatures.push({
      source,
      status,
      part,
      weight,
    });
  };

  addMatch('main entrance', counts.door > 0 ? 'matched' : 'missing', 'door', 0.9);
  addMatch('facade window rhythm', counts.window >= Math.max(4, config.layout?.baysX ?? 3) ? 'matched' : 'partial', 'window', 0.85);
  addMatch(roofShape || 'roof profile', counts.roof > 0 ? 'matched' : 'missing', 'roof', 0.9);

  if (config.referenceMaterials?.length || config.materialPalette?.length || config.dominantColors?.length) {
    addMatch('reference image material palette', 'matched', 'materials', 0.8);
  }

  features.slice(0, 12).forEach((feature) => {
    const part = feature.part || 'facility';
    const count = counts[part] ?? (part === 'materials' ? 1 : 0);

    addMatch(
      feature.label || feature.id,
      count > 0 ? 'matched' : feature.importance >= 0.8 ? 'missing' : 'partial',
      part,
      feature.importance,
    );
  });

  if (builderKind !== 'imperial-palace-hall-v1') {
    addMatch(`builder route ${builderKind}`, 'matched', 'silhouette', 0.95);
  }

  const totalWeight = matchedFeatures.reduce((sum, item) => sum + item.weight, 0) || 1;
  const matchedWeight = matchedFeatures.reduce((sum, item) => (
    sum + item.weight * (item.status === 'matched' ? 1 : item.status === 'partial' ? 0.5 : 0)
  ), 0);

  return {
    matchedFeatures,
    imageSimilarityScore: Math.max(0, Math.min(1, Number((matchedWeight / totalWeight).toFixed(2)))),
  };
}

function buildProceduralBuilding(parameters, prompt) {
  const config = normalizeProceduralParameters(parameters, prompt);
  const builderKind = getProceduralBuilderKind(config);
  const plan = builderKind === 'imperial-palace-hall-v1'
    ? buildProceduralPalaceHall(config, prompt)
    : buildGenericImageMassBuilding(config, prompt, builderKind);
  const featureMatch = scoreProceduralFeatureMatches(plan.blocks, config, builderKind);

  return {
    ...plan,
    meta: {
      ...plan.meta,
      proceduralParameters: config,
      proceduralBuilder: builderKind,
      matchedFeatures: featureMatch.matchedFeatures,
      imageSimilarityScore: featureMatch.imageSimilarityScore,
    },
  };
}

function buildFallbackBuilding(prompt, { referenceMaterials = [] } = {}) {
  const profile = applyReferenceMaterialsToProfile(
    applyMaterialDirectivesToProfile(getBuildingProfile(prompt), prompt),
    referenceMaterials,
  );
  const plan = profile.id === 'pyramid'
    ? buildPyramid(profile, prompt)
    : buildHouse(profile, prompt);

  return {
    ...plan,
    meta: {
      ...plan.meta,
      referenceMaterials,
    },
    blocks: applyMaterialDirectivesToBlocks(plan.blocks, prompt),
  };
}

function extractAssistantContent(responseJson) {
  const candidates = [];

  if (typeof responseJson?.output_text === 'string') {
    candidates.push(responseJson.output_text);
  }

  if (Array.isArray(responseJson?.output)) {
    for (const item of responseJson.output) {
      if (typeof item?.content === 'string') {
        candidates.push(item.content);
      }

      if (Array.isArray(item?.content)) {
        for (const contentItem of item.content) {
          if (typeof contentItem?.text === 'string') {
            candidates.push(contentItem.text);
          }
        }
      }
    }
  }

  const messageContent = responseJson?.choices?.[0]?.message?.content;

  if (typeof messageContent === 'string') {
    candidates.push(messageContent);
  }

  if (Array.isArray(messageContent)) {
    messageContent.forEach((contentItem) => {
      if (typeof contentItem === 'string') {
        candidates.push(contentItem);
      } else if (typeof contentItem?.text === 'string') {
        candidates.push(contentItem.text);
      }
    });
  }

  return candidates.find((value) => value && value.trim()) ?? '';
}

function getAiResponseFinishReason(responseJson) {
  const reasons = [
    responseJson?.choices?.[0]?.finish_reason,
    responseJson?.finish_reason,
    responseJson?.status === 'incomplete' ? responseJson.status : '',
    responseJson?.incomplete_details?.reason,
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);

  return reasons.join(' · ');
}

function isAiResponseTruncated(responseJson) {
  const reason = getAiResponseFinishReason(responseJson);

  return /length|incomplete|max[\w-]*tokens?/i.test(reason);
}

function parseAssistantJson(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const trimmed = content.trim();
  const stripTrailingCommas = (value) => value.replace(/,\s*([}\]])/g, '$1');
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
  ];

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);

  if (objectMatch) {
    candidates.push(objectMatch[0]);
  }

  if (arrayMatch) {
    candidates.push(arrayMatch[0]);
  }

  for (const candidate of candidates.flatMap((value) => [value, stripTrailingCommas(value)])) {
    const parsed = readJsonMaybe(candidate);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function parseBuildingAssistantPayload(content) {
  const parsed = parseAssistantJson(content);

  if (Array.isArray(parsed) || Array.isArray(parsed?.blocks)) {
    return parsed;
  }

  const blocks = [];
  const text = String(content ?? '');
  const objectPattern = /\{[^{}]*"blockId"\s*:\s*-?\d+[^{}]*"part"\s*:\s*"[^"]+"[^{}]*\}/g;

  for (const match of text.matchAll(objectPattern)) {
    const block = readJsonMaybe(match[0]);

    if (block) {
      blocks.push(block);
    }
  }

  if (blocks.length > 0) {
    return {
      blocks,
      meta: {
        partialContentRecovered: true,
      },
    };
  }

  return parsed;
}

function clampAiText(value, maxLength = 900) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function clampAiDescriptionValue(value, maxLength = 900) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return clampAiText(value, maxLength);
  }

  try {
    return clampAiText(JSON.stringify(value), maxLength);
  } catch {
    return clampAiText(value, maxLength);
  }
}

function normalizeGenerationTraceEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const chunk = Number(event.chunk);
  const chunkCount = Number(event.chunkCount);
  const attempt = Number(event.attempt);
  const progress = Number(event.progress);

  return {
    type: clampAiText(event.type, 48),
    stage: clampAiText(event.stage, 48),
    chunk: Number.isFinite(chunk) ? Math.max(1, Math.trunc(chunk)) : null,
    chunkCount: Number.isFinite(chunkCount) ? Math.max(1, Math.trunc(chunkCount)) : null,
    key: clampAiText(event.key ?? event.chunkKey, 80),
    title: clampAiText(event.title, 160),
    attempt: Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : null,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : null,
    message: clampAiText(event.message, 4000),
    summary: clampAiText(event.summary, 6000),
    systemPrompt: clampAiText(event.systemPrompt, 12000),
    userPrompt: clampAiText(event.userPrompt, 12000),
    resultPrompt: clampAiText(event.resultPrompt, 12000),
    contentPreview: clampAiText(event.contentPreview, 6000),
    blockCount: Number.isFinite(Number(event.blockCount))
      ? Math.max(0, Math.trunc(Number(event.blockCount)))
      : null,
    at: event.at ?? new Date().toISOString(),
  };
}

function normalizePromptTrace(source, fallbackPrompt = '') {
  const trace = source && typeof source === 'object' ? source : {};
  const referenceAnalysis = trace.referenceAnalysis && typeof trace.referenceAnalysis === 'object'
    ? {
      system: clampAiText(trace.referenceAnalysis.system, 12000),
      user: clampAiText(trace.referenceAnalysis.user, 6000),
      result: clampAiText(
        trace.referenceAnalysis.result
          ?? trace.referenceAnalysis.analysisResult
          ?? trace.referenceDescription,
        12000,
      ),
    }
    : null;
  const building = trace.building && typeof trace.building === 'object'
    ? {
      system: clampAiText(trace.building.system, 18000),
      user: clampAiText(trace.building.user, 14000),
      chunks: Array.isArray(trace.building.chunks)
        ? trace.building.chunks
          .slice(0, AI_BUILD_CHUNKS.length)
          .map((chunk, index) => ({
            index: Number.isFinite(Number(chunk?.index)) ? Math.max(1, Math.trunc(Number(chunk.index))) : index + 1,
            key: clampAiText(chunk?.key, 80),
            title: clampAiText(chunk?.title, 160),
            system: clampAiText(chunk?.system, 18000),
            user: clampAiText(chunk?.user, 14000),
          }))
          .filter((chunk) => chunk.system || chunk.user)
        : [],
    }
    : null;
  const generationTrace = Array.isArray(trace.generationTrace)
    ? trace.generationTrace
      .slice(0, 240)
      .map(normalizeGenerationTraceEvent)
      .filter(Boolean)
    : [];

  return {
    input: clampAiText(trace.input ?? fallbackPrompt, 2000),
    referenceAnalysis: referenceAnalysis && (
      referenceAnalysis.system
      || referenceAnalysis.user
      || referenceAnalysis.result
    )
      ? referenceAnalysis
      : null,
    building: building && (building.system || building.user || building.chunks.length)
      ? building
      : null,
    integrated: clampAiText(trace.integrated, 100000),
    generationTrace: generationTrace.length > 0 ? generationTrace : null,
  };
}

function describeAiFailure(error) {
  const message = String(error?.message ?? error ?? '未知错误').trim();

  if (/AI_API_KEY 未配置/i.test(message)) {
    return 'AI_API_KEY 未配置，无法访问参考图分析模型。';
  }

  if (/AI_BUILD_API_KEY 未配置/i.test(message)) {
    return 'AI_BUILD_API_KEY 未配置，无法访问建筑数组生成模型。';
  }

  if (/model_not_found|not supported by any configured account/i.test(message)) {
    return `模型不可用，请检查 AI_MODEL 或 AI_REFERENCE_MODEL 配置。原始原因：${message}`;
  }

  if (/401|403|unauthorized|forbidden|invalid.*key/i.test(message)) {
    return `大模型鉴权失败，请检查 AI_API_KEY。原始原因：${message}`;
  }

  if (/超时|timeout|timed out/i.test(message)) {
    return `访问大模型超时，请检查网络或增加 AI_TIMEOUT_MS。原始原因：${message}`;
  }

  if (/AI 接口请求失败：(?:502|503|504|524)\b/i.test(message)) {
    return `大模型上游服务暂时不可用，建筑生成请求将重试；如果持续失败，请稍后再试或检查模型服务状态。原始原因：${message}`;
  }

  if (/fetch failed|connect timeout|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    return `无法连接大模型服务，请检查 AI_API_BASE_URL 和网络。原始原因：${message}`;
  }

  return `大模型请求失败：${message}`;
}

function isRetryableAiError(error) {
  const message = String(error?.message ?? error ?? '');

  return /AI 接口请求失败：(?:502|503|504|524)\b|AI (?:单片请求|请求)超时|AI 建筑分片输出被截断|AI 建筑蓝图输出被截断|fetch failed|UND_ERR|ECONNRESET|ETIMEDOUT|AbortError/i.test(message);
}

function waitMs(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function normalizeReferenceDescription(parsed, rawContent) {
  const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : {};
  const fallbackText = clampAiText(rawContent, 6000);
  const referenceDescription = clampAiText(
    source.referenceDescription
      ?? source.description
      ?? source.summary
      ?? fallbackText,
    6000,
  );

  return {
    referenceDescription,
    style: clampAiDescriptionValue(source.style, 1200),
    buildingShape: clampAiDescriptionValue(source.buildingShape ?? source.shape ?? source.overallShape, 1600),
    proportions: clampAiDescriptionValue(source.proportions ?? source.dimensions, 1200),
    roof: clampAiDescriptionValue(source.roof ?? source.roofShape, 1600),
    eaves: clampAiDescriptionValue(source.eaves ?? source.eaveShape, 1400),
    walls: clampAiDescriptionValue(source.walls ?? source.wallShape, 1400),
    doors: clampAiDescriptionValue(source.doors ?? source.doorLayout ?? source.doorCount, 1200),
    windows: clampAiDescriptionValue(source.windows ?? source.windowLayout ?? source.windowCount, 1200),
    materials: clampAiDescriptionValue(source.materials, 1400),
    colors: clampAiDescriptionValue(source.colors ?? source.colorPalette, 1200),
    layout: clampAiDescriptionValue(source.layout ?? source.floorPlan, 1600),
    facilities: clampAiDescriptionValue(source.facilities ?? source.details, 1400),
    symmetry: clampAiDescriptionValue(source.symmetry, 700),
    visualFingerprint: normalizeVisualFingerprint({
      ...(source.visualFingerprint && typeof source.visualFingerprint === 'object' ? source.visualFingerprint : {}),
      apparentType: source.visualFingerprint?.apparentType ?? source.apparentType ?? source.buildingType,
      view: source.visualFingerprint?.view ?? source.view,
      roofShape: source.visualFingerprint?.roofShape ?? source.roof?.shape ?? source.roofShape,
      symmetry: source.visualFingerprint?.symmetry ?? source.symmetry,
      materials: source.visualFingerprint?.materials ?? source.materialPalette ?? source.materials,
      dominantColors: source.visualFingerprint?.dominantColors ?? source.dominantColors ?? source.colors,
    }),
    materialPalette: normalizeMaterialPalette(source.materialPalette ?? source.materials ?? source.dominantColors, 10),
    dominantColors: normalizeMaterialPalette(source.dominantColors ?? source.colors, 8),
    signatureFeatures: normalizeFeatureList(source.signatureFeatures, 12),
    imageRegions: normalizeRegionList(source.imageRegions, 12),
    confidence: typeof source.confidence === 'number'
      ? Math.max(0, Math.min(1, source.confidence))
      : null,
  };
}

function buildLocalBuildingBlueprint(prompt, referenceDescription = null) {
  const hasReference = Boolean(referenceDescription);
  const isLargePalace = /宫殿|皇家|故宫|太和殿|庑殿|重檐|palace|imperial/i.test([
    prompt,
    referenceDescription?.referenceDescription,
    referenceDescription?.style,
    referenceDescription?.roof,
    referenceDescription?.layout,
  ].filter(Boolean).join(' '));
  const dimensions = isLargePalace
    ? { width: 45, depth: 35, height: 24 }
    : { width: 28, depth: 22, height: 16 };
  const mainHall = isLargePalace
    ? { x: 8, y: 5, z: 8, width: 29, depth: 16, height: 8 }
    : { x: 5, y: 3, z: 5, width: 18, depth: 12, height: 6 };

  return {
    source: 'local-fallback',
    reason: hasReference ? 'AI 蓝图解析失败后使用参考图描述兜底' : 'AI 蓝图解析失败后使用用户指令兜底',
    dimensions,
    coordinateSystem: {
      origin: { x: 0, y: 0, z: 0 },
      xAxis: 'left-right',
      zAxis: 'front-back',
      yAxis: 'up',
      mainEntranceDirection: 'front-z0',
    },
    materials: {
      foundation: 34,
      wall: 36,
      column: 36,
      trim: 40,
      door: 0,
      window: 38,
      roof: 26,
      floor: 20,
      facility: 30,
      path: 20,
    },
    parts: {
      base: { x: 0, y: 0, z: 0, width: dimensions.width, depth: dimensions.depth, height: isLargePalace ? 4 : 2 },
      mainHall,
      leftWing: isLargePalace ? { x: 0, y: 4, z: 11, width: 9, depth: 12, height: 5 } : null,
      rightWing: isLargePalace ? { x: 36, y: 4, z: 11, width: 9, depth: 12, height: 5 } : null,
      roof: {
        type: isLargePalace ? 'double-eave-wudian' : 'pitched',
        lowerY: mainHall.y + mainHall.height,
        upperY: mainHall.y + mainHall.height + (isLargePalace ? 5 : 3),
        overhang: isLargePalace ? 3 : 2,
      },
      courtyard: { x: 4, y: 1, z: 0, width: dimensions.width - 8, depth: isLargePalace ? 9 : 5 },
      stairs: { centerX: Math.floor(dimensions.width / 2), fromZ: 0, toZ: mainHall.z, width: isLargePalace ? 9 : 5 },
    },
    segmentPlan: AI_BUILD_CHUNKS.map((chunk, index) => ({
      index: index + 1,
      key: chunk.key,
      title: chunk.title,
      instruction: chunk.instruction,
    })),
    qualityChecklist: [
      '所有分片使用同一个 0 起点局部坐标系',
      '合并后必须包含 foundation, wall, door, window, roof, facility',
      '中国宫殿参考图优先表现高台基、红柱、深出檐、重檐屋顶、中轴台阶和左右对称',
    ],
  };
}

async function requestAiChatCompletion({
  messages,
  requestId,
  signal,
  model = AI_MODEL,
  temperature = null,
  maxTokens = null,
  timeoutMs = 0,
  apiBaseUrl = AI_API_BASE_URL,
  apiKey = AI_API_KEY,
  enableThinking = null,
  responseFormat = null,
}) {
  const requestTimeout = timeoutMs > 0
    ? createChildTimeoutSignal(signal, timeoutMs)
    : null;
  const startedAt = Date.now();
  const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  log('trace', 'AI 请求发送', {
    requestId,
    endpoint,
    model,
    temperature,
    maxTokens,
    timeoutMs,
    enableThinking,
    responseFormat,
    messages,
  });

  try {
    const requestBody = {
      model,
      messages,
    };

    if (temperature !== null && temperature !== undefined) {
      requestBody.temperature = temperature;
    }

    if (maxTokens !== null && maxTokens !== undefined) {
      requestBody.max_tokens = maxTokens;
    }

    if (enableThinking !== null && enableThinking !== undefined) {
      requestBody.enable_thinking = enableThinking;
    }

    if (responseFormat) {
      requestBody.response_format = { type: responseFormat };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: requestTimeout?.signal ?? signal,
    });
    const responseText = await response.text();
    const durationMs = Date.now() - startedAt;

    log(response.ok ? 'trace' : 'warning', 'AI 响应收到', {
      requestId,
      model,
      status: response.status,
      statusText: response.statusText,
      durationMs,
      responseBytes: Buffer.byteLength(responseText, 'utf8'),
      responsePreview: responseText.slice(0, 2000),
    });

    if (!response.ok) {
      throw new Error(`AI 接口请求失败：${response.status} ${response.statusText} ${responseText.slice(0, 240)}`);
    }

    const responseJson = readJsonMaybe(responseText);

    if (!responseJson) {
      throw new Error('AI 返回的响应不是有效 JSON。');
    }

    log('debug', 'AI 响应 JSON 解析完成', {
      requestId,
      model,
      durationMs,
      responseKeys: Object.keys(responseJson),
      usage: responseJson.usage ?? null,
      contentLength: extractAssistantContent(responseJson).length,
    });

    return {
      responseJson,
      content: extractAssistantContent(responseJson),
    };
  } catch (error) {
    log('error', 'AI 请求异常', {
      requestId,
      model,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  } finally {
    requestTimeout?.clear();
  }
}

async function requestReferenceDescription(prompt, referenceImage, requestId, signal) {
  const startedAt = Date.now();
  const systemPrompt = [
    '你是建筑参考图分析师，负责把图片中的建筑准确翻译成可执行的 Minecraft 方块建筑规格。',
    '必须仔细观察整体风格、建筑体量、平面形状、立面比例、屋顶和屋檐、围墙、门和窗的数量及位置。',
    '还要描述材料、颜色、层数、入口方向、对称关系、院落、台阶、柱子、阳台、灯具和其他明显细节。',
    '不要生成方块数组，不要使用模板猜测，不确定的内容要明确标记为“无法确认”。',
    '只输出 JSON 对象，不要输出 Markdown 或代码块。',
    'JSON 至少包含 referenceDescription, style, buildingShape, proportions, roof, eaves, walls, doors, windows, materials, colors, layout, facilities, symmetry, visualFingerprint, materialPalette, dominantColors, signatureFeatures, imageRegions, confidence。',
    'visualFingerprint must be machine usable JSON: {apparentType, view, proportions:{widthToHeight, roofToBodyRatio, symmetry}, silhouette:{roofShape, hasTallCenter, hasSideWings, towerCount}, facade:{floors, baysX, windowRhythm, mainEntrance}, materials:[{slot,name,color,areaRatio,custom}]}',
    'materialPalette and dominantColors should provide numeric RGB decimal colors when visible, mapped to wall/tile/door/window/trim/podium/dougong.',
    'signatureFeatures should list the 8-12 most important visible features with {id,label,part,importance,description,generatorHint,anchor}.',
    'imageRegions ??????????{id, role, label, x, y, width, height, confidence}????? 0-1 ???',
  ].join('\n');
  const userPrompt = [
    `用户建筑指令：${prompt}`,
    '请先分析下面的参考图，再输出详细建筑规格：',
  ].join('\n');
  const userContent = [
    { type: 'text', text: userPrompt },
    {
      type: 'image_url',
      image_url: {
        url: referenceImage.dataUrl,
        detail: 'high',
      },
    },
  ];
  log('trace', 'AI 参考图分析开始', {
    requestId,
    stage: 'reference-analysis',
    model: AI_REFERENCE_MODEL,
    prompt,
    systemPrompt,
    userPrompt,
    referenceImage: summarizeReferenceImage(referenceImage),
  });
  const result = await requestAiChatCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    requestId: `${requestId}-reference-analysis`,
    signal,
    model: AI_REFERENCE_MODEL,
    temperature: 0.1,
    maxTokens: 1800,
    apiBaseUrl: AI_API_BASE_URL,
    apiKey: AI_API_KEY,
  });
  const parsed = parseAssistantJson(result.content);

  if (!parsed && !result.content) {
    throw new Error('参考图分析模型没有返回有效描述。');
  }

  const description = normalizeReferenceDescription(parsed, result.content);

  log('trace', 'AI 参考图分析完成', {
    requestId,
    stage: 'reference-analysis',
    model: AI_REFERENCE_MODEL,
    durationMs: Date.now() - startedAt,
    parsed: Boolean(parsed),
    description,
  });

  return {
    description,
    prompt: {
      system: systemPrompt,
      user: userPrompt,
      result: JSON.stringify(description, null, 2),
    },
  };
}

async function requestStructuredBuildingParameters(prompt, referenceDescription, requestId, signal, { progress = null } = {}) {
  const startedAt = Date.now();
  const emitProgress = typeof progress === 'function' ? progress : null;
  const systemPrompt = [
    'You are a procedural architecture parameter planner.',
    'Return only one compact JSON object. Do not return Markdown or block arrays.',
    'The JSON must contain buildingType, apparentType, dimensions, layout, materials, materialPalette, detailPoints, visualFingerprint, signatureFeatures, imageRegions.',
    'buildingType/apparentType must describe the actual image type, not always imperial_palace_hall. Use one of palace_hall, pagoda_tower, courtyard_house, modern_block_building, temple_pavilion, generic_building when possible.',
    'dimensions: width/depth should be odd integers; podiumHeight and columnHeight should be integers.',
    'layout: baysX, baysZ, hasDoubleEave, hasImperialWay.',
    'materials may use numeric fixed blockId values or custom material objects.',
    'Custom material object example: {"name":"gold glazed roof tile","label":"glazed tile","usage":"roof tile","custom":true,"color":16764058,"opacity":1,"opaque":true}.',
    'Do not invent global custom blockId values for new materials; use material objects and the server will allocate/reuse blockId 1000-60000.',
    'Allowed fixed material IDs: 20 stone slab, 23 glass, 25 wood planks, 28 sandstone/golden tile, 29 quartz, 34 marble, 35 dark stone, 36 terracotta/red wall, 41 white wall/painted dougong.',
    'Optional referenceMaterials may also be included when a visual material from the prompt/image should become a custom global block.',
    'detailPoints must contain exactly 200 objects using the allowed ids. Each object: {id, enabled, intensity, description, materialSlot}.',
    `Allowed detailPoint ids: ${PROCEDURAL_DETAIL_POINT_DEFINITIONS.map((point) => point.id).join(', ')}.`,
    'visualFingerprint must be machine usable: {apparentType, view, proportions:{widthToHeight, roofToBodyRatio, symmetry}, silhouette:{roofShape, hasTallCenter, hasSideWings, towerCount}, facade:{floors, baysX, windowRhythm, mainEntrance}, materials:[{slot,name,color,areaRatio,custom}]}',
    'materialPalette should contain 4-8 image color materials using numeric 0xRRGGBB decimal colors mapped to wall/tile/door/window/trim/podium/dougong where possible.',
    'signatureFeatures must list 8-12 most visible image features with {id,label,part,importance,description,generatorHint,anchor}. High importance features must be geometrically buildable.',
    'imageRegions should list 3-8 normalized crop hints using {id, role, label, x, y, width, height, confidence}.',
  ].join('\n');
  const userPrompt = [
    `User request: ${prompt}`,
    referenceDescription ? `Reference image analysis: ${JSON.stringify(referenceDescription)}` : '',
    'Generate parameters for the actual image building type. Prefer this schema:',
    '{"buildingType":"pagoda_tower","apparentType":"pagoda_tower","dimensions":{"width":19,"depth":19,"podiumHeight":2,"columnHeight":12},"layout":{"baysX":3,"baysZ":2,"floors":5,"roofShape":"tiered","hasDoubleEave":true,"hasImperialWay":false,"hasTallCenter":true,"hasSideWings":false,"mainEntrance":"center","windowRhythm":"regular"},"materials":{"podium":34,"stair":20,"balustrade":29,"column":36,"wall":{"name":"warm white wall","label":"warm wall","slot":"wall","custom":true,"color":15198183},"door":{"name":"center red door","label":"red door","slot":"door","custom":true,"color":8912912},"window":{"name":"dark window glass","label":"dark window","slot":"window","custom":true,"color":3158064,"opacity":0.58,"opaque":false},"dougong":41,"tile":{"name":"dark gray roof tile","label":"gray roof","slot":"tile","custom":true,"color":3158064},"ridge":35},"materialPalette":[{"slot":"wall","name":"warm white wall","color":15198183,"areaRatio":0.45,"custom":true},{"slot":"tile","name":"dark gray roof","color":3158064,"areaRatio":0.25,"custom":true}],"visualFingerprint":{"apparentType":"pagoda_tower","view":"front","proportions":{"widthToHeight":0.7,"roofToBodyRatio":0.42,"symmetry":"strong"},"silhouette":{"roofShape":"tiered","hasTallCenter":true,"hasSideWings":false,"towerCount":1},"facade":{"floors":5,"baysX":3,"windowRhythm":"regular","mainEntrance":"center"},"materials":[{"slot":"wall","name":"warm white wall","color":15198183,"areaRatio":0.45,"custom":true}]},"signatureFeatures":[{"id":"tiered_dark_roof","label":"tiered dark roof","part":"roof","importance":1,"description":"stacked roof eaves","generatorHint":"tiered roof bands","anchor":"roof"},{"id":"center_red_door","label":"center red entrance","part":"door","importance":0.9,"description":"red central entrance","generatorHint":"center two block high door","anchor":"front_center"}],"imageRegions":[{"id":"roof_region","role":"roof","label":"roof texture","x":0.18,"y":0.02,"width":0.64,"height":0.26,"confidence":0.7}],"detailPoints":[{"id":"podium_upper_surface","enabled":true,"intensity":1,"description":"stone top platform","materialSlot":"podium"}]}',
    'Return all 200 detailPoints. Use enabled=false only when the user/image explicitly excludes that detail. Keep visualFingerprint and imageRegions concise but concrete.',
    'When the prompt or image asks for a new visual material, put that material object directly in materials.podium/stair/balustrade/column/wall/door/window/dougong/tile/ridge. The server will replace it with the shared global blockId before Procedural Builder runs.',
    'Keep width 15-47, depth 11-35, podiumHeight 1-5, columnHeight 3-8, baysX 3/5/7, baysZ 1-5.',
    `Procedural Builder can return up to ${AI_BUILD_LIMIT} blocks.`,
  ].filter(Boolean).join('\n\n');

  emitProgress?.({
    type: 'chunk-start',
    stage: 'parameter-generation',
    chunk: 1,
    chunkCount: 1,
    chunkKey: 'structured-parameters',
    title: 'Structured procedural building parameters',
    attempt: 1,
    message: 'Generating structured building parameters',
    systemPrompt,
    userPrompt,
  });

  try {
    const result = await requestAiChatCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      requestId: `${requestId}-structured-parameters`,
      signal,
      model: AI_BUILD_MODEL,
      temperature: referenceDescription ? 0.16 : 0.22,
      maxTokens: Math.min(AI_BUILD_BLUEPRINT_MAX_TOKENS, 5200),
      timeoutMs: Math.min(Math.max(AI_BUILD_CHUNK_TIMEOUT_MS, 45000), 90000),
      apiBaseUrl: AI_BUILD_API_BASE_URL,
      apiKey: AI_BUILD_API_KEY,
      enableThinking: AI_BUILD_ENABLE_THINKING,
      responseFormat: AI_BUILD_RESPONSE_FORMAT,
    });

    if (isAiResponseTruncated(result.responseJson)) {
      throw new Error(`AI structured parameters truncated (${getAiResponseFinishReason(result.responseJson) || 'unknown'}).`);
    }

    const parsed = parseAssistantJson(result.content);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('AI structured parameters are not a valid JSON object.');
    }

    const normalized = normalizeProceduralParameters(parsed, prompt);

    emitProgress?.({
      type: 'chunk-complete',
      stage: 'parameter-generation',
      chunk: 1,
      chunkCount: 1,
      chunkKey: 'structured-parameters',
      title: 'Structured procedural building parameters',
      attempt: 1,
      blockCount: 0,
      message: 'Structured building parameters generated',
      contentPreview: result.content.slice(0, 2000),
      summary: JSON.stringify(normalized).slice(0, 2000),
    });

    return {
      raw: result.responseJson,
      parsed: normalized,
      content: result.content,
      fallback: false,
      prompts: {
        system: systemPrompt,
        user: userPrompt,
        result: JSON.stringify(normalized, null, 2),
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    log('warning', 'AI structured parameter generation failed, using procedural defaults.', {
      requestId,
      stage: 'parameter-generation',
      durationMs: Date.now() - startedAt,
      error,
    });

    const fallback = normalizeProceduralParameters({}, prompt);

    emitProgress?.({
      type: 'chunk-complete',
      stage: 'parameter-generation',
      chunk: 1,
      chunkCount: 1,
      chunkKey: 'structured-parameters',
      title: 'Structured procedural building parameters',
      attempt: 1,
      blockCount: 0,
      message: 'Using local procedural parameter defaults',
      summary: JSON.stringify(fallback),
    });

    return {
      raw: null,
      parsed: fallback,
      content: JSON.stringify(fallback),
      fallback: true,
      prompts: {
        system: systemPrompt,
        user: userPrompt,
        result: JSON.stringify(fallback, null, 2),
      },
      durationMs: Date.now() - startedAt,
    };
  }
}

async function requestBuildingPlan(prompt, requestId = 'local', referenceImage = null, {
  progress = null,
  referenceMaterials = [],
  customBlocks = [],
} = {}) {
  if (!AI_BUILD_API_KEY) {
    throw new Error('AI_BUILD_API_KEY 未配置。');
  }

  const startedAt = Date.now();
  const generationTrace = [];
  const emitProgress = typeof progress === 'function' ? progress : null;
  const pushTrace = (event) => {
    const normalized = normalizeGenerationTraceEvent(event);

    if (normalized) {
      generationTrace.push(normalized);
      if (generationTrace.length > 240) {
        generationTrace.splice(0, generationTrace.length - 240);
      }
    }

    if (emitProgress) {
      emitProgress({
        ...event,
        at: event?.at ?? new Date().toISOString(),
      });
    }
  };
  const timeout = createTimeoutSignal(AI_BUILD_TOTAL_TIMEOUT_MS);
  const directives = extractMaterialDirectives(prompt);
  const directiveInstruction = formatMaterialDirectives(directives);
  const requestedFloors = extractRequestedFloors(prompt);
  const incomingReferenceMaterials = Array.isArray(referenceMaterials) ? referenceMaterials : [];
  const incomingCustomBlocks = Array.isArray(customBlocks) ? customBlocks : [];
  const fallbackReferenceMaterialSet = await normalizeReferenceMaterialsWithCustom(incomingReferenceMaterials, referenceImage, prompt);
  const fallbackReferenceMaterials = fallbackReferenceMaterialSet.referenceMaterials;
  const fallbackCustomBlocks = normalizeStoredCustomBlocks([
    ...incomingCustomBlocks,
    ...fallbackReferenceMaterialSet.customBlocks,
  ]);
  let aiStage = referenceImage ? 'reference-analysis' : 'building-generation';
  let referenceDescription = null;
  let promptTrace = null;

  log('info', 'AI 建筑生成开始', {
    requestId,
    prompt,
    model: AI_BUILD_MODEL,
    apiBaseUrl: AI_BUILD_API_BASE_URL,
    referenceModel: referenceImage ? AI_REFERENCE_MODEL : null,
    referenceImage: summarizeReferenceImage(referenceImage),
    chunkCount: AI_BUILD_CHUNKS.length,
    chunkSize: AI_BUILD_CHUNK_SIZE,
    concurrency: Math.min(AI_BUILD_CONCURRENCY, AI_BUILD_CHUNKS.length),
    maxTokens: AI_BUILD_SEGMENT_MAX_TOKENS,
    chunkTimeoutMs: AI_BUILD_CHUNK_TIMEOUT_MS,
    requestedFloors,
    materialDirectives: directives,
  });
  pushTrace({
    type: 'start',
    stage: aiStage,
    message: 'AI 建筑生成开始',
    summary: referenceImage
      ? '已启用参考图分析'
      : '未启用参考图分析',
  });
  if (referenceImage) {
    pushTrace({
      type: 'reference-analysis-start',
      stage: 'reference-analysis',
      message: '参考图分析中',
      summary: '正在调用多模态模型识别参考图。',
    });
  }

  try {
    const referenceAnalysis = referenceImage
      ? await requestReferenceDescription(prompt, referenceImage, requestId, timeout.signal)
      : null;
    referenceDescription = referenceAnalysis?.description ?? null;
    if (referenceAnalysis) {
      pushTrace({
        type: 'reference-analysis-result',
        stage: 'reference-analysis',
        message: '参考图分析完成',
        summary: referenceDescription?.referenceDescription ?? '',
        resultPrompt: referenceAnalysis.prompt?.result ?? '',
      });
    }
    log('trace', 'AI 参考图描述已合并到建筑提示词', {
      requestId,
      hasReferenceDescription: Boolean(referenceDescription),
      referenceDescription,
    });
    aiStage = 'parameter-generation';
    const parameterResult = await requestStructuredBuildingParameters(prompt, referenceDescription, requestId, timeout.signal, {
      progress: pushTrace,
    });
    aiStage = 'procedural-building';
    pushTrace({
      type: 'chunk-start',
      stage: 'procedural-building',
      chunk: 1,
      chunkCount: 1,
      chunkKey: 'procedural-builder',
      title: 'Procedural Builder',
      message: 'Generating building blocks with procedural builder',
      summary: JSON.stringify(parameterResult.parsed),
    });
    const parameterReferenceSource = Array.isArray(parameterResult.parsed?.referenceMaterials)
      ? parameterResult.parsed.referenceMaterials
      : [];
    const promptCustomMaterialSource = extractCustomProceduralMaterialsFromPrompt(prompt);
    const imagePaletteMaterialSource = createPaletteReferenceMaterials(referenceDescription, incomingReferenceMaterials);
    const proceduralReferenceSource = dedupeProceduralReferenceSource([
      ...incomingReferenceMaterials,
      ...imagePaletteMaterialSource,
      ...parameterReferenceSource,
      ...promptCustomMaterialSource,
    ]);
    const proceduralReferenceMaterialSet = proceduralReferenceSource.length
      ? await normalizeReferenceMaterialsWithCustom(proceduralReferenceSource, referenceImage, prompt)
      : { referenceMaterials: [], customBlocks: [] };
    const proceduralReferenceMaterials = proceduralReferenceMaterialSet.referenceMaterials;
    const proceduralParameters = applyResolvedProceduralMaterials(parameterResult.parsed, proceduralReferenceMaterials);
    const proceduralPlan = buildProceduralBuilding(proceduralParameters, prompt);
    const proceduralCustomBlocks = normalizeStoredCustomBlocks([
      ...fallbackCustomBlocks,
      ...proceduralReferenceMaterialSet.customBlocks,
    ]);
    const proceduralMaterialBlocks = applyMaterialDirectivesToBlocks(proceduralPlan.blocks, prompt);
    const proceduralEnsuredBlocks = ensureRequiredParts(proceduralMaterialBlocks, prompt);
    const proceduralReferenceBlocks = applyReferenceMaterialsToBlocks(proceduralEnsuredBlocks, proceduralReferenceMaterials, {
      usePartFallback: false,
    });
    const proceduralBlocks = limitBuildingBlocks(dedupeBuildingBlocks(proceduralReferenceBlocks));
    const proceduralCounts = inferPartCounts(proceduralBlocks);

    promptTrace = normalizePromptTrace({
      input: prompt,
      referenceAnalysis: referenceAnalysis?.prompt ?? null,
      building: {
        system: parameterResult.prompts.system,
        user: parameterResult.prompts.user,
        result: parameterResult.prompts.result,
      },
      integrated: [
        referenceAnalysis?.prompt?.result ? `Reference analysis:\n${referenceAnalysis.prompt.result}` : '',
        `Structured parameters:\n${parameterResult.prompts.result}`,
        proceduralReferenceMaterials.length ? `Resolved procedural materials:\n${JSON.stringify(proceduralParameters, null, 2)}` : '',
        `Procedural builder: ${proceduralPlan.meta.proceduralBuilder}`,
        `Matched image features:\n${JSON.stringify(proceduralPlan.meta.matchedFeatures ?? [], null, 2)}`,
      ].filter(Boolean).join('\n\n'),
      generationTrace,
    }, prompt);

    pushTrace({
      type: 'chunk-complete',
      stage: 'procedural-building',
      chunk: 1,
      chunkCount: 1,
      chunkKey: 'procedural-builder',
      title: 'Procedural Builder',
      blockCount: proceduralBlocks.length,
      message: 'Procedural building blocks generated',
      summary: JSON.stringify({
        blockCount: proceduralBlocks.length,
        counts: proceduralCounts,
        parameters: proceduralParameters,
        matchedFeatures: proceduralPlan.meta.matchedFeatures,
        imageSimilarityScore: proceduralPlan.meta.imageSimilarityScore,
      }),
    });

    log('info', 'AI procedural building generation complete.', {
      requestId,
      stage: 'procedural-building',
      durationMs: Date.now() - startedAt,
      blockCount: proceduralBlocks.length,
      counts: proceduralCounts,
      parameterFallback: parameterResult.fallback,
      referenceDescription: Boolean(referenceDescription),
    });

    return {
      raw: {
        parameters: parameterResult.raw,
      },
      building: proceduralBlocks,
      meta: {
        procedural: true,
        proceduralBuilder: proceduralPlan.meta.proceduralBuilder,
        proceduralParameters,
        matchedFeatures: proceduralPlan.meta.matchedFeatures,
        imageSimilarityScore: proceduralPlan.meta.imageSimilarityScore,
        parameterFallback: parameterResult.fallback,
        generationTrace,
        materialDirectives: directives,
        referenceImage: referenceImage ? {
          name: referenceImage.name,
          mimeType: referenceImage.mimeType,
          sizeBytes: referenceImage.sizeBytes,
        } : null,
        referenceMaterials: proceduralReferenceMaterials,
        customBlocks: proceduralCustomBlocks,
        requestedFloors,
        referenceDescription,
        referenceAnalysisModel: referenceDescription ? AI_REFERENCE_MODEL : null,
      },
      customBlocks: proceduralCustomBlocks,
      counts: proceduralCounts,
      prompt,
      prompts: promptTrace,
      mergedPrompt: promptTrace.integrated,
      model: AI_BUILD_MODEL,
      aiAccess: {
        success: true,
        model: AI_BUILD_MODEL,
        stage: 'procedural-building',
        message: referenceImage
          ? `大模型访问成功：参考图分析和结构化参数生成已完成，Procedural Builder 生成 ${proceduralBlocks.length} 个方块。`
          : `大模型访问成功：结构化参数生成已完成，Procedural Builder 生成 ${proceduralBlocks.length} 个方块。`,
      },
    };

    aiStage = 'building-generation';
    const referenceInstruction = referenceDescription
      ? [
        '参考图已经由多模态模型完成分析。你必须把下面的文字规格逐项落实到 blocks，禁止退回通用房屋模板。',
        '优先匹配参考图的整体风格、体量比例、建筑轮廓、屋顶/屋檐、围墙、门窗数量和相对位置。',
        '如果文字规格写明数量，数组中必须尽量保持相同数量；如果写明对称、层数或入口方向，也必须落实。',
        `参考图分析结果：${JSON.stringify(referenceDescription)}`,
        fallbackReferenceMaterials.length
        ? `图片材料不确定时，优先从这些可用材料中选择：${formatReferenceMaterials(fallbackReferenceMaterials)}。`
        : '',
      ].filter(Boolean).join('\n')
      : '';
    const systemPrompt = [
      '你是我的世界风格的方块建筑师。',
      '只输出 JSON，不要输出解释、Markdown 或代码块。',
      '返回对象必须包含 blocks 数组，可以包含 meta 对象。',
      '每个元素必须包含 x, y, z, blockId, part。',
      'part 只能是 foundation, wall, door, window, roof, facility 之一。',
      '输出必须是最小化 JSON：不要缩进、不要换行、不要多余空格，meta 可以省略或保持极短。',
      '建筑必须包含地基、墙体/围墙、门、窗、屋顶和生活设施，缺一不可。',
      'door 可以用 blockId 0 表示空气开口；window 优先使用 blockId 23 的玻璃。',
      '坐标必须为从 0 开始的局部整数坐标，y=0 是地基层。',
      `这是完整建筑的受控分片请求。总 blocks 最多 ${AI_BUILD_LIMIT} 个；当前分片最多 ${AI_BUILD_CHUNK_SIZE} 个 blocks。`,
      `如果用户指令或参考图是大型建筑，每个分片应尽量输出 ${Math.max(100, AI_BUILD_CHUNK_SIZE - 40)}-${AI_BUILD_CHUNK_SIZE} 个 blocks，最终合并后优先保证完整建筑。`,
      '必须逐个输出实际方块，禁止压缩、坐标范围、数量描述、模板名称、字符串图案、省略号或用 meta 代替 blocks。',
      '所有分片必须使用同一个局部坐标系和同一个建筑原点，最终整体必须能组合成一座完整建筑。',
      `完整建筑由 ${AI_BUILD_CHUNKS.length} 个受控分片合成，整体必须覆盖这些结构层次：${AI_BUILD_CHUNKS.map((chunk) => chunk.title).join('；')}。`,
      '需要尽可能完整地复制参考图和用户指令中的建筑细节；重复的柱、门窗、瓦片和装饰也必须逐个写入 blocks，直到建筑完整或达到上限。',
      requestedFloors > 0 ? `用户要求 ${requestedFloors} 层建筑，墙体高度应约为 ${requestedFloors * 3} 个方块，并用屋顶封顶。` : '',
      directiveInstruction ? `用户指定材料拥有最高优先级，必须严格执行：${directiveInstruction}。不要用建筑类型默认材料覆盖这些指定材料。` : '',
      referenceInstruction,
      '根据用户指令选择材质和结构：木屋用 25 木板、26 瓦片、27 鹅卵石；城堡用 27 鹅卵石和 26 瓦片；现代别墅用 24 混凝土、29 石英、23 玻璃、31 金属板；工业建筑用 22 砖、24 混凝土、31 金属板；神庙用 25 木板和 26 瓦片；金字塔用 28 砂岩；冰雪建筑用 9 雪和 11 冰。',
      '可用 blockId：0 空气，2 普通水，3 石头，7 原木，9 雪，11 冰，13 雪山方块，19 工具台，20 石板，21 钢材，22 砖，23 玻璃，24 混凝土，25 木板，26 瓦片，27 鹅卵石，28 砂岩，29 石英，30 灯具，31 金属板，32 雪莲方块，33 可见水流装饰方块，34 大理石，35 深色石材，36 陶土，37 铜板，38 黑色玻璃，39 蓝色瓦片，40 竹材，41 白墙。',
    ].filter(Boolean).join('\n');
    const sharedUserContent = [
      `用户建筑指令：${prompt}`,
      referenceDescription
        ? '请严格根据上面的参考图文字分析生成完整建筑。先落实形状、比例和数量，再选择方块材料。'
        : '请根据用户指令生成完整建筑，不要返回简化示意图。',
    ].filter(Boolean).join('\n');
    const chunkPrompts = [];
    const updateChunkPromptTrace = () => {
      promptTrace = normalizePromptTrace({
        input: prompt,
        referenceAnalysis: referenceAnalysis?.prompt ?? null,
        building: {
          system: systemPrompt,
          user: sharedUserContent,
          chunks: chunkPrompts.filter(Boolean),
        },
        integrated: [
          systemPrompt,
          sharedUserContent,
          ...chunkPrompts
            .filter(Boolean)
            .map((item) => `\n建筑数组分片 ${item.index}/${AI_BUILD_CHUNKS.length}：${item.title}\n${item.user}`),
        ].join('\n\n'),
      }, prompt);
      pushTrace({
        type: 'prompt-trace',
        stage: 'building-generation',
        message: '建筑整合提示词已生成',
        summary: promptTrace.integrated,
        systemPrompt: systemPrompt,
        userPrompt: sharedUserContent,
        prompts: promptTrace,
      });
    };
    updateChunkPromptTrace();
    const blueprintSystemPrompt = [
      '你是 Minecraft 方块建筑总设计师。',
      '只输出一个紧凑 JSON 对象，不要输出 Markdown，不要输出 blocks 数组，不要输出长篇解释。',
      '蓝图必须让后续分片共享同一个从 0 开始的局部坐标系。',
      'JSON 顶层只允许包含 dimensions, coordinateSystem, materials, parts, segmentPlan, qualityChecklist。',
      'materials 必须使用可用 blockId 数字，不要使用 Minecraft 英文方块名。',
      'segmentPlan 每项只写 key、title、range、include、exclude，保持简短。',
    ].join('\n');
    const blueprintUserPrompt = [
      sharedUserContent,
      referenceInstruction,
      `完整建筑总上限 ${AI_BUILD_LIMIT} 个 blocks，将由 ${AI_BUILD_CHUNKS.length} 个分片合并。`,
      `可用 blockId：0 空气，20 石板，23 玻璃，26 瓦片，30 灯具，34 大理石，36 陶土，38 黑色玻璃，40 竹材，41 白墙。`,
      `分片列表：${AI_BUILD_CHUNKS.map((chunk, index) => `${index + 1}. ${chunk.key}: ${chunk.title}`).join('；')}`,
      '请输出短蓝图：dimensions 用 width/depth/height；parts 只描述 base/mainHall/wings/roof/courtyard/stairs 的坐标范围；不要展开逐块坐标。',
    ].filter(Boolean).join('\n\n');
    const requestBlueprint = async () => {
      const blueprintStartedAt = Date.now();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        pushTrace({
          type: 'chunk-start',
          stage: 'building-generation',
          chunk: 1,
          chunkCount: AI_BUILD_CHUNKS.length + 1,
          chunkKey: 'blueprint',
          title: '完整建筑蓝图',
          attempt: attempt + 1,
          message: '开始请求完整建筑蓝图',
          systemPrompt: blueprintSystemPrompt,
          userPrompt: blueprintUserPrompt,
        });

        try {
          const result = await requestAiChatCompletion({
            messages: [
              { role: 'system', content: blueprintSystemPrompt },
              { role: 'user', content: blueprintUserPrompt },
            ],
            requestId: `${requestId}-building-blueprint-${attempt + 1}`,
            signal: timeout.signal,
            model: AI_BUILD_MODEL,
            temperature: 0.15,
            maxTokens: AI_BUILD_BLUEPRINT_MAX_TOKENS,
            timeoutMs: Math.min(Math.max(AI_BUILD_CHUNK_TIMEOUT_MS, 45000), 90000),
            apiBaseUrl: AI_BUILD_API_BASE_URL,
            apiKey: AI_BUILD_API_KEY,
            enableThinking: AI_BUILD_ENABLE_THINKING,
            responseFormat: AI_BUILD_RESPONSE_FORMAT,
          });
          if (isAiResponseTruncated(result.responseJson)) {
            throw new Error(`AI 建筑蓝图输出被截断（${getAiResponseFinishReason(result.responseJson) || 'unknown'}）。`);
          }

          const parsed = parseAssistantJson(result.content);

          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            pushTrace({
              type: 'chunk-complete',
              stage: 'building-generation',
              chunk: 1,
              chunkCount: AI_BUILD_CHUNKS.length + 1,
              chunkKey: 'blueprint',
              title: '完整建筑蓝图',
              attempt: attempt + 1,
              blockCount: 0,
              message: '完整建筑蓝图已生成',
              contentPreview: result.content.slice(0, 2000),
              summary: JSON.stringify(parsed).slice(0, 2000),
            });
            log('trace', 'AI 建筑蓝图生成完成', {
              requestId,
              stage: 'building-generation',
              attempt: attempt + 1,
              durationMs: Date.now() - blueprintStartedAt,
              blueprint: parsed,
            });
            return {
              raw: result.responseJson,
              parsed,
              content: result.content,
            };
          }

          throw new Error('AI 建筑蓝图不是有效 JSON 对象。');
        } catch (error) {
          if (attempt === 0 && !timeout.signal.aborted && isRetryableAiError(error)) {
            log('warning', 'AI 建筑蓝图将重试', {
              requestId,
              stage: 'building-generation',
              attempt: attempt + 1,
              durationMs: Date.now() - blueprintStartedAt,
              error,
            });
            await waitMs(1200);
            continue;
          }

          log(attempt === 0 ? 'warning' : 'error', 'AI 建筑蓝图解析失败', {
            requestId,
            stage: 'building-generation',
            attempt: attempt + 1,
            durationMs: Date.now() - blueprintStartedAt,
            error,
          });

          if (attempt === 0) {
            await waitMs(600);
            continue;
          }

          const fallback = buildLocalBuildingBlueprint(prompt, referenceDescription);
          pushTrace({
            type: 'chunk-complete',
            stage: 'building-generation',
            chunk: 1,
            chunkCount: AI_BUILD_CHUNKS.length + 1,
            chunkKey: 'blueprint',
            title: '完整建筑蓝图',
            attempt: attempt + 1,
            blockCount: 0,
            message: 'AI 蓝图无效，已使用本地兜底蓝图',
            contentPreview: JSON.stringify(fallback).slice(0, 2000),
            summary: JSON.stringify(fallback).slice(0, 2000),
          });
          return {
            raw: null,
            parsed: fallback,
            content: JSON.stringify(fallback),
            fallback: true,
          };
        }
      }

      const fallback = buildLocalBuildingBlueprint(prompt, referenceDescription);
      return {
        raw: null,
        parsed: fallback,
        content: JSON.stringify(fallback),
        fallback: true,
      };
    };
    const blueprintResult = await requestBlueprint();
    const blueprintText = JSON.stringify(blueprintResult.parsed, null, 2);
    const getSegmentBlockLimit = (attempt) => {
      if (attempt <= 0) {
        return AI_BUILD_CHUNK_SIZE;
      }

      if (attempt === 1) {
        return Math.min(AI_BUILD_CHUNK_SIZE, 140);
      }

      return Math.min(AI_BUILD_CHUNK_SIZE, 100);
    };
    const createSegmentPrompt = (chunk, index, attempt, blockLimit) => [
      sharedUserContent,
      `完整建筑蓝图：\n${blueprintText}`,
      `当前分片：${index + 1}/${AI_BUILD_CHUNKS.length}，职责：${chunk.title}。`,
      chunk.instruction,
      `本分片目标输出 ${Math.max(70, blockLimit - 40)}-${blockLimit} 个 blocks，最多输出 ${blockLimit} 个 blocks。必须逐个输出实际方块，禁止省略号、模板、坐标范围和说明文字。`,
      '输出必须是单行最小化 JSON，例如 {"blocks":[{"x":0,"y":0,"z":0,"blockId":34,"part":"foundation"}]}，不要缩进、不要换行。',
      '必须严格复用蓝图中的局部坐标系、建筑原点、整体尺寸、入口方向和材料映射。',
      '只输出当前分片负责的 blocks，避免与其他分片重复坐标；但必须保证和其他分片合并后是一座完整建筑。',
      '返回 JSON 对象，格式为 {"blocks":[...],"meta":{"segmentKey":"...","coveredParts":[...]}}。',
      attempt > 0
        ? `上一轮分片失败或返回不完整。现在最多只输出 ${blockLimit} 个 blocks，必须返回完整有效 JSON；优先保留该分片最关键结构。`
        : '',
    ].filter(Boolean).join('\n\n');
    const requestSegment = async (chunk, index) => {
      const segmentStartedAt = Date.now();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const blockLimit = getSegmentBlockLimit(attempt);
        const userPrompt = createSegmentPrompt(chunk, index, attempt, blockLimit);
        const chunkPrompt = {
          index: index + 1,
          key: chunk.key,
          title: chunk.title,
          system: systemPrompt,
          user: userPrompt,
        };
        chunkPrompts[index] = chunkPrompt;
        updateChunkPromptTrace();

        pushTrace({
          type: 'chunk-start',
          stage: 'building-generation',
          chunk: index + 1,
          chunkCount: AI_BUILD_CHUNKS.length,
          chunkKey: chunk.key,
          title: chunk.title,
          attempt: attempt + 1,
          message: `开始请求建筑分片 ${index + 1}/${AI_BUILD_CHUNKS.length}`,
          systemPrompt,
          userPrompt,
        });

        try {
          const result = await requestAiChatCompletion({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            requestId: `${requestId}-building-segment-${index + 1}-${attempt + 1}`,
            signal: timeout.signal,
            model: AI_BUILD_MODEL,
            temperature: attempt > 0 ? 0.12 : (referenceDescription ? 0.2 : 0.35),
            maxTokens: attempt > 0
              ? Math.min(AI_BUILD_FULL_MAX_TOKENS, Math.ceil(AI_BUILD_SEGMENT_MAX_TOKENS * (attempt === 1 ? 1.15 : 1.25)))
              : AI_BUILD_SEGMENT_MAX_TOKENS,
            timeoutMs: AI_BUILD_CHUNK_TIMEOUT_MS,
            apiBaseUrl: AI_BUILD_API_BASE_URL,
            apiKey: AI_BUILD_API_KEY,
            enableThinking: AI_BUILD_ENABLE_THINKING,
            responseFormat: AI_BUILD_RESPONSE_FORMAT,
          });

          if (isAiResponseTruncated(result.responseJson)) {
            throw new Error(`AI 建筑分片输出被截断（${getAiResponseFinishReason(result.responseJson) || 'unknown'}）。`);
          }

          const parsed = parseBuildingAssistantPayload(result.content);

          if (parsed?.meta?.partialContentRecovered) {
            throw new Error('AI 建筑分片返回了不完整 JSON。');
          }

          const blocks = normalizeBuildingChunk(parsed, blockLimit);

          if (blocks.length === 0) {
            throw new Error(`建筑分片 ${index + 1}/${AI_BUILD_CHUNKS.length} 没有返回有效 blocks。`);
          }

          pushTrace({
            type: 'chunk-complete',
            stage: 'building-generation',
            chunk: index + 1,
            chunkCount: AI_BUILD_CHUNKS.length,
            chunkKey: chunk.key,
            title: chunk.title,
            attempt: attempt + 1,
            blockCount: blocks.length,
            message: `建筑分片 ${index + 1}/${AI_BUILD_CHUNKS.length} 完成`,
            contentPreview: result.content.slice(0, 2000),
            summary: JSON.stringify({
              blockCount: blocks.length,
              firstBlock: blocks[0] ?? null,
            }),
          });
          log('trace', 'AI 建筑分片完成', {
            requestId,
            stage: 'building-generation',
            chunk: index + 1,
            chunkCount: AI_BUILD_CHUNKS.length,
            chunkKey: chunk.key,
            attempt: attempt + 1,
            blockCount: blocks.length,
            durationMs: Date.now() - segmentStartedAt,
            meta: parsed?.meta ?? null,
          });

          return {
            raw: result.responseJson,
            parsed,
            blocks,
          };
        } catch (error) {
          if (attempt === 0 && !timeout.signal.aborted && isRetryableAiError(error)) {
            log('warning', 'AI 建筑分片将重试', {
              requestId,
              stage: 'building-generation',
              chunk: index + 1,
              chunkCount: AI_BUILD_CHUNKS.length,
              chunkKey: chunk.key,
              attempt: attempt + 1,
              durationMs: Date.now() - segmentStartedAt,
              error,
            });
            await waitMs(1200);
            continue;
          }

          if (attempt === 1 && !timeout.signal.aborted && isRetryableAiError(error)) {
            log('warning', 'AI 建筑分片将再次缩小后重试', {
              requestId,
              stage: 'building-generation',
              chunk: index + 1,
              chunkCount: AI_BUILD_CHUNKS.length,
              chunkKey: chunk.key,
              attempt: attempt + 1,
              nextBlockLimit: getSegmentBlockLimit(attempt + 1),
              durationMs: Date.now() - segmentStartedAt,
              error,
            });
            await waitMs(1400);
            continue;
          }

          log('error', 'AI 建筑分片失败', {
            requestId,
            stage: 'building-generation',
            chunk: index + 1,
            chunkCount: AI_BUILD_CHUNKS.length,
            chunkKey: chunk.key,
            attempt: attempt + 1,
            durationMs: Date.now() - segmentStartedAt,
            error,
          });
          throw error;
        }
      }

      throw new Error(`建筑分片 ${index + 1}/${AI_BUILD_CHUNKS.length} 生成失败。`);
    };
    const chunkResults = new Array(AI_BUILD_CHUNKS.length);
    let nextChunkIndex = 0;
    const worker = async () => {
      while (nextChunkIndex < AI_BUILD_CHUNKS.length) {
        const index = nextChunkIndex;
        nextChunkIndex += 1;
        chunkResults[index] = await requestSegment(AI_BUILD_CHUNKS[index], index);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(AI_BUILD_CONCURRENCY, AI_BUILD_CHUNKS.length) },
        () => worker(),
      ),
    );
    const generatedBlocks = chunkResults.flatMap((chunk) => chunk.blocks);
    const mergedBlocks = dedupeBuildingBlocks(generatedBlocks);
    const normalized = normalizeArchitecturalCoordinates(mergedBlocks);
    const segmentMetas = chunkResults
      .map((chunk) => chunk.parsed?.meta)
      .filter((meta) => meta && typeof meta === 'object');
    const referenceMaterialSet = await normalizeReferenceMaterialsWithCustom(
      segmentMetas.find((meta) => Array.isArray(meta.referenceMaterials))?.referenceMaterials
        ?? blueprintResult.parsed?.referenceMaterials,
      referenceImage,
      prompt,
    );
    const referenceMaterials = referenceMaterialSet.referenceMaterials;
    const customBlocks = normalizeStoredCustomBlocks([
      ...fallbackCustomBlocks,
      ...referenceMaterialSet.customBlocks,
    ]);
    const materialRepaired = applyMaterialDirectivesToBlocks(normalized, prompt);
    const ensured = ensureRequiredParts(materialRepaired, prompt);
    const referenceRepaired = applyReferenceMaterialsToBlocks(ensured, referenceMaterials);
    const repaired = limitBuildingBlocks(
      dedupeBuildingBlocks(referenceRepaired),
    );
    promptTrace = normalizePromptTrace({
      ...promptTrace,
      generationTrace,
    }, prompt);
    pushTrace({
      type: 'merge-complete',
      stage: 'building-generation',
      message: '完整建筑数组已归一化完成',
      blockCount: repaired.length,
      summary: JSON.stringify({
        chunkCount: AI_BUILD_CHUNKS.length,
        blocksByChunk: chunkResults.map((chunk) => chunk.blocks.length),
        mergedBlockCount: repaired.length,
      }),
    });

    log('info', 'AI 建筑生成完成', {
      requestId,
      stage: 'building-generation',
      durationMs: Date.now() - startedAt,
      chunkCount: AI_BUILD_CHUNKS.length,
      blocksByChunk: chunkResults.map((chunk) => chunk.blocks.length),
      mergedBlockCount: repaired.length,
      counts: inferPartCounts(repaired),
      promptTraceLength: promptTrace?.integrated?.length ?? 0,
    });

    return {
      raw: {
        blueprint: blueprintResult.raw,
        chunks: chunkResults.map((chunk) => chunk.raw),
      },
      building: repaired,
      meta: {
        blueprint: blueprintResult.parsed,
        segmentMetas,
        generationChunks: {
          count: AI_BUILD_CHUNKS.length,
          chunkSize: AI_BUILD_CHUNK_SIZE,
          blocksByChunk: chunkResults.map((chunk) => chunk.blocks.length),
          mergedBlockCount: repaired.length,
        },
        generationTrace,
        materialDirectives: directives,
        referenceImage: referenceImage ? {
          name: referenceImage.name,
          mimeType: referenceImage.mimeType,
          sizeBytes: referenceImage.sizeBytes,
        } : null,
        referenceMaterials,
        customBlocks,
        requestedFloors,
        referenceDescription,
        referenceAnalysisModel: referenceDescription ? AI_REFERENCE_MODEL : null,
      },
      customBlocks,
      counts: inferPartCounts(repaired),
      prompt,
      prompts: promptTrace,
      mergedPrompt: promptTrace.integrated,
      model: AI_BUILD_MODEL,
      aiAccess: {
        success: true,
        model: AI_BUILD_MODEL,
        stage: 'building-generation',
        message: referenceImage
          ? `大模型访问成功：参考图分析、蓝图和 ${AI_BUILD_CHUNKS.length} 个建筑分片均已完成，共生成 ${repaired.length} 个方块。`
          : `大模型访问成功：蓝图和 ${AI_BUILD_CHUNKS.length} 个建筑分片均已完成，共生成 ${repaired.length} 个方块。`,
      },
    };
  } catch (error) {
    log('error', 'AI 建筑生成流程失败', {
      requestId,
      stage: error.aiStage ?? aiStage,
      durationMs: Date.now() - startedAt,
      error,
      referenceDescription,
      promptTrace,
    });
    error.aiStage = error.aiStage ?? aiStage;
    error.promptTrace = error.promptTrace ?? promptTrace;
    error.referenceDescription = error.referenceDescription ?? referenceDescription;
    error.generationTrace = error.generationTrace ?? generationTrace;
    throw error;
  } finally {
    timeout.clear();
  }
}

async function handleAiRequest(request, response, url) {
  if (request.method !== 'POST' || url.pathname !== '/api/ai/building') {
    sendError(response, 404, '接口不存在。');
    return;
  }

  let payload = null;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === 'REQUEST_BODY_TOO_LARGE') {
      sendError(response, 413, '请求体太大。');
      return;
    }

    sendError(response, 400, '请求 JSON 无效。');
    return;
  }

  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  const referenceImage = normalizeReferenceImage(payload.referenceImage);
  const referenceMaterials = Array.isArray(payload.referenceMaterials) ? payload.referenceMaterials : [];
  const customBlocks = Array.isArray(payload.customBlocks) ? payload.customBlocks : [];
  const playerId = getPlayerId(request);
  const requestId = `building-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const wantsProgressStream = /application\/x-ndjson|text\/event-stream/i.test(String(request.headers.accept ?? ''))
    || String(request.headers['x-ai-progress'] ?? '').trim() === '1';
  const streamEvent = wantsProgressStream
    ? (event) => {
      response.write(`${JSON.stringify({
        requestId,
        at: new Date().toISOString(),
        ...event,
      })}\n`);
    }
    : null;

  log('info', 'AI 建筑接口收到请求', {
    requestId,
    playerId,
    prompt,
    referenceImage: summarizeReferenceImage(referenceImage),
    payloadKeys: Object.keys(payload),
  });

  if (!prompt) {
    log('warning', 'AI 建筑接口拒绝空指令', {
      requestId,
      playerId,
    });
    if (wantsProgressStream) {
      response.writeHead(400, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Player-Id, Authorization, X-AI-Progress',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      });
      streamEvent?.({
        type: 'error',
        ok: false,
        error: '请先输入建筑生成指令。',
        aiAccess: {
          success: false,
          model: AI_BUILD_MODEL,
          stage: 'building-generation',
          message: '请先输入建筑生成指令。',
        },
      });
      response.end();
      return;
    }

    sendError(response, 400, '请先输入建筑生成指令。');
    return;
  }

  try {
    if (wantsProgressStream) {
      response.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Player-Id, Authorization, X-AI-Progress',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Transfer-Encoding': 'chunked',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders?.();
      streamEvent?.({
        type: 'meta',
        ok: true,
        prompt,
        model: AI_BUILD_MODEL,
        apiBaseUrl: AI_BUILD_API_BASE_URL,
        referenceApiBaseUrl: AI_API_BASE_URL,
        playerId,
      });
    }

    const result = await requestBuildingPlan(prompt, requestId, referenceImage, {
      progress: streamEvent,
      referenceMaterials,
      customBlocks,
    });

    log('info', 'AI 建筑接口返回成功', {
      requestId,
      playerId,
      model: result.model,
      blockCount: result.building?.length ?? 0,
      counts: result.counts,
      aiAccess: result.aiAccess,
    });

    if (wantsProgressStream) {
      streamEvent?.({
        type: 'final',
        ok: true,
        model: result.model ?? AI_BUILD_MODEL,
        apiBaseUrl: AI_BUILD_API_BASE_URL,
        referenceApiBaseUrl: AI_API_BASE_URL,
        prompt,
        building: result.building,
        counts: result.counts,
        customBlocks: result.customBlocks ?? result.meta?.customBlocks ?? [],
        meta: result.meta,
        prompts: result.prompts,
        mergedPrompt: result.mergedPrompt,
        aiAccess: result.aiAccess,
        fallback: false,
      });
      response.end();
      return;
    }

    sendJson(response, 200, {
      ok: true,
      model: result.model ?? AI_BUILD_MODEL,
      apiBaseUrl: AI_BUILD_API_BASE_URL,
      referenceApiBaseUrl: AI_API_BASE_URL,
      prompt,
      building: result.building,
      counts: result.counts,
      customBlocks: result.customBlocks ?? result.meta?.customBlocks ?? [],
      meta: result.meta,
      prompts: result.prompts,
      mergedPrompt: result.mergedPrompt,
      aiAccess: result.aiAccess,
      fallback: false,
    });
  } catch (error) {
    const reason = describeAiFailure(error);
    const promptTrace = error.promptTrace
      ? normalizePromptTrace(error.promptTrace, prompt)
      : normalizePromptTrace({ input: prompt }, prompt);
    const aiAccess = {
      success: false,
      model: error.aiStage === 'reference-analysis' ? AI_REFERENCE_MODEL : AI_BUILD_MODEL,
      stage: error.aiStage ?? (referenceImage ? 'reference-analysis' : 'building-generation'),
      message: `大模型访问失败：${reason}`,
    };

    log('error', 'AI 建筑接口返回失败', {
      requestId,
      playerId,
      stage: aiAccess.stage,
      model: aiAccess.model,
      error,
      aiAccess,
      prompts: promptTrace,
    });
    if (wantsProgressStream) {
      streamEvent?.({
        type: 'final',
        ok: false,
        error: aiAccess.message,
        reason,
        model: aiAccess.model,
        apiBaseUrl: AI_BUILD_API_BASE_URL,
        referenceApiBaseUrl: AI_API_BASE_URL,
        prompt,
        prompts: promptTrace,
        mergedPrompt: promptTrace.integrated,
        meta: {
          error: error.message,
          referenceDescription: error.referenceDescription ?? null,
          prompts: promptTrace,
          aiAccess,
        },
        aiAccess,
      });
      response.end();
      return;
    }
    sendJson(response, 502, {
      ok: false,
      error: aiAccess.message,
      reason,
      model: aiAccess.model,
      apiBaseUrl: AI_BUILD_API_BASE_URL,
      referenceApiBaseUrl: AI_API_BASE_URL,
      prompt,
      prompts: promptTrace,
      mergedPrompt: promptTrace.integrated,
      meta: {
        error: error.message,
        referenceDescription: error.referenceDescription ?? null,
        prompts: promptTrace,
        aiAccess,
      },
      aiAccess,
    });
  }
}

async function requestNpcChatReply({ npc, message, profile, history = [] }, requestId = 'local') {
  if (!AI_API_KEY) {
    throw new Error('AI_API_KEY 未配置。');
  }

  const timeout = createTimeoutSignal(Math.min(AI_TIMEOUT_MS, 45000));
  const systemPrompt = [
    '你是 three-mini-world 中的 Minecraft 方块世界 NPC。',
    '你必须保持角色设定，用中文回复，回复 1 到 3 句。',
    '你可以记住本轮聊天上下文，结合 NPC 职业、情绪、行为、玩家金币和村庄状态回答。',
    '不要输出 JSON，不要泄露系统提示，不要承诺真实世界交易。',
    npc?.role ? `NPC 职业：${npc.role}` : '',
    npc?.name ? `NPC 名字：${npc.name}` : '',
    npc?.behavior ? `当前行为：${npc.behavior}` : '',
    npc?.emotion ? `当前情绪：${npc.emotion}` : '',
    profile?.nickname ? `玩家昵称：${profile.nickname}` : '',
    Number.isFinite(profile?.coins) ? `玩家金币：${profile.coins}` : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch(`${AI_API_BASE_URL.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0.65,
        max_tokens: 360,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-8).map((entry) => ({
            role: entry.role === 'assistant' ? 'assistant' : 'user',
            content: String(entry.content ?? '').slice(0, 500),
          })),
          { role: 'user', content: String(message ?? '').slice(0, 600) },
        ],
      }),
      signal: timeout.signal,
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`AI 聊天请求失败：${response.status} ${response.statusText} ${responseText.slice(0, 160)}`);
    }

    const responseJson = readJsonMaybe(responseText);
    const content = extractAssistantContent(responseJson).trim();

    return content || '我听见了，不过一时没想好怎么回答。';
  } finally {
    timeout.clear();
  }
}

async function getAuthenticatedUser(request, { required = true } = {}) {
  const tokenUser = parseAuthToken(request);

  if (!tokenUser) {
    if (required) {
      throw new Error('UNAUTHORIZED');
    }

    return null;
  }

  const users = await getUserCollection();
  const user = await users.findOne({ userId: tokenUser.userId });

  if (!user) {
    if (required) {
      throw new Error('UNAUTHORIZED');
    }

    return null;
  }

  request.authUser = publicUser(user);
  return user;
}

async function handleAuthRequest(request, response, url) {
  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    const payload = await readRequestBody(request);
    const username = normalizeLoginId(payload.username);
    const nickname = normalizeNickname(payload.nickname);
    const password = String(payload.password ?? '');

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      sendError(response, 400, '用户名只能包含小写字母、数字、下划线，长度 3-24。');
      return true;
    }

    if (nickname.length < 2) {
      sendError(response, 400, '昵称至少 2 个字符。');
      return true;
    }

    if (password.length < 6) {
      sendError(response, 400, '密码至少 6 位。');
      return true;
    }

    const users = await getUserCollection();
    const now = Date.now();
    const isFirstUser = await users.estimatedDocumentCount() === 0;
    const user = {
      userId: createUserId(),
      username,
      nickname,
      passwordHash: await hashPassword(password),
      role: isFirstUser ? 'admin' : 'player',
      createdAt: now,
      updatedAt: now,
    };

    try {
      await users.insertOne(user);
    } catch (error) {
      if (error.code === 11000) {
        sendError(response, 409, '用户名或昵称已存在。');
        return true;
      }

      throw error;
    }

    const profile = await ensureUserProfile(user);
    sendJson(response, 201, { user: publicUser(user), profile, token: createAuthToken(user) });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const payload = await readRequestBody(request);
    const username = normalizeLoginId(payload.username);
    const users = await getUserCollection();
    const user = await users.findOne({ username });

    if (!user || !await verifyPassword(payload.password, user.passwordHash)) {
      sendError(response, 401, '用户名或密码错误。');
      return true;
    }

    const profile = await ensureUserProfile(user);
    sendJson(response, 200, { user: publicUser(user), profile, token: createAuthToken(user) });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    const user = await getAuthenticatedUser(request);
    const profile = await ensureUserProfile(user);

    sendJson(response, 200, { user: publicUser(user), profile });
    return true;
  }

  return false;
}

async function handleProfileRequest(request, response, url) {
  if (!url.pathname.startsWith('/api/profile') && !url.pathname.startsWith('/api/trade')) {
    return false;
  }

  const user = await getAuthenticatedUser(request);
  const profiles = await getProfileCollection();

  if (request.method === 'GET' && url.pathname === '/api/profile') {
    const profile = await ensureUserProfile(user);

    sendJson(response, 200, { profile });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/trade/buy') {
    const payload = await readRequestBody(request);
    const itemId = String(payload.itemId ?? '').slice(0, 60);
    const count = clampInteger(payload.count ?? 1, 1, 64);
    const price = clampInteger(payload.price ?? 0, 0, 100000);
    const cost = price * count;
    const result = await profiles.findOneAndUpdate(
      { userId: user.userId, coins: { $gte: cost } },
      { $inc: { coins: -cost }, $set: { updatedAt: Date.now() } },
      { returnDocument: 'after', projection: { _id: 0 } },
    );

    if (!result) {
      sendError(response, 400, '金币不足。');
      return true;
    }

    sendJson(response, 200, { ok: true, itemId, count, cost, profile: result });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/trade/sell') {
    const payload = await readRequestBody(request);
    const itemId = String(payload.itemId ?? '').slice(0, 60);
    const count = clampInteger(payload.count ?? 1, 1, 64);
    const price = clampInteger(payload.price ?? 0, 0, 100000);
    const income = price * count;
    const result = await profiles.findOneAndUpdate(
      { userId: user.userId },
      { $inc: { coins: income }, $set: { updatedAt: Date.now() } },
      { returnDocument: 'after', projection: { _id: 0 } },
    );

    sendJson(response, 200, { ok: true, itemId, count, income, profile: result });
    return true;
  }

  return false;
}

async function handleAdminRequest(request, response, url) {
  if (!url.pathname.startsWith('/api/admin')) {
    return false;
  }

  const user = await getAuthenticatedUser(request);

  if ((user.role ?? 'player') !== 'admin') {
    sendError(response, 403, '需要管理员权限。');
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/users') {
    const users = await getUserCollection();
    const profiles = await getProfileCollection();
    const userList = await users.find({}, { projection: { _id: 0, passwordHash: 0 } }).sort({ createdAt: -1 }).limit(200).toArray();
    const profileList = await profiles.find({ userId: { $in: userList.map((item) => item.userId) } }, { projection: { _id: 0 } }).toArray();
    const profileByUserId = new Map(profileList.map((profile) => [profile.userId, profile]));

    sendJson(response, 200, {
      users: userList.map((item) => ({
        ...item,
        profile: profileByUserId.get(item.userId) ?? null,
      })),
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/users/coins') {
    const payload = await readRequestBody(request);
    const userId = String(payload.userId ?? '');
    const delta = clampInteger(payload.delta ?? 0, -1000000, 1000000);
    const profiles = await getProfileCollection();
    const result = await profiles.findOneAndUpdate(
      { userId },
      { $inc: { coins: delta }, $set: { updatedAt: Date.now() } },
      { returnDocument: 'after', projection: { _id: 0 } },
    );

    if (!result) {
      sendError(response, 404, '用户资料不存在。');
      return true;
    }

    sendJson(response, 200, { profile: result });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/users/password') {
    const payload = await readRequestBody(request);
    const userId = String(payload.userId ?? '');
    const password = String(payload.password ?? '');

    if (password.length < 6) {
      sendError(response, 400, '新密码至少 6 位。');
      return true;
    }

    const users = await getUserCollection();
    const result = await users.findOneAndUpdate(
      { userId },
      { $set: { passwordHash: await hashPassword(password), updatedAt: Date.now() } },
      { returnDocument: 'after', projection: { _id: 0, passwordHash: 0 } },
    );

    if (!result) {
      sendError(response, 404, '用户不存在。');
      return true;
    }

    sendJson(response, 200, { user: publicUser(result) });
    return true;
  }

  return false;
}

async function handleNpcChatRequest(request, response, url) {
  if (request.method !== 'POST' || url.pathname !== '/api/ai/npc-chat') {
    return false;
  }

  const user = await getAuthenticatedUser(request, { required: false });
  const payload = await readRequestBody(request);
  const message = String(payload.message ?? '').trim();

  if (!message) {
    sendError(response, 400, '请输入聊天内容。');
    return true;
  }

  const profile = user ? await ensureUserProfile(user) : null;

  try {
    const reply = await requestNpcChatReply({
      npc: payload.npc ?? {},
      message,
      history: Array.isArray(payload.history) ? payload.history : [],
      profile,
    }, user?.userId ?? getPlayerId(request));

    sendJson(response, 200, { ok: true, reply, fallback: false });
  } catch (error) {
    const npcName = normalizeNickname(payload.npc?.name) || '我';

    log('error', 'NPC AI chat failed.', { error });
    sendJson(response, 200, {
      ok: true,
      reply: `${npcName}想了想说：现在村里事务很多，但你的问题我记下了。先看看周围的资源和安全路线，我们可以继续聊。`,
      fallback: true,
      error: error.message,
    });
  }

  return true;
}

async function handlePlayerBuildingRequest(request, response, url) {
  if (!url.pathname.startsWith('/api/player-buildings')) {
    return false;
  }

  const user = await getAuthenticatedUser(request, { required: false });
  const playerId = getPlayerId(request);
  const clientPlayerId = getClientPlayerId(request);
  const ownerFilter = user?.userId
    ? {
      $or: [
        { userId: user.userId },
        { 'creator.userId': user.userId },
        { playerId: clientPlayerId },
        { 'creator.playerId': clientPlayerId },
      ],
    }
    : {
      $or: [
        { playerId: clientPlayerId },
        { 'creator.playerId': clientPlayerId },
      ],
    };
  const collection = await getPlayerBuildingCollection();

  if (request.method === 'GET' && url.pathname === '/api/player-buildings') {
    const minX = Math.trunc(Number(url.searchParams.get('minX')));
    const maxX = Math.trunc(Number(url.searchParams.get('maxX')));
    const minZ = Math.trunc(Number(url.searchParams.get('minZ')));
    const maxZ = Math.trunc(Number(url.searchParams.get('maxZ')));
    const hasBounds = [minX, maxX, minZ, maxZ].every(Number.isFinite);
    const query = hasBounds
      ? {
        ...ownerFilter,
        status: { $nin: ['cleared', 'preview'] },
        'bounds.maxX': { $gte: minX },
        'bounds.minX': { $lte: maxX },
        'bounds.maxZ': { $gte: minZ },
        'bounds.minZ': { $lte: maxZ },
      }
      : {
        ...ownerFilter,
        status: { $nin: ['cleared', 'preview'] },
      };
    const records = await collection
      .find(query, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(hasBounds ? 200 : 100)
      .toArray();

    sendJson(response, 200, { records });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/player-buildings') {
    let payload = null;

    try {
      payload = await readRequestBody(request);
    } catch (error) {
      if (error.message === 'REQUEST_BODY_TOO_LARGE') {
        sendError(response, 413, '建筑数据太大，服务器拒绝写入。');
        return true;
      }

      sendError(response, 400, '建筑数据格式不是有效 JSON。');
      return true;
    }

    let record = null;

    try {
      const resolvedPayload = await resolveBuildingMaterialModule(payload, {
        prompt: String(payload?.prompt ?? ''),
      });
      record = buildPlayerBuildingRecord(resolvedPayload, {
        playerId,
        userId: user?.userId ?? resolvedPayload.userId ?? null,
      });
    } catch (error) {
      if (error.message === 'PLAYER_BUILDING_EMPTY') {
        sendError(response, 400, '建筑记录缺少可用方块。');
        return true;
      }

      throw error;
    }

    await collection.insertOne(record);
    sendJson(response, 201, { record: normalizeRecord(record) });
    return true;
  }

  const clearMatch = url.pathname.match(/^\/api\/player-buildings\/([^/]+)\/clear$/);

  if (request.method === 'POST' && clearMatch) {
    const id = decodeURIComponent(clearMatch[1]);
    const now = Date.now();
    const result = await collection.updateOne(
      { id, ...ownerFilter },
      { $set: { status: 'cleared', clearedAt: now, updatedAt: now } },
    );

    if (result.matchedCount <= 0) {
      sendError(response, 404, '建筑记录不存在。');
      return true;
    }

    const record = await collection.findOne(
      { id, ...ownerFilter },
      { projection: { _id: 0 } },
    );
    sendJson(response, 200, { record: normalizeRecord(record) });
    return true;
  }

  const recordMatch = url.pathname.match(/^\/api\/player-buildings\/([^/]+)$/);

  if (request.method === 'DELETE' && recordMatch) {
    const id = decodeURIComponent(recordMatch[1]);
    const result = await collection.deleteOne({ id, ...ownerFilter });

    if (result.deletedCount <= 0) {
      sendError(response, 404, '建筑记录不存在。');
      return true;
    }

    sendJson(response, 200, { ok: true, id });
    return true;
  }

  if (request.method === 'PATCH' && recordMatch) {
    let payload = null;

    try {
      payload = await readRequestBody(request);
    } catch (error) {
      if (error.message === 'REQUEST_BODY_TOO_LARGE') {
        sendError(response, 413, '建筑数据太大，服务器拒绝更新。');
        return true;
      }

      sendError(response, 400, '建筑更新数据格式不是有效 JSON。');
      return true;
    }

    const id = decodeURIComponent(recordMatch[1]);
    const existing = await collection.findOne({ id, ...ownerFilter });

    if (!existing) {
      sendError(response, 404, '建筑记录不存在。');
      return true;
    }

    let replacement = null;

    try {
      const resolvedPayload = await resolveBuildingMaterialModule({
        ...existing,
        ...payload,
        id,
        createdAt: existing.createdAt,
      }, {
        prompt: String(payload?.prompt ?? existing.prompt ?? ''),
      });
      replacement = buildPlayerBuildingRecord(resolvedPayload, {
        playerId,
        userId: user?.userId ?? resolvedPayload.userId ?? existing.userId ?? null,
      });
    } catch (error) {
      if (error.message === 'PLAYER_BUILDING_EMPTY') {
        sendError(response, 400, '建筑记录缺少可用方块。');
        return true;
      }

      throw error;
    }

    const now = Date.now();
    const { id: ignoredId, createdAt: ignoredCreatedAt, ...updatedFields } = replacement;
    const result = await collection.updateOne(
      { id, ...ownerFilter },
      { $set: { ...updatedFields, updatedAt: now } },
    );

    if (result.matchedCount <= 0) {
      sendError(response, 404, '建筑记录不存在。');
      return true;
    }

    const record = await collection.findOne(
      { id, ...ownerFilter },
      { projection: { _id: 0 } },
    );
    sendJson(response, 200, { record: normalizeRecord(record) });
    return true;
  }

  sendError(response, 404, '建筑记录接口不存在。');
  return true;
}

async function handleCustomBlockRequest(request, response, url) {
  if (!url.pathname.startsWith('/api/custom-blocks')) {
    return false;
  }

  if (request.method === 'GET' && url.pathname === '/api/custom-blocks') {
    const collection = await getCustomBlockCollection();
    const records = await collection
      .find({}, { projection: { _id: 0 } })
      .sort({ blockId: 1 })
      .limit(CUSTOM_BLOCK_ID_MAX - CUSTOM_BLOCK_ID_MIN + 1)
      .toArray();

    sendJson(response, 200, { customBlocks: normalizeStoredCustomBlocks(records) });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/custom-blocks/resolve') {
    let payload = null;

    try {
      payload = await readRequestBody(request);
    } catch (error) {
      if (error.message === 'REQUEST_BODY_TOO_LARGE') {
        sendError(response, 413, 'custom block request too large');
        return true;
      }

      sendError(response, 400, 'custom block JSON invalid');
      return true;
    }

    const source = Array.isArray(payload?.materials)
      ? payload.materials
      : Array.isArray(payload?.referenceMaterials)
        ? payload.referenceMaterials
        : Array.isArray(payload)
          ? payload
          : [];
    const materialSet = await normalizeReferenceMaterialsWithCustom(source, null, '');

    sendJson(response, 200, {
      referenceMaterials: materialSet.referenceMaterials,
      customBlocks: materialSet.customBlocks,
    });
    return true;
  }

  sendError(response, 404, 'custom block API not found');
  return true;
}

async function handleBuildingModuleRequest(request, response, url) {
  if (!url.pathname.startsWith('/api/building-module')) {
    return false;
  }

  if (request.method === 'POST' && url.pathname === '/api/building-module/resolve') {
    let payload = null;

    try {
      payload = await readRequestBody(request);
    } catch (error) {
      if (error.message === 'REQUEST_BODY_TOO_LARGE') {
        sendError(response, 413, 'building module request too large');
        return true;
      }

      sendError(response, 400, 'building module JSON invalid');
      return true;
    }

    const resolved = await resolveBuildingMaterialModule(payload, {
      referenceImage: normalizeReferenceImage(payload?.referenceImage),
      prompt: String(payload?.prompt ?? ''),
    });

    sendJson(response, 200, {
      blocks: Array.isArray(resolved.blocks) ? resolved.blocks : [],
      localBlocks: Array.isArray(resolved.localBlocks) ? resolved.localBlocks : [],
      referenceMaterials: resolved.referenceMaterials,
      customBlocks: resolved.customBlocks,
      meta: resolved.meta,
    });
    return true;
  }

  sendError(response, 404, 'building module API not found');
  return true;
}

async function handleApiRequest(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  const handledAuth = await handleAuthRequest(request, response, url);

  if (handledAuth) {
    return;
  }

  const handledProfile = await handleProfileRequest(request, response, url);

  if (handledProfile) {
    return;
  }

  const handledNpcChat = await handleNpcChatRequest(request, response, url);

  if (handledNpcChat) {
    return;
  }

  if (url.pathname === '/api/ai/building') {
    await handleAiRequest(request, response, url);
    return;
  }

  const handledCustomBlock = await handleCustomBlockRequest(request, response, url);

  if (handledCustomBlock) {
    return;
  }

  const handledBuildingModule = await handleBuildingModuleRequest(request, response, url);

  if (handledBuildingModule) {
    return;
  }

  const handledPlayerBuilding = await handlePlayerBuildingRequest(request, response, url);

  if (handledPlayerBuilding) {
    return;
  }

  await getAuthenticatedUser(request, { required: false });

  const collection = await getSaveCollection();
  const playerId = getPlayerId(request);

  if (request.method === 'GET' && url.pathname === '/api/saves') {
    const records = await collection
      .find({ playerId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    sendJson(response, 200, { records: records.map(normalizeRecord) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/saves') {
    let payload = null;

    try {
      payload = await readRequestBody(request);
    } catch (error) {
      if (error.message === 'REQUEST_BODY_TOO_LARGE') {
        sendError(response, 413, '保存数据太大，服务器拒绝写入。');
        return;
      }

      sendError(response, 400, '保存数据格式不是有效 JSON。');
      return;
    }

    const record = buildSaveRecord(payload, playerId);
    await collection.insertOne(record);
    sendJson(response, 201, { record: normalizeRecord(record) });
    return;
  }

  const saveMatch = url.pathname.match(/^\/api\/saves\/([^/]+)$/);

  if (request.method === 'GET' && saveMatch) {
    const record = await collection.findOne({
      id: decodeURIComponent(saveMatch[1]),
      playerId,
    });

    if (!record) {
      sendError(response, 404, '保存记录不存在。');
      return;
    }

    sendJson(response, 200, { record: normalizeRecord(record) });
    return;
  }

  sendError(response, 404, '接口不存在。');
}

async function handleAdminApiRequest(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, service: 'admin' });
    return;
  }

  if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/me') {
    const handledAuth = await handleAuthRequest(request, response, url);

    if (handledAuth) {
      return;
    }
  }

  const handledAdmin = await handleAdminRequest(request, response, url);

  if (handledAdmin) {
    return;
  }

  sendError(response, 404, '后台接口不存在。');
}

function isInside(parent, child) {
  const relativePath = relative(parent, child);

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

async function serveStatic(request, response, url) {
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = resolve(join(distRoot, requestedPath));

  if (!isInside(distRoot, filePath)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (!existsSync(filePath)) {
    filePath = resolve(join(distRoot, 'index.html'));
  }

  if (!existsSync(filePath)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('请先运行 npm run build 生成 dist。');
    return;
  }

  const extension = extname(filePath);
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}

function getAdminPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>three-mini-world 用户后台</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #edf6f4;
      background: #101418;
      font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { width: min(1080px, calc(100% - 32px)); margin: 24px auto; }
    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(237,246,244,.14);
    }
    h1 { margin: 0; font-size: 22px; }
    p { margin: 4px 0 0; color: rgba(237,246,244,.62); }
    section {
      margin-top: 16px;
      padding: 14px;
      border: 1px solid rgba(237,246,244,.14);
      border-radius: 8px;
      background: rgba(255,255,255,.045);
    }
    form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 10px; align-items: end; }
    label { display: grid; gap: 5px; color: rgba(237,246,244,.68); font-size: 12px; }
    input {
      min-height: 38px;
      padding: 0 10px;
      border: 1px solid rgba(237,246,244,.18);
      border-radius: 6px;
      color: #edf6f4;
      background: rgba(255,255,255,.08);
    }
    button {
      min-height: 38px;
      padding: 0 12px;
      border: 0;
      border-radius: 6px;
      color: #061218;
      background: #9de8ff;
      font-weight: 800;
      cursor: pointer;
    }
    button.secondary { color: #edf6f4; background: rgba(255,255,255,.1); }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 9px 8px; border-bottom: 1px solid rgba(237,246,244,.1); text-align: left; vertical-align: middle; }
    th { color: rgba(237,246,244,.62); font-size: 12px; font-weight: 700; }
    td code { color: #9de8ff; overflow-wrap: anywhere; }
    .actions { display: flex; gap: 6px; align-items: center; }
    .actions input { width: 92px; }
    .password-action input { width: 138px; }
    .status { min-height: 22px; color: #ffd87d; }
    .hidden { display: none; }
    @media (max-width: 760px) {
      form { grid-template-columns: 1fr; }
      table, thead, tbody, tr, th, td { display: block; }
      thead { display: none; }
      tr { padding: 10px 0; border-bottom: 1px solid rgba(237,246,244,.1); }
      td { border: 0; padding: 4px 0; }
      .actions { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>用户后台管理</h1>
        <p>独立管理端口：${ADMIN_PORT}。用户资产以 userId 作为唯一识别。</p>
      </div>
      <button class="secondary hidden" type="button" data-logout>退出</button>
    </header>

    <section data-login-section>
      <form data-login-form>
        <label>管理员用户名<input name="username" autocomplete="username" required></label>
        <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">登录后台</button>
      </form>
    </section>

    <section class="hidden" data-admin-section>
      <div class="actions">
        <button type="button" data-refresh>刷新用户</button>
        <span class="status" data-status></span>
      </div>
      <table>
        <thead>
          <tr>
            <th>昵称</th>
            <th>用户名</th>
            <th>用户ID</th>
            <th>角色</th>
            <th>金币</th>
            <th>管理</th>
          </tr>
        </thead>
        <tbody data-users></tbody>
      </table>
    </section>
  </main>
  <script>
    const TOKEN_KEY = 'three-mini-world-admin-token';
    const loginSection = document.querySelector('[data-login-section]');
    const adminSection = document.querySelector('[data-admin-section]');
    const logoutButton = document.querySelector('[data-logout]');
    const statusEl = document.querySelector('[data-status]');
    const usersEl = document.querySelector('[data-users]');

    function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
    function setToken(value) {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    }
    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token() ? { Authorization: 'Bearer ' + token() } : {}),
          ...(options.headers || {}),
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || '请求失败：' + response.status);
      return payload;
    }
    function showAdmin(isAdmin) {
      loginSection.classList.toggle('hidden', isAdmin);
      adminSection.classList.toggle('hidden', !isAdmin);
      logoutButton.classList.toggle('hidden', !isAdmin);
    }
    function row(user) {
      const coins = user.profile?.coins ?? 0;
      return '<tr>' +
        '<td>' + user.nickname + '</td>' +
        '<td>' + user.username + '</td>' +
        '<td><code>' + user.userId + '</code></td>' +
        '<td>' + user.role + '</td>' +
        '<td>' + coins + '</td>' +
        '<td><div class="actions">' +
          '<button type="button" data-delta="100" data-user="' + user.userId + '">+100</button>' +
          '<button type="button" data-delta="-100" data-user="' + user.userId + '">-100</button>' +
          '<input type="number" value="0" data-custom="' + user.userId + '">' +
          '<button type="button" data-apply="' + user.userId + '">应用</button>' +
          '<span class="actions password-action">' +
            '<input type="password" placeholder="新密码" minlength="6" autocomplete="new-password" data-password="' + user.userId + '">' +
            '<button type="button" data-password-apply="' + user.userId + '">改密码</button>' +
          '</span>' +
        '</div></td>' +
      '</tr>';
    }
    async function loadUsers() {
      statusEl.textContent = '正在读取...';
      const payload = await api('/api/admin/users');
      usersEl.innerHTML = payload.users.map(row).join('');
      statusEl.textContent = '共 ' + payload.users.length + ' 个用户';
    }
    async function changeCoins(userId, delta) {
      statusEl.textContent = '正在修改金币...';
      await api('/api/admin/users/coins', {
        method: 'POST',
        body: JSON.stringify({ userId, delta: Number(delta) || 0 }),
      });
      await loadUsers();
    }
    async function changePassword(userId, password) {
      statusEl.textContent = '正在修改密码...';
      await api('/api/admin/users/password', {
        method: 'POST',
        body: JSON.stringify({ userId, password }),
      });
      statusEl.textContent = '密码已修改';
      const input = usersEl.querySelector('[data-password="' + userId + '"]');
      if (input) input.value = '';
    }
    document.querySelector('[data-login-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      try {
        const payload = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            username: data.get('username'),
            password: data.get('password'),
          }),
        });
        if (payload.user?.role !== 'admin') throw new Error('当前用户不是管理员。');
        setToken(payload.token);
        showAdmin(true);
        await loadUsers();
      } catch (error) {
        alert(error.message);
      }
    });
    document.querySelector('[data-refresh]').addEventListener('click', () => loadUsers().catch((error) => {
      statusEl.textContent = error.message;
    }));
    logoutButton.addEventListener('click', () => {
      setToken('');
      showAdmin(false);
    });
    usersEl.addEventListener('click', (event) => {
      const deltaButton = event.target.closest('[data-delta]');
      if (deltaButton) {
        changeCoins(deltaButton.dataset.user, deltaButton.dataset.delta).catch((error) => {
          statusEl.textContent = error.message;
        });
        return;
      }
      const applyButton = event.target.closest('[data-apply]');
      if (applyButton) {
        const input = usersEl.querySelector('[data-custom="' + applyButton.dataset.apply + '"]');
        changeCoins(applyButton.dataset.apply, input?.value ?? 0).catch((error) => {
          statusEl.textContent = error.message;
        });
        return;
      }
      const passwordButton = event.target.closest('[data-password-apply]');
      if (passwordButton) {
        const input = usersEl.querySelector('[data-password="' + passwordButton.dataset.passwordApply + '"]');
        changePassword(passwordButton.dataset.passwordApply, input?.value ?? '').catch((error) => {
          statusEl.textContent = error.message;
        });
      }
    });
    if (token()) {
      api('/api/auth/me')
        .then((payload) => {
          if (payload.user?.role !== 'admin') throw new Error('当前用户不是管理员。');
          showAdmin(true);
          return loadUsers();
        })
        .catch(() => {
          setToken('');
          showAdmin(false);
        });
    }
  </script>
</body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  try {
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Player-Id, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      });
      response.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApiRequest(request, response, url);
      return;
    }

    await serveStatic(request, response, url);
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') {
      sendError(response, 401, '请先登录。');
      return;
    }

    log('error', 'Save server error.', { error });
    sendError(response, 500, '服务器保存服务出错，请检查 MongoDB 是否运行。');
  }
});

const adminServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  try {
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Player-Id, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      });
      response.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleAdminApiRequest(request, response, url);
      return;
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) {
      sendHtml(response, 200, getAdminPageHtml());
      return;
    }

    sendError(response, 404, '后台页面不存在。');
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') {
      sendError(response, 401, '请先登录管理员账号。');
      return;
    }

    log('error', 'Admin server error.', { error });
    sendError(response, 500, '后台服务出错，请检查 MongoDB 是否运行。');
  }
});

server.listen(PORT, () => {
  log('info', 'Server logging configured.', {
    level: LOG_LEVEL,
    levels: Object.keys(LOG_LEVELS),
    promptMaxChars: LOG_PROMPT_MAX_CHARS,
  });
  log('info', 'Save server listening.', { port: PORT, url: `http://127.0.0.1:${PORT}` });
  log('info', 'MongoDB candidates configured.', { mongoUrls: MONGO_URLS });
});

adminServer.listen(ADMIN_PORT, () => {
  log('info', 'Admin server listening.', { port: ADMIN_PORT, url: `http://127.0.0.1:${ADMIN_PORT}` });
});

async function shutdown() {
  server.close();
  adminServer.close();
  await mongoClient?.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
