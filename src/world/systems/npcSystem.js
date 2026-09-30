import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BLOCK_IDS, CHUNK_HEIGHT } from '../chunk.js';
import { requestJson } from '../saveStorage.js';
import { handleEditingKeydown } from '../utils/inputFocus.js';

const NPC_MODEL_LIBRARY = Object.freeze({
  fangkren: {
    url: '/assets/fangkren.glb',
    targetHeight: 1.58,
    forwardYawOffset: 0,
  },
  renwu: {
    url: '/assets/renwu.glb',
    targetHeight: 1.72,
    forwardYawOffset: 0,
  },
});

const NPC_EMOTIONS = Object.freeze([
  { id: 'mumble', label: '日常嘟囔', text: '今天的风向不错，日子慢慢过。', pitch: 0.95, rate: 0.92 },
  { id: 'sleepy', label: '发困', text: '哈啊，昨晚的火炉烧得太晚了。', pitch: 0.72, rate: 0.72 },
  { id: 'angry', label: '生气', text: '别踩坏路边的箱子，修起来很麻烦。', pitch: 0.82, rate: 1.18 },
  { id: 'dazed', label: '发呆', text: '嗯？我刚才想说什么来着。', pitch: 1.02, rate: 0.78 },
  { id: 'happy', label: '开心', text: '哈哈，村子今天看起来很精神。', pitch: 1.22, rate: 1.05 },
  { id: 'worried', label: '担忧', text: '远处的云压得很低，可能要变天。', pitch: 0.88, rate: 0.9 },
  { id: 'sad', label: '沮丧', text: '事情不太顺，但总要继续想办法。', pitch: 0.78, rate: 0.82 },
  { id: 'cry', label: '哭', text: '我需要一点时间缓过来。', pitch: 0.68, rate: 0.72 },
  { id: 'curious', label: '好奇', text: '你从哪里来的？这身装备挺少见。', pitch: 1.12, rate: 1.0 },
  { id: 'proud', label: '自豪', text: '我们村虽小，但每块石头都结实。', pitch: 1.0, rate: 0.86 },
]);

const NPC_CONFIGS = Object.freeze([
  {
    id: 'villager-ahe',
    model: 'fangkren',
    role: '村民',
    name: '阿禾',
    position: new THREE.Vector3(-3.2, 0, 4.2),
    yaw: Math.PI * 0.18,
    emotionOffset: 0,
    dialogue: [
      '欢迎来到这片小村。树林边的路不宽，走慢点更安全。',
      '最近雪地和洞穴都变多了，村里人白天会去巡一圈。',
      '如果你听见我嘟囔，那只是我在记今天要做的活。',
    ],
  },
  {
    id: 'merchant-linji',
    model: 'fangkren',
    role: '旅行商人',
    name: '林记',
    position: new THREE.Vector3(4.8, 0, 3.4),
    yaw: -Math.PI * 0.25,
    emotionOffset: 2,
    dialogue: [
      '要买工具、干粮，或者换点消息，都可以来找我。',
      '雪地里最好备一双厚靴，洞穴里最好备一盏灯。',
      '今天心情好，给熟人可以算便宜一点。',
    ],
  },
  {
    id: 'wanderer-xiaoan',
    model: 'renwu',
    role: '无业游民',
    name: '小安',
    position: new THREE.Vector3(-1.8, 0, 8.2),
    yaw: Math.PI * 0.9,
    emotionOffset: 5,
    dialogue: [
      '我还没有固定工作，正到处看看哪里缺人。',
      '如果仓库或田地缺帮手，我可以先去学一学。',
      '有跑腿的小事也可以叫我，至少我认路。',
    ],
  },
  {
    id: 'artisan-tieshan',
    model: 'fangkren',
    role: '工匠',
    name: '铁山',
    position: new THREE.Vector3(1.8, 0, -5.6),
    yaw: Math.PI * 0.7,
    emotionOffset: 4,
    dialogue: [
      '我负责修桥、补墙，也修那些被冒险者踩坏的箱子。',
      '洞穴石很硬，敲的时候要顺着纹理来。',
      '你要是找到好矿石，带回来，我能打成趁手的东西。',
    ],
  },
  {
    id: 'soldier-lanwei',
    model: 'fangkren',
    role: '士兵',
    name: '岚卫',
    position: new THREE.Vector3(-6.4, 0, -2.4),
    yaw: Math.PI * 0.42,
    emotionOffset: 6,
    dialogue: [
      '夜里别独自进洞，里面回声会骗方向。',
      '我会守住村口。你要出去，先看清脚下的地形。',
      '听见岩浆声就后退，别想着跳过去。',
    ],
  },
  {
    id: 'chief-baishi',
    model: 'fangkren',
    role: '村长',
    name: '白石',
    position: new THREE.Vector3(7.2, 0, -4.2),
    yaw: -Math.PI * 0.58,
    emotionOffset: 1,
    dialogue: [
      '我是白石，这个村子的村长。',
      '村民、商人、工匠和士兵各司其职，你可以逐个问问。',
      '如果世界继续扩张，我们会把更多岗位和任务记录进村册。',
    ],
  },
]);

const NPC_SPEECH_DISTANCE = 2;
const INTERACTION_DISTANCE = NPC_SPEECH_DISTANCE;
const NPC_PROXIMITY_PAUSE_DISTANCE = 2;
const NPC_PROXIMITY_RESUME_DISTANCE = 2.45;
const EMOTION_INTERVAL_SECONDS = 9;
const BEHAVIOR_TICK_SECONDS = 5;
const PATH_STUCK_CHECK_SECONDS = 5;
const PATH_STUCK_DISTANCE = 0.16;
const PATH_NODE_LIMIT = 260;
const PATH_MAX_SEARCH_DISTANCE = 58;
const NPC_WALK_SPEED = 1.45;
const NPC_RUN_SPEED = 2.15;
const NPC_TARGET_REACHED_DISTANCE = 0.7;
const NPC_WAYPOINT_REACHED_DISTANCE = 0.38;
const NPC_SAFE_STEP_HEIGHT = 3;
const NPC_ELEVATOR_SPEED = 8.5;
const NPC_ELEVATOR_VERTICAL_THRESHOLD = 3.2;
const NPC_ELEVATOR_HORIZONTAL_RANGE = 4.5;
const NPC_SOCIAL_DISTANCE = 5.5;
const NPC_RENDER_HALF_EXTENT = 16;
const NPC_NEED_GAIN = Object.freeze({
  hunger: 0.0018,
  fatigue: 0.0014,
});
const TRAVELER_CHUNK_INTERVAL = 10;
const TRAVELER_MIN_NPC_DISTANCE = 4.2;
const TRAVELER_SPAWN_ATTEMPTS = 36;
const NPC_COLLISION_RADIUS = 0.38;
const NPC_MASS = 68;
const NPC_IMPACT_TRANSFER = 0.52;
const NPC_KNOCKDOWN_SPEED = 6.8;
const NPC_KNOCKDOWN_SECONDS = 1.4;
const NPC_FRICTION = 5.8;
const NPC_STOP_EPSILON = 0.02;
const WALKABLE_BLOCKS = new Set([BLOCK_IDS.AIR, BLOCK_IDS.WATER_FLOW_DECOR]);
const HAZARD_BLOCKS = new Set([BLOCK_IDS.LAVA, BLOCK_IDS.TNT]);

// Role behavior tree templates. Runtime selection below is driven by the
// world-time schedule so roles do not rapidly cycle through every task.
const ROLE_BEHAVIOR_TREES = Object.freeze({
  chief: {
    label: '村长',
    priority: ['安全', '村庄管理', '玩家任务', '社交娱乐', '情绪', '返回默认位置'],
    roleTasks: [
      { id: 'patrol-safety', label: '巡查村庄安全', target: 'watch-post', emotion: 'proud' },
      { id: 'inspect-fields', label: '检查农田', target: 'fields', emotion: 'worried' },
      { id: 'inspect-warehouse', label: '检查仓库', target: 'warehouse', emotion: 'worried' },
      { id: 'assign-work', label: '分配村民工作', target: 'village-square', emotion: 'proud' },
      { id: 'issue-quest', label: '发布任务/悬赏', target: 'village-center', emotion: 'curious' },
      { id: 'resolve-dispute', label: '处理纠纷', target: 'homes', emotion: 'angry' },
    ],
    socialTasks: [
      { id: 'meeting', label: '参加集会', target: 'theatre', emotion: 'happy' },
      { id: 'talk', label: '与村民谈话', target: 'homes', emotion: 'happy' },
      { id: 'rest', label: '回家休息', target: 'homes', emotion: 'sleepy' },
    ],
  },
  villager: {
    label: '村民',
    priority: ['安全', '基础需求', '工作生产', '社交', '娱乐', '情绪'],
    roleTasks: [
      { id: 'wake', label: '起床', target: 'homes', emotion: 'mumble' },
      { id: 'eat', label: '吃饭', target: 'dining', emotion: 'happy' },
      { id: 'go-work', label: '去工作点', target: 'fields', emotion: 'proud' },
      { id: 'harvest', label: '种植/收割', target: 'fields', emotion: 'happy' },
      { id: 'carry', label: '搬运物资', target: 'warehouse', emotion: 'proud' },
      { id: 'return-home', label: '回家', target: 'homes', emotion: 'sleepy' },
    ],
    socialTasks: [
      { id: 'chat', label: '和村民聊天', target: 'village-square', emotion: 'happy' },
      { id: 'report', label: '向村长汇报', target: 'village-center', emotion: 'proud' },
      { id: 'food', label: '吃美食', target: 'food-street', emotion: 'happy' },
      { id: 'story', label: '听故事', target: 'theatre', emotion: 'curious' },
    ],
  },
  artisan: {
    label: '工匠',
    priority: ['安全', '订单制造', '修理村庄', '交易', '研究'],
    roleTasks: [
      { id: 'orders', label: '检查订单', target: 'craft-station', emotion: 'curious' },
      { id: 'materials', label: '寻找材料', target: 'warehouse', emotion: 'worried' },
      { id: 'bench', label: '使用工具台/锻炉/压力机', target: 'craft-station', emotion: 'proud' },
      { id: 'craft', label: '制作工具/武器/建筑件', target: 'craft-station', emotion: 'happy' },
      { id: 'repair', label: '修门/桥/房屋', target: 'village-square', emotion: 'proud' },
      { id: 'defense', label: '加固防御', target: 'watch-post', emotion: 'angry' },
    ],
    socialTasks: [
      { id: 'sell-tools', label: '出售工具', target: 'market', emotion: 'happy' },
      { id: 'research', label: '解锁新配方', target: 'craft-station', emotion: 'curious' },
    ],
  },
  unemployed: {
    label: '无业游民',
    priority: ['安全', '找工作', '求助/跑腿', '闲逛娱乐', '情绪'],
    roleTasks: [
      { id: 'wander', label: '在村庄闲逛', target: 'village-square', emotion: 'mumble' },
      { id: 'observe', label: '观察他人工作', target: 'fields', emotion: 'curious' },
      { id: 'find-job', label: '发现空工作点', target: 'craft-station', emotion: 'curious' },
      { id: 'learn', label: '学习职业', target: 'warehouse', emotion: 'proud' },
      { id: 'errand', label: '接受跑腿任务', target: 'market', emotion: 'happy' },
    ],
    socialTasks: [
      { id: 'ask-food', label: '向玩家索要食物', target: 'dining', emotion: 'worried' },
      { id: 'rumor', label: '提供传闻', target: 'bar', emotion: 'curious' },
      { id: 'bar', label: '去酒吧', target: 'bar', emotion: 'happy' },
    ],
  },
  traveler: {
    label: '旅行者',
    priority: ['安全', '旅行探索', '游玩', '信息交换', '临时工作'],
    roleTasks: [
      { id: 'destination', label: '选择目的地', target: 'mountain-view', emotion: 'curious' },
      { id: 'map', label: '查看地图', target: 'village-center', emotion: 'curious' },
      { id: 'sight', label: '前往景点/遗迹/山川', target: 'mountain-view', emotion: 'happy' },
      { id: 'notes', label: '记录见闻', target: 'inn', emotion: 'proud' },
      { id: 'souvenir', label: '收集纪念品', target: 'market', emotion: 'happy' },
    ],
    socialTasks: [
      { id: 'food', label: '吃当地美食', target: 'food-street', emotion: 'happy' },
      { id: 'story', label: '听村庄故事', target: 'theatre', emotion: 'curious' },
      { id: 'route', label: '询问安全路线', target: 'watch-post', emotion: 'worried' },
    ],
  },
  travelingMerchant: {
    label: '旅行商人',
    priority: ['安全', '交易', '路线经营', '补货', '娱乐'],
    roleTasks: [
      { id: 'rare-elements', label: '交易稀有元素', target: 'market', emotion: 'happy' },
      { id: 'resource-coords', label: '交易稀有资源坐标', target: 'village-center', emotion: 'curious' },
      { id: 'rare-tools', label: '交易稀有工具', target: 'craft-station', emotion: 'proud' },
      { id: 'local-goods', label: '收购当地特产', target: 'food-street', emotion: 'happy' },
      { id: 'next-route', label: '选择下一个村庄', target: 'inn', emotion: 'curious' },
      { id: 'restock', label: '补充货物', target: 'warehouse', emotion: 'proud' },
    ],
    socialTasks: [
      { id: 'bar', label: '去酒吧', target: 'bar', emotion: 'happy' },
      { id: 'view', label: '看风景', target: 'mountain-view', emotion: 'curious' },
    ],
  },
});

const TRAVELER_NAMES = Object.freeze([
  '云岚',
  '南星',
  '河朔',
  '青砾',
  '望川',
  '栗原',
  '石舟',
  '白露',
]);

const TRAVELER_DIALOGUES = Object.freeze([
  [
    '我沿着水声走到这里，没想到这片地形变化这么快。',
    '旅行最重要的是记路，其次是别在夜里逞强。',
    '如果你也要远行，先看看天气和脚下的方块。',
  ],
  [
    '我从雪地那边过来，靴底现在还在发冷。',
    '这附近的洞穴回声很重，最好留个醒目的标记。',
    '村子不大，但能补给的地方已经够用了。',
  ],
  [
    '我在找一条绕开岩浆的路，直线通常不是最安全的。',
    '风向变了，远处可能会下雨。',
    '你要是发现新的高地，可以在那里看完整片地图。',
  ],
]);

const boundsBox = new THREE.Box3();
const boundsCenter = new THREE.Vector3();
const boundsSize = new THREE.Vector3();
const projectedPosition = new THREE.Vector3();
const combatBoxCenter = new THREE.Vector3();

function configureNpcMesh(object) {
  if (!object.isMesh) {
    return;
  }

  object.castShadow = true;
  object.receiveShadow = true;
  object.frustumCulled = false;
}

function normalizeModel(model, targetHeight) {
  model.updateMatrixWorld(true);
  boundsBox.setFromObject(model);
  boundsBox.getCenter(boundsCenter);
  boundsBox.getSize(boundsSize);

  const height = Math.max(boundsSize.y, 0.001);
  const scale = targetHeight / height;

  model.scale.setScalar(scale);
  model.position.set(
    -boundsCenter.x * scale,
    -boundsBox.min.y * scale,
    -boundsCenter.z * scale,
  );
  model.traverse(configureNpcMesh);

  return targetHeight;
}

function createFallbackNpcModel() {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x597c6a, roughness: 0.75 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0xc79a73, roughness: 0.7 });
  const hatMaterial = new THREE.MeshStandardMaterial({ color: 0x2f3d43, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.9, 0.36), bodyMaterial);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), headMaterial);
  const hat = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.16, 0.54), hatMaterial);

  body.position.y = 0.72;
  head.position.y = 1.42;
  hat.position.y = 1.72;
  group.add(body, head, hat);
  group.traverse(configureNpcMesh);

  return group;
}

function createLabelElement(npc) {
  const label = document.createElement('div');
  label.className = 'npc-label';
  label.innerHTML = `
    <div class="npc-label__role">${npc.config.role}</div>
    <div class="npc-label__name">${npc.config.name}</div>
    <div class="npc-label__emotion" data-npc-emotion>${npc.emotion.label}</div>
    <div class="npc-label__behavior" data-npc-behavior>${npc.behavior?.label ?? '待命'}</div>
    <div class="npc-label__hint">L / B</div>
  `;

  return label;
}

function createDialogueElement() {
  const panel = document.createElement('section');
  panel.className = 'npc-dialogue';
  panel.setAttribute('aria-label', 'NPC 对话');
  panel.innerHTML = `
    <div class="npc-dialogue__meta">
      <span data-dialogue-role>--</span>
      <strong data-dialogue-name>--</strong>
      <em data-dialogue-emotion>--</em>
    </div>
    <div class="npc-dialogue__log" data-dialogue-log></div>
    <form class="npc-dialogue__form" data-dialogue-form>
      <input type="text" maxlength="160" placeholder="输入想问 NPC 的话" data-dialogue-input>
      <button type="submit">发送</button>
    </form>
    <div class="npc-dialogue__footer">
      <span>L 聊天</span>
      <span>B 与商人交易</span>
      <span>Esc 关闭</span>
    </div>
  `;

  return panel;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getHorizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function getChunkHash(chunkCoord) {
  return (
    Math.imul(chunkCoord.x, 73856093) ^
    Math.imul(chunkCoord.z, 19349663) ^
    0x9e3779b9
  ) >>> 0;
}

function createSeededRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;

    return state / 0x100000000;
  };
}

function isFarFromPositions(position, positions, minDistance) {
  return positions.every((otherPosition) => getHorizontalDistance(position, otherPosition) >= minDistance);
}

function getTravelerTargetCount(loadedChunkCount) {
  if (loadedChunkCount <= 0) {
    return 0;
  }

  return Math.max(1, Math.floor(loadedChunkCount / TRAVELER_CHUNK_INTERVAL));
}

function getRoleKey(role) {
  if (role === '村长') return 'chief';
  if (role === '工匠') return 'artisan';
  if (role === '无业游民') return 'unemployed';
  if (role === '旅行者') return 'traveler';
  if (role === '旅行商人' || role === '商人') return 'travelingMerchant';

  return 'villager';
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function gridKey(x, z) {
  return `${x},${z}`;
}

function parseGridKey(key) {
  const [x, z] = key.split(',').map(Number);

  return { x, z };
}

function getNearestNpc(npc, npcs, maxDistance = NPC_SOCIAL_DISTANCE) {
  let nearest = null;
  let nearestDistance = maxDistance;

  for (const otherNpc of npcs) {
    if (otherNpc === npc || otherNpc.config.dynamicTraveler !== npc.config.dynamicTraveler) {
      continue;
    }

    const distance = getHorizontalDistance(npc.root.position, otherNpc.root.position);

    if (distance < nearestDistance) {
      nearest = otherNpc;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function getClockHours(timeState) {
  return ((timeState?.normalizedDay ?? 0.5) * 24) % 24;
}

function isNight(timeState) {
  const stageId = timeState?.stage?.id;

  if (stageId) {
    return stageId === 'night' || stageId === 'preDawn';
  }

  const hours = getClockHours(timeState);

  return hours >= 20 || hours < 5;
}

function getScheduleSlot(timeState) {
  const hours = getClockHours(timeState);

  if (hours >= 5 && hours < 7) return 'wake';
  if (hours >= 7 && hours < 9) return 'breakfast';
  if (hours >= 9 && hours < 12) return 'morningWork';
  if (hours >= 12 && hours < 14) return 'lunch';
  if (hours >= 14 && hours < 17) return 'afternoonWork';
  if (hours >= 17 && hours < 20) return 'tradeSocial';
  if (hours >= 20 && hours < 23) return 'entertainment';

  return 'sleep';
}

function getScheduledRoleTask(roleKey, scheduleSlot) {
  const schedule = {
    chief: {
      wake: { id: 'chief-wake', label: '回家整理村务', category: '村庄管理', target: 'homes', emotion: 'mumble' },
      breakfast: { id: 'chief-breakfast', label: '接待早餐村民', category: '村庄管理', target: 'dining', emotion: 'curious' },
      morningWork: { id: 'chief-safety', label: '巡查村庄安全', category: '村庄管理', target: 'watch-post', emotion: 'proud' },
      lunch: { id: 'chief-lunch', label: '在吃饭点听取汇报', category: '村庄管理', target: 'dining', emotion: 'curious' },
      afternoonWork: { id: 'chief-inspect', label: '检查农田/房屋/仓库', category: '村庄管理', target: 'warehouse', emotion: 'worried' },
      tradeSocial: { id: 'chief-quests', label: '发布任务/悬赏', category: '玩家任务', target: 'village-square', emotion: 'proud' },
      entertainment: { id: 'chief-meeting', label: '参加集会', category: '社交娱乐', target: 'theatre', emotion: 'happy' },
      sleep: { id: 'chief-sleep', label: '回家休息', category: '基础需求', target: 'homes', emotion: 'sleepy' },
    },
    villager: {
      wake: { id: 'villager-wake', label: '起床', category: '日常生活', target: 'homes', emotion: 'mumble' },
      breakfast: { id: 'villager-breakfast', label: '吃饭', category: '基础需求', target: 'dining', emotion: 'happy' },
      morningWork: { id: 'villager-fields', label: '工作生产: 去田地', category: '工作生产', target: 'fields', emotion: 'proud' },
      lunch: { id: 'villager-lunch', label: '午饭: 吃饭点', category: '基础需求', target: 'dining', emotion: 'happy' },
      afternoonWork: { id: 'villager-harvest', label: '种植/收割', category: '工作生产', target: 'fields', emotion: 'happy' },
      tradeSocial: { id: 'villager-store', label: '搬运物资入仓库', category: '工作生产', target: 'warehouse', emotion: 'proud' },
      entertainment: { id: 'villager-bar', label: '娱乐: 去酒吧', category: '娱乐', target: 'bar', emotion: 'happy' },
      sleep: { id: 'villager-home', label: '回家睡觉', category: '基础需求', target: 'homes', emotion: 'sleepy' },
    },
    artisan: {
      wake: { id: 'artisan-wake', label: '整理工具', category: '制造修理', target: 'craft-station', emotion: 'mumble' },
      breakfast: { id: 'artisan-breakfast', label: '吃饭', category: '基础需求', target: 'dining', emotion: 'happy' },
      morningWork: { id: 'artisan-craft', label: '订单制造: 使用工具台', category: '订单制造', target: 'craft-station', emotion: 'proud' },
      lunch: { id: 'artisan-lunch', label: '午饭: 美食街', category: '基础需求', target: 'food-street', emotion: 'happy' },
      afternoonWork: { id: 'artisan-repair', label: '修理村庄设施', category: '修理村庄', target: 'village-square', emotion: 'proud' },
      tradeSocial: { id: 'artisan-market', label: '交易工具和建材', category: '交易', target: 'market', emotion: 'happy' },
      entertainment: { id: 'artisan-bar', label: '娱乐: 去酒吧', category: '娱乐', target: 'bar', emotion: 'happy' },
      sleep: { id: 'artisan-home', label: '回家休息', category: '基础需求', target: 'homes', emotion: 'sleepy' },
    },
    unemployed: {
      wake: { id: 'unemployed-wake', label: '在村庄闲逛', category: '闲逛娱乐', target: 'village-square', emotion: 'mumble' },
      breakfast: { id: 'unemployed-food', label: '求助: 找食物', category: '求助/跑腿', target: 'dining', emotion: 'worried' },
      morningWork: { id: 'unemployed-observe', label: '观察田地工作', category: '找工作', target: 'fields', emotion: 'curious' },
      lunch: { id: 'unemployed-lunch', label: '在美食街找机会', category: '求助/跑腿', target: 'food-street', emotion: 'curious' },
      afternoonWork: { id: 'unemployed-learn', label: '学习职业: 靠近工作点', category: '找工作', target: 'craft-station', emotion: 'proud' },
      tradeSocial: { id: 'unemployed-errand', label: '接受跑腿任务', category: '求助/跑腿', target: 'market', emotion: 'happy' },
      entertainment: { id: 'unemployed-bar', label: '娱乐: 去酒吧', category: '娱乐', target: 'bar', emotion: 'happy' },
      sleep: { id: 'unemployed-rest', label: '回村民家借宿', category: '基础需求', target: 'homes', emotion: 'sleepy' },
    },
    traveler: {
      wake: { id: 'traveler-inn-wake', label: '旅游住宿: 旅店起床', category: '旅行探索', target: 'inn', emotion: 'mumble' },
      breakfast: { id: 'traveler-breakfast', label: '吃当地早餐', category: '游玩', target: 'food-street', emotion: 'happy' },
      morningWork: { id: 'traveler-sight', label: '旅行探索: 前往景点', category: '旅行探索', target: 'mountain-view', emotion: 'curious' },
      lunch: { id: 'traveler-food', label: '游玩: 吃当地美食', category: '游玩', target: 'food-street', emotion: 'happy' },
      afternoonWork: { id: 'traveler-notes', label: '记录见闻/坐标', category: '旅行探索', target: 'inn', emotion: 'proud' },
      tradeSocial: { id: 'traveler-info', label: '信息交换: 询问路线', category: '信息交换', target: 'market', emotion: 'curious' },
      entertainment: { id: 'traveler-story', label: '听村庄故事', category: '游玩', target: 'theatre', emotion: 'happy' },
      sleep: { id: 'traveler-lodge', label: '旅游住宿: 回旅店', category: '基础需求', target: 'inn', emotion: 'sleepy' },
    },
    travelingMerchant: {
      wake: { id: 'merchant-wake', label: '路线经营: 整理货单', category: '路线经营', target: 'inn', emotion: 'mumble' },
      breakfast: { id: 'merchant-breakfast', label: '补给早餐', category: '补货', target: 'food-street', emotion: 'happy' },
      morningWork: { id: 'merchant-market', label: '交易: 市场摆摊', category: '交易', target: 'market', emotion: 'happy' },
      lunch: { id: 'merchant-food-street', label: '交易: 美食街收购特产', category: '交易', target: 'food-street', emotion: 'happy' },
      afternoonWork: { id: 'merchant-restock', label: '补货: 仓库整理货物', category: '补货', target: 'warehouse', emotion: 'proud' },
      tradeSocial: { id: 'merchant-deals', label: '交易稀有元素/资源坐标', category: '交易', target: 'market', emotion: 'curious' },
      entertainment: { id: 'merchant-bar', label: '娱乐: 去酒吧', category: '娱乐', target: 'bar', emotion: 'happy' },
      sleep: { id: 'merchant-inn', label: '旅行住宿: 回旅店', category: '基础需求', target: 'inn', emotion: 'sleepy' },
    },
  };

  return schedule[roleKey]?.[scheduleSlot] ?? schedule.villager[scheduleSlot] ?? schedule.villager.morningWork;
}

function isFluidOrHazard(blockId) {
  return blockId === BLOCK_IDS.WATER || blockId === BLOCK_IDS.LAVA || HAZARD_BLOCKS.has(blockId);
}

function isStandableSurfaceBlock(blockId) {
  return (
    blockId !== BLOCK_IDS.AIR &&
    blockId !== BLOCK_IDS.WATER &&
    blockId !== BLOCK_IDS.LAVA &&
    blockId !== BLOCK_IDS.WATER_FLOW_DECOR &&
    !HAZARD_BLOCKS.has(blockId)
  );
}

function isOpenAboveSurface(worldManager, x, y, z) {
  const feetBlock = worldManager.getBlockAtIfLoaded(x, y + 1, z);
  const headBlock = worldManager.getBlockAtIfLoaded(x, y + 2, z);

  return (
    !isFluidOrHazard(feetBlock) &&
    !isFluidOrHazard(headBlock) &&
    WALKABLE_BLOCKS.has(feetBlock) &&
    WALKABLE_BLOCKS.has(headBlock)
  );
}

function getWalkableSurfaceY(worldManager, x, z, preferredBodyY = null) {
  const gridX = Math.round(x);
  const gridZ = Math.round(z);
  const preferredSurfaceY = Number.isFinite(preferredBodyY)
    ? Math.round(preferredBodyY - 0.52)
    : null;

  if (preferredSurfaceY !== null) {
    for (let offset = 0; offset <= 2; offset += 1) {
      const candidates = offset === 0
        ? [preferredSurfaceY]
        : [preferredSurfaceY - offset, preferredSurfaceY + offset];

      for (const y of candidates) {
        if (y < 0 || y >= CHUNK_HEIGHT - 2) {
          continue;
        }

        const surfaceBlock = worldManager.getBlockAtIfLoaded(gridX, y, gridZ);

        if (isStandableSurfaceBlock(surfaceBlock) && isOpenAboveSurface(worldManager, gridX, y, gridZ)) {
          return y;
        }
      }
    }
  }

  for (let y = CHUNK_HEIGHT - 3; y >= 0; y -= 1) {
    const surfaceBlock = worldManager.getBlockAtIfLoaded(gridX, y, gridZ);

    if (isStandableSurfaceBlock(surfaceBlock) && isOpenAboveSurface(worldManager, gridX, y, gridZ)) {
      return y;
    }
  }

  return null;
}

function isWalkableColumn(worldManager, x, z, preferredBodyY = null) {
  const surfaceY = getWalkableSurfaceY(worldManager, x, z, preferredBodyY);

  return surfaceY;
}

function isNpcStandingSpaceOpen(worldManager, position) {
  const x = Math.round(position.x);
  const z = Math.round(position.z);
  const feetY = Math.floor(position.y + 0.48);
  const headY = feetY + 1;

  return (
    WALKABLE_BLOCKS.has(worldManager.getBlockAtIfLoaded(x, feetY, z)) &&
    WALKABLE_BLOCKS.has(worldManager.getBlockAtIfLoaded(x, headY, z))
  );
}

function findNearbyNpcOpenPosition(worldManager, position) {
  if (isNpcStandingSpaceOpen(worldManager, position)) {
    return null;
  }

  const baseX = Math.round(position.x);
  const baseZ = Math.round(position.z);

  for (let radius = 1; radius <= 5; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) {
          continue;
        }

        const surfaceY = isWalkableColumn(worldManager, baseX + dx, baseZ + dz, position.y);

        if (surfaceY !== null) {
          return new THREE.Vector3(baseX + dx, surfaceY + 0.52, baseZ + dz);
        }
      }
    }
  }

  return null;
}

function getPathNodeScore(node, goal) {
  return Math.abs(node.x - goal.x) + Math.abs(node.z - goal.z);
}

function reconstructPath(cameFrom, currentKey, worldManager) {
  const path = [];

  while (currentKey) {
    const { x, z } = parseGridKey(currentKey);
    const y = getWalkableSurfaceY(worldManager, x, z);

    if (y !== null && y !== undefined) {
      path.push(new THREE.Vector3(x, y + 0.52, z));
    }

    currentKey = cameFrom.get(currentKey);
  }

  return path.reverse();
}

function findPath(worldManager, startPosition, targetPosition) {
  const start = {
    x: Math.round(startPosition.x),
    z: Math.round(startPosition.z),
  };
  const goal = {
    x: Math.round(targetPosition.x),
    z: Math.round(targetPosition.z),
  };
  const startKey = gridKey(start.x, start.z);
  const goalKey = gridKey(goal.x, goal.z);

  if (startKey === goalKey) {
    return [targetPosition.clone()];
  }

  if (Math.hypot(goal.x - start.x, goal.z - start.z) > PATH_MAX_SEARCH_DISTANCE) {
    return [targetPosition.clone()];
  }

  const open = new Map([[startKey, start]]);
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const fScore = new Map([[startKey, getPathNodeScore(start, goal)]]);
  let visited = 0;
  let bestKey = startKey;
  let bestDistance = getPathNodeScore(start, goal);

  while (open.size > 0 && visited < PATH_NODE_LIMIT) {
    let currentKey = null;
    let current = null;
    let currentScore = Infinity;

    for (const [key, node] of open) {
      const score = fScore.get(key) ?? Infinity;

      if (score < currentScore) {
        currentScore = score;
        currentKey = key;
        current = node;
      }
    }

    if (!currentKey || !current) {
      break;
    }

    if (currentKey === goalKey) {
      return reconstructPath(cameFrom, currentKey, worldManager);
    }

    open.delete(currentKey);
    visited += 1;

    const currentSurfaceY = isWalkableColumn(worldManager, current.x, current.z);

    if (currentSurfaceY === null) {
      continue;
    }
    const currentSurfaceBlock = worldManager.getBlockAtIfLoaded(current.x, currentSurfaceY, current.z);

    const neighbors = [
      { x: current.x + 1, z: current.z },
      { x: current.x - 1, z: current.z },
      { x: current.x, z: current.z + 1 },
      { x: current.x, z: current.z - 1 },
    ];

    for (const neighbor of neighbors) {
      const neighborKey = gridKey(neighbor.x, neighbor.z);
      const neighborSurfaceY = isWalkableColumn(worldManager, neighbor.x, neighbor.z);
      const neighborSurfaceBlock = neighborSurfaceY === null
        ? BLOCK_IDS.AIR
        : worldManager.getBlockAtIfLoaded(neighbor.x, neighborSurfaceY, neighbor.z);
      const isBridgeConnection =
        currentSurfaceBlock === BLOCK_IDS.STONE_SLAB ||
        neighborSurfaceBlock === BLOCK_IDS.STONE_SLAB;

      if (
        neighborSurfaceY === null ||
        (!isBridgeConnection && Math.abs(neighborSurfaceY - currentSurfaceY) > NPC_SAFE_STEP_HEIGHT)
      ) {
        continue;
      }

      const tentativeGScore = (gScore.get(currentKey) ?? Infinity) + 1 + Math.abs(neighborSurfaceY - currentSurfaceY) * 0.7;

      if (tentativeGScore >= (gScore.get(neighborKey) ?? Infinity)) {
        continue;
      }

      cameFrom.set(neighborKey, currentKey);
      gScore.set(neighborKey, tentativeGScore);
      fScore.set(neighborKey, tentativeGScore + getPathNodeScore(neighbor, goal));
      open.set(neighborKey, neighbor);

      const distance = getPathNodeScore(neighbor, goal);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestKey = neighborKey;
      }
    }
  }

  const partialPath = reconstructPath(cameFrom, bestKey, worldManager);

  return partialPath.length ? partialPath : [targetPosition.clone()];
}

function stitchPath(worldManager, startPosition, routePoints) {
  const stitchedPath = [];
  let segmentStart = startPosition;

  routePoints.forEach((point) => {
    const segment = findPath(worldManager, segmentStart, point);

    if (stitchedPath.length > 0 && segment.length > 0) {
      segment.shift();
    }

    stitchedPath.push(...segment);
    segmentStart = point;
  });

  return stitchedPath;
}

function getTravelerPositionInChunk(entity, occupiedPositions) {
  const { chunk, chunkCoord, surfaceHeights } = entity;
  const random = createSeededRandom(getChunkHash(chunkCoord));

  for (let attempt = 0; attempt < TRAVELER_SPAWN_ATTEMPTS; attempt += 1) {
    const localX = 1 + Math.floor(random() * Math.max(1, chunk.size.x - 2));
    const localZ = 1 + Math.floor(random() * Math.max(1, chunk.size.z - 2));
    const surfaceY = surfaceHeights[chunk.getColumnIndex(localX, localZ)];
    const surfaceBlock = chunk.getBlock(localX, surfaceY, localZ);
    const blockAbove = chunk.getBlock(localX, surfaceY + 1, localZ);
    const position = new THREE.Vector3(
      chunk.position.x + localX - (chunk.size.x - 1) / 2,
      0,
      chunk.position.z + localZ - (chunk.size.z - 1) / 2,
    );

    if (
      surfaceBlock === BLOCK_IDS.AIR ||
      surfaceBlock === BLOCK_IDS.WATER ||
      surfaceBlock === BLOCK_IDS.LAVA ||
      blockAbove !== BLOCK_IDS.AIR ||
      !isFarFromPositions(position, occupiedPositions, TRAVELER_MIN_NPC_DISTANCE)
    ) {
      continue;
    }

    return position;
  }

  return null;
}

export class NpcSystem {
  constructor({
    scene,
    camera,
    container,
    eventBus,
    worldManager,
    player,
    villageSystem = null,
    configs = NPC_CONFIGS,
    modelLibrary = NPC_MODEL_LIBRARY,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.container = container;
    this.eventBus = eventBus;
    this.worldManager = worldManager;
    this.player = player;
    this.villageSystem = villageSystem;
    this.configs = configs;
    this.modelLibrary = modelLibrary;
    this.loader = new GLTFLoader();
    this.modelCache = new Map();
    this.modelLoadPromises = new Map();
    this.travelersByChunkKey = new Map();
    this.npcs = [];
    this.elapsedTime = 0;
    this.nearestNpc = null;
    this.activeNpc = null;
    this.activeVoiceNpc = null;
    this.dialogueIndex = 0;
    this.chatHistories = new Map();
    this.isChatPending = false;
    this.isDisposed = false;
    this.timeState = null;
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'npc-label-layer';
    this.dialoguePanel = createDialogueElement();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onDialogueSubmit = this.onDialogueSubmit.bind(this);

    this.unsubscribe = [
      eventBus.on('time:update', (timeState) => {
        this.timeState = timeState;
      }),
      eventBus.on('npc:interaction:start', ({ npc, reason = 'interaction', label = '与玩家互动' } = {}) => {
        this.pauseNpcInteraction(npc, reason, label);
      }),
      eventBus.on('npc:interaction:end', ({ npc, reason = 'interaction' } = {}) => {
        this.resumeNpcInteraction(npc, reason);
      }),
      eventBus.on('npc:hiring:start', (payload) => this.startNpcHiring(payload)),
      eventBus.on('npc:hiring:progress', (payload) => this.updateNpcHiringProgress(payload)),
      eventBus.on('npc:hiring:end', (payload) => this.endNpcHiring(payload)),
    ];

    this.container.append(this.labelLayer, this.dialoguePanel);
    this.dialoguePanel.querySelector('[data-dialogue-form]')?.addEventListener('submit', this.onDialogueSubmit);
    window.addEventListener('keydown', this.onKeyDown);
    this.loadNpcs();
  }

  loadNpcs() {
    const modelIds = [...new Set(this.configs.map((config) => config.model))];

    this.configs.forEach((config) => this.createNpc(config, true));
    modelIds.forEach((modelId) => this.ensureModelLoaded(modelId).catch(() => {}));
  }

  loadModel(modelId) {
    const modelConfig = this.modelLibrary[modelId];

    if (!modelConfig) {
      return Promise.reject(new Error(`Unknown NPC model: ${modelId}`));
    }

    return new Promise((resolve, reject) => {
      this.loader.load(
        modelConfig.url,
        (gltf) => {
          this.modelCache.set(modelId, gltf.scene);
          resolve(gltf.scene);
        },
        undefined,
        reject,
      );
    });
  }

  ensureModelLoaded(modelId) {
    if (this.modelCache.has(modelId)) {
      return Promise.resolve(this.modelCache.get(modelId));
    }

    if (this.modelLoadPromises.has(modelId)) {
      return this.modelLoadPromises.get(modelId);
    }

    const promise = this.loadModel(modelId)
      .then((model) => {
        if (!this.isDisposed) {
          this.npcs
            .filter((npc) => npc.config.model === modelId)
            .forEach((npc) => this.replaceNpcModel(npc));
        }

        return model;
      })
      .catch((error) => {
        console.warn(`Failed to load NPC model "${modelId}"; keeping fallback NPCs.`, error);
        throw error;
      })
      .finally(() => {
        this.modelLoadPromises.delete(modelId);
      });

    this.modelLoadPromises.set(modelId, promise);

    return promise;
  }

  createNpc(config, forceFallback = false) {
    const modelConfig = this.modelLibrary[config.model] ?? NPC_MODEL_LIBRARY.fangkren;
    const root = new THREE.Group();
    const sourceModel = this.modelCache.get(config.model);
    const model = forceFallback || !sourceModel ? createFallbackNpcModel() : cloneSkeleton(sourceModel);
    const emotion = this.getEmotionForNpc(config, 0);
    const roleKey = getRoleKey(config.role);
    const seededNeed = createSeededRandom(config.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0));
    const npc = {
      config,
      roleKey,
      root,
      model,
      height: normalizeModel(model, modelConfig.targetHeight),
      baseModelY: model.position.y,
      emotion,
      emotionIndex: -1,
      lastVoiceEmotionId: '',
      label: null,
      placed: false,
      velocity: new THREE.Vector3(),
      radius: NPC_COLLISION_RADIUS,
      mass: NPC_MASS,
      isKnockedDown: false,
      knockdownTimer: 0,
      isRenderable: false,
      behavior: {
        id: 'spawn',
        label: '起身',
        category: '默认',
        targetId: 'village-center',
        scheduleSlot: 'spawn',
        targetPosition: config.position.clone(),
        speed: NPC_WALK_SPEED,
        startedAt: 0,
      },
      behaviorTimer: BEHAVIOR_TICK_SECONDS * seededNeed(),
      pathStuckTimer: PATH_STUCK_CHECK_SECONDS,
      lastPathCheckPosition: root.position.clone(),
      path: [],
      pathIndex: 0,
      pathUsesElevator: false,
      elevatorRide: null,
      hireTask: null,
      interactionPauseReasons: new Set(),
      interactionPauseLabel: '',
      needs: {
        hunger: 0.18 + seededNeed() * 0.28,
        fatigue: 0.12 + seededNeed() * 0.24,
        health: 1,
      },
      employmentProgress: 0,
      homePosition: config.position.clone(),
      lastImpactAt: -Infinity,
    };

    root.name = `NPC: ${config.role} ${config.name}`;
    root.position.copy(config.position);
    npc.lastPathCheckPosition.copy(root.position);
    root.rotation.y = config.yaw + (modelConfig.forwardYawOffset ?? 0);
    root.visible = false;
    root.add(model);
    this.scene.add(root);

    npc.label = createLabelElement(npc);
    npc.label.classList.add('is-hidden');
    this.labelLayer.append(npc.label);
    this.npcs.push(npc);
    this.placeNpcOnTerrain(npc);

    return npc;
  }

  replaceNpcModel(npc) {
    const sourceModel = this.modelCache.get(npc.config.model);
    const modelConfig = this.modelLibrary[npc.config.model] ?? NPC_MODEL_LIBRARY.fangkren;

    if (!sourceModel) {
      return;
    }

    npc.root.remove(npc.model);
    npc.model = cloneSkeleton(sourceModel);
    npc.height = normalizeModel(npc.model, modelConfig.targetHeight);
    npc.baseModelY = npc.model.position.y;
    npc.root.add(npc.model);
  }

  update(deltaTime) {
    if (this.isDisposed) {
      return;
    }

    this.elapsedTime += deltaTime;
    this.updateTravelers();
    this.updateNearestNpc();
    this.updateProximityInteractionPauses();
    this.updateVoiceRange();
    this.npcs.forEach((npc) => {
      const isRenderable = this.updateNpcRenderState(npc);

      if (this.isNpcInteractionPaused(npc)) {
        this.updateNpcInteractionPause(npc);
        if (isRenderable) {
          if (!npc.elevatorRide) {
            this.placeNpcOnTerrain(npc);
          }
          this.updateNpcEmotion(npc);
          this.updateNpcPose(npc, deltaTime);
          this.updateNpcLabel(npc);
        }
        return;
      }

      if (!isRenderable) {
        this.updateNpcBackgroundState(npc, deltaTime);
        return;
      }

      this.updateNpcBehavior(npc, deltaTime);
      this.updateNpcPhysics(npc, deltaTime);
      if (!npc.elevatorRide) {
        this.placeNpcOnTerrain(npc);
      }
      this.updateNpcEmotion(npc);
      this.updateNpcPose(npc, deltaTime);
      this.updateNpcLabel(npc);
    });
    this.updateDialoguePanelPosition();
  }

  updateTravelers() {
    for (const [chunkKey, npc] of Array.from(this.travelersByChunkKey)) {
      if (!this.worldManager.loadedChunks.has(chunkKey)) {
        this.removeNpc(npc);
        this.travelersByChunkKey.delete(chunkKey);
      }
    }

    const loadedEntries = Array.from(this.worldManager.loadedChunks)
      .sort(([, a], [, b]) => getChunkHash(a.chunkCoord) - getChunkHash(b.chunkCoord));
    const targetCount = getTravelerTargetCount(loadedEntries.length);
    const targetChunkKeys = new Set();

    for (const [chunkKey, entity] of loadedEntries) {
      if (targetChunkKeys.size >= targetCount) {
        break;
      }

      if (this.travelersByChunkKey.has(chunkKey)) {
        targetChunkKeys.add(chunkKey);
        continue;
      }

      if (this.createTravelerForChunk(chunkKey, entity)) {
        targetChunkKeys.add(chunkKey);
      }
    }

    for (const [chunkKey, npc] of Array.from(this.travelersByChunkKey)) {
      if (!targetChunkKeys.has(chunkKey)) {
        this.removeNpc(npc);
        this.travelersByChunkKey.delete(chunkKey);
      }
    }
  }

  createTravelerForChunk(chunkKey, entity) {
    const occupiedPositions = this.npcs.map((npc) => npc.root.position);
    const position = getTravelerPositionInChunk(entity, occupiedPositions);

    if (!position) {
      return null;
    }

    const hash = getChunkHash(entity.chunkCoord);
    const nameIndex = hash % TRAVELER_NAMES.length;
    const dialogueIndex = Math.floor(hash / TRAVELER_NAMES.length) % TRAVELER_DIALOGUES.length;
    const config = {
      id: `traveler-${hash.toString(36)}`,
      model: 'renwu',
      role: '旅行者',
      name: TRAVELER_NAMES[nameIndex],
      position,
      yaw: (hash / 0xffffffff) * Math.PI * 2,
      emotionOffset: hash % NPC_EMOTIONS.length,
      dialogue: TRAVELER_DIALOGUES[dialogueIndex],
      dynamicTraveler: true,
    };
    const npc = this.createNpc(config, !this.modelCache.has(config.model));

    this.travelersByChunkKey.set(chunkKey, npc);
    this.ensureModelLoaded(config.model).catch(() => {});

    return npc;
  }

  removeNpc(npc) {
    if (this.activeNpc === npc) {
      this.closeDialogue();
    }

    if (npc.interactionPauseReasons?.has('trade')) {
      this.eventBus.emit('trade:close', { npc });
    }

    if (this.nearestNpc === npc) {
      this.nearestNpc = null;
    }

    this.scene.remove(npc.root);
    npc.label.remove();
    this.npcs = this.npcs.filter((candidate) => candidate !== npc);
  }

  isNpcInteractionPaused(npc) {
    return Boolean(npc?.interactionPauseReasons?.size);
  }

  pauseNpcInteraction(npc, reason = 'interaction', label = '与玩家互动') {
    if (!npc || !this.npcs.includes(npc)) {
      return;
    }

    const changed = !npc.interactionPauseReasons.has(reason) || npc.interactionPauseLabel !== label;

    npc.interactionPauseReasons.add(reason);
    npc.interactionPauseLabel = label;
    npc.velocity.set(0, 0, 0);
    npc.pathStuckTimer = PATH_STUCK_CHECK_SECONDS;
    npc.lastPathCheckPosition.copy(npc.root.position);
    if (changed) {
      this.updateNpcBehaviorLabel(npc);
    }
  }

  resumeNpcInteraction(npc, reason = 'interaction') {
    if (!npc?.interactionPauseReasons) {
      return;
    }

    npc.interactionPauseReasons.delete(reason);

    if (npc.interactionPauseReasons.size <= 0) {
      npc.interactionPauseLabel = '';
      npc.pathStuckTimer = PATH_STUCK_CHECK_SECONDS;
      npc.lastPathCheckPosition.copy(npc.root.position);
    }

    this.updateNpcBehaviorLabel(npc);
  }

  updateNpcInteractionPause(npc) {
    npc.velocity.set(0, 0, 0);
    npc.pathStuckTimer = PATH_STUCK_CHECK_SECONDS;
    npc.lastPathCheckPosition.copy(npc.root.position);
  }

  placeNpcOnTerrain(npc) {
    const surfaceY = getWalkableSurfaceY(
      this.worldManager,
      npc.root.position.x,
      npc.root.position.z,
      npc.root.position.y,
    );

    if (surfaceY === null || surfaceY === undefined) {
      return;
    }

    npc.root.position.y = surfaceY + 0.52;
    const openPosition = findNearbyNpcOpenPosition(this.worldManager, npc.root.position);

    if (openPosition) {
      npc.root.position.copy(openPosition);
      npc.velocity.set(0, 0, 0);
    }

    npc.placed = true;
  }

  updateNearestNpc() {
    const playerPosition = this.player.position;
    let nearest = null;
    let nearestDistance = Infinity;

    for (const npc of this.npcs) {
      if (!this.isNpcInRenderRange(npc)) {
        continue;
      }

      const distance = getHorizontalDistance(playerPosition, npc.root.position);

      if (distance < nearestDistance) {
        nearest = npc;
        nearestDistance = distance;
      }
    }

    this.nearestNpc = nearestDistance <= INTERACTION_DISTANCE ? nearest : null;

    if (this.activeNpc && getHorizontalDistance(playerPosition, this.activeNpc.root.position) > NPC_SPEECH_DISTANCE) {
      this.closeDialogue();
    }
  }

  updateProximityInteractionPauses() {
    const playerPosition = this.player.position;

    for (const npc of this.npcs) {
      const distance = getHorizontalDistance(playerPosition, npc.root.position);
      const isNearPlayer = this.isNpcInRenderRange(npc) && distance <= NPC_PROXIMITY_PAUSE_DISTANCE;
      const shouldResume = distance > NPC_PROXIMITY_RESUME_DISTANCE || !this.isNpcInRenderRange(npc);

      if (isNearPlayer) {
        this.pauseNpcInteraction(npc, 'proximity', '等待玩家交流');
      } else if (npc.interactionPauseReasons?.has('proximity') && shouldResume) {
        this.resumeNpcInteraction(npc, 'proximity');
      }
    }
  }

  updateVoiceRange() {
    if (
      this.activeVoiceNpc &&
      getHorizontalDistance(this.player.position, this.activeVoiceNpc.root.position) > NPC_SPEECH_DISTANCE
    ) {
      this.stopNpcVoice();
    }
  }

  updateNpcEmotion(npc) {
    const emotionIndex = Math.floor(this.elapsedTime / EMOTION_INTERVAL_SECONDS) % NPC_EMOTIONS.length;
    const behaviorEmotion = NPC_EMOTIONS.find((emotion) => emotion.id === npc.behavior?.emotion);

    if (emotionIndex === npc.emotionIndex) {
      return;
    }

    npc.emotionIndex = emotionIndex;
    npc.emotion = behaviorEmotion ?? this.getEmotionForNpc(npc.config, emotionIndex);

    const emotionElement = npc.label.querySelector('[data-npc-emotion]');
    if (emotionElement) {
      emotionElement.textContent = npc.emotion.label;
    }

    if (
      npc.emotion.id !== npc.lastVoiceEmotionId &&
      getHorizontalDistance(this.player.position, npc.root.position) <= NPC_SPEECH_DISTANCE
    ) {
      npc.lastVoiceEmotionId = npc.emotion.id;
      this.emitNpcVoice(npc, npc.emotion.text, {
        volume: 0.34,
        rate: npc.emotion.rate,
        pitch: npc.emotion.pitch,
      });
    }
  }

  getEmotionForNpc(config, emotionIndex) {
    return NPC_EMOTIONS[(emotionIndex + config.emotionOffset) % NPC_EMOTIONS.length];
  }

  isNpcInRenderRange(npc) {
    return (
      Math.abs(npc.root.position.x - this.player.position.x) <= NPC_RENDER_HALF_EXTENT &&
      Math.abs(npc.root.position.z - this.player.position.z) <= NPC_RENDER_HALF_EXTENT
    );
  }

  updateNpcRenderState(npc) {
    const isRenderable = this.isNpcInRenderRange(npc);

    npc.isRenderable = isRenderable;
    npc.root.visible = isRenderable;

    if (!isRenderable) {
      npc.label.classList.add('is-hidden');
    }

    return isRenderable;
  }

  isHireableVillager(npc) {
    if (!npc || npc.config.dynamicTraveler) {
      return false;
    }

    if (npc.roleKey === 'chief' || npc.roleKey === 'traveler' || npc.roleKey === 'travelingMerchant') {
      return false;
    }

    return ['村民', '无业游民', '工匠', '士兵'].includes(npc.config.role) || npc.roleKey === 'villager' || npc.roleKey === 'unemployed' || npc.roleKey === 'artisan';
  }

  getHireableVillagers() {
    return this.npcs
      .filter((npc) => this.isHireableVillager(npc))
      .map((npc) => ({
        id: npc.config.id,
        name: npc.config.name,
        role: npc.config.role,
        isHired: Boolean(npc.hireTask),
        progress: npc.hireTask?.progress ?? 0,
        remainingSeconds: npc.hireTask?.remainingSeconds ?? 0,
      }));
  }

  getNpcById(npcId) {
    return this.npcs.find((npc) => npc.config.id === npcId) ?? null;
  }

  startNpcHiring({ npcId, task, label = '受雇挖矿' } = {}) {
    const npc = this.getNpcById(npcId);

    if (!this.isHireableVillager(npc)) {
      return;
    }

    npc.hireTask = {
      ...task,
      label,
      progress: 0,
      remainingSeconds: task?.remainingSeconds ?? 0,
    };
    npc.needs.hunger = Math.min(npc.needs.hunger, 0.62);
    npc.needs.fatigue = Math.min(npc.needs.fatigue, 0.62);
    npc.behaviorTimer = 0;
    this.setNpcEmotionById(npc, 'proud');
    this.updateNpcBehaviorLabel(npc);
  }

  updateNpcHiringProgress({ npcId, progress = 0, remainingSeconds = 0 } = {}) {
    const npc = this.getNpcById(npcId);

    if (!npc?.hireTask) {
      return;
    }

    npc.hireTask.progress = clamp01(progress);
    npc.hireTask.remainingSeconds = remainingSeconds;

    if (npc.isRenderable) {
      this.updateNpcBehaviorLabel(npc);
    }
  }

  endNpcHiring({ npcId } = {}) {
    const npc = this.getNpcById(npcId);

    if (!npc?.hireTask) {
      return;
    }

    npc.hireTask = null;
    npc.behaviorTimer = 0;
    this.setNpcEmotionById(npc, 'happy');
    this.updateNpcBehaviorLabel(npc);
  }

  getBehaviorAnchors() {
    const anchors = typeof this.villageSystem?.getBehaviorAnchors === 'function'
      ? this.villageSystem.getBehaviorAnchors()
      : new Map([
      ['village-center', new THREE.Vector3(0, 1, 0)],
      ['village-square', new THREE.Vector3(0, 1, -2)],
      ['homes', new THREE.Vector3(-4, 1, 12)],
      ['dining', new THREE.Vector3(-5, 1, -18)],
      ['food-street', new THREE.Vector3(11, 1, -18)],
      ['warehouse', new THREE.Vector3(-17, 1, -7)],
      ['hospital', new THREE.Vector3(15, 1, -7)],
      ['fields', new THREE.Vector3(-14, 1, 14)],
      ['bar', new THREE.Vector3(6, 1, 11)],
      ['theatre', new THREE.Vector3(18, 1, 12)],
      ['watch-post', new THREE.Vector3(-6, 1, -2)],
      ['craft-station', new THREE.Vector3(2, 1, -6)],
      ['market', new THREE.Vector3(8, 1, -18)],
      ['mountain-view', new THREE.Vector3(26, 1, -1)],
    ]);

    if (!anchors.has('mine-site')) {
      const surfaceY = this.worldManager.getSurfaceHeightAt(28, -7) ?? 1;

      anchors.set('mine-site', new THREE.Vector3(28, surfaceY + 0.52, -7));
    }

    return anchors;
  }

  getAnchorPosition(targetId, npc) {
    if (targetId === 'home') {
      return npc.homePosition.clone();
    }

    const anchors = this.getBehaviorAnchors();
    const anchor = anchors.get(targetId) ?? anchors.get('village-center') ?? npc.homePosition;
    const seed = npc.config.emotionOffset + npc.config.id.length;
    const offsetX = ((seed % 5) - 2) * 0.45;
    const offsetZ = (((seed * 7) % 5) - 2) * 0.45;
    const position = anchor.clone();

    position.x += offsetX;
    position.z += offsetZ;
    position.y = (getWalkableSurfaceY(this.worldManager, position.x, position.z, anchor.y) ?? Math.round(anchor.y - 0.52)) + 0.52;

    return position;
  }

  findNearestHazard(npc, radius = 4) {
    const origin = npc.root.position;
    let nearest = null;
    let nearestDistance = Infinity;

    for (let x = Math.floor(origin.x - radius); x <= Math.ceil(origin.x + radius); x += 1) {
      for (let z = Math.floor(origin.z - radius); z <= Math.ceil(origin.z + radius); z += 1) {
        const surfaceY = this.worldManager.getSurfaceHeightAt(x, z);

        if (surfaceY === null || surfaceY === undefined) {
          continue;
        }

        const blockId = this.worldManager.getBlockAtIfLoaded(x, surfaceY, z);
        const aboveBlockId = this.worldManager.getBlockAtIfLoaded(x, surfaceY + 1, z);

        if (!HAZARD_BLOCKS.has(blockId) && !HAZARD_BLOCKS.has(aboveBlockId)) {
          continue;
        }

        const distance = Math.hypot(origin.x - x, origin.z - z);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = new THREE.Vector3(x, surfaceY + 0.52, z);
        }
      }
    }

    return nearest;
  }

  getEscapePosition(npc, hazardPosition) {
    const direction = npc.root.position.clone().sub(hazardPosition);

    direction.y = 0;
    if (direction.lengthSq() === 0) {
      direction.set(1, 0, 0);
    }
    direction.normalize();

    const target = npc.root.position.clone().addScaledVector(direction, 9);

    target.y = (getWalkableSurfaceY(this.worldManager, target.x, target.z, npc.root.position.y) ?? Math.round(npc.root.position.y - 0.52)) + 0.52;

    return target;
  }

  updateNpcNeeds(npc, deltaTime) {
    npc.needs.hunger = clamp01(npc.needs.hunger + NPC_NEED_GAIN.hunger * deltaTime);
    npc.needs.fatigue = clamp01(npc.needs.fatigue + NPC_NEED_GAIN.fatigue * deltaTime * (isNight(this.timeState) ? 1.8 : 0.7));

    if (npc.behavior?.id === 'eat') {
      npc.needs.hunger = clamp01(npc.needs.hunger - 0.06 * deltaTime);
    }

    if (npc.behavior?.id === 'sleep') {
      npc.needs.fatigue = clamp01(npc.needs.fatigue - 0.08 * deltaTime);
      npc.needs.health = clamp01(npc.needs.health + 0.025 * deltaTime);
    }

    if (npc.behavior?.id === 'heal') {
      npc.needs.health = clamp01(npc.needs.health + 0.05 * deltaTime);
    }
  }

  selectNpcBehavior(npc) {
    const hazard = this.findNearestHazard(npc);

    if (hazard) {
      return {
        id: 'escape',
        label: '逃跑/呼救/躲避',
        category: '生存安全',
        targetPosition: this.getEscapePosition(npc, hazard),
        speed: NPC_RUN_SPEED,
        emotion: 'worried',
      };
    }

    if (npc.needs.health < 0.58) {
      return { id: 'heal', label: '受伤: 治疗/求助', category: '基础需求', targetId: 'hospital', speed: NPC_WALK_SPEED, emotion: npc.needs.health < 0.25 ? 'cry' : 'worried' };
    }

    if (npc.hireTask) {
      return {
        id: 'hired-mining',
        label: `受雇挖矿 ${Math.round((npc.hireTask.progress ?? 0) * 100)}%`,
        category: '雇佣任务',
        targetId: 'mine-site',
        speed: NPC_WALK_SPEED,
        emotion: 'proud',
      };
    }

    if (npc.needs.hunger > 0.9) {
      return { id: 'eat', label: '饥饿: 找食物/吃饭', category: '基础需求', targetId: npc.roleKey === 'travelingMerchant' ? 'food-street' : 'dining', speed: NPC_WALK_SPEED, emotion: 'happy' };
    }

    if (isNight(this.timeState) && npc.needs.fatigue > 0.78) {
      return { id: 'sleep', label: '夜晚疲劳: 回家/睡觉', category: '基础需求', targetId: npc.roleKey === 'traveler' || npc.roleKey === 'travelingMerchant' ? 'inn' : 'homes', speed: NPC_WALK_SPEED, emotion: 'sleepy' };
    }

    if (this.activeNpc === npc) {
      return {
        id: 'receive-player',
        label: npc.roleKey === 'chief' ? '接待玩家/发布主线任务' : '和玩家交流',
        category: '社交',
        targetPosition: npc.root.position.clone(),
        speed: 0,
        emotion: 'curious',
      };
    }

    const scheduleSlot = getScheduleSlot(this.timeState);
    const roleTask = getScheduledRoleTask(npc.roleKey, scheduleSlot);

    return {
      ...roleTask,
      scheduleSlot,
      targetId: roleTask.target,
      speed: NPC_WALK_SPEED,
    };
  }

  setNpcBehavior(npc, nextBehavior) {
    const targetPosition = nextBehavior.targetPosition?.clone() ?? this.getAnchorPosition(nextBehavior.targetId ?? 'village-center', npc);
    const changed =
      npc.behavior?.id !== nextBehavior.id ||
      npc.behavior?.targetId !== nextBehavior.targetId ||
      npc.behavior?.scheduleSlot !== nextBehavior.scheduleSlot ||
      getHorizontalDistance(npc.behavior?.targetPosition ?? npc.root.position, targetPosition) > 1.5;

    npc.behavior = {
      ...nextBehavior,
      targetPosition,
      startedAt: changed ? this.elapsedTime : npc.behavior?.startedAt ?? this.elapsedTime,
    };

    if (changed) {
      npc.path = [];
      npc.pathIndex = 0;
      npc.pathUsesElevator = false;
      npc.elevatorRide = null;
      npc.pathStuckTimer = PATH_STUCK_CHECK_SECONDS;
      npc.lastPathCheckPosition.copy(npc.root.position);
      this.setNpcEmotionById(npc, nextBehavior.emotion);
      this.updateNpcBehaviorLabel(npc);
    }
  }

  setNpcEmotionById(npc, emotionId) {
    if (!emotionId) {
      return;
    }

    const emotion = NPC_EMOTIONS.find((candidate) => candidate.id === emotionId);

    if (!emotion) {
      return;
    }

    npc.emotion = emotion;
    npc.emotionIndex = -1;
    const emotionElement = npc.label?.querySelector('[data-npc-emotion]');

    if (emotionElement) {
      emotionElement.textContent = emotion.label;
    }
  }

  updateNpcBehaviorLabel(npc) {
    const behaviorElement = npc.label?.querySelector('[data-npc-behavior]');

    if (behaviorElement) {
      const hireLabel = npc.hireTask
        ? `受雇挖矿 ${Math.round((npc.hireTask.progress ?? 0) * 100)}%`
        : '';

      behaviorElement.textContent = npc.interactionPauseLabel || hireLabel || npc.behavior?.label || '待命';
    }
  }

  updateNpcRoleLabel(npc) {
    const roleElement = npc.label?.querySelector('.npc-label__role');

    if (roleElement) {
      roleElement.textContent = npc.config.role;
    }
  }

  updateNpcPath(npc, deltaTime) {
    if (!npc.behavior?.targetPosition || npc.behavior.speed <= 0) {
      return;
    }

    if (npc.path.length > 0) {
      npc.pathStuckTimer -= deltaTime;

      if (npc.pathStuckTimer > 0) {
        return;
      }

      const progressDistance = getHorizontalDistance(npc.root.position, npc.lastPathCheckPosition);

      npc.pathStuckTimer = PATH_STUCK_CHECK_SECONDS;
      npc.lastPathCheckPosition.copy(npc.root.position);

      if (progressDistance >= PATH_STUCK_DISTANCE) {
        return;
      }

      npc.path = [];
      npc.pathIndex = 0;
      npc.pathUsesElevator = false;
    }

    if (getHorizontalDistance(npc.root.position, npc.behavior.targetPosition) <= NPC_TARGET_REACHED_DISTANCE) {
      return;
    }

    const elevatorRoute = this.villageSystem?.getBuildingElevatorRoute?.(
      npc.root.position,
      npc.behavior.targetPosition,
      npc.behavior.targetId,
    );

    npc.pathUsesElevator = Boolean(elevatorRoute?.length);
    npc.path = elevatorRoute?.length
      ? stitchPath(this.worldManager, npc.root.position, elevatorRoute)
      : findPath(this.worldManager, npc.root.position, npc.behavior.targetPosition);
    npc.pathIndex = Math.min(1, npc.path.length - 1);
    npc.pathStuckTimer = PATH_STUCK_CHECK_SECONDS;
    npc.lastPathCheckPosition.copy(npc.root.position);
  }

  isNpcElevatorTransition(from, to) {
    return (
      Math.abs(to.y - from.y) >= NPC_ELEVATOR_VERTICAL_THRESHOLD &&
      getHorizontalDistance(from, to) <= NPC_ELEVATOR_HORIZONTAL_RANGE
    );
  }

  startNpcElevatorRide(npc, target, targetPathIndex) {
    npc.velocity.set(0, 0, 0);
    npc.elevatorRide = {
      target: target.clone(),
      targetPathIndex,
    };
  }

  updateNpcElevatorRide(npc, deltaTime) {
    if (!npc.elevatorRide) {
      return false;
    }

    const { target, targetPathIndex } = npc.elevatorRide;
    const offset = target.clone().sub(npc.root.position);
    const distance = offset.length();
    const step = NPC_ELEVATOR_SPEED * deltaTime;

    npc.velocity.set(0, 0, 0);

    if (distance <= step || distance <= 0.04) {
      npc.root.position.copy(target);
      npc.pathIndex = Math.min(targetPathIndex, Math.max(0, npc.path.length - 1));
      npc.elevatorRide = null;
      return true;
    }

    npc.root.position.addScaledVector(offset.normalize(), step);
    return true;
  }

  steerNpcAlongPath(npc) {
    if (!npc.behavior?.targetPosition || npc.behavior.speed <= 0 || npc.isKnockedDown) {
      return;
    }

    const targetDistance = getHorizontalDistance(npc.root.position, npc.behavior.targetPosition);

    if (targetDistance <= NPC_TARGET_REACHED_DISTANCE) {
      npc.velocity.x = 0;
      npc.velocity.z = 0;
      return;
    }

    const waypoint = npc.path[npc.pathIndex] ?? npc.behavior.targetPosition;
    const waypointDistance = getHorizontalDistance(npc.root.position, waypoint);

    if (waypointDistance <= NPC_WAYPOINT_REACHED_DISTANCE && npc.pathIndex < npc.path.length - 1) {
      npc.pathIndex += 1;
    }

    const nextWaypoint = npc.path[npc.pathIndex] ?? npc.behavior.targetPosition;

    if (
      npc.pathUsesElevator &&
      this.isNpcElevatorTransition(npc.root.position, nextWaypoint) &&
      getHorizontalDistance(npc.root.position, nextWaypoint) <= NPC_ELEVATOR_HORIZONTAL_RANGE
    ) {
      this.startNpcElevatorRide(npc, nextWaypoint, npc.pathIndex);
      return;
    }

    const direction = nextWaypoint.clone().sub(npc.root.position);

    direction.y = 0;
    if (direction.lengthSq() === 0) {
      return;
    }
    direction.normalize();
    npc.velocity.x = direction.x * npc.behavior.speed;
    npc.velocity.z = direction.z * npc.behavior.speed;
  }

  updateNpcBehavior(npc, deltaTime) {
    this.updateNpcNeeds(npc, deltaTime);

    if (this.updateNpcElevatorRide(npc, deltaTime)) {
      return;
    }

    npc.behaviorTimer -= deltaTime;
    if (npc.behaviorTimer <= 0) {
      npc.behaviorTimer = BEHAVIOR_TICK_SECONDS;
      this.setNpcBehavior(npc, this.selectNpcBehavior(npc));
    }

    this.updateNpcPath(npc, deltaTime);
    this.steerNpcAlongPath(npc);
    this.updateEmploymentProgress(npc, deltaTime);
  }

  updateNpcBackgroundState(npc, deltaTime) {
    this.updateNpcNeeds(npc, deltaTime);

    npc.behaviorTimer -= deltaTime;
    if (npc.behaviorTimer <= 0) {
      npc.behaviorTimer = BEHAVIOR_TICK_SECONDS;
      this.setNpcBehavior(npc, this.selectNpcBehavior(npc));
    }
  }

  updateEmploymentProgress(npc, deltaTime) {
    if (npc.roleKey !== 'unemployed') {
      return;
    }

    const isLearning =
      npc.behavior?.id === 'find-job' ||
      npc.behavior?.id === 'learn' ||
      npc.behavior?.id === 'unemployed-learn';
    const isAtWorkPoint =
      isLearning &&
      npc.behavior?.targetPosition &&
      getHorizontalDistance(npc.root.position, npc.behavior.targetPosition) <= NPC_TARGET_REACHED_DISTANCE + 0.35;

    npc.employmentProgress = isAtWorkPoint
      ? npc.employmentProgress + deltaTime
      : Math.max(0, npc.employmentProgress - deltaTime * 0.5);

    if (npc.employmentProgress < 10) {
      return;
    }

    npc.config.role = '工匠';
    npc.roleKey = 'artisan';
    npc.config.dialogue = [
      '我找到工作点了，现在先从修工具和整理材料学起。',
      '以前到处闲逛，现在终于有了固定的活。',
      '如果你带来矿石，我可以试着做些有用的东西。',
    ];
    npc.employmentProgress = 0;
    this.updateNpcRoleLabel(npc);
    this.setNpcBehavior(npc, {
      id: 'employed',
      label: '转职为工匠',
      category: '找工作',
      targetId: 'craft-station',
      speed: NPC_WALK_SPEED,
      emotion: 'happy',
    });
  }

  getCollisionBodies() {
    return this.npcs
      .filter((npc) => npc.placed && npc.isRenderable)
      .map((npc) => ({
        position: npc.root.position,
        height: npc.height,
        radius: npc.radius,
        mass: npc.mass,
        onImpact: (impact) => this.applyPlayerImpact(npc, impact),
      }));
  }

  getCombatEntities() {
    return this.npcs
      .filter((npc) => npc.placed && npc.isRenderable)
      .map((npc) => this.createCombatEntity(npc));
  }

  createCombatEntity(npc) {
    const system = this;
    const aabb = new THREE.Box3();
    const size = new THREE.Vector3(npc.radius * 2, npc.height, npc.radius * 2);

    return {
      mesh: npc.root,
      velocity: npc.velocity,
      size,
      aabb,
      animationController: {
        playKnockdown: () => {
          system.knockDownNpc(npc);
          return true;
        },
      },
      knockDown: (seconds) => system.knockDownNpc(npc, seconds),
      get mass() {
        return npc.mass;
      },
      get isKnockedDown() {
        return npc.isKnockedDown;
      },
      set isKnockedDown(value) {
        if (value) {
          system.knockDownNpc(npc);
        } else {
          npc.isKnockedDown = false;
          npc.knockdownTimer = 0;
        }
      },
      get isStunned() {
        return npc.isKnockedDown;
      },
      set isStunned(value) {
        if (value) {
          system.knockDownNpc(npc);
        }
      },
      updateAABB: () => {
        combatBoxCenter.set(
          npc.root.position.x,
          npc.root.position.y + npc.height * 0.5,
          npc.root.position.z,
        );
        aabb.setFromCenterAndSize(combatBoxCenter, size);
        return aabb;
      },
      applyImpulse: (forceVector) => {
        npc.velocity.addScaledVector(forceVector, 1 / npc.mass);
      },
    };
  }

  knockDownNpc(npc, seconds = NPC_KNOCKDOWN_SECONDS) {
    npc.isKnockedDown = true;
    npc.knockdownTimer = Math.max(npc.knockdownTimer, seconds);
  }

  applyPlayerImpact(npc, { impactSpeed = 0, normal, playerMass = NPC_MASS } = {}) {
    if (!normal || impactSpeed <= 0) {
      return;
    }

    const transfer = NPC_IMPACT_TRANSFER * Math.min(1.35, playerMass / Math.max(npc.mass, 1));

    npc.velocity.addScaledVector(normal, -impactSpeed * transfer);
    npc.needs.health = clamp01(npc.needs.health - Math.min(0.35, impactSpeed / 28));
    npc.lastImpactAt = this.elapsedTime;
    this.setNpcEmotionById(npc, impactSpeed >= NPC_KNOCKDOWN_SPEED ? 'cry' : 'angry');

    if (impactSpeed >= NPC_KNOCKDOWN_SPEED) {
      this.knockDownNpc(npc);
    }
  }

  updateNpcPhysics(npc, deltaTime) {
    if (npc.knockdownTimer > 0) {
      npc.knockdownTimer = Math.max(0, npc.knockdownTimer - deltaTime);
      npc.isKnockedDown = npc.knockdownTimer > 0;
    }

    npc.root.position.x += npc.velocity.x * deltaTime;
    npc.root.position.z += npc.velocity.z * deltaTime;

    const decay = Math.exp(-NPC_FRICTION * deltaTime);

    npc.velocity.x *= decay;
    npc.velocity.z *= decay;

    if (Math.abs(npc.velocity.x) < NPC_STOP_EPSILON) {
      npc.velocity.x = 0;
    }

    if (Math.abs(npc.velocity.z) < NPC_STOP_EPSILON) {
      npc.velocity.z = 0;
    }
  }

  updateNpcPose(npc) {
    const distanceToPlayer = getHorizontalDistance(this.player.position, npc.root.position);
    const idleBob = Math.sin(this.elapsedTime * 1.2 + npc.config.emotionOffset) * 0.015;
    const horizontalSpeed = Math.hypot(npc.velocity.x, npc.velocity.z);

    npc.model.position.y = npc.baseModelY + idleBob;
    npc.model.rotation.x = npc.isKnockedDown ? -1.12 : 0;
    npc.model.rotation.z = npc.isKnockedDown ? 0.12 : 0;

    if (horizontalSpeed > 0.08) {
      const targetYaw = Math.atan2(npc.velocity.x, npc.velocity.z);
      let deltaYaw = targetYaw - npc.root.rotation.y;

      deltaYaw = Math.atan2(Math.sin(deltaYaw), Math.cos(deltaYaw));
      npc.root.rotation.y += deltaYaw * 0.14;
      return;
    }

    if (distanceToPlayer <= 5) {
      const dx = this.player.position.x - npc.root.position.x;
      const dz = this.player.position.z - npc.root.position.z;
      const targetYaw = Math.atan2(dx, dz);
      let deltaYaw = targetYaw - npc.root.rotation.y;

      deltaYaw = Math.atan2(Math.sin(deltaYaw), Math.cos(deltaYaw));
      npc.root.rotation.y += deltaYaw * 0.04;
    }
  }

  updateNpcLabel(npc) {
    const labelPosition = projectedPosition.set(
      npc.root.position.x,
      npc.root.position.y + npc.height + 0.48,
      npc.root.position.z,
    );

    labelPosition.project(this.camera);

    const isVisible = labelPosition.z >= -1 && labelPosition.z <= 1;
    npc.label.classList.toggle('is-hidden', !isVisible);
    npc.label.classList.toggle('is-near', npc === this.nearestNpc);

    if (!isVisible) {
      return;
    }

    const x = (labelPosition.x * 0.5 + 0.5) * this.container.clientWidth;
    const y = (-labelPosition.y * 0.5 + 0.5) * this.container.clientHeight;

    npc.label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
  }

  onKeyDown(event) {
    if (handleEditingKeydown(event)) {
      return;
    }

    if (event.code === 'Escape' && this.activeNpc) {
      event.preventDefault();
      this.closeDialogue();
      return;
    }

    if (event.code === 'KeyB' && !event.shiftKey && !event.repeat && this.nearestNpc) {
      if (this.isTradeNpc(this.nearestNpc)) {
        event.preventDefault();
        this.eventBus.emit('trade:open', { npc: this.nearestNpc });
      }

      return;
    }

    if (event.code !== 'KeyL' || event.repeat) {
      return;
    }

    if (this.activeNpc) {
      event.preventDefault();
      this.dialoguePanel.querySelector('[data-dialogue-input]')?.focus();
      return;
    }

    if (this.nearestNpc) {
      event.preventDefault();
      this.openDialogue(this.nearestNpc);
    }
  }

  isTradeNpc(npc) {
    return ['chief', 'artisan', 'villager', 'traveler', 'travelingMerchant'].includes(npc?.roleKey)
      || ['村长', '工匠', '村民', '旅行者'].includes(npc?.config?.role)
      || npc?.config?.role?.includes('商人');
  }

  openDialogue(npc) {
    this.pauseNpcInteraction(npc, 'dialogue', '与玩家对话');
    this.activeNpc = npc;
    this.dialogueIndex = 0;
    this.dialoguePanel.classList.add('is-open');
    this.renderDialogue();
    window.setTimeout(() => this.dialoguePanel.querySelector('[data-dialogue-input]')?.focus(), 0);
  }

  advanceDialogue() {
    if (!this.activeNpc) {
      return;
    }

    this.dialogueIndex += 1;

    if (this.dialogueIndex >= this.getDialogueLines(this.activeNpc).length) {
      this.closeDialogue();
      return;
    }

    this.renderDialogue();
  }

  closeDialogue() {
    const npc = this.activeNpc;
    this.activeNpc = null;
    this.dialogueIndex = 0;
    this.dialoguePanel.classList.remove('is-open');
    this.resumeNpcInteraction(npc, 'dialogue');
    this.stopNpcVoice();
  }

  getDialogueLines(npc) {
    return [
      ...npc.config.dialogue,
      `当前行为：${npc.behavior?.category ?? '默认'} / ${npc.behavior?.label ?? '待命'}。`,
      `状态：饥饿 ${Math.round(npc.needs.hunger * 100)}%，疲劳 ${Math.round(npc.needs.fatigue * 100)}%，健康 ${Math.round(npc.needs.health * 100)}%。`,
      `${npc.emotion.label}：${npc.emotion.text}`,
    ];
  }

  renderDialogue() {
    if (!this.activeNpc) {
      return;
    }

    const roleElement = this.dialoguePanel.querySelector('[data-dialogue-role]');
    const nameElement = this.dialoguePanel.querySelector('[data-dialogue-name]');
    const emotionElement = this.dialoguePanel.querySelector('[data-dialogue-emotion]');
    const logElement = this.dialoguePanel.querySelector('[data-dialogue-log]');
    const history = this.chatHistories.get(this.activeNpc.config.id) ?? [];
    const lines = history.length ? history : this.getDialogueLines(this.activeNpc).map((content) => ({ role: 'assistant', content }));

    roleElement.textContent = this.activeNpc.config.role;
    nameElement.textContent = this.activeNpc.config.name;
    emotionElement.textContent = this.activeNpc.emotion.label;
    logElement.innerHTML = lines.slice(-8).map((entry) => `
      <p class="npc-dialogue__message is-${entry.role === 'user' ? 'user' : 'npc'}">${escapeHtml(entry.content)}</p>
    `).join('');
    logElement.scrollTop = logElement.scrollHeight;

    const text = lines[lines.length - 1]?.content ?? '';
    this.emitNpcVoice(this.activeNpc, text, {
      volume: 0.72,
      rate: this.activeNpc.emotion.rate,
      pitch: this.activeNpc.emotion.pitch,
    });
  }

  async onDialogueSubmit(event) {
    event.preventDefault();

    if (!this.activeNpc || this.isChatPending) {
      return;
    }

    const input = this.dialoguePanel.querySelector('[data-dialogue-input]');
    const message = input.value.trim();

    if (!message) {
      return;
    }

    input.value = '';
    const npcId = this.activeNpc.config.id;
    const history = [...(this.chatHistories.get(npcId) ?? [])];
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: '……' });
    this.chatHistories.set(npcId, history);
    this.isChatPending = true;
    this.renderDialogue();

    try {
      const payload = await requestJson('/api/ai/npc-chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          history: history.slice(0, -1),
          npc: {
            id: this.activeNpc.config.id,
            name: this.activeNpc.config.name,
            role: this.activeNpc.config.role,
            behavior: this.activeNpc.behavior?.label ?? '',
            emotion: this.activeNpc.emotion?.label ?? '',
            health: this.activeNpc.needs?.health ?? 1,
            hunger: this.activeNpc.needs?.hunger ?? 0,
            fatigue: this.activeNpc.needs?.fatigue ?? 0,
          },
        }),
      });
      const nextHistory = [...(this.chatHistories.get(npcId) ?? [])];
      nextHistory[nextHistory.length - 1] = { role: 'assistant', content: payload.reply ?? '我不知道该怎么回答。' };
      this.chatHistories.set(npcId, nextHistory);
    } catch (error) {
      const nextHistory = [...(this.chatHistories.get(npcId) ?? [])];
      nextHistory[nextHistory.length - 1] = { role: 'assistant', content: `聊天失败：${error.message}` };
      this.chatHistories.set(npcId, nextHistory);
    } finally {
      this.isChatPending = false;
      this.renderDialogue();
      input.focus();
    }
  }

  emitNpcVoice(npc, text, options = {}) {
    if (getHorizontalDistance(this.player.position, npc.root.position) > NPC_SPEECH_DISTANCE) {
      return;
    }

    this.activeVoiceNpc = npc;
    this.eventBus.emit('sound:voice', {
      id: `npc:${npc.config.id}:${npc.emotion.id}`,
      text,
      volume: options.volume,
      rate: options.rate,
      pitch: options.pitch,
    });
  }

  stopNpcVoice() {
    this.activeVoiceNpc = null;
    this.eventBus.emit('sound:stop-voice');
  }

  updateDialoguePanelPosition() {
    this.dialoguePanel.classList.toggle('has-target', Boolean(this.nearestNpc || this.activeNpc));
  }

  dispose() {
    this.isDisposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    this.dialoguePanel.querySelector('[data-dialogue-form]')?.removeEventListener('submit', this.onDialogueSubmit);
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.npcs.forEach((npc) => {
      this.scene.remove(npc.root);
      npc.label.remove();
      npc.root.traverse((object) => {
        if (object.isMesh) {
          object.geometry?.dispose?.();
        }
      });
    });
    this.labelLayer.remove();
    this.dialoguePanel.remove();
    this.npcs = [];
  }
}
