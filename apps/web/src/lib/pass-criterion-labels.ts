/** Short labels for compact UI (e.g. lab attempt criterion chips). */
export const PASS_CRITERION_TYPE_LABELS: Record<string, string> = {
  max_query_duration_ms: 'Runtime',
  max_explain_total_cost: 'Cost',
  requires_index_usage: 'Index',
  required_output_columns: 'Columns',
  required_tables_in_query: 'Tables',
};

export function labelForPassCriterionType(type: string): string {
  return PASS_CRITERION_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}
