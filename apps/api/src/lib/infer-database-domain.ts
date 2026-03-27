export const DATABASE_DOMAIN_VALUES = [
  'ecommerce',
  'fintech',
  'health',
  'iot',
  'social',
  'analytics',
  'other',
] as const;

export type DatabaseDomain = (typeof DATABASE_DOMAIN_VALUES)[number];

/** Infers a coarse domain from schema template name/description (same rules as catalog databases). */
export function inferDatabaseDomain(name: string, description: string | null | undefined): DatabaseDomain {
  const haystack = `${name} ${description ?? ''}`.toLowerCase();
  if (/(ecommerce|commerce|retail|order|product|inventory)/.test(haystack)) return 'ecommerce';
  if (/(fintech|ledger|payment|merchant|bank|fraud|compliance)/.test(haystack)) return 'fintech';
  if (/(health|patient|ehr|clinical|fhir|prescription)/.test(haystack)) return 'health';
  if (/(iot|sensor|telemetry|device)/.test(haystack)) return 'iot';
  if (/(social|community|post|comment|feed)/.test(haystack)) return 'social';
  if (/(analytics|event|warehouse|report|insight)/.test(haystack)) return 'analytics';
  return 'other';
}
