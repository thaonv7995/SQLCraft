import type { ChallengeEvaluation, PassCriterionCheckClient } from '@/lib/api';

/**
 * Short chip text for pass-criterion rows. Handles legacy verbose API `detail` strings
 * (stored attempts) and compact server output.
 */
export function compactPassCriterionChipDetail(
  ch: PassCriterionCheckClient,
  evaluation?: ChallengeEvaluation | null,
): string | null {
  const detail = ch.detail?.trim();
  if (!detail) return null;

  const { type, passed } = ch;

  if (type === 'max_query_duration_ms') {
    if (passed && evaluation?.baselineDurationMs != null) {
      return `<= ${evaluation.baselineDurationMs} ms`;
    }
    if (passed) {
      if (/^<=\s*\d+\s*ms$/i.test(detail)) return detail;
      const limit =
        detail.match(/[≤\u2264]\s*(\d+)\s*ms/i)?.[1] ?? detail.match(/<=\s*(\d+)\s*ms/i)?.[1];
      if (limit) return `<= ${limit} ms`;
    }
    return detail;
  }

  if (type === 'max_explain_total_cost') {
    if (passed && evaluation?.maxTotalCost != null) {
      return `<= ${evaluation.maxTotalCost}`;
    }
    if (passed) {
      if (/^<=\s*[\d.]+\s*$/i.test(detail)) return detail;
      const limit =
        detail.match(/Planner total cost\s+[\d.]+\s*[≤\u2264]\s*([\d.]+)/i)?.[1] ??
        detail.match(/[≤\u2264]\s*([\d.]+)\s*\.?$/i)?.[1] ??
        detail.match(/<=\s*([\d.]+)\s*\.?$/i)?.[1];
      if (limit) return `<= ${limit}`;
    }
    return detail;
  }

  if (type === 'required_output_columns' && passed) {
    return (
      detail
        .replace(/^Output includes required columns:\s*/i, '')
        .replace(/^Output must include all columns:\s*/i, '')
        .trim() || detail
    );
  }

  if (type === 'required_tables_in_query' && passed) {
    if (/^(all|any):\s*.+/i.test(detail)) return detail;
    const onlyMode = detail.match(/^SQL references required table\(s\)\s*\((all|any)\)\.?\s*$/i);
    if (onlyMode) return onlyMode[1];
    return detail
      .replace(/^SQL references required table\(s\)\s*\((all|any)\)\.\s*/i, '$1: ')
      .replace(/^SQL must .+?:\s*/i, '')
      .trim();
  }

  if (type === 'requires_index_usage' && passed) {
    if (/^OK$/i.test(detail)) return detail;
    return 'OK';
  }

  return detail;
}
