const {
  initMovieDb,
  getCollectionIDsFromMovieIDs,
  getCollectionDetails,
  handleTmdbError,
} = require("./getTmdb");

const MAX_MOVIES = 50;
const MAX_DIRECT_COLLECTIONS = 15;
const MAX_SEARCH_PAGES = 4;
const MAX_PERSON_MOVIES = 30;
const MAX_COLLECTION_DETAILS = 60;
const MAX_RESULTS = 30;
const DETAILS_BATCH_SIZE = 8;

const movieDbPromise = initMovieDb();

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const IGNORED_WORDS = new Set([
  "a", "an", "and", "of", "the", "to", "in", "on",
  "collection", "complete", "film", "films", "movie", "movies",
]);

function meaningfulWords(value) {
  return normalizeText(value)
    .split(" ")
    .filter(word => word && !IGNORED_WORDS.has(word));
}

function isPersonMatch(query, personName) {
  const q = normalizeText(query);
  const name = normalizeText(personName);

  if (!q || !name) return false;
  if (q === name) return true;

  if (!q.includes(" ")) {
    return name.split(" ").includes(q);
  }

  return false;
}

// LIVELLO 1 E 2: corrispondenza con il nome della collezione.
function scoreCollectionName(query, collectionName) {
  const q = normalizeText(query);
  const name = normalizeText(collectionName);
  const queryWords = meaningfulWords(query);
  const nameWords = meaningfulWords(collectionName);

  if (!q || !name || queryWords.length === 0) return 0;

  if (q === name) return 120;

  if (` ${name} `.includes(` ${q} `)) return 110;

  const nameWordSet = new Set(nameWords);

  if (queryWords.every(word => nameWordSet.has(word))) {
    return 100;
  }

  const matchedWords = queryWords.filter(
    word => nameWordSet.has(word)
  ).length;

  const overlap = matchedWords / queryWords.length;

  if (queryWords.length > 1 && overlap >= 0.75) {
    return 70 + Math.round(overlap * 10);
  }

  return 0;
}

// LIVELLO 3: verifica i titoli dei film della collezione.
function scoreCollectionParts(query, parts = []) {
  const q = normalizeText(query);
  const queryWords = meaningfulWords(query);

  if (!q || queryWords.length === 0) return 0;

  let bestScore = 0;

  for (const part of parts) {
    const title = normalizeText(
      part?.title || part?.original_title || ""
    );

    if (!title) continue;

    const titleWords = new Set(meaningfulWords(title));

    if (title === q) {
      bestScore = Math.max(bestScore, 105);
      continue;
    }

    if (` ${title} `.includes(` ${q} `)) {
      bestScore = Math.max(bestScore, 95);
      continue;
    }

    if (queryWords.every(word => titleWords.has(word))) {
      bestScore = Math.max(bestScore, 90);
      continue;
    }

    const matchedWords = queryWords.filter(
      word => titleWords.has(word)
    ).length;

    const overlap = matchedWords / queryWords.length;

    if (queryWords.length > 1 && overlap >= 0.75) {
      bestScore = Math.max(
        bestScore,
        65 + Math.round(overlap * 10)
      );
    }
  }

  return bestScore;
}

async function searchMovies(query) {
  try {
    const moviedb = await movieDbPromise;

    const first = await moviedb.searchMovie({
      query,
      page: 1,
    });

    if (!first?.results?.length) return new Set();

    const ids = new Set(
      first.results.map(movie => movie.id).filter(Boolean)
    );

    const pages = Math.min(
      first.total_pages || 1,
      MAX_SEARCH_PAGES
    );

    for (let page = 2; page <= pages && ids.size < MAX_MOVIES; page++) {
      try {
        const response = await moviedb.searchMovie({
          query,
          page,
        });

        for (const movie of response?.results || []) {
          if (movie.id) ids.add(movie.id);
          if (ids.size >= MAX_MOVIES) break;
        }
      } catch (err) {
        handleTmdbError(
          err,
          `Movie search page ${page} for "${query}":`
        );
        break;
      }
    }

    return new Set([...ids].slice(0, MAX_MOVIES));

  } catch (err) {
    handleTmdbError(
      err,
      `Error during movie search for "${query}":`
    );
    return new Set();
  }
}

async function searchCollections(query) {
  try {
    const moviedb = await movieDbPromise;

    const first = await moviedb.searchCollection({
      query,
      page: 1,
    });

    if (!first?.results?.length) return new Set();

    const ids = new Set(
      first.results.map(collection => collection.id).filter(Boolean)
    );

    const pages = Math.min(
      first.total_pages || 1,
      3
    );

    for (let page = 2; page <= pages && ids.size < MAX_DIRECT_COLLECTIONS; page++) {
      try {
        const response = await moviedb.searchCollection({
          query,
          page,
        });

        for (const collection of response?.results || []) {
          if (collection.id) ids.add(collection.id);
          if (ids.size >= MAX_DIRECT_COLLECTIONS) break;
        }
      } catch (err) {
        handleTmdbError(
          err,
          `Collection search page ${page} for "${query}":`
        );
        break;
      }
    }

    return new Set([...ids].slice(0, MAX_DIRECT_COLLECTIONS));

  } catch (err) {
    handleTmdbError(
      err,
      `Error during collection search for "${query}":`
    );
    return new Set();
  }
}

async function searchMoviesByPerson(query) {
  try {
    const moviedb = await movieDbPromise;

    const response = await moviedb.searchPerson({
      query,
    });

    if (!response?.results?.length) return new Set();

    const matchingPeople = response.results
      .filter(person =>
        person.id && isPersonMatch(query, person.name)
      )
      .sort(
        (a, b) =>
          (b.popularity || 0) - (a.popularity || 0)
      );

    if (!matchingPeople.length) return new Set();

    const credits = await moviedb.personMovieCredits({
      id: matchingPeople[0].id,
    });

    if (!credits) return new Set();

    const movies = [
      ...(credits.cast || []),
      ...(credits.crew || []).filter(movie =>
        movie.department === "Writing" ||
        movie.department === "Directing"
      ),
    ];

    movies.sort(
      (a, b) =>
        (b.popularity || 0) - (a.popularity || 0)
    );

    return new Set(
      movies
        .map(movie => movie.id)
        .filter(Boolean)
        .slice(0, MAX_PERSON_MOVIES)
    );

  } catch (err) {
    handleTmdbError(
      err,
      `Error during person search for "${query}":`
    );
    return new Set();
  }
}

async function getCollectionDetailsInBatches(collectionIds) {
  const details = [];

  for (
    let i = 0;
    i < collectionIds.length;
    i += DETAILS_BATCH_SIZE
  ) {
    const batch = collectionIds.slice(
      i,
      i + DETAILS_BATCH_SIZE
    );

    const results = await Promise.all(
      batch.map(async id => {
        try {
          return await getCollectionDetails(id);
        } catch (err) {
          handleTmdbError(
            err,
            `Error getting collection details for ${id}:`
          );
          return null;
        }
      })
    );

    details.push(...results.filter(Boolean));
  }

  return details;
}

async function getSearch(query) {
  try {
    const cleanQuery = String(query || "").trim();

    if (
      !cleanQuery ||
      meaningfulWords(cleanQuery).length === 0
    ) {
      return [];
    }

    const [
      directCollectionIds,
      movieIds,
      personMovieIds,
    ] = await Promise.all([
      searchCollections(cleanQuery),
      searchMovies(cleanQuery),
      searchMoviesByPerson(cleanQuery),
    ]);

    const [
      movieCollectionIds,
      personCollectionIds,
    ] = await Promise.all([
      movieIds.size
        ? getCollectionIDsFromMovieIDs([...movieIds])
        : Promise.resolve(new Set()),

      personMovieIds.size
        ? getCollectionIDsFromMovieIDs([...personMovieIds])
        : Promise.resolve(new Set()),
    ]);

    // Conserviamo la provenienza dei risultati.
    const sources = new Map();

    function addIds(ids, source) {
      for (const id of ids) {
        if (!id) continue;

        if (!sources.has(id)) {
          sources.set(id, new Set());
        }

        sources.get(id).add(source);
      }
    }

    addIds(directCollectionIds, "direct");
    addIds(movieCollectionIds, "movie");
    addIds(personCollectionIds, "person");

    const candidateIds = [...sources.keys()]
      .slice(0, MAX_COLLECTION_DETAILS);

    if (candidateIds.length === 0) return [];

    const collectionDetails =
      await getCollectionDetailsInBatches(candidateIds);

    const ranked = [];

    for (const collection of collectionDetails) {
      if (!collection?.id) continue;

      const source = sources.get(collection.id) || new Set();

      // Livelli 1 e 2.
      const nameScore = scoreCollectionName(
        cleanQuery,
        collection.name || ""
      );

      // Livello 3.
      const partsScore = scoreCollectionParts(
        cleanQuery,
        collection.parts || []
      );

      let score = Math.max(nameScore, partsScore);

      // Manteniamo le collezioni dei film di una persona
      // solo se il nome della persona corrisponde alla ricerca.
      if (source.has("person")) {
        score = Math.max(score, 50);
      }

      // Escludiamo le collezioni senza alcuna pertinenza.
      if (score === 0) continue;

      // Piccola priorità alle corrispondenze dirette.
      if (source.has("direct") && nameScore > 0) {
        score += 5;
      }

      ranked.push({
        id: collection.id,
        score,
      });
    }

    // Ordiniamo dal risultato più pertinente al meno pertinente.
    ranked.sort((a, b) => b.score - a.score);

    return ranked
      .slice(0, MAX_RESULTS)
      .map(result => result.id);

  } catch (err) {
    handleTmdbError(
      err,
      `Error during search for "${query}":`
    );

    return [];
  }
}

module.exports = {
  getSearch,
  searchCollections,
};
