const { createCache } = require("cache-manager");
const { Keyv } = require("keyv");
const { KeyvCacheableMemory } = require("cacheable");
const { KeyvSqlite } = require("@keyv/sqlite");
const fs = require("fs");
const path = require("path");

const DAY = 86400000;
const COLLECTION_TTL = 7 * DAY;
const SEARCH_TTL = 7 * DAY;
const MOVIE_TTL = 30 * DAY;
const OTHER_TTL = 7 * DAY;
const pending = new Map();

fs.mkdirSync(path.join(__dirname, "../sqlite"), { recursive: true });
const sqliteStore = new KeyvSqlite(
  "sqlite://" + path.join(__dirname, "../sqlite/cache.sqlite"),
  { table: "keyv_cache" }
);
const sqliteCache = createCache({ stores: [new Keyv({ store: sqliteStore })] });
const memoryStore = new KeyvCacheableMemory({ ttl: MOVIE_TTL, lruSize: 500 });
const memoryCache = createCache({ stores: [new Keyv({ store: memoryStore })] });

async function wrap(key, method, { ttl = OTHER_TTL, cache = sqliteCache } = {}) {
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    try {
      const cached = await cache.get(key);
      if (cached !== undefined && cached !== null) return cached;
    } catch (err) {
      console.warn("Cache read failed:", key, err.message);
    }
    const result = await method();
    if (result !== undefined && result !== null) {
      try { await cache.set(key, result, ttl); }
      catch (err) { console.warn("Cache write failed:", key, err.message); }
    }
    return result;
  })();
  pending.set(key, task);
  try { return await task; }
  finally { pending.delete(key); }
}

function cacheWrapCollectionDetails(id, method, options = {}) {
  return wrap(`collection:${id}`, method, {
    ttl: options.ttl ?? COLLECTION_TTL,
    cache: options.cache === "memory" ? memoryCache : sqliteCache,
  });
}
function cacheWrapMovieDetails(id, method, options = {}) {
  return wrap(`movie:${id}`, method, {
    ttl: options.ttl ?? MOVIE_TTL,
    cache: options.cache || memoryCache,
  });
}
function cacheWrapOthers(id, method, options = {}) {
  return wrap(`other:${id}`, method, {
    ttl: options.ttl ?? OTHER_TTL,
    cache: options.cache || sqliteCache,
  });
}
function cacheWrapSearch(query, method, options = {}) {
  return wrap(`search:v4:${String(query).toLowerCase().trim()}`, method, {
    ttl: options.ttl ?? SEARCH_TTL,
    cache: options.cache || sqliteCache,
  });
}
function cacheWrapMovieCollection(id, method) {
  return wrap(`movie-collection:v2:${id}`, method, { ttl: MOVIE_TTL });
}
module.exports = {
  cacheWrapCollectionDetails,
  cacheWrapMovieDetails,
  cacheWrapOthers,
  cacheWrapSearch,
  cacheWrapMovieCollection,
};
