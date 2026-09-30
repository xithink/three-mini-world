export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(eventName, listener) {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);

    return () => this.off(eventName, listener);
  }

  off(eventName, listener) {
    this.listeners.get(eventName)?.delete(listener);
  }

  emit(eventName, payload) {
    const listeners = this.listeners.get(eventName);

    if (!listeners) {
      return;
    }

    listeners.forEach((listener) => listener(payload));
  }

  clear() {
    this.listeners.clear();
  }
}
