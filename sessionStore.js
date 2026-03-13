/**
 * Simple in-memory session store.
 *
 * For production, replace with Redis:
 *   npm install ioredis
 *   const redis = new Redis(process.env.REDIS_URL);
 *   await redis.set(key, JSON.stringify(value), 'EX', 86400);
 *   const val = await redis.get(key); return val ? JSON.parse(val) : null;
 */

const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getSession(phone) {
  const entry = sessions.get(phone);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > SESSION_TTL_MS) {
    sessions.delete(phone);
    return null;
  }
  return entry.data;
}

async function setSession(phone, data) {
  sessions.set(phone, { data, updatedAt: Date.now() });
}

async function clearSession(phone) {
  sessions.delete(phone);
}

module.exports = { getSession, setSession, clearSession };
