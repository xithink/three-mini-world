import { appendSaveRecord, formatSaveTime } from '../saveStorage.js';
import { getMaterial } from '../../crafting/craftingData.js';
import { handleEditingKeydown } from '../utils/inputFocus.js';

export class SaveSystem {
  constructor({
    container,
    player,
    inventorySystem,
    craftingCodexSystem,
    profileSystem = null,
  }) {
    this.container = container;
    this.player = player;
    this.inventorySystem = inventorySystem;
    this.craftingCodexSystem = craftingCodexSystem;
    this.profileSystem = profileSystem;
    this.hint = this.createHint();
    this.toast = this.createToast();
    this.isSaving = false;
    this.onKeyDown = this.onKeyDown.bind(this);

    this.container.append(this.hint, this.toast);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  createHint() {
    const element = document.createElement('div');
    element.className = 'save-hint';
    element.textContent = 'O 保存当前进度';

    return element;
  }

  createToast() {
    const element = document.createElement('div');
    element.className = 'save-toast';
    element.setAttribute('aria-live', 'polite');

    return element;
  }

  onKeyDown(event) {
    if (handleEditingKeydown(event)) {
      return;
    }

    if (event.code !== 'KeyO' || event.repeat) {
      return;
    }

    event.preventDefault();
    void this.save();
  }

  async save() {
    if (this.isSaving) {
      this.showToast('正在保存，请稍候');
      return null;
    }

    this.isSaving = true;
    this.hint.textContent = '正在保存到服务器...';
    let record = null;

    try {
      const selectedItemId = this.inventorySystem.getSelectedItemId();
      const playerState = this.player.serialize();
      const profileState = this.profileSystem?.serialize?.() ?? null;
      record = await appendSaveRecord({
        version: 1,
        userId: profileState?.userId ?? null,
        profile: profileState,
        player: playerState,
        inventory: this.inventorySystem.serialize(),
        codex: this.craftingCodexSystem.serialize(),
        summary: {
          selectedItem: selectedItemId ? getMaterial(selectedItemId).name : '空手',
          unlockedRecipes: this.craftingCodexSystem.unlockedRecipeIds.size,
          position: playerState.position,
        },
      });

      this.hint.textContent = `最近保存 ${formatSaveTime(record.createdAt)}`;
      this.showToast(`保存成功：已新增记录 ${formatSaveTime(record.createdAt)}`);
    } catch (error) {
      console.error('Failed to save game.', error);
      this.hint.textContent = 'O 保存当前进度';
      this.showToast(`保存失败：${error.message}`, true);
    } finally {
      this.isSaving = false;
    }

    return record;
  }

  showToast(message, isError = false) {
    this.toast.textContent = message;
    this.toast.classList.toggle('is-error', isError);
    this.toast.classList.add('is-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.classList.remove('is-visible');
      this.toast.classList.remove('is-error');
    }, 1800);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    clearTimeout(this.toastTimer);
    this.hint.remove();
    this.toast.remove();
  }
}
