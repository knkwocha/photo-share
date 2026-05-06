const { createClient } = require('redis');

let redisClient;
let isConnected = false;

async function getRedisClient() {
  if (redisClient && isConnected) return redisClient;

  const host = process.env.REDIS_HOST;
  if (!host) {
    console.warn('Redis not configured — caching disabled');
    return null;
  }

  redisClient = createClient({
    socket: {
      host,
      port: parseInt(process.env.REDIS_PORT) || 6380,
      tls: process.env.REDIS_TLS === 'true',
    },
    password: process.env.REDIS_PASSWORD,
  });

  redisClient.on('error', (err) => console.error('Redis error:', err));
  redisClient.on('connect', () => { isConnected = true; });
  redisClient.on('disconnect', () => { isConnected = false; });

  await redisClient.connect();
  return redisClient;
}

async function cacheGet(key) {
  try {
    const client = await getRedisClient();
    if (!client) return null;
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

async function cacheSet(key, value, ttlSeconds = 300) {
  try {
    const client = await getRedisClient();
    if (!client) return;
    await client.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch { /* cache failures are non-fatal */ }
}

async function cacheDel(key) {
  try {
    const client = await getRedisClient();
    if (!client) return;
    await client.del(key);
  } catch { /* non-fatal */ }
}

async function cacheDelPattern(pattern) {
  try {
    const client = await getRedisClient();
    if (!client) return;
    const keys = await client.keys(pattern);
    if (keys.length > 0) await client.del(keys);
  } catch { /* non-fatal */ }
}

module.exports = { getRedisClient, cacheGet, cacheSet, cacheDel, cacheDelPattern };
