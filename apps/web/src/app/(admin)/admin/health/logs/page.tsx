const LOG_ENTRIES = [
  {
    id: 'evt_001',
    severity: 'info',
    actor: 'admin_01',
    event: 'Published lesson version',
    target: 'lesson/customer-cohorts-v3',
    requestId: 'req_f3a912',
    time: '2m ago',
  },
  {
    id: 'evt_002',
    severity: 'warn',
    actor: 'system',
    event: 'Sandbox pool hit 84% utilization',
    target: 'sandbox-cluster/ap-southeast-1',
    requestId: 'req_c81bb3',
    time: '8m ago',
  },
  {
    id: 'evt_003',
    severity: 'error',
    actor: 'worker_sync',
    event: 'Dataset verification failed',
    target: 'dataset/fintech-ledger-large',
    requestId: 'req_a0f21e',
    time: '14m ago',
  },
  {
    id: 'evt_004',
    severity: 'info',
    actor: 'admin_02',
    event: 'Role updated from contributor to admin',
    target: 'user/minh.tran',
    requestId: 'req_18dd42',
    time: '31m ago',
  },
  {
    id: 'evt_005',
    severity: 'warn',
    actor: 'scheduler',
    event: 'Nightly content sync exceeded baseline duration',
    target: 'job/content-sync',
    requestId: 'req_915cd0',
    time: '47m ago',
  },
];

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-surface-container-high text-on-surface-variant',
  warn: 'bg-surface-container-high text-on-surface',
  error: 'bg-error/10 text-error',
};

export default function AdminSystemLogsPage() {
  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">System Health</p>
          <h1 className="mt-2 page-title-lg">System Logs</h1>
          <p className="page-lead mt-2 max-w-2xl">
            Audit trail for privileged actions, dataset operations, and infrastructure events.
            The observability design and SRS both require retained admin logs for publish,
            role, and runtime actions.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Privileged</p>
            <p className="mt-2 text-xl font-semibold text-on-surface">42</p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Warnings</p>
            <p className="mt-2 text-xl font-semibold text-tertiary">7</p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Errors</p>
            <p className="mt-2 text-xl font-semibold text-error">2</p>
          </div>
        </div>
      </div>

      <div className="section-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-md flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-outline">
              <span className="material-symbols-outlined text-sm">search</span>
            </span>
            <input
              readOnly
              value="Search events, actors, request IDs"
              className="w-full rounded-xl border border-outline-variant/10 bg-surface px-10 py-2.5 text-sm text-on-surface-variant"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {['All Events', 'Audit', 'Jobs', 'Warnings', 'Errors'].map((filter) => (
              <span
                key={filter}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  filter === 'All Events'
                    ? 'bg-surface-container-high text-on-surface'
                    : 'bg-surface text-on-surface-variant'
                }`}
              >
                {filter}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container-low">
        <div className="border-b border-outline-variant/10 px-5 py-4">
          <h2 className="page-section-title">Console Output</h2>
        </div>
        <div className="divide-y divide-outline-variant/10">
          {LOG_ENTRIES.map((entry) => (
            <div
              key={entry.id}
              className="grid gap-4 px-5 py-4 lg:grid-cols-[96px,88px,140px,1fr,168px,84px]"
            >
              <div className="font-mono text-xs text-on-surface-variant">{entry.time}</div>
              <div>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${SEVERITY_STYLES[entry.severity]}`}
                >
                  {entry.severity}
                </span>
              </div>
              <div className="text-sm font-medium text-on-surface">{entry.actor}</div>
              <div>
                <p className="text-sm text-on-surface">{entry.event}</p>
                <p className="mt-1 font-mono text-xs text-on-surface-variant">{entry.target}</p>
              </div>
              <div className="font-mono text-xs text-on-surface-variant">{entry.requestId}</div>
              <div className="text-right text-xs text-outline">{entry.id}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
