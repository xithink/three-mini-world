const SEASON_LABELS = Object.freeze({
  spring: '春季',
  summer: '夏季',
  autumn: '秋季',
  winter: '冬季',
});

const WEATHER_LABELS = Object.freeze({
  clear: '晴天',
  rain: '雨天',
  snow: '雪天',
  aurora: '极光',
});

const AUDIO_VOLUME_CONTROLS = Object.freeze([
  { key: 'backgroundVolume', label: '背景乐' },
  { key: 'ambientVolume', label: '环境音' },
  { key: 'eventVolume', label: '事件音效' },
  { key: 'voiceVolume', label: '人物语音' },
]);

const GUIDE_ITEMS = Object.freeze([
  { keys: 'WASD / 方向键', text: '移动' },
  { keys: 'Space', text: '跳跃 / 起身' },
  { keys: 'F', text: '切换视角' },
  { keys: 'K', text: '踢击' },
  { keys: 'Z', text: '背包' },
  { keys: 'V', text: '滑翔' },
  { keys: 'T', text: '悬浮' },
  { keys: 'E / Q / R', text: '拾取 / 掷出 / 放置' },
  { keys: 'C', text: '打火石' },
  { keys: 'Tab', text: '切换物品栏' },
  { keys: 'X', text: '躺下' },
  { keys: 'B', text: '合成图鉴' },
  { keys: '查找雪莲', text: '定位天山雪莲' },
]);

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

function formatClock(normalizedDay) {
  const totalMinutes = Math.floor(normalizedDay * 24 * 60) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getClockMinutes(normalizedDay) {
  return Math.floor(normalizedDay * 24 * 60) % (24 * 60);
}

function formatHour(hour) {
  const normalized = ((hour % 24) + 24) % 24;
  const totalMinutes = Math.round(normalized * 60) % (24 * 60);
  const wholeHour = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(wholeHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatPercent(value) {
  if (typeof value !== 'number') {
    return '--';
  }

  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatHoverTemperature(hoverState) {
  if (typeof hoverState?.temperatureCelsius === 'number') {
    return `${Math.round(hoverState.temperatureCelsius)}°C`;
  }

  return formatPercent(hoverState?.temperature);
}

function formatSnowLotusExtras(hoverState) {
  if (hoverState?.type !== 'snowLotus') {
    return [];
  }

  return [
    `土${formatPercent(hoverState.soilMoisture)}`,
    `雪${formatPercent(hoverState.snowCoverage)}`,
  ];
}

function formatPlantHeightExtras(hoverState) {
  if (typeof hoverState?.plantHeight !== 'number') {
    return [];
  }

  return [`高${hoverState.plantHeight.toFixed(2)}格`];
}

function formatGrowthCycle(hoverState) {
  if (!hoverState?.cycle) {
    return '--';
  }

  if (typeof hoverState.cycleDay === 'number' && typeof hoverState.cycleDays === 'number') {
    return `${hoverState.cycle} · 第 ${hoverState.cycleDay}/${hoverState.cycleDays} 天`;
  }

  return hoverState.cycle;
}

function formatCompassDirection(headingDegrees) {
  if (typeof headingDegrees !== 'number' || Number.isNaN(headingDegrees)) {
    return '北';
  }

  const labels = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  const index = Math.round((headingDegrees / 45)) % labels.length;

  return labels[index < 0 ? index + labels.length : index];
}

function estimateTemperatureCelsius(biologyState) {
  if (!biologyState) {
    return null;
  }

  const base = SEASON_TEMPERATURE[biologyState.seasonId] ?? SEASON_TEMPERATURE.summer;
  const weatherOffset = WEATHER_TEMPERATURE_OFFSET[biologyState.weatherId] ?? 0;
  const snowOffset = (biologyState.ecology?.snowCoverage ?? 0) * -6;

  return Math.round(base + weatherOffset + snowOffset);
}

export class WorldStatusHud {
  constructor({ container, eventBus, playerName = '未来探险家' }) {
    this.container = container;
    this.eventBus = eventBus;
    this.state = {
      time: '--:--',
      minutes: 0,
      dayOfYear: 1,
      stage: '凌晨',
      season: '夏季',
      weather: '晴天',
      sunrise: '--:--',
      sunset: '--:--',
      stageDuration: '--',
      ecosystem: '--',
      humidity: '--',
      temperature: '--',
      hoverTitle: '未选中',
      hoverStage: '--',
      hoverCycle: '--',
      hoverStatus: '--',
      hoverGrowth: '--',
      hoverHealth: '--',
      hoverEnvironment: '--',
      hoverVisible: false,
      buildingTitle: '未选中',
      buildingCreator: '--',
      buildingUser: '--',
      buildingName: '--',
      buildingReference: '--',
      buildingBlocks: '--',
      buildingStatus: '--',
      buildingMergedPrompt: '--',
      buildingVisible: false,
      buildingCanClear: false,
      buildingRecord: null,
      buildingHoverSources: {
        pointer: null,
        crosshair: null,
      },
      snowLotusFinder: '未查找',
      guideOpen: false,
      compassHeading: 0,
      compassDirection: '北',
      player: playerName,
      stamina: '--',
      hunger: '--',
      speed: '--',
      body: '--',
      playerHeight: '--',
      audioVolumes: Object.fromEntries(AUDIO_VOLUME_CONTROLS.map(({ key }) => [key, 1])),
    };
    this.element = this.createElement();
    this.handleTimeInput = (event) => {
      this.eventBus.emit('time:set-minutes', {
        minutes: Number(event.currentTarget.value),
      });
    };
    this.handleShiftClick = (event) => {
      const minutes = Number(event.currentTarget.dataset.timeShift ?? 0);

      this.eventBus.emit('time:shift-minutes', { minutes });
    };
    this.handleAudioVolumeInput = (event) => {
      const key = event.currentTarget.dataset.audioVolume;
      const value = Number(event.currentTarget.value) / 100;

      this.eventBus.emit('sound:set-volume', { key, value });
    };
    this.handleSnowLotusFindClick = () => {
      this.state.snowLotusFinder = '查找中';
      this.render();
      this.eventBus.emit('snowLotus:find-nearest');
    };
    this.handleGuideToggle = () => {
      this.state.guideOpen = !this.state.guideOpen;
      this.render();
    };
    this.handleBuildingClearClick = this.handleBuildingClearClick.bind(this);
    this.stopPointerPropagation = (event) => {
      event.stopPropagation();
    };
    this.unsubscribe = [
      eventBus.on('time:update', (timeState) => this.handleTimeUpdate(timeState)),
      eventBus.on('biology:update', (biologyState) => this.handleBiologyUpdate(biologyState)),
      eventBus.on('weather:update', (weatherState) => this.handleWeatherUpdate(weatherState)),
      eventBus.on('ecosystem:hover', (hoverState) => this.handleEcosystemHover(hoverState)),
      eventBus.on('building:hover', (hoverState) => this.handleBuildingHover(hoverState, 'crosshair')),
      eventBus.on('building:pointer-hover', (hoverState) => this.handleBuildingHover(hoverState, 'pointer')),
      eventBus.on('sound:volume-state', (volumeState) => this.handleAudioVolumeUpdate(volumeState)),
      eventBus.on('player:update', (playerState) => this.handlePlayerUpdate(playerState)),
      eventBus.on('snowLotus:finder-update', (finderState) => this.handleSnowLotusFinderUpdate(finderState)),
    ];

    this.bindControls();
    this.eventBus.emit('biology:request-state');
    this.eventBus.emit('sound:request-volume-state');
    this.render();
    container.append(this.element);
  }

  createElement() {
    const element = document.createElement('aside');
    element.className = 'world-status-hud';
    element.setAttribute('aria-label', '世界时间、四季与天气状态');

    element.innerHTML = `
      <div class="world-status-hud__primary">
        <span class="world-status-hud__label">世界时间</span>
        <span class="world-status-hud__time" data-hud-field="time">--:--</span>
      </div>
      <div class="world-status-hud__controls">
        <button class="world-status-hud__button" type="button" data-time-shift="-60" aria-label="时间后退一小时">-1h</button>
        <input class="world-status-hud__slider" type="range" min="0" max="1439" step="5" value="0" aria-label="调整世界时间" data-time-slider>
        <button class="world-status-hud__button" type="button" data-time-shift="60" aria-label="时间前进一小时">+1h</button>
      </div>
      <div class="world-status-hud__quick-controls">
        <button class="world-status-hud__button" type="button" data-time-shift="1440" aria-label="时间前进一天">+1d</button>
        <button class="world-status-hud__button" type="button" data-time-shift="43200" aria-label="时间前进三十天">+1mo</button>
      </div>
      <div class="world-status-hud__grid">
        <span>阶段</span><strong data-hud-field="stage">--</strong>
        <span>四季</span><strong data-hud-field="season">--</strong>
        <span>天气</span><strong data-hud-field="weather">--</strong>
        <span>年日</span><strong data-hud-field="dayOfYear">--</strong>
        <span>湿度</span><strong data-hud-field="humidity">--</strong>
        <span>温度</span><strong data-hud-field="temperature">--</strong>
        <span>日出</span><strong data-hud-field="sunrise">--:--</strong>
        <span>日落</span><strong data-hud-field="sunset">--:--</strong>
        <span>阶段时长</span><strong data-hud-field="stageDuration">--</strong>
        <span>群落活性</span><strong data-hud-field="ecosystem">--</strong>
        <span>Player</span><strong data-hud-field="player">--</strong>
        <span>体力</span><strong data-hud-field="stamina">--</strong>
        <span>饥饿</span><strong data-hud-field="hunger">--</strong>
        <span>速度</span><strong data-hud-field="speed">--</strong>
        <span>体格</span><strong data-hud-field="body">--</strong>
        <span>人物高度</span><strong data-hud-field="playerHeight">--</strong>
      </div>
      <div class="world-status-hud__fixed-actions">
        <div class="world-status-hud__finder">
          <button class="world-status-hud__button" type="button" data-snow-lotus-find>查找雪莲</button>
          <strong data-hud-field="snowLotusFinder">未查找</strong>
        </div>
        <div class="world-status-hud__guide">
          <button class="world-status-hud__button" type="button" data-guide-toggle aria-pressed="false">指南</button>
          <div class="world-status-hud__guide-panel" data-guide-panel>
            ${GUIDE_ITEMS.map(({ keys, text }) => `
              <div class="world-status-hud__guide-row">
                <span>${keys}</span>
                <strong>${text}</strong>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="world-status-hud__ecosystem" aria-label="生态目标状态">
        <div class="world-status-hud__ecosystem-title">
          <span>生态目标</span><strong data-hud-field="hoverTitle">未选中</strong>
        </div>
        <div class="world-status-hud__grid world-status-hud__grid--compact">
          <span>阶段</span><strong data-hud-field="hoverStage">--</strong>
          <span>周期</span><strong data-hud-field="hoverCycle">--</strong>
          <span>状态</span><strong data-hud-field="hoverStatus">--</strong>
          <span data-hud-label="hoverGrowth">生长</span><strong data-hud-field="hoverGrowth">--</strong>
          <span data-hud-label="hoverHealth">健康</span><strong data-hud-field="hoverHealth">--</strong>
          <span>环境</span><strong data-hud-field="hoverEnvironment">--</strong>
        </div>
      </div>
      <div class="world-status-hud__building" aria-label="建筑悬停状态">
        <div class="world-status-hud__building-title">
          <span>建筑</span><strong data-hud-field="buildingTitle">未选中</strong>
        </div>
        <div class="world-status-hud__grid world-status-hud__grid--compact">
          <span>创建者</span><strong data-hud-field="buildingCreator">--</strong>
          <span>用户</span><strong data-hud-field="buildingUser">--</strong>
          <span>名称</span><strong data-hud-field="buildingName">--</strong>
          <span>参考图</span><strong data-hud-field="buildingReference">--</strong>
          <span>方块</span><strong data-hud-field="buildingBlocks">--</strong>
          <span>状态</span><strong data-hud-field="buildingStatus">--</strong>
        </div>
        <details class="world-status-hud__building-prompt" data-building-prompt hidden>
          <summary>最终整合提示词</summary>
          <pre data-hud-field="buildingMergedPrompt">--</pre>
        </details>
        <div class="world-status-hud__building-actions">
          <button class="world-status-hud__button" type="button" data-building-clear hidden>清除建筑</button>
        </div>
      </div>
      <div class="world-status-hud__audio" aria-label="音量调节">
        ${AUDIO_VOLUME_CONTROLS.map(({ key, label }) => `
          <label class="world-status-hud__volume-row">
            <span>${label}</span>
            <input class="world-status-hud__volume-slider" type="range" min="0" max="100" step="1" value="100" aria-label="${label}音量" data-audio-volume="${key}">
            <strong data-audio-volume-value="${key}">100%</strong>
          </label>
        `).join('')}
      </div>
      <div class="world-status-hud__compass" aria-label="指南针">
        <span>指南针</span>
        <div class="world-status-hud__compass-ring">
          <i class="world-status-hud__compass-needle" style="--compass-rotation: 0deg"></i>
          <strong data-hud-field="compassDirection">北</strong>
        </div>
      </div>
    `;

    return element;
  }

  bindControls() {
    this.slider = this.element.querySelector('[data-time-slider]');
    this.shiftButtons = Array.from(this.element.querySelectorAll('[data-time-shift]'));
    this.audioSliders = Array.from(this.element.querySelectorAll('[data-audio-volume]'));
    this.snowLotusFindButton = this.element.querySelector('[data-snow-lotus-find]');
    this.guideToggleButton = this.element.querySelector('[data-guide-toggle]');
    this.guidePanel = this.element.querySelector('[data-guide-panel]');
    this.buildingClearButton = this.element.querySelector('[data-building-clear]');

    this.slider.addEventListener('input', this.handleTimeInput);
    this.shiftButtons.forEach((button) => {
      button.addEventListener('click', this.handleShiftClick);
    });
    this.audioSliders.forEach((slider) => {
      slider.addEventListener('input', this.handleAudioVolumeInput);
    });
    this.snowLotusFindButton?.addEventListener('click', this.handleSnowLotusFindClick);
    this.guideToggleButton?.addEventListener('click', this.handleGuideToggle);
    this.buildingClearButton?.addEventListener('click', this.handleBuildingClearClick);
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
      this.element.addEventListener(eventName, this.stopPointerPropagation);
    });
    this.element.addEventListener('wheel', this.stopPointerPropagation, { passive: true });
  }

  setField(name, value) {
    const field = this.element.querySelector(`[data-hud-field="${name}"]`);

    if (field) {
      field.textContent = value;
    }
  }

  setLabel(name, value) {
    const label = this.element.querySelector(`[data-hud-label="${name}"]`);

    if (label) {
      label.textContent = value;
    }
  }

  handleTimeUpdate(timeState) {
    this.state.time = formatClock(timeState.normalizedDay);
    this.state.minutes = getClockMinutes(timeState.normalizedDay);
    this.state.dayOfYear = `第 ${timeState.dayOfYear} 天`;
    this.state.stage = timeState.stage.label;
    this.state.sunrise = formatHour(timeState.solarProfile.sunriseHour);
    this.state.sunset = formatHour(timeState.solarProfile.sunsetHour);
    this.state.stageDuration = `${Math.round(timeState.stage.seconds)} 秒`;
    this.render();
  }

  handleBiologyUpdate(biologyState) {
    this.state.season = SEASON_LABELS[biologyState.seasonId] ?? biologyState.seasonId;
    this.state.ecosystem = `${Math.round(biologyState.ecology.wildlifeActivity * 100)}%`;
    this.state.humidity = formatPercent(biologyState.ecology.moisture);
    this.state.temperature = `${estimateTemperatureCelsius(biologyState)}°C`;
    this.render();
  }

  handleWeatherUpdate(weatherState) {
    this.state.weather = WEATHER_LABELS[weatherState.weatherId] ?? weatherState.weatherId;
    this.render();
  }

  handleEcosystemHover(hoverState) {
    if (!hoverState) {
      this.state.hoverTitle = '未选中';
      this.state.hoverStage = '--';
      this.state.hoverCycle = '--';
      this.state.hoverStatus = '--';
      this.state.hoverGrowth = '--';
      this.state.hoverHealth = '--';
      this.state.hoverEnvironment = '--';
      this.state.hoverVisible = false;
      this.setLabel('hoverGrowth', '生长');
      this.setLabel('hoverHealth', '健康');
      this.render();
      return;
    }

    this.state.hoverTitle = `${hoverState.title} · ${hoverState.host}`;
    this.state.hoverVisible = true;
    this.state.hoverStage = hoverState.stage;
    this.state.hoverCycle = formatGrowthCycle(hoverState);
    this.state.hoverStatus = hoverState.status;

    if (hoverState.type === 'terrainMountain') {
      this.setLabel('hoverGrowth', '最高峰');
      this.setLabel('hoverHealth', '危险');
      this.state.hoverGrowth = `${hoverState.peakHeight ?? hoverState.height}格`;
      this.state.hoverHealth = formatPercent(hoverState.dangerIndex);
      this.state.hoverEnvironment = [
        `当前${hoverState.height}格`,
        `坡${formatPercent(hoverState.slope)}`,
        `块高${hoverState.blockHeight}格`,
      ].join(' ');
      this.render();
      return;
    }

    this.setLabel('hoverGrowth', '生长');
    this.setLabel('hoverHealth', '健康');
    this.state.hoverGrowth = formatPercent(hoverState.growth);
    this.state.hoverHealth = formatPercent(hoverState.health);
    this.state.hoverEnvironment = [
      `水${formatPercent(hoverState.water)}`,
      `光${formatPercent(hoverState.daylight)}`,
      `湿${formatPercent(hoverState.humidity)}`,
      `温${formatHoverTemperature(hoverState)}`,
      `适${formatPercent(hoverState.suitability)}`,
      ...formatPlantHeightExtras(hoverState),
      ...formatSnowLotusExtras(hoverState),
    ].join(' ');
    this.render();
  }

  applyBuildingHoverState(hoverState) {
    if (!hoverState) {
      this.state.buildingTitle = '未选中';
      this.state.buildingCreator = '--';
      this.state.buildingUser = '--';
      this.state.buildingName = '--';
      this.state.buildingReference = '--';
      this.state.buildingBlocks = '--';
      this.state.buildingStatus = '--';
      this.state.buildingMergedPrompt = '--';
      this.state.buildingVisible = false;
      this.state.buildingCanClear = false;
      this.state.buildingRecord = null;
      this.render();
      return;
    }

    const referenceImage = hoverState.referenceImage;
    const referenceMaterials = Array.isArray(hoverState.referenceMaterials) ? hoverState.referenceMaterials : [];
    const referenceText = [
      referenceImage?.name ? referenceImage.name : '',
      referenceMaterials.length ? `${referenceMaterials.length} 项材料` : '',
    ].filter(Boolean).join(' · ') || '无';

    const matchedFeatures = Array.isArray(hoverState.matchedFeatures) ? hoverState.matchedFeatures : [];
    const matchedFeatureText = matchedFeatures.length
      ? matchedFeatures
        .filter((feature) => feature?.status === 'matched')
        .slice(0, 3)
        .map((feature) => feature.source || feature.part || 'feature')
        .join(', ')
      : '';
    const similarityText = Number.isFinite(hoverState.imageSimilarityScore)
      ? `image ${(hoverState.imageSimilarityScore * 100).toFixed(0)}%`
      : '';

    this.state.buildingTitle = hoverState.title || 'AI 建筑';
    const hoveredCustomBlock = hoverState.customBlock ?? hoverState.hoveredBlock?.customBlock ?? null;
    const hoveredBlockId = Math.trunc(Number(hoverState.hoveredBlock?.blockId) || 0);
    const customMaterialText = hoveredCustomBlock
      ? [
        `${hoveredCustomBlock.label || hoveredCustomBlock.name || 'custom'} #${hoveredCustomBlock.blockId}`,
        hoveredCustomBlock.usage ?? '',
        hoveredCustomBlock.textureRegion?.label ? `纹理区域 ${hoveredCustomBlock.textureRegion.label}` : '',
        hoveredCustomBlock.textureSource ? `来源 ${hoveredCustomBlock.textureSource}` : '',
      ].filter(Boolean).join(' ')
      : hoveredBlockId >= 1000 && hoveredBlockId <= 60000
        ? `custom #${hoveredBlockId}`
        : '';

    this.state.buildingCreator = hoverState.creatorName ?? '--';
    this.state.buildingUser = hoverState.userLabel ?? '--';
    this.state.buildingName = hoverState.title || hoverState.record?.prompt || 'AI 建筑';
    this.state.buildingReference = [referenceText, similarityText, matchedFeatureText, customMaterialText].filter(Boolean).join(' 路 ');
    this.state.buildingBlocks = typeof hoverState.blockCount === 'number' ? `${hoverState.blockCount} 个` : '--';
    this.state.buildingStatus = hoverState.status === 'preview'
      ? '预览中'
      : hoverState.status === 'cleared'
        ? '已清除'
        : '正在使用';
    this.state.buildingMergedPrompt = hoverState.mergedPrompt || '--';
    this.state.buildingVisible = true;
    this.state.buildingCanClear = Boolean(hoverState.canClear);
    this.state.buildingRecord = hoverState.record ?? null;
    this.render();
  }

  handleBuildingHover(hoverState, source = 'crosshair') {
    this.state.buildingHoverSources[source] = hoverState;
    this.applyBuildingHoverState(this.state.buildingHoverSources.pointer ?? this.state.buildingHoverSources.crosshair);
  }

  handleBuildingClearClick() {
    if (!this.state.buildingCanClear || !this.state.buildingRecord) {
      return;
    }

    this.eventBus.emit('building:clear-request', this.state.buildingRecord);
  }

  handlePlayerUpdate(playerState) {
    const staminaPercent = Math.round((playerState.stamina / playerState.maxStamina) * 100);
    const hunger = playerState.hunger.toFixed(1);
    const status = playerState.isKnockedDown
      ? ' 跌倒'
      : playerState.isLyingDown
        ? ' 躺下'
      : playerState.isHovering
        ? ' 悬浮'
      : playerState.isGliding
        ? ' 滑翔'
      : playerState.isMovementBlockedByHunger
        ? ' 停滞'
        : playerState.isResting
          ? ' 休息'
          : '';

    this.state.stamina = `${staminaPercent}%${status}`;
    this.state.hunger = `${hunger}/${playerState.maxHunger}`;
    this.state.speed = `${playerState.speed.toFixed(1)} / ${playerState.maxSpeed.toFixed(1)}`;
    this.state.body = `${Math.round(playerState.mass)}kg ${playerState.height.toFixed(2)}m`;
    this.state.playerHeight = typeof playerState.altitude === 'number'
      ? `${playerState.height.toFixed(2)}m / ${playerState.altitude.toFixed(1)}格`
      : `${playerState.height.toFixed(2)}m`;
    this.state.compassHeading = typeof playerState.headingDegrees === 'number' ? playerState.headingDegrees : 0;
    this.state.compassDirection = formatCompassDirection(this.state.compassHeading);
    this.render();
  }

  handleAudioVolumeUpdate(volumeState) {
    for (const { key } of AUDIO_VOLUME_CONTROLS) {
      if (typeof volumeState?.[key] === 'number') {
        this.state.audioVolumes[key] = Math.max(0, Math.min(1, volumeState[key]));
      }
    }

    this.renderAudioControls();
  }

  handleSnowLotusFinderUpdate(finderState) {
    this.state.snowLotusFinder = finderState?.message ?? '未找到';
    if (!finderState?.found) {
      this.render();
      return;
    }

    this.render();
  }

  renderAudioControls() {
    for (const { key } of AUDIO_VOLUME_CONTROLS) {
      const percent = Math.round((this.state.audioVolumes[key] ?? 1) * 100);
      const slider = this.element.querySelector(`[data-audio-volume="${key}"]`);
      const value = this.element.querySelector(`[data-audio-volume-value="${key}"]`);

      if (slider) {
        slider.value = String(percent);
      }

      if (value) {
        value.textContent = `${percent}%`;
      }
    }
  }

  render() {
    this.setField('time', this.state.time);
    this.setField('stage', this.state.stage);
    this.setField('season', this.state.season);
    this.setField('weather', this.state.weather);
    this.setField('dayOfYear', this.state.dayOfYear);
    this.setField('sunrise', this.state.sunrise);
    this.setField('sunset', this.state.sunset);
    this.setField('stageDuration', this.state.stageDuration);
    this.setField('ecosystem', this.state.ecosystem);
    this.setField('humidity', this.state.humidity);
    this.setField('temperature', this.state.temperature);
    this.setField('hoverTitle', this.state.hoverTitle);
    this.setField('hoverStage', this.state.hoverStage);
    this.setField('hoverCycle', this.state.hoverCycle);
    this.setField('hoverStatus', this.state.hoverStatus);
    this.setField('hoverGrowth', this.state.hoverGrowth);
    this.setField('hoverHealth', this.state.hoverHealth);
    this.setField('hoverEnvironment', this.state.hoverEnvironment);
    this.setField('buildingTitle', this.state.buildingTitle);
    this.setField('buildingCreator', this.state.buildingCreator);
    this.setField('buildingUser', this.state.buildingUser);
    this.setField('buildingName', this.state.buildingName);
    this.setField('buildingReference', this.state.buildingReference);
    this.setField('buildingBlocks', this.state.buildingBlocks);
    this.setField('buildingStatus', this.state.buildingStatus);
    this.setField('buildingMergedPrompt', this.state.buildingMergedPrompt);
    this.setField('snowLotusFinder', this.state.snowLotusFinder);
    this.setField('player', this.state.player);
    this.setField('stamina', this.state.stamina);
    this.setField('hunger', this.state.hunger);
    this.setField('speed', this.state.speed);
    this.setField('body', this.state.body);
    this.setField('playerHeight', this.state.playerHeight);
    this.setField('compassDirection', this.state.compassDirection);
    this.guideToggleButton?.setAttribute('aria-pressed', String(this.state.guideOpen));
    this.guidePanel?.classList.toggle('is-open', this.state.guideOpen);
    this.element.querySelector('.world-status-hud__ecosystem')?.classList.toggle('is-empty', !this.state.hoverVisible);
    this.element.querySelector('.world-status-hud__building')?.classList.toggle('is-empty', !this.state.buildingVisible);
    const buildingPromptPanel = this.element.querySelector('[data-building-prompt]');
    if (buildingPromptPanel) {
      const hasPrompt = this.state.buildingVisible
        && this.state.buildingMergedPrompt
        && this.state.buildingMergedPrompt !== '--';
      buildingPromptPanel.hidden = !hasPrompt;
      buildingPromptPanel.open = Boolean(hasPrompt);
    }
    if (this.buildingClearButton) {
      this.buildingClearButton.hidden = !this.state.buildingCanClear;
      this.buildingClearButton.disabled = !this.state.buildingCanClear;
    }
    const compassNeedle = this.element.querySelector('.world-status-hud__compass-needle');

    if (compassNeedle) {
      compassNeedle.style.setProperty('--compass-rotation', `${this.state.compassHeading}deg`);
    }

    if (this.slider) {
      this.slider.value = String(this.state.minutes);
    }

    this.renderAudioControls();
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.slider?.removeEventListener('input', this.handleTimeInput);
    this.shiftButtons?.forEach((button) => {
      button.removeEventListener('click', this.handleShiftClick);
    });
    this.audioSliders?.forEach((slider) => {
      slider.removeEventListener('input', this.handleAudioVolumeInput);
    });
    this.snowLotusFindButton?.removeEventListener('click', this.handleSnowLotusFindClick);
    this.guideToggleButton?.removeEventListener('click', this.handleGuideToggle);
    this.buildingClearButton?.removeEventListener('click', this.handleBuildingClearClick);
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
      this.element.removeEventListener(eventName, this.stopPointerPropagation);
    });
    this.element.removeEventListener('wheel', this.stopPointerPropagation);
    this.element.remove();
  }
}
