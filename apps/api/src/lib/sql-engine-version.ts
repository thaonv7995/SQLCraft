import type { SchemaSqlDialect } from '@sqlcraft/types';
import { normalizeSchemaSqlEngine } from '@sqlcraft/types';

const SCAN_HEAD_BYTES = 2 * 1024 * 1024;

function headWindow(rawUtf8: string): string {
  return rawUtf8.length <= SCAN_HEAD_BYTES ? rawUtf8 : rawUtf8.slice(0, SCAN_HEAD_BYTES);
}

/**
 * Extract server/engine version string from tool-generated dump headers (comment lines preserved).
 */
export function inferEngineVersionFromDump(
  rawUtf8: string,
  dialect: SchemaSqlDialect | string,
): string | null {
  const w = headWindow(rawUtf8);
  const family = normalizeSchemaSqlEngine(dialect);

  if (family === 'postgresql') {
    const fromDumped = w.match(/--\s*Dumped from database version\s+(\d+(?:\.\d+)*)/i);
    if (fromDumped?.[1]) return fromDumped[1].trim();

    const fromPg = w.match(/PostgreSQL\s+(\d+(?:\.\d+)*)\s+database dump/i);
    if (fromPg?.[1]) return fromPg[1].trim();
    return null;
  }

  if (family === 'mysql' || family === 'mariadb') {
    const serverVer = w.match(/--\s*Server version[:\s\t]+(\d+(?:\.\d+)*)/i);
    if (serverVer?.[1]) return serverVer[1].trim();

    const distrib = w.match(/Distrib\s+(\d+(?:\.\d+)*)/i);
    if (distrib?.[1]) return distrib[1].trim();
    return null;
  }

  if (family === 'sqlite') {
    const sqlite = w.match(/--\s*SQLite version\s+(\d+(?:\.\d+)*)/i);
    if (sqlite?.[1]) return sqlite[1].trim();
    return null;
  }

  if (family === 'sqlserver') {
    const v = w.match(/--\s*Microsoft SQL Server\s+(\d{4}(?:\s*\([^)]+\))?)/i);
    if (v?.[1]) return v[1].trim().replace(/\s+/g, ' ');
    return null;
  }

  return null;
}
