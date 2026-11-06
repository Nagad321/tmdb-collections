
const {
  initMovieDb,
  getCollectionIDsFromMovieIDs,
  handleTmdbError,
} = require("./getTmdb");

let moviedb = null;

(async () => {
  moviedb = await initMovieDb();
})();

const MAX_MOVIES = 50;
const MAX_COLLECTIONS = 15;
const MAX_PAGES = 4;
const MAX_RESULTS = 30;

function normalizeText(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Verifica che la ricerca corrisponda realmente
// al nome della persona trovata su TMDB.
function isPersonMatch(query, name) {
  const q = normalizeText(query);
  const n = normalizeText(name);

  if (!q || !n) return false;

  if (q === n) return true;

  // Permette ricerche per cognome, ad esempio Nolan.
  if (!q.includes(" ")) {
    return n.split(" ").includes(q);
  }

  return false;
}

async function searchMovies(query) {
  try {
    const first = await moviedb.searchMovie({
      query,
      page: 1,
    });

    if (!first.results?.length) {
      return new Set();
    }

    const ids = new Set(
      first.results.map(movie => movie.id)
    );

    const pages = Math.min(
      first.total_pages || 1,
      MAX_PAGES
    );

    for (let page = 2; page <= pages; page++) {
      if (ids.size >= MAX_MOVIES) break;

      try {
        const response = await moviedb.searchMovie({
          query,
          page,
        });

        (response.results || []).forEach(movie => {
          if (movie.id) ids.add(movie.id);
        });

      } catch (err) {
        handleTmdbError(
          err,
          `Movie search page ${page}:`
        );
        break;
      }
    }

    return new Set([...ids].slice(0, MAX_MOVIES));

  } catch (err) {
    handleTmdbError(err, "Error during movie search:");
    return new Set();
  }
}

async function searchCollections(query) {
  try {
    const first = await moviedb.searchCollection({
      query,
      page: 1,
    });

    if (!first.results?.length) {
      return new Set();
    }

    const ids = new Set(
      first.results.map(collection => collection.id)
    );

    const pages = Math.min(
      first.total_pages || 1,
      3
    );

    for (let page = 2; page <= pages; page++) {
      if (ids.size >= MAX_COLLECTIONS) break;

      try {
        const response = await moviedb.searchCollection({
          query,
          page,
        });

        (response.results || []).forEach(collection => {
          if (collection.id) ids.add(collection.id);
        });

      } catch (err) {
        handleTmdbError(
          err,
          `Collection search page ${page}:`
        );
        break;
      }
    }

    return new Set([...ids].slice(0, MAX_COLLECTIONS));

  } catch (err) {
    handleTmdbError(err, "Error during collection search:");
    return new Set();
  }
}

async function searchMoviesByPerson(query) {
  try {
    const response = await moviedb.searchPerson({
      query,
    });

    if (!response.results?.length) {
      return new Set();
    }

    // Non scegliere automaticamente la persona più popolare:
    // deve esserci una corrispondenza effettiva con la ricerca.
    const matchingPeople = response.results
      .filter(person =>
        person.id && isPersonMatch(query, person.name)
      )
      .sort(
        (a, b) =>
          (b.popularity || 0) - (a.popularity || 0)
      );

    if (!matchingPeople.length) {
      return new Set();
    }

    const personId = matchingPeople[0].id;

    const credits = await moviedb.personMovieCredits({
      id: personId,
    });

    if (!credits) {
      return new Set();
    }

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
        .slice(0, 30)
    );

  } catch (err) {
    handleTmdbError(
      err,
      "Error during person search:"
    );
    return new Set();
  }
}

async function getSearch(query) {
  try {
    const cleanQuery = String(query || "").trim();

    if (!cleanQuery) {
      return [];
    }

    // Eseguiamo tutte le ricerche contemporaneamente.
    const [
      directCollectionIds,
      movieIds,
      personMovieIds,
    ] = await Promise.all([
      searchCollections(cleanQuery),
      searchMovies(cleanQuery),
      searchMoviesByPerson(cleanQuery),
    ]);

    // Recuperiamo le collezioni associate ai film.
    const [
      movieCollectionIds,
      personCollectionIds,
    ] = await Promise.all([
      movieIds.size > 0
        ? getCollectionIDsFromMovieIDs([...movieIds])
        : Promise.resolve(new Set()),

      personMovieIds.size > 0
        ? getCollectionIDsFromMovieIDs([...personMovieIds])
        : Promise.resolve(new Set()),
    ]);

    // Priorità:
    // 1. Collezioni trovate direttamente.
    // 2. Collezioni dei film corrispondenti.
    // 3. Collezioni dei film delle persone corrispondenti.

    const allCollectionIds = new Set([
      ...directCollectionIds,
      ...movieCollectionIds,
      ...personCollectionIds,
    ]);

    return [...allCollectionIds].slice(0, MAX_RESULTS);

  } catch (err) {
    handleTmdbError(
      err,
      `Error during search: ${query}:`
    );

    return [];
  }
}

module.exports = {
  getSearch,
  searchCollections,
};
