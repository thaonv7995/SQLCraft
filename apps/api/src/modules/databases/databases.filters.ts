import { normalizeSchemaSqlEngine } from '@sqlcraft/types';
import type { ListDatabasesQuery } from './databases.schema';
import type { DatabaseItem } from './databases.types';

export function databaseMatchesListQuery(db: DatabaseItem, query: ListDatabasesQuery): boolean {
  if (query.domain && db.domain !== query.domain) {
    return false;
  }
  if (query.difficulty && db.difficulty !== query.difficulty) {
    return false;
  }
  if (query.scale && !db.availableScales.includes(query.scale)) {
    return false;
  }
  if (
    query.dialect &&
    normalizeSchemaSqlEngine(db.dialect) !== normalizeSchemaSqlEngine(query.dialect)
  ) {
    return false;
  }

  const q = query.q?.trim().toLowerCase();
  if (q) {
    const inText =
      db.name.toLowerCase().includes(q) ||
      db.slug.toLowerCase().includes(q) ||
      db.description.toLowerCase().includes(q) ||
      db.engine.toLowerCase().includes(q) ||
      db.tags.some((tag) => tag.toLowerCase().includes(q));
    if (!inText) {
      return false;
    }
  }

  return true;
}
