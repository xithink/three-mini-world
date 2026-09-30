import { requestJson, setAuthToken } from './saveStorage.js';

const SESSION_KEY = 'three-mini-world-user-session';

function normalizeSession(payload) {
  if (!payload?.user || !payload?.profile || !payload?.token) {
    return null;
  }

  return {
    user: payload.user,
    profile: payload.profile,
    token: payload.token,
  };
}

export function getStoredSession() {
  const raw = localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storeSession(session) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    setAuthToken('');
    return null;
  }

  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  setAuthToken(session.token);

  return session;
}

export async function registerUser({ username, nickname, password }) {
  const payload = await requestJson('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, nickname, password }),
  });

  return storeSession(normalizeSession(payload));
}

export async function loginUser({ username, password }) {
  const payload = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  return storeSession(normalizeSession(payload));
}

export async function refreshSession() {
  const stored = getStoredSession();

  if (!stored?.token) {
    return null;
  }

  setAuthToken(stored.token);

  try {
    const payload = await requestJson('/api/auth/me');
    return storeSession({
      ...stored,
      user: payload.user,
      profile: payload.profile,
    });
  } catch {
    storeSession(null);
    return null;
  }
}

export async function getProfile() {
  const payload = await requestJson('/api/profile');

  return payload.profile;
}

export async function listAdminUsers() {
  const payload = await requestJson('/api/admin/users');

  return Array.isArray(payload.users) ? payload.users : [];
}

export async function addUserCoins(userId, delta) {
  const payload = await requestJson('/api/admin/users/coins', {
    method: 'POST',
    body: JSON.stringify({ userId, delta }),
  });

  return payload.profile;
}
