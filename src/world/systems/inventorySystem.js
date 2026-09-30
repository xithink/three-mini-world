import * as THREE from 'three';
import { BLOCK_IDS } from '../chunk.js';
import { getMaterial } from '../../crafting/craftingData.js';

const HOTBAR_SIZE = 9;
const BACKPACK_SIZE = 100;
const STACK_LIMIT = Number.MAX_SAFE_INTEGER;

export const PLACEABLE_ITEM_BLOCKS = Object.freeze({
  tnt_block: BLOCK_IDS.TNT,
  workbench: BLOCK_IDS.CRAFTING_TABLE,
  stone_slab: BLOCK_IDS.STONE_SLAB,
  steel_beam: BLOCK_IDS.STEEL_BLOCK,
  grass_block: BLOCK_IDS.GRASS,
  dry_grass_block: BLOCK_IDS.DRY_GRASS,
  dirt_block: BLOCK_IDS.DIRT,
  stone: BLOCK_IDS.STONE,
  cave_stone: BLOCK_IDS.CAVE_STONE,
  rock_mountain_stone: BLOCK_IDS.ROCK_MOUNTAIN,
  forest_mountain_block: BLOCK_IDS.FOREST_MOUNTAIN,
  sand: BLOCK_IDS.SAND,
  snow_block: BLOCK_IDS.SNOW,
  snow_mountain_block: BLOCK_IDS.SNOW_MOUNTAIN,
  ice: BLOCK_IDS.ICE,
  wood: BLOCK_IDS.WOOD,
  birch_wood: BLOCK_IDS.BIRCH_WOOD,
  leaves: BLOCK_IDS.LEAVES,
  cactus: BLOCK_IDS.CACTUS,
});

function createEmptySlots(length) {
  return Array.from({ length }, () => null);
}

function cloneStack(stack) {
  return stack ? { itemId: stack.itemId, count: stack.count } : null;
}

function stackLabel(stack) {
  if (!stack) {
    return '';
  }

  return getMaterial(stack.itemId).name;
}

export class InventorySystem {
  constructor({ container, eventBus, player, worldItemSystem }) {
    this.container = container;
    this.eventBus = eventBus;
    this.player = player;
    this.worldItemSystem = worldItemSystem;
    this.hotbar = createEmptySlots(HOTBAR_SIZE);
    this.hotbarEntryOrder = createEmptySlots(HOTBAR_SIZE);
    this.backpack = createEmptySlots(BACKPACK_SIZE);
    this.nextHotbarEntryOrder = 1;
    this.selectedHotbarIndex = 0;
    this.isOpen = false;
    this.swapSource = null;
    this.status = '准备';
    this.element = this.createElement();
    this.container.append(this.element);

    this.unsubscribe = [
      eventBus.on('inventory:toggle', () => this.toggle()),
      eventBus.on('inventory:hotbar-next', () => this.selectNextHotbar()),
      eventBus.on('inventory:throw-selected', () => this.throwSelected()),
      eventBus.on('inventory:consume-selected', ({ count = 1 } = {}) => this.removeSelected(count)),
    ];

    this.render();
  }

  createElement() {
    const element = document.createElement('section');
    element.className = 'inventory-ui';
    element.setAttribute('aria-label', '背包与物品栏');
    element.innerHTML = `
      <div class="inventory-ui__hotbar" data-hotbar></div>
      <div class="inventory-ui__panel" data-inventory-panel>
        <div class="inventory-ui__header">
          <strong>背包</strong>
          <button class="inventory-ui__sort" type="button" data-inventory-sort>整理</button>
          <span data-inventory-status>准备</span>
        </div>
        <div class="inventory-ui__grid" data-backpack></div>
      </div>
    `;

    element.addEventListener('pointerdown', (event) => event.stopPropagation());
    element.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    element.addEventListener('click', (event) => {
      if (event.target.closest('[data-inventory-sort]')) {
        this.sortInventory();
        return;
      }

      const slot = event.target.closest('[data-inventory-slot]');

      if (!slot) {
        return;
      }

      this.handleSlotClick(slot.dataset.inventoryArea, Number(slot.dataset.inventoryIndex));
    });

    return element;
  }

  getSelectedStack() {
    return this.hotbar[this.selectedHotbarIndex];
  }

  getSelectedItemId() {
    return this.getSelectedStack()?.itemId ?? null;
  }

  getSelectedPlaceBlockId() {
    const itemId = this.getSelectedItemId();

    return itemId ? PLACEABLE_ITEM_BLOCKS[itemId] ?? null : null;
  }

  addItem(itemId, count = 1) {
    let remaining = count;
    const allSlots = [this.hotbar, this.backpack];

    for (const slots of allSlots) {
      for (const stack of slots) {
        if (!stack || stack.itemId !== itemId || stack.count >= STACK_LIMIT) {
          continue;
        }

        const added = Math.min(remaining, STACK_LIMIT - stack.count);
        stack.count += added;
        remaining -= added;

        if (remaining <= 0) {
          this.status = `获得 ${getMaterial(itemId).name} x${count}`;
          this.eventBus?.emit('inventory:item-acquired', { itemId, count });
          this.render();
          return true;
        }
      }
    }

    for (const slots of allSlots) {
      for (let index = 0; index < slots.length; index += 1) {
        if (slots[index]) {
          continue;
        }

        const added = Math.min(remaining, STACK_LIMIT);
        slots[index] = { itemId, count: added };
        if (slots === this.hotbar) {
          this.hotbarEntryOrder[index] = this.nextHotbarEntryOrder;
          this.nextHotbarEntryOrder += 1;
        }
        remaining -= added;

        if (remaining <= 0) {
          this.status = `获得 ${getMaterial(itemId).name} x${count}`;
          this.eventBus?.emit('inventory:item-acquired', { itemId, count });
          this.render();
          return true;
        }
      }
    }

    this.status = '背包已满';
    this.render();

    return false;
  }

  addToBackpack(itemId, count = 1) {
    let remaining = count;

    for (const stack of this.backpack) {
      if (!stack || stack.itemId !== itemId || stack.count >= STACK_LIMIT) {
        continue;
      }

      const added = Math.min(remaining, STACK_LIMIT - stack.count);
      stack.count += added;
      remaining -= added;

      if (remaining <= 0) {
        this.render();
        return true;
      }
    }

    for (let index = 0; index < this.backpack.length; index += 1) {
      if (this.backpack[index]) {
        continue;
      }

      const added = Math.min(remaining, STACK_LIMIT);
      this.backpack[index] = { itemId, count: added };
      remaining -= added;

      if (remaining <= 0) {
        this.render();
        return true;
      }
    }

    this.render();

    return false;
  }

  holdItem(itemId, count = 1) {
    return this.addToHotbarAndSelect(itemId, count);
  }

  addToHotbarAndSelect(itemId, count = 1) {
    let remaining = count;
    const existingIndex = this.hotbar.findIndex((stack) => (
      stack?.itemId === itemId && stack.count < STACK_LIMIT
    ));

    if (existingIndex >= 0) {
      const stack = this.hotbar[existingIndex];
      const added = Math.min(remaining, STACK_LIMIT - stack.count);

      stack.count += added;
      remaining -= added;
      this.selectedHotbarIndex = existingIndex;

      if (remaining <= 0) {
        this.status = `手持 ${getMaterial(itemId).name} x${stack.count}`;
        this.eventBus?.emit('inventory:item-acquired', { itemId, count });
        this.render();
        return true;
      }
    }

    while (remaining > 0) {
      const targetIndex = this.findHotbarInsertionIndex();

      if (targetIndex < 0) {
        this.status = '背包已满，无法拾取到物品栏';
        this.render();
        return false;
      }

      const added = Math.min(remaining, STACK_LIMIT);
      this.hotbar[targetIndex] = { itemId, count: added };
      this.hotbarEntryOrder[targetIndex] = this.nextHotbarEntryOrder;
      this.nextHotbarEntryOrder += 1;
      this.selectedHotbarIndex = targetIndex;
      remaining -= added;
    }

    this.status = `手持 ${getMaterial(itemId).name} x${count}`;
    this.eventBus?.emit('inventory:item-acquired', { itemId, count });
    this.render();

    return true;
  }

  findHotbarInsertionIndex() {
    const emptyIndex = this.hotbar.findIndex((stack) => !stack);

    if (emptyIndex >= 0) {
      return emptyIndex;
    }

    const oldestIndex = this.getOldestHotbarIndex();
    const oldestStack = this.hotbar[oldestIndex];

    if (!oldestStack) {
      return oldestIndex;
    }

    if (!this.addToBackpack(oldestStack.itemId, oldestStack.count)) {
      return -1;
    }

    this.hotbar[oldestIndex] = null;
    this.hotbarEntryOrder[oldestIndex] = null;

    return oldestIndex;
  }

  getOldestHotbarIndex() {
    let oldestIndex = 0;
    let oldestOrder = Infinity;

    this.hotbarEntryOrder.forEach((order, index) => {
      if (typeof order === 'number' && order < oldestOrder) {
        oldestOrder = order;
        oldestIndex = index;
      }
    });

    return oldestIndex;
  }

  removeItems(ingredients) {
    if (!this.hasItems(ingredients)) {
      return false;
    }

    ingredients.forEach(({ itemId, count }) => {
      let remaining = count;

      for (const slots of [this.hotbar, this.backpack]) {
        for (let index = 0; index < slots.length; index += 1) {
          const stack = slots[index];

          if (!stack || stack.itemId !== itemId || remaining <= 0) {
            continue;
          }

          const removed = Math.min(remaining, stack.count);
          stack.count -= removed;
          remaining -= removed;

          if (stack.count <= 0) {
            slots[index] = null;
          }
        }
      }
    });

    this.render();

    return true;
  }

  hasItems(ingredients) {
    return ingredients.every(({ itemId, count }) => this.countItem(itemId) >= count);
  }

  countItem(itemId) {
    return [...this.hotbar, ...this.backpack]
      .filter((stack) => stack?.itemId === itemId)
      .reduce((sum, stack) => sum + stack.count, 0);
  }

  removeSelected(count = 1) {
    const stack = this.getSelectedStack();

    if (!stack || stack.count < count) {
      this.render();
      return false;
    }

    stack.count -= count;

    if (stack.count <= 0) {
      this.hotbar[this.selectedHotbarIndex] = null;
      this.hotbarEntryOrder[this.selectedHotbarIndex] = null;
    }

    this.render();

    return true;
  }

  dropSelected() {
    const stack = this.getSelectedStack();

    if (!stack) {
      this.status = '当前物品栏为空';
      this.render();
      return false;
    }

    const direction = this.player.characterFacingDirection.clone().normalize();
    const position = this.player.position.clone().add(new THREE.Vector3(0, 1.05, 0)).addScaledVector(direction, 1);

    this.worldItemSystem.dropItem(stack.itemId, 1, position, { velocity: direction.multiplyScalar(1.5) });
    this.removeSelected(1);
    this.status = '已放下物品';
    this.render();

    return true;
  }

  throwSelected() {
    const stack = this.getSelectedStack();

    if (!stack) {
      this.status = '当前物品栏为空';
      this.render();
      return false;
    }

    const direction = this.player.cameraDirection.lengthSq() > 0
      ? this.player.cameraDirection.clone().normalize()
      : this.player.characterFacingDirection.clone().normalize();
    const position = this.player.position.clone().add(new THREE.Vector3(0, 1.25, 0)).addScaledVector(direction, 1.2);
    const velocity = direction.multiplyScalar(9.5);
    velocity.y += 2.2;

    this.worldItemSystem.dropItem(stack.itemId, 1, position, { velocity });
    this.removeSelected(1);
    this.status = '已掷出物品';
    this.render();

    return true;
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.render();
  }

  selectNextHotbar() {
    this.selectedHotbarIndex = (this.selectedHotbarIndex + 1) % HOTBAR_SIZE;
    this.render();
  }

  sortInventory() {
    const countByItemId = new Map();

    [...this.hotbar, ...this.backpack].forEach((stack) => {
      if (!stack?.itemId || stack.count <= 0) {
        return;
      }

      countByItemId.set(stack.itemId, (countByItemId.get(stack.itemId) ?? 0) + stack.count);
    });

    const sortedStacks = [...countByItemId.entries()]
      .map(([itemId, count]) => ({ itemId, count }))
      .sort((a, b) => {
        const materialA = getMaterial(a.itemId);
        const materialB = getMaterial(b.itemId);

        return materialA.category.localeCompare(materialB.category, 'zh-CN')
          || materialA.name.localeCompare(materialB.name, 'zh-CN')
          || a.itemId.localeCompare(b.itemId);
      });

    this.hotbar = createEmptySlots(HOTBAR_SIZE);
    this.backpack = createEmptySlots(BACKPACK_SIZE);
    this.hotbarEntryOrder = createEmptySlots(HOTBAR_SIZE);

    sortedStacks.slice(0, HOTBAR_SIZE).forEach((stack, index) => {
      this.hotbar[index] = stack;
      this.hotbarEntryOrder[index] = index + 1;
    });

    sortedStacks.slice(HOTBAR_SIZE, HOTBAR_SIZE + BACKPACK_SIZE).forEach((stack, index) => {
      this.backpack[index] = stack;
    });

    this.selectedHotbarIndex = Math.min(this.selectedHotbarIndex, HOTBAR_SIZE - 1);
    this.nextHotbarEntryOrder = HOTBAR_SIZE + 1;
    this.swapSource = null;
    this.status = `已整理 ${sortedStacks.length} 类物品`;
    this.render();
  }

  handleSlotClick(area, index) {
    const slots = area === 'hotbar' ? this.hotbar : this.backpack;

    if (!slots[index]) {
      if (!this.swapSource) {
        return;
      }

      const sourceOrder = this.swapSource.area === 'hotbar'
        ? this.hotbarEntryOrder[this.swapSource.index]
        : null;

      slots[index] = cloneStack(this.swapSource.slots[this.swapSource.index]);
      this.swapSource.slots[this.swapSource.index] = null;

      if (this.swapSource.area === 'hotbar') {
        this.hotbarEntryOrder[this.swapSource.index] = null;
      }

      if (area === 'hotbar') {
        this.hotbarEntryOrder[index] = sourceOrder ?? this.nextHotbarEntryOrder;

        if (sourceOrder === null) {
          this.nextHotbarEntryOrder += 1;
        }
      }

      this.swapSource = null;
      this.render();
      return;
    }

    if (!this.swapSource) {
      this.swapSource = { area, index, slots };
      this.render();
      return;
    }

    const sourceStack = this.swapSource.slots[this.swapSource.index];
    const targetStack = slots[index];

    if (sourceStack && targetStack && sourceStack.itemId === targetStack.itemId) {
      targetStack.count += sourceStack.count;
      this.swapSource.slots[this.swapSource.index] = null;

      if (this.swapSource.area === 'hotbar') {
        this.hotbarEntryOrder[this.swapSource.index] = null;
      }
    } else {
      const sourceOrder = this.swapSource.area === 'hotbar'
        ? this.hotbarEntryOrder[this.swapSource.index]
        : null;
      const targetOrder = area === 'hotbar'
        ? this.hotbarEntryOrder[index]
        : null;

      this.swapSource.slots[this.swapSource.index] = targetStack;
      slots[index] = sourceStack;

      if (this.swapSource.area === 'hotbar') {
        this.hotbarEntryOrder[this.swapSource.index] = targetStack
          ? targetOrder ?? this.nextHotbarEntryOrder
          : null;

        if (targetStack && targetOrder === null) {
          this.nextHotbarEntryOrder += 1;
        }
      }

      if (area === 'hotbar') {
        this.hotbarEntryOrder[index] = sourceStack
          ? sourceOrder ?? this.nextHotbarEntryOrder
          : null;

        if (sourceStack && sourceOrder === null) {
          this.nextHotbarEntryOrder += 1;
        }
      }
    }

    this.swapSource = null;
    this.render();
  }

  renderSlot(area, stack, index) {
    const material = stack ? getMaterial(stack.itemId) : null;
    const selected = area === 'hotbar' && index === this.selectedHotbarIndex;
    const moving = this.swapSource?.area === area && this.swapSource?.index === index;

    return `
      <button class="inventory-ui__slot${selected ? ' is-selected' : ''}${moving ? ' is-moving' : ''}" type="button" data-inventory-slot data-inventory-area="${area}" data-inventory-index="${index}" aria-label="${stackLabel(stack) || '空槽'}">
        ${material ? `<img src="${material.svg}" alt="">` : ''}
        ${stack ? `<span>${material.name}</span><strong>${stack.count}</strong>` : ''}
      </button>
    `;
  }

  render() {
    const hotbar = this.element.querySelector('[data-hotbar]');
    const backpack = this.element.querySelector('[data-backpack]');
    const panel = this.element.querySelector('[data-inventory-panel]');
    const status = this.element.querySelector('[data-inventory-status]');

    hotbar.innerHTML = this.hotbar.map((stack, index) => this.renderSlot('hotbar', stack, index)).join('');
    backpack.innerHTML = this.backpack.map((stack, index) => this.renderSlot('backpack', stack, index)).join('');
    panel.classList.toggle('is-open', this.isOpen);
    status.textContent = this.status;
  }

  serialize() {
    return {
      hotbar: this.hotbar.map(cloneStack),
      hotbarEntryOrder: [...this.hotbarEntryOrder],
      backpack: this.backpack.map(cloneStack),
      selectedHotbarIndex: this.selectedHotbarIndex,
      nextHotbarEntryOrder: this.nextHotbarEntryOrder,
    };
  }

  restore(state = {}) {
    this.hotbar = createEmptySlots(HOTBAR_SIZE);
    this.backpack = createEmptySlots(BACKPACK_SIZE);
    this.hotbarEntryOrder = createEmptySlots(HOTBAR_SIZE);

    if (Array.isArray(state.hotbar)) {
      state.hotbar.slice(0, HOTBAR_SIZE).forEach((stack, index) => {
        this.hotbar[index] = cloneStack(stack);
      });
    }

    if (Array.isArray(state.backpack)) {
      state.backpack.slice(0, BACKPACK_SIZE).forEach((stack, index) => {
        this.backpack[index] = cloneStack(stack);
      });
    }

    if (Array.isArray(state.hotbarEntryOrder)) {
      state.hotbarEntryOrder.slice(0, HOTBAR_SIZE).forEach((order, index) => {
        this.hotbarEntryOrder[index] = typeof order === 'number' ? order : null;
      });
    }

    this.selectedHotbarIndex = Math.max(0, Math.min(HOTBAR_SIZE - 1, Number(state.selectedHotbarIndex ?? 0)));
    this.nextHotbarEntryOrder = Math.max(
      Number(state.nextHotbarEntryOrder ?? 1),
      Math.max(0, ...this.hotbarEntryOrder.filter((order) => typeof order === 'number')) + 1,
    );
    this.status = '已加载背包';
    this.render();
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.element.remove();
  }
}
