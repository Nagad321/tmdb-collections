const configDefaults = {
  language: "it",
  catalogList: ["popular", "topRated", "newReleases", "topRatedByCountry", "topRatedByCompany"],
  discoverOnly: { popular: false, topRated: false, newReleases: false, topRatedByCountry: true, topRatedByCompany: true },
  enableSearch: true,
  enableAdultContent: false,
  enableCollectionFromMovie: true,
};
function parseConfig(config) {
  try {
    const parsed = typeof config === "string" ? JSON.parse(config) : (config || {});
    const catalogList = Array.isArray(parsed.catalogList)
      ? parsed.catalogList.filter(x => configDefaults.catalogList.includes(x))
      : [...configDefaults.catalogList];
    return {
      ...configDefaults,
      ...parsed,
      catalogList,
      discoverOnly: { ...configDefaults.discoverOnly, ...(parsed.discoverOnly || {}) },
      language: "it",
    };
  } catch (_) {
    return { ...configDefaults, catalogList: [...configDefaults.catalogList], discoverOnly: { ...configDefaults.discoverOnly } };
  }
}
module.exports = { parseConfig };
