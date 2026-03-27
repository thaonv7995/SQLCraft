import { parseChallengeValidatorMetrics } from '@/lib/challenge-pass-criteria';
import { cn } from '@/lib/utils';

export function ChallengePassMetricsPanel({
  validatorConfig,
  className,
}: {
  validatorConfig?: Record<string, unknown> | null;
  className?: string;
}) {
  const { baselineDurationMs, maxTotalCost, requiresIndexOptimization } =
    parseChallengeValidatorMetrics(validatorConfig);

  return (
    <div
      className={cn(
        'grid gap-4 border-t border-outline-variant/10 pt-4 sm:grid-cols-2',
        className,
      )}
    >
      <div className="rounded-lg bg-surface-container-high/60 px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-outline">
          Thời gian chạy query
        </p>
        <p className="mt-2 text-sm leading-relaxed text-on-surface">
          {baselineDurationMs != null ? (
            <>
              Để pass:{' '}
              <span className="font-mono font-semibold text-secondary">
                ≤ {baselineDurationMs.toLocaleString()} ms
              </span>
            </>
          ) : (
            <span className="text-on-surface-variant">
              Không có ngưỡng (dữ liệu cũ) — pass không kiểm tra thời gian chạy
              {requiresIndexOptimization ? '; vẫn cần đúng kết quả và index nếu bật' : ''}.
            </span>
          )}
        </p>
        <p className="mt-2 text-xs text-on-surface-variant">
          Thời gian thực thi trên sandbox; dùng luôn để xếp hạng trên leaderboard (trong nhóm đã pass).
        </p>
      </div>
      <div className="rounded-lg bg-surface-container-high/60 px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-outline">
          Cost (PostgreSQL planner)
        </p>
        <p className="mt-2 text-sm leading-relaxed text-on-surface">
          {maxTotalCost != null ? (
            <>
              Để pass:{' '}
              <span className="font-mono font-semibold text-secondary">
                ≤ {maxTotalCost.toLocaleString()}
              </span>
              <span className="text-on-surface-variant"> (total cost từ EXPLAIN)</span>
            </>
          ) : (
            <span className="text-on-surface-variant">
              Không có ngưỡng (dữ liệu cũ) — pass không kiểm tra cost.
            </span>
          )}
        </p>
        <p className="mt-2 text-xs text-on-surface-variant">
          Leaderboard chỉ liệt kê người đã pass; cùng thời gian thì cost thấp hơn xếp trên.
        </p>
      </div>
    </div>
  );
}
