const { getGenres, getCountries } = require("./getTmdb");
const { productionCompanies } = require("../Public/productionCompanies");
const dev = process.argv.includes("--dev") ? "Dev" : "";
const version = "2.2.2";

async function getManifest(config) {
  const genres = await getGenres("it");
  const countries = await getCountries("it");
  const companyNames = productionCompanies.map(x => x.name);
  const catalogs = [];
  const list = [...(config.catalogList || [])];
  if (config.enableSearch === true && !list.includes("search")) list.push("search");

  const names = {
    popular: "Popolari",
    topRated: "Più votate",
    newReleases: "Nuove uscite",
    topRatedByCountry: "Più votate per paese",
    topRatedByCompany: "Più votate per casa di produzione",
    search: "Ricerca",
  };
  for (const catalogId of list) {
    const isCountry = catalogId === "topRatedByCountry";
    const isCompany = catalogId === "topRatedByCompany";
    const options = isCountry ? countries : isCompany ? productionCompanies : genres;
    const genreList = isCompany ? companyNames : options.map(x => x.name);
    const onlyDiscover = isCountry || isCompany || !!config.discoverOnly?.[catalogId];
    catalogs.push({
      type: "collections",
      id: `${dev}ctmdb.${catalogId}`,
      name: dev + (names[catalogId] || catalogId),
      extra: catalogId === "search"
        ? [{ name: "search", isRequired: true, genres: options }]
        : [{
          name: "genre",
          isRequired: onlyDiscover,
          options: onlyDiscover && !isCountry && !isCompany
            ? ["Default", ...genreList] : genreList,
          genres: options,
        }],
    });
  }
  return {
    id: "org.stremio.tmdbcollections" + dev,
    version,
    name: "Collezioni" + dev,
    description: "Esplora e cerca le collezioni cinematografiche TMDB in italiano.",
    types: ["movie", "collections"],
    resources: [
      "catalog",
      { name: "meta", types: ["movie"], idPrefixes: [`${dev}ctmdb.`] },
      ...(config.enableCollectionFromMovie
        ? [{ name: "stream", types: ["movie"], idPrefixes: ["tt"] }]
        : []),
    ],
    idPrefixes: [`${dev}ctmdb.`],
    behaviorHints: { configurable: true },
    favicon: "https://github.com/youchi1/tmdb-collections/raw/main/Images/favicon.png",
    logo: "https://github.com/youchi1/tmdb-collections/raw/main/Images/logo.png",
    background: "https://github.com/youchi1/tmdb-collections/raw/main/Images/bg.png",
    catalogs,
    genres,
  };
}
module.exports = getManifest;
