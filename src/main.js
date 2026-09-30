import './style.css';
import { createMiniWorld } from './world/createMiniWorld.js';
import { formatSaveTime, getSaveRecord, getSaveRecords } from './world/saveStorage.js';
import { getStoredSession, loginUser, refreshSession, registerUser, storeSession } from './world/userSession.js';

document.querySelector('#app').innerHTML = `
  <main class="world-shell">
    <div id="scene-root" aria-label="Continuous 3D chunk world with controllable character"></div>
  </main>
`;

const sceneRoot = document.querySelector('#scene-root');
let destroyMiniWorld = null;
let saveSelectElement = null;
let activeSession = null;

function getAdminUrl() {
  const url = new URL(window.location.href);

  url.port = import.meta.env.VITE_ADMIN_PORT ?? '3002';
  url.pathname = '/';
  url.search = '';
  url.hash = '';

  return url.toString();
}

function formatPosition(position) {
  if (!Array.isArray(position) || position.length < 3) {
    return '未知位置';
  }

  return position.slice(0, 3).map((value) => Math.round(Number(value) || 0)).join(', ');
}

function startWorld(initialSave = null) {
  saveSelectElement?.remove();
  saveSelectElement = null;
  destroyMiniWorld = createMiniWorld(sceneRoot, { initialSave, session: activeSession });
}

function createSaveButton(record) {
  const button = document.createElement('button');
  button.className = 'save-select__record';
  button.type = 'button';

  const createdAt = document.createElement('strong');
  createdAt.textContent = formatSaveTime(record.createdAt);
  const selectedItem = document.createElement('span');
  selectedItem.textContent = `手持：${record.summary?.selectedItem ?? '空手'}`;
  const unlockedRecipes = document.createElement('span');
  unlockedRecipes.textContent = `图鉴：${record.summary?.unlockedRecipes ?? 0} 项`;
  const position = document.createElement('span');
  position.textContent = `坐标：${formatPosition(record.summary?.position)}`;
  button.append(createdAt, selectedItem, unlockedRecipes, position);
  button.addEventListener('click', async () => {
    button.disabled = true;
    createdAt.textContent = '正在加载...';

    try {
      startWorld(await getSaveRecord(record.id) ?? record);
    } catch (error) {
      createdAt.textContent = '加载失败';
      selectedItem.textContent = error.message;
      button.disabled = false;
    }
  });

  return button;
}

function showSaveSelection(records, errorMessage = '') {
  saveSelectElement?.remove();
  saveSelectElement = document.createElement('section');
  saveSelectElement.className = 'save-select';
  saveSelectElement.innerHTML = `
    <div class="save-select__panel" role="dialog" aria-modal="true" aria-label="选择保存记录">
      <div class="save-select__header">
        <strong>${activeSession?.user?.nickname ?? '玩家'} 的保存记录</strong>
        <span data-save-select-status></span>
      </div>
      <div class="save-select__records" data-save-records></div>
      <button class="save-select__new" type="button" data-new-game>新游戏</button>
      ${activeSession?.user?.role === 'admin' ? '<button class="save-select__new" type="button" data-admin-open>打开后台管理</button>' : ''}
      <button class="save-select__new" type="button" data-logout>退出登录</button>
    </div>
  `;

  saveSelectElement.querySelector('[data-save-select-status]').textContent =
    errorMessage || '按 O 键保存的记录会保存在服务器 MongoDB 中';

  const recordList = saveSelectElement.querySelector('[data-save-records]');

  if (records.length > 0) {
    records.forEach((record) => {
      recordList.append(createSaveButton(record));
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'save-select__empty';
    empty.textContent = errorMessage ? '无法读取服务器存档。可以先开始新游戏，修复服务器后再保存。' : '服务器中还没有保存记录。';
    recordList.append(empty);
  }

  saveSelectElement.querySelector('[data-new-game]').addEventListener('click', () => {
    startWorld();
  });
  saveSelectElement.querySelector('[data-logout]').addEventListener('click', () => {
    storeSession(null);
    activeSession = null;
    showLogin();
  });
  saveSelectElement.querySelector('[data-admin-open]')?.addEventListener('click', () => {
    window.open(getAdminUrl(), '_blank', 'noopener,noreferrer');
  });
  sceneRoot.append(saveSelectElement);
}

function showLogin(errorMessage = '') {
  saveSelectElement?.remove();
  saveSelectElement = document.createElement('section');
  saveSelectElement.className = 'save-select auth-select';
  saveSelectElement.innerHTML = `
    <form class="save-select__panel auth-select__panel" role="dialog" aria-modal="true" aria-label="用户登录">
      <div class="save-select__header">
        <strong>用户登录</strong>
        <span data-auth-status>${errorMessage || '登录后个人金币、存档和资产会绑定到用户 ID'}</span>
      </div>
      <label>用户名<input name="username" autocomplete="username" required minlength="3" maxlength="24"></label>
      <label data-nickname-field>昵称<input name="nickname" autocomplete="nickname" maxlength="24" placeholder="注册时填写"></label>
      <label>密码<input name="password" type="password" autocomplete="current-password" required minlength="6"></label>
      <div class="auth-select__actions">
        <button type="submit" data-auth-login>登录</button>
        <button type="button" data-auth-register>注册</button>
      </div>
    </form>
  `;
  const form = saveSelectElement.querySelector('form');
  const status = saveSelectElement.querySelector('[data-auth-status]');
  const nicknameField = saveSelectElement.querySelector('[data-nickname-field]');
  const nicknameInput = saveSelectElement.querySelector('[name="nickname"]');

  function setAuthMode(mode) {
    const isRegister = mode === 'register';

    nicknameField.hidden = !isRegister;
    nicknameInput.required = isRegister;
    status.textContent = isRegister
      ? '注册需要用户名、昵称和密码，昵称不能重复'
      : '登录只需要用户名和密码';
  }

  async function authenticate(mode) {
    const formData = new FormData(form);
    const username = String(formData.get('username') ?? '').trim();
    const nickname = String(formData.get('nickname') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    status.textContent = mode === 'register' ? '正在注册...' : '正在登录...';

    try {
      activeSession = mode === 'register'
        ? await registerUser({ username, nickname, password })
        : await loginUser({ username, password });
      await loadSavesAfterLogin();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void authenticate('login');
  });
  saveSelectElement.querySelector('[data-auth-register]').addEventListener('click', () => {
    if (nicknameField.hidden) {
      setAuthMode('register');
      nicknameInput.focus();
      return;
    }

    void authenticate('register');
  });

  setAuthMode('login');
  sceneRoot.append(saveSelectElement);
}

async function loadSavesAfterLogin() {
  showSaveLoading('读取用户保存记录', '正在读取当前用户的保存数据...');

  try {
    const saveRecords = await getSaveRecords();
    showSaveSelection(saveRecords);
  } catch (error) {
    showSaveSelection([], `读取服务器存档失败：${error.message}`);
  }
}

function showSaveLoading(title = '读取服务器保存记录', message = '正在连接 MongoDB 保存服务...') {
  saveSelectElement?.remove();
  saveSelectElement = document.createElement('section');
  saveSelectElement.className = 'save-select';
  saveSelectElement.innerHTML = `
    <div class="save-select__panel" role="dialog" aria-modal="true" aria-label="读取保存记录">
      <div class="save-select__header">
        <strong>${title}</strong>
        <span>${message}</span>
      </div>
    </div>
  `;
  sceneRoot.append(saveSelectElement);
}

async function initialize() {
  activeSession = getStoredSession();

  if (activeSession) {
    showSaveLoading('恢复登录', '正在验证用户会话...');
    activeSession = await refreshSession();
  }

  if (!activeSession) {
    showLogin();
    return;
  }

  await loadSavesAfterLogin();
}

void initialize();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    destroyMiniWorld?.();
    saveSelectElement?.remove();
  });
}
