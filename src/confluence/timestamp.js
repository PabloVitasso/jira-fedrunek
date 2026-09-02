// Normalizes timestamps into one canonical ISO representation so pages
// tracked interchangeably via CQL search (`lastModified`) and the REST
// space listing (`version.createdAt`) compare equal for the same instant,
// even when the two Confluence APIs format it differently (e.g. millisecond
// precision vs none).
export function normalizeTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toISOString();
}
