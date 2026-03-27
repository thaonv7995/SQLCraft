/**
 * Human-readable pass criteria aligned with `evaluateAttempt` in challenges.service.ts.
 * Does not expose reference SQL.
 */
export type ChallengePassCriteriaSource = {
  validatorType: string;
  validatorConfig?: Record<string, unknown> | null;
  /** Max points when all pass conditions are met (see evaluateAttempt). */
  points?: number;
};

export type ChallengeValidatorMetrics = {
  baselineDurationMs: number | null;
  /** EXPLAIN total cost ceiling for pass (`maxTotalCost` on server). */
  maxTotalCost: number | null;
  requiresIndexOptimization: boolean;
};

/** Parsed from `validatorConfig` (same keys as server `evaluateAttempt`). */
export function parseChallengeValidatorMetrics(
  validatorConfig?: Record<string, unknown> | null,
): ChallengeValidatorMetrics {
  const config =
    validatorConfig && typeof validatorConfig === 'object' ? validatorConfig : {};
  const rawBaseline = config.baselineDurationMs;
  const baselineDurationMs =
    typeof rawBaseline === 'number' && Number.isFinite(rawBaseline) && rawBaseline > 0
      ? rawBaseline
      : null;
  const rawCost = config.maxTotalCost;
  const maxTotalCost =
    typeof rawCost === 'number' && Number.isFinite(rawCost) && rawCost > 0 ? rawCost : null;
  return {
    baselineDurationMs,
    maxTotalCost,
    requiresIndexOptimization: config.requiresIndexOptimization === true,
  };
}

export function getChallengePassCriteriaLines(source: ChallengePassCriteriaSource): string[] {
  const { baselineDurationMs: baselineMs, maxTotalCost, requiresIndexOptimization } =
    parseChallengeValidatorMetrics(source.validatorConfig);

  const lines: string[] = [];

  lines.push('Truy vấn phải chạy thành công (không lỗi) và có trả về kết quả khi challenge yêu cầu tập dòng.');

  if (source.validatorType === 'result_set') {
    lines.push(
      'Kết quả được so với đáp án chuẩn: cùng số cột, cùng thứ tự và tên cột (so khớp không phân biệt hoa thường từng vị trí), cùng số dòng, và tập giá trị các dòng trùng khớp (thứ tự dòng không quan trọng).',
    );
  } else {
    lines.push(`Loại chấm: ${source.validatorType} (chi tiết theo cấu hình nội bộ).`);
  }

  if (baselineMs !== null) {
    lines.push(
      `Thời gian thực thi truy vấn phải ≤ ${baselineMs.toLocaleString()} ms mới pass (đo trên sandbox).`,
    );
  } else {
    lines.push(
      '(Dữ liệu cũ) Không có ngưỡng thời gian — pass không kiểm tra runtime.',
    );
  }

  if (maxTotalCost !== null) {
    lines.push(
      `Tổng cost kế hoạch (PostgreSQL EXPLAIN, total cost) phải ≤ ${maxTotalCost.toLocaleString()} mới pass.`,
    );
  } else {
    lines.push('(Dữ liệu cũ) Không có ngưỡng cost — pass không kiểm tra EXPLAIN total cost.');
  }

  if (requiresIndexOptimization) {
    lines.push(
      'Plan thực thi phải cho thấy sử dụng index; có thể cần chạy CREATE INDEX trong phiên làm việc trước câu truy vấn cuối.',
    );
  }

  if (
    typeof source.points === 'number' &&
    Number.isFinite(source.points) &&
    source.points > 0
  ) {
    lines.push(
      `Đạt đủ mọi điều kiện trên thì nhận trọn ${source.points.toLocaleString()} điểm; thiếu một điều kiện thì 0 điểm cho lần chấm đó.`,
    );
  }

  lines.push(
    'Bảng xếp hạng challenge chỉ liệt kê người đã pass; trong đó thứ hạng ưu tiên thời gian chạy query ngắn hơn, nếu trùng thì cost (ước lượng PostgreSQL từ EXPLAIN) thấp hơn xếp trên.',
  );

  return lines;
}
