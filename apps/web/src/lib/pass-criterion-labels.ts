/** Human-readable labels for server pass-criterion `type` values (aligned with admin display). */
export const PASS_CRITERION_TYPE_LABELS: Record<string, string> = {
  max_query_duration_ms: 'Max query duration',
  max_explain_total_cost: 'Max EXPLAIN total cost',
  requires_index_usage: 'Plan must use an index',
  required_output_columns: 'Required output columns',
  required_tables_in_query: 'Tables in SQL',
};

export function labelForPassCriterionType(type: string): string {
  return PASS_CRITERION_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}
