/* ---------------------------------------------------------
   Offline storage: two jobs.
   1. Cache the last-known data (branches, clients, bookings,
      etc.) in localStorage, so the app has something to show
      when there's no connection at all.
   2. Queue up any change (new booking, new client, status
      update...) made while offline, so it can be replayed
      against Supabase the moment connectivity comes back.
--------------------------------------------------------- */

const CACHE_KEY = "utulivu_cache_v1";
const QUEUE_KEY = "utulivu_pending_v1";

export function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, cachedAt: Date.now() }));
  } catch (e) {
    // storage full or unavailable — the app still works online, just without an offline copy
  }
}

export function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function getQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    // ignore — best effort
  }
}

export function enqueueAction(action) {
  const queue = getQueue();
  const withId = { ...action, id: "pending-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), createdAt: Date.now() };
  queue.push(withId);
  saveQueue(queue);
  return withId;
}

export function removeFromQueue(id) {
  saveQueue(getQueue().filter((a) => a.id !== id));
}

export function queueCount() {
  return getQueue().length;
}
