import { getMaterial, getRecipeEnvironmentScore, RECIPES } from '../../crafting/craftingData.js';

const WEATHER_PRESSURE_OFFSET = Object.freeze({
  clear: 0,
  rain: -0.05,
  snow: -0.08,
  aurora: -0.12,
});

const SEASON_TEMPERATURE = Object.freeze({
  spring: 18,
  summer: 27,
  autumn: 14,
  winter: -4,
});

const WEATHER_TEMPERATURE_OFFSET = Object.freeze({
  clear: 2,
  rain: -3,
  snow: -8,
  aurora: -5,
});

const CODEX_PAGE_UNLOCKS = Object.freeze({
  codex_page_tnt: {
    label: 'TNT 图鉴页',
    preferredCategories: ['能源爆炸'],
    recipeIds: ['tnt'],
  },
  codex_page_tools: {
    label: '工具图鉴页',
    preferredCategories: ['工具机械', '工具类'],
    recipeIds: ['flint_tool', 'forklift', 'excavator'],
  },
  codex_page_building: {
    label: '建材图鉴页',
    preferredCategories: ['建筑材料'],
    recipeIds: ['steel_beam', 'stone_slab'],
  },
  codex_page_elements: {
    label: '元素图鉴页',
    preferredCategories: ['基础元素', '化工物质'],
  },
});

function hashString(input) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleRecipes(recipes, seed) {
  const random = createSeededRandom(seed);
  const shuffled = [...recipes];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const temp = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = temp;
  }

  return shuffled;
}

function getCodexRecipeIds(itemId, unlock) {
  const seed = hashString(itemId);
  const targetCount = 10 + (seed % 91);
  const forcedIds = new Set(unlock.recipeIds ?? []);
  const preferredRecipes = RECIPES.filter((recipe) => (
    forcedIds.has(recipe.id) ||
    unlock.preferredCategories?.includes(recipe.category)
  ));
  const fallbackRecipes = RECIPES.filter((recipe) => !preferredRecipes.includes(recipe));
  const selected = [];
  const seen = new Set();

  [...forcedIds].forEach((recipeId) => {
    if (RECIPES.some((recipe) => recipe.id === recipeId)) {
      selected.push(recipeId);
      seen.add(recipeId);
    }
  });

  for (const recipe of shuffleRecipes(preferredRecipes, seed ^ 0x9e3779b9)) {
    if (selected.length >= targetCount) {
      break;
    }

    if (!seen.has(recipe.id)) {
      selected.push(recipe.id);
      seen.add(recipe.id);
    }
  }

  for (const recipe of shuffleRecipes(fallbackRecipes, seed ^ 0x85ebca6b)) {
    if (selected.length >= targetCount) {
      break;
    }

    if (!seen.has(recipe.id)) {
      selected.push(recipe.id);
      seen.add(recipe.id);
    }
  }

  return selected.slice(0, targetCount);
}

function formatRange(range, suffix = '') {
  return `${range[0]}-${range[1]}${suffix}`;
}

function formatPercentRange(range) {
  return `${Math.round(range[0] * 100)}%-${Math.round(range[1] * 100)}%`;
}

function stationMatches(recipe, point) {
  if (!point) {
    return false;
  }

  return recipe.station.includes(point.station) || recipe.station.includes(point.label) || point.station === '工具台';
}

function getTemperatureCelsius(biologyState) {
  if (!biologyState) {
    return 22;
  }

  const base = SEASON_TEMPERATURE[biologyState.seasonId] ?? 22;
  const weatherOffset = WEATHER_TEMPERATURE_OFFSET[biologyState.weatherId] ?? 0;
  const snowOffset = (biologyState.ecology?.snowCoverage ?? 0) * -6;

  return Math.round(base + weatherOffset + snowOffset);
}

function createDistributionSvg(material) {
  const seed = material.distribution.mapSeed ?? 1;
  const cells = [];

  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const value = ((seed >>> ((x + y) % 16)) + x * 37 + y * 53) % 100;
      const opacity = 0.16 + value / 140;
      cells.push(`<rect x="${x * 14}" y="${y * 14}" width="12" height="12" rx="2" fill="#8fd6c5" opacity="${opacity.toFixed(2)}"/>`);
    }
  }

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 98 98">',
    '<rect width="98" height="98" rx="8" fill="#121915"/>',
    '<path d="M6 28 C20 16 30 34 44 22 S70 12 90 32 L90 92 L6 92 Z" fill="#26372f"/>',
    cells.join(''),
    '<path d="M8 8 H90 V90 H8 Z" fill="none" stroke="rgba(255,255,255,.24)" stroke-width="2"/>',
    '</svg>',
  ].join('');
}

export class CraftingCodexSystem {
  constructor({ container, eventBus, worldItemSystem, interactionSystem }) {
    this.container = container;
    this.eventBus = eventBus;
    this.worldItemSystem = worldItemSystem;
    this.interactionSystem = interactionSystem;
    this.isOpen = false;
    this.query = '';
    this.unlockedRecipeIds = new Set();
    this.selectedRecipeId = null;
    this.selectedMaterialId = null;
    this.biologyState = null;
    this.weatherState = null;
    this.unlockMessage = '未拾取图鉴页';
    this.element = this.createElement();
    this.container.append(this.element);

    this.unsubscribe = [
      eventBus.on('codex:toggle', () => this.toggle()),
      eventBus.on('inventory:item-acquired', ({ itemId }) => this.handleItemAcquired(itemId)),
      eventBus.on('biology:update', (state) => {
        this.biologyState = state;
        this.render();
      }),
      eventBus.on('weather:update', (state) => {
        this.weatherState = state;
        this.render();
      }),
    ];

    this.render();
  }

  createElement() {
    const element = document.createElement('section');
    element.className = 'crafting-codex';
    element.setAttribute('aria-label', '合成图鉴');
    element.innerHTML = `
      <button class="crafting-codex__toggle" type="button" data-codex-toggle>图鉴</button>
      <div class="crafting-codex__panel" data-codex-panel>
        <div class="crafting-codex__toolbar">
          <strong>合成图鉴</strong>
          <span data-codex-count>0/${RECIPES.length} 项</span>
          <input type="search" placeholder="搜索材料或配方" data-codex-search>
        </div>
        <div class="crafting-codex__body">
          <div class="crafting-codex__list" data-codex-list></div>
          <article class="crafting-codex__detail" data-codex-detail></article>
          <aside class="crafting-codex__material" data-codex-material></aside>
        </div>
      </div>
    `;

    element.addEventListener('pointerdown', (event) => event.stopPropagation());
    element.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    element.querySelector('[data-codex-toggle]').addEventListener('click', () => this.toggle());
    element.querySelector('[data-codex-search]').addEventListener('input', (event) => {
      this.query = event.currentTarget.value.trim().toLowerCase();
      this.render();
    });
    element.addEventListener('click', (event) => {
      const recipeButton = event.target.closest('[data-recipe-id]');
      const materialButton = event.target.closest('[data-material-id]');
      const craftButton = event.target.closest('[data-craft-start]');

      if (recipeButton) {
        this.selectedRecipeId = recipeButton.dataset.recipeId;
        this.render();
      }

      if (materialButton) {
        this.selectedMaterialId = materialButton.dataset.materialId;
        this.render();
      }

      if (craftButton) {
        this.startCrafting();
      }
    });

    return element;
  }

  getEnvironment() {
    const heatCelsius = getTemperatureCelsius(this.biologyState);
    const humidity = this.biologyState?.ecology?.moisture ?? 0.45;
    const pressure = Math.max(0.5, 1 + (WEATHER_PRESSURE_OFFSET[this.weatherState?.weatherId] ?? 0));

    return { heatCelsius, humidity, pressure };
  }

  getSelectedRecipe() {
    if (!this.selectedRecipeId) {
      return null;
    }

    return RECIPES.find((recipe) => recipe.id === this.selectedRecipeId) ?? null;
  }

  getFilteredRecipes() {
    const unlockedRecipes = RECIPES.filter((recipe) => this.unlockedRecipeIds.has(recipe.id));

    if (!this.query) {
      return unlockedRecipes.slice(0, 80);
    }

    return unlockedRecipes
      .filter((recipe) => {
        const ingredientNames = recipe.ingredients.map((ingredient) => getMaterial(ingredient.itemId).name).join(' ');
        return `${recipe.name} ${recipe.category} ${ingredientNames}`.toLowerCase().includes(this.query);
      })
      .slice(0, 120);
  }

  countItemsNearPoint(point, itemId) {
    if (!point) {
      return 0;
    }

    return this.worldItemSystem.getItemsNear(point.position, point.radius ?? 3.2)
      .filter((item) => item.itemId === itemId)
      .reduce((sum, item) => sum + item.count, 0);
  }

  canCraft(recipe, point, environment) {
    const environmentScore = getRecipeEnvironmentScore(recipe, environment);
    const hasStation = stationMatches(recipe, point);
    const hasItems = Boolean(point) && recipe.ingredients.every((ingredient) => (
      this.countItemsNearPoint(point, ingredient.itemId) >= ingredient.count
    ));

    return {
      ok: environmentScore.ok && hasStation && hasItems,
      environmentScore,
      hasStation,
      hasItems,
    };
  }

  startCrafting() {
    const recipe = this.getSelectedRecipe();

    if (!recipe) {
      return;
    }

    const point = this.interactionSystem.getNearestCraftingPoint();
    const environment = this.getEnvironment();
    const state = this.canCraft(recipe, point, environment);

    if (!state.ok) {
      return;
    }

    const consumed = this.worldItemSystem.consumeItemsNear(point.position, point.radius ?? 3.2, recipe.ingredients);

    if (!consumed) {
      return;
    }

    this.worldItemSystem.dropItem(recipe.resultItemId, 1, point.position.clone().add({ x: 0, y: 1.4, z: 0 }), {
      settled: false,
    });
    this.render();
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.render();
  }

  handleItemAcquired(itemId) {
    const unlock = CODEX_PAGE_UNLOCKS[itemId];

    if (!unlock) {
      return;
    }

    let unlockedCount = 0;
    const recipeIds = getCodexRecipeIds(itemId, unlock);

    recipeIds.forEach((recipeId) => {
      if (this.unlockedRecipeIds.has(recipeId)) {
        return;
      }

      this.unlockedRecipeIds.add(recipeId);
      unlockedCount += 1;
    });

    if (!this.selectedRecipeId || !this.unlockedRecipeIds.has(this.selectedRecipeId)) {
      this.selectedRecipeId = [...this.unlockedRecipeIds][0] ?? null;
    }

    const selectedRecipe = this.getSelectedRecipe();
    this.selectedMaterialId = selectedRecipe?.ingredients[0]?.itemId ?? this.selectedMaterialId;
    this.unlockMessage = `${unlock.label} 包含 ${recipeIds.length} 条配方，本次新增 ${unlockedCount} 条`;
    this.render();
  }

  renderRecipeList() {
    const list = this.element.querySelector('[data-codex-list]');
    const recipes = this.getFilteredRecipes();

    if (recipes.length <= 0) {
      list.innerHTML = `<div class="crafting-codex__empty">${this.unlockMessage}。在地图中寻找并拾取图鉴页。</div>`;
      return;
    }

    list.innerHTML = recipes.map((recipe) => `
      <button class="crafting-codex__recipe${recipe.id === this.selectedRecipeId ? ' is-selected' : ''}" type="button" data-recipe-id="${recipe.id}">
        <span>${recipe.category}</span>
        <strong>${recipe.name}</strong>
      </button>
    `).join('');
  }

  renderRecipeDetail() {
    const recipe = this.getSelectedRecipe();
    const detail = this.element.querySelector('[data-codex-detail]');

    if (!recipe) {
      detail.innerHTML = `
        <div class="crafting-codex__empty">
          <strong>未解锁配方</strong>
          <span>拾取散落在世界中的 TNT、工具、建材或元素图鉴页后，这里会显示合成详情。</span>
        </div>
      `;
      return;
    }

    const point = this.interactionSystem.getNearestCraftingPoint();
    const environment = this.getEnvironment();
    const state = this.canCraft(recipe, point, environment);
    const result = getMaterial(recipe.resultItemId);

    detail.innerHTML = `
      <div class="crafting-codex__title">
        <img src="${result.svg}" alt="">
        <div>
          <span>${recipe.category}</span>
          <h2>${recipe.name}</h2>
        </div>
      </div>
      <p>${recipe.description}</p>
      <div class="crafting-codex__meta">
        <span>合成点</span><strong>${recipe.station}</strong>
        <span>当前</span><strong>${point?.label ?? '不在合成点'}</strong>
      </div>
      <div class="crafting-codex__conditions">
        <span class="${state.environmentScore.heatOk ? 'is-ok' : ''}">热量 ${formatRange(recipe.conditions.heat, '°C')} / ${environment.heatCelsius}°C</span>
        <span class="${state.environmentScore.humidityOk ? 'is-ok' : ''}">湿度 ${formatPercentRange(recipe.conditions.humidity)} / ${Math.round(environment.humidity * 100)}%</span>
        <span class="${state.environmentScore.pressureOk ? 'is-ok' : ''}">压力 ${formatRange(recipe.conditions.pressure)} / ${environment.pressure.toFixed(2)}</span>
      </div>
      <div class="crafting-codex__ingredients">
        ${recipe.ingredients.map((ingredient) => {
          const material = getMaterial(ingredient.itemId);
          const nearCount = this.countItemsNearPoint(point, ingredient.itemId);

          return `
            <button type="button" data-material-id="${material.id}">
              <img src="${material.svg}" alt="">
              <span>${material.name}</span>
              <strong>${nearCount}/${ingredient.count}</strong>
            </button>
          `;
        }).join('')}
      </div>
      <button class="crafting-codex__craft" type="button" data-craft-start ${state.ok ? '' : 'disabled'}>开始合成</button>
    `;
  }

  renderMaterialDetail() {
    const panel = this.element.querySelector('[data-codex-material]');
    const selectedRecipe = this.getSelectedRecipe();
    const material = getMaterial(this.selectedMaterialId ?? selectedRecipe?.ingredients[0]?.itemId ?? 'codex_page_tnt');

    if (!this.selectedMaterialId && !selectedRecipe) {
      panel.innerHTML = `
        <div class="crafting-codex__empty">
          <strong>材料信息未解锁</strong>
          <span>点击已解锁配方中的材料后，可查看详细描述和分布图。</span>
        </div>
      `;
      return;
    }

    const recipes = RECIPES
      .filter((recipe) => recipe.ingredients.some((ingredient) => ingredient.itemId === material.id))
      .slice(0, 6);

    panel.innerHTML = `
      <div class="crafting-codex__material-head">
        <img src="${material.svg}" alt="">
        <div>
          <span>${material.category}</span>
          <strong>${material.name}</strong>
        </div>
      </div>
      <p>${material.description}</p>
      <div class="crafting-codex__map">${createDistributionSvg(material)}</div>
      <div class="crafting-codex__meta crafting-codex__meta--single">
        <span>分布</span><strong>${material.distribution.biome}</strong>
        <span>稀有度</span><strong>${material.distribution.rarity}</strong>
        <span>环境</span><strong>${material.distribution.heatAffinity} · ${material.distribution.humidityAffinity} · ${material.distribution.pressureAffinity}</strong>
      </div>
      <div class="crafting-codex__uses">
        ${recipes.map((recipe) => `<button type="button" data-recipe-id="${recipe.id}">${recipe.name}</button>`).join('')}
      </div>
    `;
  }

  render() {
    const panel = this.element.querySelector('[data-codex-panel]');
    const count = this.element.querySelector('[data-codex-count]');
    panel.classList.toggle('is-open', this.isOpen);

    if (count) {
      count.textContent = `${this.unlockedRecipeIds.size}/${RECIPES.length} 项`;
    }

    this.renderRecipeList();
    this.renderRecipeDetail();
    this.renderMaterialDetail();
  }

  serialize() {
    return {
      unlockedRecipeIds: [...this.unlockedRecipeIds],
      selectedRecipeId: this.selectedRecipeId,
      selectedMaterialId: this.selectedMaterialId,
      unlockMessage: this.unlockMessage,
    };
  }

  restore(state = {}) {
    this.unlockedRecipeIds = new Set(
      Array.isArray(state.unlockedRecipeIds)
        ? state.unlockedRecipeIds.filter((recipeId) => RECIPES.some((recipe) => recipe.id === recipeId))
        : [],
    );
    this.selectedRecipeId = this.unlockedRecipeIds.has(state.selectedRecipeId)
      ? state.selectedRecipeId
      : [...this.unlockedRecipeIds][0] ?? null;
    this.selectedMaterialId = state.selectedMaterialId ?? null;
    this.unlockMessage = state.unlockMessage ?? '已加载图鉴';
    this.render();
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.element.remove();
  }
}
