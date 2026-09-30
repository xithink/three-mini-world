import { MATERIALS, getMaterial } from '../../crafting/craftingData.js';
import { requestJson } from '../saveStorage.js';
import { handleEditingKeydown } from '../utils/inputFocus.js';
import { SECONDS_PER_YEAR_DAY } from './timeSystem.js';

const RARITY_PRICE = Object.freeze({
  '常见': 4,
  '较常见': 8,
  '稀有': 18,
  '高价值': 36,
  '未知': 6,
});
const HIRE_MINER_PRICE_PER_DAY = 160;
const HIRE_MINER_MAX_DAYS = 64;
const HIRE_MINER_YIELD_INTERVAL_SECONDS = 300;
const HIRE_ORE_POOLS = Object.freeze([
  {
    id: 'ordinary',
    label: '普通',
    chance: 0.60,
    items: [
      { itemId: 'stone', count: 4 },
      { itemId: 'cave_stone', count: 4 },
      { itemId: 'rock_mountain_stone', count: 3 },
      { itemId: 'Fe', count: 2 },
      { itemId: 'Cu', count: 2 },
      { itemId: 'Zn', count: 2 },
      { itemId: 'Sn', count: 1 },
    ],
  },
  {
    id: 'precious',
    label: '珍贵',
    chance: 0.20,
    items: [
      { itemId: 'Ag', count: 1 },
      { itemId: 'W', count: 1 },
      { itemId: 'Au', count: 1 },
      { itemId: 'Pb', count: 1 },
    ],
  },
  {
    id: 'special',
    label: '特殊',
    chance: 0.10,
    items: [
      { itemId: 'U', count: 1 },
      { itemId: 'niter', count: 2 },
      { itemId: 'flint', count: 2 },
      { itemId: 'steel_ingot', count: 1 },
    ],
  },
  {
    id: 'rare',
    label: '稀有',
    chance: 0.05,
    items: [
      { itemId: 'zn_powder_203', count: 1 },
      { itemId: 'au_gear_207', count: 1 },
      { itemId: 'fe_alloy_231', count: 1 },
      { itemId: 'sn_tube_235', count: 1 },
    ],
  },
  {
    id: 'legendary',
    label: '绝世',
    chance: 0.03,
    items: [
      { itemId: 'ag_crystal_204', count: 1 },
      { itemId: 'w_core_236', count: 1 },
      { itemId: 'u_module_240', count: 1 },
    ],
  },
  {
    id: 'mythic',
    label: '绝世稀有',
    chance: 0.02,
    items: [
      { itemId: 'u_module_240', count: 2 },
      { itemId: 'w_core_236', count: 2 },
      { itemId: 'ca_module_260', count: 1 },
    ],
  },
]);

const TRADE_CATALOGS = Object.freeze({
  travelingMerchant: [
    { itemId: 'stone_slab', count: 8, price: 12, label: '桥梁石板' },
    { itemId: 'wood', count: 10, price: 10, label: '建筑木材' },
    { itemId: 'steel_beam', count: 4, price: 28, label: '钢材支撑' },
    { itemId: 'glass_panel', count: 6, price: 18, label: '玻璃板' },
    { itemId: 'potion', count: 2, price: 20, label: '旅行药水' },
    { itemId: 'flint', count: 2, price: 8, label: '打火石' },
    { itemId: 'Au', count: 1, price: 96, label: '金元素' },
    { itemId: 'Ag', count: 1, price: 72, label: '银元素' },
    { itemId: 'W', count: 1, price: 88, label: '钨元素' },
    { itemId: 'U', count: 1, price: 140, label: '铀元素' },
    { itemId: 'au_gear_207', count: 1, price: 180, label: '稀有金齿轮' },
    { itemId: 'u_module_240', count: 1, price: 240, label: '稀有铀模块' },
    { itemId: 'drill', count: 1, price: 220, label: '钻机' },
    { itemId: 'excavator', count: 1, price: 680, label: '挖掘机' },
  ],
  artisan: [
    { itemId: 'Fe', count: 3, price: 18, label: '铁矿元素' },
    { itemId: 'Cu', count: 2, price: 24, label: '铜矿元素' },
    { itemId: 'Zn', count: 2, price: 22, label: '锌矿元素' },
    { itemId: 'Sn', count: 2, price: 28, label: '锡矿元素' },
    { itemId: 'W', count: 1, price: 88, label: '钨矿元素' },
    { itemId: 'steel_ingot', count: 3, price: 24, label: '钢锭' },
    { itemId: 'steel_plate', count: 2, price: 30, label: '钢板' },
    { itemId: 'steel_beam', count: 2, price: 38, label: '钢材' },
    { itemId: 'drill', count: 1, price: 220, label: '钻机' },
    { itemId: 'forge', count: 1, price: 160, label: '锻炉' },
  ],
  villager: [
    { itemId: 'wood', count: 6, price: 6, label: '柴火木材' },
    { itemId: 'leaves', count: 8, price: 4, label: '可食嫩叶' },
    { itemId: 'cactus', count: 3, price: 7, label: '仙人掌食材' },
    { itemId: 'resin', count: 2, price: 12, label: '树脂糖浆' },
    { itemId: 'potion', count: 1, price: 24, label: '恢复药水' },
    { itemId: 'snow_block', count: 4, price: 5, label: '冰镇雪块' },
  ],
  traveler: [
    { itemId: 'sand', count: 6, price: 6, label: '远行沙样' },
    { itemId: 'ice', count: 3, price: 14, label: '寒地冰块' },
    { itemId: 'snow_mountain_block', count: 3, price: 18, label: '雪山样本' },
    { itemId: 'rock_mountain_stone', count: 4, price: 16, label: '岩山石样本' },
    { itemId: 'forest_mountain_block', count: 4, price: 18, label: '森林山体样本' },
    { itemId: 'codex_page_elements', count: 1, price: 80, label: '元素图鉴页' },
    { itemId: 'codex_page_tools', count: 1, price: 90, label: '工具图鉴页' },
    { itemId: 'potion', count: 2, price: 22, label: '旅途药水' },
  ],
  chief: [
    {
      itemId: 'hire_miner',
      count: 1,
      price: HIRE_MINER_PRICE_PER_DAY,
      label: '雇佣村民挖矿',
      service: 'hire-miner',
    },
  ],
});

function getRoleKey(npc) {
  if (npc?.roleKey) return npc.roleKey;

  const role = String(npc?.config?.role ?? '');

  if (role === '村长') return 'chief';
  if (role === '工匠') return 'artisan';
  if (role === '旅行者') return 'traveler';
  if (role === '旅行商人' || role.includes('商人')) return 'travelingMerchant';
  if (role === '村民') return 'villager';

  return 'travelingMerchant';
}

function getBaseItemPrice(itemId) {
  if (!itemId) {
    return 0;
  }

  const material = getMaterial(itemId);
  const rarity = material.distribution?.rarity ?? '未知';
  const rarityPrice = RARITY_PRICE[rarity] ?? RARITY_PRICE['未知'];
  const categoryBonus = material.category === '基础元素'
    ? 8
    : material.category === '工具机械'
      ? 80
      : material.category === '图鉴页'
        ? 48
        : material.category === '建筑材料'
          ? 10
          : 0;

  return rarityPrice + categoryBonus;
}

function getTradeGoods(npc) {
  const roleKey = getRoleKey(npc);
  const catalog = TRADE_CATALOGS[roleKey] ?? TRADE_CATALOGS.travelingMerchant;

  if (roleKey !== 'traveler') {
    return catalog;
  }

  const generatedTravelFinds = MATERIALS
    .filter((material) => material.category !== '工具机械')
    .filter((material) => ['稀有', '高价值'].includes(material.distribution?.rarity))
    .slice(0, 8)
    .map((material, index) => ({
      itemId: material.id,
      count: 1 + (index % 2),
      price: getBaseItemPrice(material.id) + 12,
      label: material.name,
    }));

  return [...catalog, ...generatedTravelFinds];
}

function getBuyUnitPrice(itemId, goodsList) {
  const goods = goodsList.find((item) => item.itemId === itemId);

  return goods?.price ?? getBaseItemPrice(itemId);
}

function getSellPrice(itemId, goodsList) {
  return Math.max(1, Math.floor(getBuyUnitPrice(itemId, goodsList) * 0.8));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function clampInteger(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(number)));
}

function pickByChance(pools) {
  const roll = Math.random();
  let cursor = 0;

  for (const pool of pools) {
    cursor += pool.chance;

    if (roll <= cursor) {
      return pool;
    }
  }

  return pools[pools.length - 1];
}

function formatTaskTime(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const restSeconds = safeSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;

    return `${hours}小时${restMinutes}分`;
  }

  return `${minutes}分${String(restSeconds).padStart(2, '0')}秒`;
}

export class TradeSystem {
  constructor({ container, eventBus, inventorySystem, profileSystem, npcSystem = null }) {
    this.container = container;
    this.eventBus = eventBus;
    this.inventorySystem = inventorySystem;
    this.profileSystem = profileSystem;
    this.npcSystem = npcSystem;
    this.activeMerchant = null;
    this.isOpen = false;
    this.status = '靠近商人按 B 交易';
    this.confirmation = null;
    this.isProcessing = false;
    this.hireTasks = new Map();
    this.renderAccumulator = 0;
    this.element = this.createElement();
    this.onKeyDown = this.onKeyDown.bind(this);
    this.unsubscribe = [
      eventBus.on('trade:open', ({ npc } = {}) => this.open(npc)),
      eventBus.on('trade:close', () => this.close()),
    ];

    this.container.append(this.element);
    window.addEventListener('keydown', this.onKeyDown, true);
    this.render();
  }

  createElement() {
    const element = document.createElement('section');
    element.className = 'trade-panel';
    element.setAttribute('aria-label', '商人交易');
    element.innerHTML = `
      <div class="trade-panel__header">
        <strong data-trade-title>商人交易</strong>
        <span data-trade-coins>金币 0</span>
      </div>
      <div class="trade-panel__goods" data-trade-goods></div>
      <div class="trade-panel__hire" data-trade-hire></div>
      <div class="trade-panel__sell">
        <button type="button" data-trade-sell>出售手持物品</button>
        <span data-trade-selected>空手</span>
      </div>
      <div class="trade-panel__status" data-trade-status></div>
      <div class="trade-panel__confirm" data-trade-confirm hidden></div>
    `;

    element.addEventListener('pointerdown', (event) => event.stopPropagation());
    element.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    element.addEventListener('click', (event) => {
      const buyButton = event.target.closest('[data-trade-buy]');

      if (buyButton) {
        this.requestBuy(Number(buyButton.dataset.tradeBuy));
        return;
      }

      if (event.target.closest('[data-trade-sell]')) {
        this.requestSellSelected();
        return;
      }

      const hireButton = event.target.closest('[data-hire-npc]');

      if (hireButton) {
        this.requestHireMiner(hireButton.dataset.hireNpc);
        return;
      }

      if (event.target.closest('[data-trade-confirm-cancel]')) {
        this.cancelConfirmation();
        return;
      }

      if (event.target.closest('[data-trade-confirm-ok]')) {
        void this.confirmTrade();
      }
    });

    return element;
  }

  onKeyDown(event) {
    if (handleEditingKeydown(event)) {
      return;
    }

    if (event.code === 'Escape' && this.confirmation) {
      event.preventDefault();
      this.cancelConfirmation();
      return;
    }

    if (event.code === 'Escape' && this.isOpen) {
      event.preventDefault();
      this.close();
    }
  }

  open(npc) {
    if (!npc) {
      this.status = '附近没有商人';
      this.render();
      return;
    }

    if (this.activeMerchant && this.activeMerchant !== npc) {
      this.eventBus.emit('npc:interaction:end', { npc: this.activeMerchant, reason: 'trade' });
    }

    this.activeMerchant = npc;
    this.isOpen = true;
    this.confirmation = null;
    this.isProcessing = false;
    this.status = `${npc.config.name} 展开了货单`;
    this.eventBus.emit('npc:interaction:start', {
      npc,
      reason: 'trade',
      label: '与玩家交易',
    });
    this.render();
  }

  close() {
    const merchant = this.activeMerchant;

    this.isOpen = false;
    this.activeMerchant = null;
    this.confirmation = null;
    this.isProcessing = false;
    if (merchant) {
      this.eventBus.emit('npc:interaction:end', { npc: merchant, reason: 'trade' });
    }
    this.render();
  }

  requestBuy(index) {
    if (this.isProcessing) {
      return;
    }

    const goods = getTradeGoods(this.activeMerchant)[index];

    if (!goods) {
      return;
    }

    if (goods.service === 'hire-miner') {
      this.status = '请在下方雇佣列表选择村民和天数';
      this.render();
      return;
    }

    const material = getMaterial(goods.itemId);
    const totalPrice = goods.price * goods.count;
    const title = goods.service === 'hire-miner' ? '确认雇佣' : '确认购买';
    const detail = goods.service === 'hire-miner'
      ? `支付 ${totalPrice} 金币，雇佣村民挖矿，并获得矿石奖励。`
      : `购买 ${material.name} x${goods.count}，需要支付 ${totalPrice} 金币。`;

    this.confirmation = {
      title,
      detail,
      confirmLabel: goods.service === 'hire-miner' ? '确认雇佣' : '确认购买',
      action: { type: 'buy', index },
    };
    this.status = '请确认交易内容';
    this.render();
  }

  async executeBuy(index) {
    const goods = getTradeGoods(this.activeMerchant)[index];

    if (!goods) {
      this.status = '交易货品已失效';
      return;
    }

    const material = getMaterial(goods.itemId);
    const totalPrice = goods.price * goods.count;
    this.isProcessing = true;
    this.status = goods.service === 'hire-miner'
      ? `正在雇佣村民挖矿，支付 ${totalPrice} 金币...`
      : `正在购买 ${material.name} x${goods.count}，支付 ${totalPrice} 金币...`;
    this.render();

    try {
      const result = await requestJson('/api/trade/buy', {
        method: 'POST',
        body: JSON.stringify(goods),
      });

      this.inventorySystem.addItem(goods.itemId, goods.count);
      this.profileSystem.setProfile(result.profile);
      this.eventBus.emit('profile:update', result.profile);
      this.status = `交易完成：购买 ${material.name} x${goods.count}，花费 ${totalPrice} 金币`;
    } catch (error) {
      this.status = `交易失败：${error.message}`;
    } finally {
      this.isProcessing = false;
    }

    this.render();
  }

  requestSellSelected() {
    if (this.isProcessing) {
      return;
    }

    const stack = this.inventorySystem.getSelectedStack();

    if (!stack) {
      this.status = '当前手持为空，无法出售';
      this.render();
      return;
    }

    const goodsList = getTradeGoods(this.activeMerchant);
    const price = getSellPrice(stack.itemId, goodsList);
    const material = getMaterial(stack.itemId);

    this.confirmation = {
      title: '确认出售',
      detail: `出售 ${material.name} x1，可获得 ${price} 金币。卖出价格按购买价 80% 计算。`,
      confirmLabel: '确认出售',
      action: { type: 'sell', itemId: stack.itemId, price },
    };
    this.status = '请确认交易内容';
    this.render();
  }

  async executeSellSelected({ itemId, price }) {
    const stack = this.inventorySystem.getSelectedStack();

    if (!stack || stack.itemId !== itemId) {
      this.status = '交易失败：手持物品已变化，请重新选择出售';
      return;
    }

    const material = getMaterial(itemId);
    this.isProcessing = true;
    this.status = `正在出售 ${material.name} x1，预计获得 ${price} 金币...`;
    this.render();

    if (!this.inventorySystem.removeSelected(1)) {
      this.status = '交易失败：当前物品数量不足';
      this.isProcessing = false;
      this.render();
      return;
    }

    try {
      const result = await requestJson('/api/trade/sell', {
        method: 'POST',
        body: JSON.stringify({ itemId, count: 1, price }),
      });

      this.profileSystem.setProfile(result.profile);
      this.eventBus.emit('profile:update', result.profile);
      this.status = `交易完成：出售 ${material.name} x1，获得 ${price} 金币`;
    } catch (error) {
      this.inventorySystem.addItem(itemId, 1);
      this.status = `交易失败：${error.message}`;
    } finally {
      this.isProcessing = false;
    }

    this.render();
  }

  cancelConfirmation() {
    if (this.isProcessing) {
      return;
    }

    this.confirmation = null;
    this.status = '交易已取消';
    this.render();
  }

  async confirmTrade() {
    if (!this.confirmation || this.isProcessing) {
      return;
    }

    const action = this.confirmation.action;
    this.confirmation = null;

    if (action.type === 'buy') {
      await this.executeBuy(action.index);
      return;
    }

    if (action.type === 'sell') {
      await this.executeSellSelected(action);
      return;
    }

    if (action.type === 'hire-miner') {
      await this.executeHireMiner(action);
    }
  }

  getHireableVillagers() {
    return this.npcSystem?.getHireableVillagers?.() ?? [];
  }

  getHiringDaysInput(npcId) {
    const input = this.element.querySelector(`[data-hire-days="${CSS.escape(npcId)}"]`);

    return clampInteger(input?.value ?? 1, 1, HIRE_MINER_MAX_DAYS);
  }

  requestHireMiner(npcId) {
    if (this.isProcessing || this.hireTasks.has(npcId)) {
      return;
    }

    const npc = this.getHireableVillagers().find((candidate) => candidate.id === npcId);

    if (!npc) {
      this.status = '该村民暂时无法雇佣';
      this.render();
      return;
    }

    const days = this.getHiringDaysInput(npcId);
    const totalPrice = days * HIRE_MINER_PRICE_PER_DAY;

    this.confirmation = {
      title: '确认雇佣村民',
      detail: `雇佣 ${npc.name} 挖矿 ${days} 天，需要支付 ${totalPrice} 金币。每 5 分钟按概率产出矿石。`,
      confirmLabel: '确认雇佣',
      action: { type: 'hire-miner', npcId, days, totalPrice },
    };
    this.status = '请确认雇佣任务';
    this.render();
  }

  async executeHireMiner({ npcId, days, totalPrice }) {
    const npc = this.getHireableVillagers().find((candidate) => candidate.id === npcId);

    if (!npc) {
      this.status = '雇佣失败：该村民已不在可雇佣列表';
      return;
    }

    this.isProcessing = true;
    this.status = `正在雇佣 ${npc.name} 挖矿 ${days} 天，支付 ${totalPrice} 金币...`;
    this.render();

    try {
      const result = await requestJson('/api/trade/buy', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'hire_miner',
          count: days,
          price: HIRE_MINER_PRICE_PER_DAY,
        }),
      });

      this.profileSystem.setProfile(result.profile);
      this.eventBus.emit('profile:update', result.profile);
      this.startHireTask(npc, days);
      this.status = `交易完成：已雇佣 ${npc.name} 挖矿 ${days} 天`;
    } catch (error) {
      this.status = `雇佣失败：${error.message}`;
    } finally {
      this.isProcessing = false;
    }

    this.render();
  }

  startHireTask(npc, days) {
    const totalSeconds = days * SECONDS_PER_YEAR_DAY;
    const task = {
      id: `hire-${npc.id}-${Date.now()}`,
      npcId: npc.id,
      npcName: npc.name,
      npcRole: npc.role,
      days,
      elapsedSeconds: 0,
      totalSeconds,
      remainingSeconds: totalSeconds,
      nextYieldSeconds: HIRE_MINER_YIELD_INTERVAL_SECONDS,
      producedCount: 0,
      lastReward: null,
    };

    this.hireTasks.set(npc.id, task);
    this.eventBus.emit('npc:hiring:start', {
      npcId: npc.id,
      label: `受雇挖矿：${days}天`,
      task,
    });
  }

  update(deltaTime) {
    if (this.hireTasks.size <= 0) {
      return;
    }

    let shouldRender = false;

    for (const task of Array.from(this.hireTasks.values())) {
      task.elapsedSeconds = Math.min(task.totalSeconds, task.elapsedSeconds + deltaTime);
      task.remainingSeconds = Math.max(0, task.totalSeconds - task.elapsedSeconds);

      while (task.elapsedSeconds >= task.nextYieldSeconds && task.remainingSeconds > 0) {
        const reward = this.generateHireReward();

        this.inventorySystem.addItem(reward.itemId, reward.count);
        task.producedCount += reward.count;
        task.lastReward = reward;
        task.nextYieldSeconds += HIRE_MINER_YIELD_INTERVAL_SECONDS;
        this.status = `${task.npcName} 挖到${reward.rarityLabel}矿物：${reward.name} x${reward.count}`;
        shouldRender = true;
      }

      this.eventBus.emit('npc:hiring:progress', {
        npcId: task.npcId,
        progress: task.elapsedSeconds / task.totalSeconds,
        remainingSeconds: task.remainingSeconds,
        task,
      });

      if (task.remainingSeconds <= 0) {
        this.hireTasks.delete(task.npcId);
        this.eventBus.emit('npc:hiring:end', {
          npcId: task.npcId,
          reason: 'complete',
          task,
        });
        this.status = `雇佣任务完成：${task.npcName} 已回归正常行为策略`;
        shouldRender = true;
      }
    }

    this.renderAccumulator += deltaTime;
    if (shouldRender || (this.isOpen && this.renderAccumulator >= 1)) {
      this.renderAccumulator = 0;
      this.render();
    }
  }

  generateHireReward() {
    const pool = pickByChance(HIRE_ORE_POOLS);
    const reward = pool.items[Math.floor(Math.random() * pool.items.length) % pool.items.length];
    const material = getMaterial(reward.itemId);

    return {
      ...reward,
      name: material.name,
      rarityLabel: pool.label,
    };
  }

  render() {
    const selectedStack = this.inventorySystem.getSelectedStack();
    const goodsList = getTradeGoods(this.activeMerchant);

    this.element.classList.toggle('is-open', this.isOpen);
    this.element.querySelector('[data-trade-title]').textContent =
      this.activeMerchant ? `${this.activeMerchant.config.name} 的货单` : '商人交易';
    this.element.querySelector('[data-trade-coins]').textContent = `金币 ${this.profileSystem.getCoins()}`;
    this.element.querySelector('[data-trade-selected]').textContent = selectedStack
      ? `${getMaterial(selectedStack.itemId).name} 可卖 ${getSellPrice(selectedStack.itemId, goodsList)} 金币`
      : '空手';
    this.element.querySelector('[data-trade-status]').textContent = this.status;
    this.element.querySelector('[data-trade-goods]').innerHTML = goodsList.map((goods, index) => {
      const material = getMaterial(goods.itemId);
      const totalPrice = goods.price * goods.count;
      const priceText = goods.service === 'hire-miner'
        ? `${totalPrice} 金币 / 获得矿石`
        : `${goods.count} 个 / ${totalPrice} 金币`;

      return `
        <button type="button" data-trade-buy="${index}">
          <img src="${material.svg}" alt="">
          <span>${escapeHtml(goods.label)}</span>
          <strong>${priceText}</strong>
        </button>
      `;
    }).join('');
    this.element.querySelectorAll('[data-trade-buy], [data-trade-sell]').forEach((button) => {
      button.disabled = this.isProcessing || Boolean(this.confirmation);
    });
    this.renderHirePanel();
    this.renderConfirmation();
  }

  renderHirePanel() {
    const hireElement = this.element.querySelector('[data-trade-hire]');
    const roleKey = getRoleKey(this.activeMerchant);

    if (roleKey !== 'chief') {
      hireElement.innerHTML = '';
      hireElement.hidden = true;
      return;
    }

    const villagers = this.getHireableVillagers();
    const activeTasks = [...this.hireTasks.values()];
    hireElement.hidden = false;
    hireElement.innerHTML = `
      <div class="trade-panel__hire-header">
        <strong>村民雇佣挖矿</strong>
        <span>${HIRE_MINER_PRICE_PER_DAY} 金币/天 · 每5分钟产矿</span>
      </div>
      <div class="trade-panel__hire-list">
        ${villagers.length ? villagers.map((npc) => {
          const task = this.hireTasks.get(npc.id);
          const progress = task ? Math.min(100, Math.round((task.elapsedSeconds / task.totalSeconds) * 100)) : 0;
          const disabled = this.isProcessing || Boolean(this.confirmation) || Boolean(task);

          return `
            <div class="trade-panel__hire-row">
              <div>
                <strong>${escapeHtml(npc.name)}</strong>
                <span>${escapeHtml(npc.role)} · ${task ? '挖矿中' : '空闲可雇佣'}</span>
              </div>
              <input type="number" min="1" max="${HIRE_MINER_MAX_DAYS}" value="${task?.days ?? 1}" data-hire-days="${escapeHtml(npc.id)}" ${task ? 'disabled' : ''}>
              <button type="button" data-hire-npc="${escapeHtml(npc.id)}" ${disabled ? 'disabled' : ''}>${task ? '已雇佣' : '雇佣'}</button>
              ${task ? `
                <div class="trade-panel__hire-task">
                  <span>已工作 ${formatTaskTime(task.elapsedSeconds)} / 剩余 ${formatTaskTime(task.remainingSeconds)}</span>
                  <i><b style="width: ${progress}%"></b></i>
                  <em>${task.lastReward ? `最近产出：${escapeHtml(task.lastReward.name)} x${task.lastReward.count}` : '等待首次产矿'}</em>
                </div>
              ` : ''}
            </div>
          `;
        }).join('') : '<p class="trade-panel__hire-empty">当前没有可雇佣的村民 NPC。</p>'}
      </div>
      ${activeTasks.length ? `
        <div class="trade-panel__hire-summary">
          ${activeTasks.map((task) => `${escapeHtml(task.npcName)}：${Math.round((task.elapsedSeconds / task.totalSeconds) * 100)}%`).join(' · ')}
        </div>
      ` : ''}
    `;
  }

  renderConfirmation() {
    const confirmElement = this.element.querySelector('[data-trade-confirm]');

    if (!this.confirmation) {
      confirmElement.hidden = true;
      confirmElement.innerHTML = '';
      return;
    }

    confirmElement.hidden = false;
    confirmElement.innerHTML = `
      <div class="trade-panel__confirm-box" role="dialog" aria-modal="true" aria-label="${escapeHtml(this.confirmation.title)}">
        <strong>${escapeHtml(this.confirmation.title)}</strong>
        <p>${escapeHtml(this.confirmation.detail)}</p>
        <div class="trade-panel__confirm-actions">
          <button type="button" data-trade-confirm-cancel ${this.isProcessing ? 'disabled' : ''}>取消</button>
          <button type="button" data-trade-confirm-ok ${this.isProcessing ? 'disabled' : ''}>${escapeHtml(this.confirmation.confirmLabel)}</button>
        </div>
      </div>
    `;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.element.remove();
  }
}
