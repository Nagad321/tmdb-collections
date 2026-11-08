const { MovieDb } = require("moviedb-promise");
const { genres } = require("../Public/genres");
require("dotenv").config();
const {
  cacheWrapMovieDetails, cacheWrapOthers, cacheWrapCollectionDetails,
  cacheWrapMovieCollection,
} = require("./cache");

let moviedb;
let initializationPromise;
function handleTmdbError(err, label) {
  if (err?.response?.status !== 404 && !String(err?.message).includes("404")) {
    console.error(label, err?.message || err);
  }
}
function initMovieDb() {
  if (moviedb) return Promise.resolve(moviedb);
  if (!initializationPromise) {
    initializationPromise = Promise.resolve().then(() => {
      moviedb = new MovieDb(process.env.TMDB_API_KEY, "https://api.themoviedb.org/3/", 15);
      return moviedb;
    });
  }
  return initializationPromise;
}
initMovieDb();

async function getGenres() {
  try {
    return await cacheWrapOthers("genres:it", async () => {
      const db = await initMovieDb();
      const response = await db.genreMovieList({ language: "it-IT" });
      return response?.genres?.length ? response.genres : genres;
    });
  } catch (err) {
    handleTmdbError(err, "Error getting genres:");
    return genres;
  }
}
async function getCountries() {
  return [{ id: "IT", name: "Italia", english_name: "Italy" }];
}
function getBelongsToCollection(imdbId, belongsToCollection) {
  return cacheWrapOthers("BtC" + imdbId, async () => belongsToCollection, {
    ttl: 2 * 86400000,
  });
}
async function getMovieDetailsImdbId(imdbId) {
  try {
    const db = await initMovieDb();
    const movie = await db.movieInfo({ id: imdbId });
    return getBelongsToCollection(
      movie.imdb_id || imdbId,
      movie.belongs_to_collection
        ? { id: movie.belongs_to_collection.id, name: movie.belongs_to_collection.name }
        : "npoc"
    );
  } catch (err) {
    handleTmdbError(err, `Error getting movie ${imdbId}:`);
    return null;
  }
}
async function getMovieDetails(movieId) {
  return cacheWrapMovieDetails(movieId, async () => {
    try {
      const db = await initMovieDb();
      const movie = await db.movieInfo({
        id: movieId,
        language: "it-IT",
        append_to_response: "translations,images",
      });
      if (movie.imdb_id) {
        void getBelongsToCollection(
          movie.imdb_id,
          movie.belongs_to_collection
            ? { id: movie.belongs_to_collection.id, name: movie.belongs_to_collection.name }
            : "npoc"
        ).catch(() => {});
      }
      return {
        id: movie.id,
        imdb_id: movie.imdb_id,
        genres: movie.genres,
        belongs_to_collection: {
          id: movie.belongs_to_collection?.id,
          name: movie.belongs_to_collection?.name,
        },
        translations: movie.translations?.translations
          ?.filter(t => t.iso_639_1 !== "en" && (t.data?.overview?.trim() || t.data?.title?.trim()))
          .map(t => ({
            iso_639_1: t.iso_639_1,
            description: t.data.overview,
            title: t.data.title,
          })),
        posters: movie.images?.posters
          ?.filter(img => img.iso_639_1 !== "en" && img.iso_639_1?.trim() && img.file_path)
          .map(img => ({
            iso_639_1: img.iso_639_1,
            poster: img.file_path,
            vote_average: img.vote_average,
          })),
        logos: movie.images?.logos
          ?.filter(img => img.file_path && img.aspect_ratio >= 1 && img.aspect_ratio <= 2)
          .map(img => ({
            iso_639_1: img.iso_639_1,
            logo: img.file_path,
            vote_average: img.vote_average,
          })),
      };
    } catch (err) {
      handleTmdbError(err, `Error getting movie ${movieId}:`);
      return null;
    }
  });
}
async function getCollectionDetails(collectionId) {
  return cacheWrapCollectionDetails(`tmdb-it-v2:${collectionId}`, async () => {
    try {
      const db = await initMovieDb();
      const collection = await db.collectionInfo({
        id: collectionId,
        language: "it-IT",
        append_to_response: "translations,images",
      });
      if (Array.isArray(collection.parts)) {
        collection.parts.sort((a, b) => {
          if (!a.release_date && !b.release_date) return 0;
          if (!a.release_date) return 1;
          if (!b.release_date) return -1;
          return new Date(a.release_date) - new Date(b.release_date);
        });
      }
      return collection;
    } catch (err) {
      handleTmdbError(err, `Error getting collection ${collectionId}:`);
      return null;
    }
  }, { ttl: 7 * 86400000 });
}
async function getCollectionIDsFromMovieIDs(movieIds) {
  const ids = [...new Set(movieIds)].filter(Boolean);
  const collections = new Set();
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(ids.slice(i, i + 8).map(async id => {
      try {
        return await cacheWrapMovieCollection(id, async () => {
          const db = await initMovieDb();
          const movie = await db.movieInfo({ id });
          return movie.belongs_to_collection?.id || 0;
        });
      } catch (err) {
        handleTmdbError(err, `Error finding collection for movie ${id}:`);
        return 0;
      }
    }));
    for (const id of batch) if (id) collections.add(id);
  }
  return collections;
}
module.exports = {
  initMovieDb, getMovieDetails, getCollectionDetails,
  getCollectionIDsFromMovieIDs, getMovieDetailsImdbId,
  getBelongsToCollection, getGenres, getCountries, handleTmdbError,
};
