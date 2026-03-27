/** Human-readable labels for server pass-criterion `type` values (VN, aligned with admin display). */
export const PASS_CRITERION_TYPE_LABELS: Record<string, string> = {
  max_query_duration_ms: 'Thời gian query tối đa',
  max_explain_total_cost: 'EXPLAIN total cost tối đa',
  requires_index_usage: 'Plan phải dùng index',
  required_output_columns: 'Cột output bắt buộc',
  required_tables_in_query: 'Bảng trong SQL',
};

export function labelForPassCriterionType(type: string): string {
  return PASS_CRITERION_TYPE_LABELS[type] ?? type.replace(/_/g, ' ');
}
