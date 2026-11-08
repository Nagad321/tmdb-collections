const {
  initMovieDb, getCollectionIDsFromMovieIDs,
  getCollectionDetails, handleTmdbError,
} = require("./getTmdb");

const dbPromise = initMovieDb();
const MAX_RESULTS = 30;
function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
const ignored = new Set(["the", "a", "an", "of", "and", "collection", "collezione", "film", "movie"]);
function words(value) {
  return normalize(value).split(" ").filter(w => w && !ignored.has(w));
}
function titleMatch(query, title) {
  const q = words(query);
  const t = new Set(words(title));
  return q.length > 0 && q.every(w => t.has(w));
}
function nameScore(query, name) {
  if (!name || !query) return 0;
  const q = normalize(query);
  const n = normalize(name);
  if (q === n) return 130;
  if (titleMatch(query, name)) return 115;
  if (` ${n} `.includes(` ${q} `)) return 105;
  return 0;
}
function partsScore(query, parts) {
  // One matching crossover or spin-off must not admit an entire collection.
  let count = 0;
  for (const part of parts || []) {
    if (titleMatch(query, part.title) || titleMatch(query, part.original_title)) count++;
  }
  return count >= 2 ? 85 + Math.min(count, 10) : 0;
}
function isPersonMatch(query, name) {
  const q = normalize(query);
  const n = normalize(name);
  return q === n || (!q.includes(" ") && n.split(" ").includes(q));
}
async function searchCollections(query) {
  try {
    const db = await dbPromise;
    const response = await db.searchCollection({ query, page: 1, language: "it-IT" });
    // Filter direct hits using their returned names, avoiding expensive detail calls.
    return new Set((response?.results || [])
      .filter(c => nameScore(query, c.name) > 0)
      .slice(0, 15)
      .map(c => c.id));
  } catch (err) {
    handleTmdbError(err, `Collection search "${query}":`);
    return new Set();
  }
}
async function searchMovies(query) {
  try {
    const db = await dbPromise;
    const response = await db.searchMovie({ query, page: 1, language: "it-IT" });
    return new Set((response?.results || [])
      .filter(m => titleMatch(query, m.title) || titleMatch(query, m.original_title))
      .slice(0, 20)
      .map(m => m.id));
  } catch (err) {
    handleTmdbError(err, `Movie search "${query}":`);
    return new Set();
  }
}
async function searchMoviesByPerson(query) {
  try {
    const db = await dbPromise;
    const response = await db.searchPerson({ query, page: 1 });
    const person = (response?.results || [])
      .filter(p => isPersonMatch(query, p.name))
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
    if (!person) return { isPerson: false, ids: new Set() };
    const credits = await db.personMovieCredits({ id: person.id });
    const movies = [
      ...(credits?.cast || []),
      ...(credits?.crew || []).filter(c => ["Directing", "Writing"].includes(c.department)),
    ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return { isPerson: true, ids: new Set(movies.slice(0, 25).map(m => m.id)) };
  } catch (err) {
    handleTmdbError(err, `Person search "${query}":`);
    return { isPerson: false, ids: new Set() };
  }
}
async function getSearch(query) {
  const q = String(query || "").trim();
  if (!words(q).length) return [];
  try {
    // Fast path: a strong direct collection match needs no movie lookup.
    const direct = await searchCollections(q);
    if (direct.size) return [...direct].slice(0, MAX_RESULTS);

    const [movieIds, person] = await Promise.all([
      searchMovies(q), searchMoviesByPerson(q),
    ]);
    const allMovieIds = [...new Set([...movieIds, ...person.ids])];
    const candidateIds = await getCollectionIDsFromMovieIDs(allMovieIds);
    const ids = [...candidateIds].slice(0, 35);
    const ranked = [];
    for (let i = 0; i < ids.length; i += 8) {
      const details = await Promise.all(ids.slice(i, i + 8).map(getCollectionDetails));
      for (const c of details) {
        if (!c?.id) continue;
        const score = Math.max(
          nameScore(q, c.name),
          partsScore(q, c.parts),
          person.isPerson ? 50 : 0,
        );
        if (score > 0) ranked.push({ id: c.id, score });
      }
    }
    return ranked.sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS).map(x => x.id);
  } catch (err) {
    handleTmdbError(err, `Search "${q}":`);
    return [];
  }
}
module.exports = { getSearch, searchCollections };
