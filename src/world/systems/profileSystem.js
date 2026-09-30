import { getProfile } from '../userSession.js';

export class ProfileSystem {
  constructor({ container, eventBus, session }) {
    this.container = container;
    this.eventBus = eventBus;
    this.session = session;
    this.profile = session?.profile ?? null;
    this.user = session?.user ?? null;
    this.element = this.createElement();
    this.unsubscribe = [
      eventBus.on('profile:update', (profile) => this.setProfile(profile)),
      eventBus.on('profile:refresh', () => {
        void this.refresh();
      }),
    ];

    this.container.append(this.element);
    this.render();
  }

  createElement() {
    const element = document.createElement('section');
    element.className = 'profile-hud';
    element.setAttribute('aria-label', '玩家资料');
    element.innerHTML = `
      <strong data-profile-nickname>玩家</strong>
      <span data-profile-user-id></span>
      <em data-profile-coins>金币 0</em>
    `;

    return element;
  }

  setProfile(profile) {
    this.profile = {
      ...(this.profile ?? {}),
      ...(profile ?? {}),
    };
    this.render();
  }

  async refresh() {
    try {
      this.setProfile(await getProfile());
    } catch (error) {
      console.warn('Failed to refresh profile.', error);
    }
  }

  getCoins() {
    return Number(this.profile?.coins ?? 0);
  }

  serialize() {
    return {
      userId: this.user?.userId ?? this.profile?.userId ?? null,
      nickname: this.user?.nickname ?? this.profile?.nickname ?? '',
      coins: this.getCoins(),
    };
  }

  render() {
    this.element.querySelector('[data-profile-nickname]').textContent =
      this.user?.nickname ?? this.profile?.nickname ?? '玩家';
    this.element.querySelector('[data-profile-user-id]').textContent =
      this.user?.userId ? `ID ${this.user.userId}` : '';
    this.element.querySelector('[data-profile-coins]').textContent = `金币 ${this.getCoins()}`;
  }

  dispose() {
    this.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.element.remove();
  }
}
