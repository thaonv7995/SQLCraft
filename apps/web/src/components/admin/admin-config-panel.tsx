'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { adminApi, type AdminConfig, type AdminConfigRecord } from '@/lib/api';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatCard,
} from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { cn, formatRelativeTime } from '@/lib/utils';

type ConfigSectionKey = keyof AdminConfig;
type FlagKey = keyof AdminConfig['flags'];

type FeatureFlagMeta = {
  key: FlagKey;
  label: string;
  description: string;
  audience: 'Users' | 'Admins';
};

const CONFIG_QUERY_KEY = ['admin-config'];

const SECTION_LABELS: Record<ConfigSectionKey, string> = {
  platform: 'Platform Defaults',
  rankings: 'Ranking Defaults',
  moderation: 'Submission Moderation',
  infrastructure: 'Workers & Storage',
  flags: 'Feature Flags',
};

const FEATURE_FLAGS: FeatureFlagMeta[] = [
  {
    key: 'globalRankings',
    label: 'Global rankings',
    description: 'Expose the main SQLForge ranking board across fixed-point challenges.',
    audience: 'Users',
  },
  {
    key: 'challengeRankings',
    label: 'Challenge rankings',
    description: 'Show per-challenge placements and recent movement on challenge detail screens.',
    audience: 'Users',
  },
  {
    key: 'submissionQueue',
    label: 'Submission review queue',
    description: 'Keep admin review enabled for challenge and lesson submissions before publish.',
    audience: 'Admins',
  },
  {
    key: 'explanationPanel',
    label: 'Explain plan panel',
    description: 'Enable deeper query-plan hints for admins during review and support triage.',
    audience: 'Admins',
  },
  {
    key: 'snapshotExports',
    label: 'Snapshot exports',
    description: 'Allow admins to export the current config snapshot for audits and rollback notes.',
    audience: 'Admins',
  },
];

function cloneConfig(config: AdminConfig): AdminConfig {
  return JSON.parse(JSON.stringify(config)) as AdminConfig;
}

function countDifferences(current: unknown, baseline: unknown): number {
  if (
    current === null ||
    baseline === null ||
    typeof current !== 'object' ||
    typeof baseline !== 'object'
  ) {
    return current === baseline ? 0 : 1;
  }

  const currentRecord = current as Record<string, unknown>;
  const baselineRecord = baseline as Record<string, unknown>;
  const keys = new Set([...Object.keys(currentRecord), ...Object.keys(baselineRecord)]);

  let total = 0;
  keys.forEach((key) => {
    total += countDifferences(currentRecord[key], baselineRecord[key]);
  });

  return total;
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-outline-variant/10 bg-surface-container p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-on-surface">{label}</p>
          <p className="text-xs leading-relaxed text-on-surface-variant">{hint}</p>
        </div>
        <button
          type="button"
          aria-pressed={checked}
          onClick={() => onChange(!checked)}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
            checked ? 'bg-primary' : 'bg-surface-container-highest',
          )}
        >
          <span
            className={cn(
              'inline-block h-5 w-5 rounded-full bg-surface-container-low shadow-sm transition-transform',
              checked ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
          <span className="sr-only">{label}</span>
        </button>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="section-card p-5">
      <h2 className="page-section-title">Config</h2>
      <p className="mt-1 text-sm text-on-surface-variant">
        Loading persisted admin configuration from the backend.
      </p>
    </section>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="section-card p-5">
      <h2 className="page-section-title">Config</h2>
      <p className="mt-1 text-sm text-on-surface-variant">
        The admin config endpoint is unavailable right now.
      </p>
      <div className="mt-4">
        <Button
          variant="secondary"
          leftIcon={<span className="material-symbols-outlined text-base">refresh</span>}
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    </section>
  );
}

export function AdminConfigPanel() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: adminApi.getConfig,
    staleTime: 30_000,
  });

  const [draft, setDraft] = useState<AdminConfig | null>(null);

  const persistConfigRecord = (record: AdminConfigRecord) => {
    queryClient.setQueryData(CONFIG_QUERY_KEY, record);
    setDraft(null);
  };

  const saveMutation = useMutation({
    mutationFn: (config: AdminConfig) => adminApi.updateConfig(config),
    onSuccess: (record) => {
      persistConfigRecord(record);
      toast.success('Admin config saved');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save admin config');
    },
  });

  const resetMutation = useMutation({
    mutationFn: adminApi.resetConfig,
    onSuccess: (record) => {
      persistConfigRecord(record);
      toast.success('Admin config reset to backend baseline');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reset admin config');
    },
  });

  const persisted = configQuery.data;
  const currentConfig = draft ?? (persisted ? cloneConfig(persisted.config) : null);
  const isBusy = saveMutation.isPending || resetMutation.isPending;

  const enabledFlagsCount = currentConfig
    ? Object.values(currentConfig.flags).filter(Boolean).length
    : 0;

  const unsavedChanges =
    currentConfig && persisted ? countDifferences(currentConfig, persisted.config) : 0;

  const pendingSections =
    currentConfig && persisted
      ? (Object.keys(SECTION_LABELS) as ConfigSectionKey[]).filter(
          (section) => countDifferences(currentConfig[section], persisted.config[section]) > 0,
        )
      : [];

  const readinessChecks = useMemo(() => {
    if (!currentConfig) {
      return [];
    }

    return [
      {
        label: 'Draft validation remains required before publish',
        ok:
          currentConfig.moderation.requireDraftValidation &&
          currentConfig.moderation.blockDangerousSql,
      },
      {
        label: 'Ranking surfaces stay enabled',
        ok: currentConfig.flags.globalRankings && currentConfig.flags.challengeRankings,
      },
      {
        label: 'Warm sandbox pool stays at 6 or higher',
        ok: Number(currentConfig.infrastructure.sandboxWarmPool) >= 6,
      },
    ];
  }, [currentConfig]);

  const updateSection = <K extends ConfigSectionKey>(
    section: K,
    patch: Partial<AdminConfig[K]>,
  ) => {
    setDraft((current) => {
      const baseConfig = current ?? (persisted ? cloneConfig(persisted.config) : null);
      if (!baseConfig) {
        return current;
      }

      return {
        ...baseConfig,
        [section]: {
          ...baseConfig[section],
          ...patch,
        },
      };
    });
  };

  const handleDiscardChanges = () => {
    if (!persisted || unsavedChanges === 0) {
      return;
    }

    setDraft(null);
    toast.success('Unsaved changes discarded');
  };

  const handleSave = () => {
    if (!currentConfig || unsavedChanges === 0) {
      toast.success('Config is already up to date');
      return;
    }

    saveMutation.mutate(currentConfig);
  };

  const handleReset = () => {
    resetMutation.mutate();
  };

  const handleExport = () => {
    if (!currentConfig || !persisted) {
      return;
    }

    const fileName = `sqlforge-admin-config-${persisted.scope}.json`;
    const payload = {
      exportedAt: new Date().toISOString(),
      scope: persisted.scope,
      updatedAt: persisted.updatedAt,
      config: currentConfig,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success('Config snapshot exported');
  };

  if (configQuery.isLoading && !currentConfig) {
    return <LoadingState />;
  }

  if (configQuery.isError || !persisted || !currentConfig) {
    return <ErrorState onRetry={() => void configQuery.refetch()} />;
  }

  return (
    <div className="page-stack">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="page-section-title">Config</h2>
            <StatusBadge status={unsavedChanges > 0 ? 'draft' : 'published'} />
          </div>
          <p className="max-w-3xl text-sm text-on-surface-variant">
            Persisted admin defaults for rankings, moderation, workers, and platform behavior.
            This panel is backed by the real `/admin/config` API.
          </p>
        </div>

        <div className="rounded-xl bg-surface-container-low px-4 py-3 text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Last Persisted</p>
          <p className="mt-2 text-sm font-semibold text-on-surface">
            {formatRelativeTime(persisted.updatedAt)}
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">{persisted.scope}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-on-surface">
            {unsavedChanges > 0
              ? `${unsavedChanges} unsaved change${unsavedChanges === 1 ? '' : 's'}`
              : 'Persisted config is aligned with the working draft'}
          </p>
          <p className="text-xs text-on-surface-variant">
            Enabled flags: {enabledFlagsCount} / {FEATURE_FLAGS.length}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={saveMutation.isPending}
            leftIcon={<span className="material-symbols-outlined text-base">save</span>}
            onClick={handleSave}
          >
            Save Config
          </Button>
          <Button
            variant="ghost"
            disabled={isBusy}
            leftIcon={<span className="material-symbols-outlined text-base">undo</span>}
            onClick={handleDiscardChanges}
          >
            Discard Changes
          </Button>
          <Button
            variant="ghost"
            loading={resetMutation.isPending}
            leftIcon={<span className="material-symbols-outlined text-base">restart_alt</span>}
            onClick={handleReset}
          >
            Restore Baseline
          </Button>
          <Button
            variant="ghost"
            disabled={isBusy}
            leftIcon={<span className="material-symbols-outlined text-base">download</span>}
            onClick={handleExport}
          >
            Export Snapshot
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Unsaved Changes"
          value={unsavedChanges}
          icon={<span className="material-symbols-outlined">edit_note</span>}
          accent="tertiary"
        />
        <StatCard
          label="Enabled Flags"
          value={`${enabledFlagsCount}/${FEATURE_FLAGS.length}`}
          icon={<span className="material-symbols-outlined">toggle_on</span>}
          accent="secondary"
        />
        <StatCard
          label="Warm Sandbox Pool"
          value={currentConfig.infrastructure.sandboxWarmPool}
          icon={<span className="material-symbols-outlined">deployed_code</span>}
          accent="primary"
        />
        <StatCard
          label="Ranking Refresh"
          value={currentConfig.rankings.refreshInterval}
          icon={<span className="material-symbols-outlined">schedule</span>}
          accent="primary"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="items-start gap-3 border-b border-outline-variant/10 sm:flex-row sm:items-center">
            <div>
              <CardTitle>Platform Defaults</CardTitle>
              <CardDescription>
                Core behavior for new SQL practice sessions and fixed-point challenge setup.
              </CardDescription>
            </div>
            <Badge className="bg-primary/10 text-primary">Persisted</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Select
                label="Default SQL dialect"
                value={currentConfig.platform.defaultDialect}
                onChange={(event) =>
                  updateSection('platform', { defaultDialect: event.target.value as AdminConfig['platform']['defaultDialect'] })
                }
                options={[
                  { value: 'postgresql-16', label: 'PostgreSQL 16' },
                  { value: 'mysql-8', label: 'MySQL 8' },
                  { value: 'sqlite-3', label: 'SQLite 3' },
                ]}
              />
              <Input
                label="Fixed challenge points"
                value={currentConfig.platform.defaultChallengePoints}
                onChange={(event) =>
                  updateSection('platform', { defaultChallengePoints: event.target.value })
                }
              />
              <Input
                label="Session timeout (minutes)"
                value={currentConfig.platform.sessionTimeoutMinutes}
                onChange={(event) =>
                  updateSection('platform', { sessionTimeoutMinutes: event.target.value })
                }
              />
              <Select
                label="Daily query budget"
                value={currentConfig.platform.dailyQueryBudget}
                onChange={(event) =>
                  updateSection('platform', { dailyQueryBudget: event.target.value })
                }
                options={[
                  { value: '400', label: '400 queries per user' },
                  { value: '800', label: '800 queries per user' },
                  { value: '1200', label: '1,200 queries per user' },
                ]}
              />
              <Select
                label="Starter schema visibility"
                value={currentConfig.platform.starterSchemaVisibility}
                onChange={(event) =>
                  updateSection('platform', {
                    starterSchemaVisibility:
                      event.target.value as AdminConfig['platform']['starterSchemaVisibility'],
                  })
                }
                options={[
                  { value: 'schema-only', label: 'Schema only' },
                  { value: 'schema-and-sample', label: 'Schema + sample rows' },
                  { value: 'delayed-sample', label: 'Sample rows after first run' },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ToggleRow
                label="Explain-plan hints"
                hint="Show focused SQL plan hints to help users recover from failed submissions."
                checked={currentConfig.platform.enableExplainHints}
                onChange={(value) => updateSection('platform', { enableExplainHints: value })}
              />
              <ToggleRow
                label="Sample data downloads"
                hint="Allow admins to export sample datasets directly from practice screens."
                checked={currentConfig.platform.allowSampleDataDownloads}
                onChange={(value) =>
                  updateSection('platform', { allowSampleDataDownloads: value })
                }
              />
            </div>

            <Textarea
              label="Operator note"
              value={currentConfig.platform.operatorNote}
              onChange={(event) => updateSection('platform', { operatorNote: event.target.value })}
              rows={4}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="items-start gap-3 border-b border-outline-variant/10 sm:flex-row sm:items-center">
            <div>
              <CardTitle>Ranking Defaults</CardTitle>
              <CardDescription>
                Controls for global rankings, challenge placements, and tie-break behavior.
              </CardDescription>
            </div>
            <Badge className="bg-secondary/10 text-secondary">Live rankings</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Select
                label="Global ranking window"
                value={currentConfig.rankings.globalWindow}
                onChange={(event) =>
                  updateSection('rankings', {
                    globalWindow: event.target.value as AdminConfig['rankings']['globalWindow'],
                  })
                }
                options={[
                  { value: 'all-time', label: 'All time' },
                  { value: 'seasonal', label: 'Current season' },
                  { value: 'rolling-30', label: 'Rolling 30 days' },
                ]}
              />
              <Select
                label="Tie-break rule"
                value={currentConfig.rankings.tieBreaker}
                onChange={(event) =>
                  updateSection('rankings', {
                    tieBreaker: event.target.value as AdminConfig['rankings']['tieBreaker'],
                  })
                }
                options={[
                  { value: 'completion-speed', label: 'Fastest solve time' },
                  { value: 'accuracy-first', label: 'Most accurate first run' },
                  { value: 'recent-activity', label: 'Most recent activity' },
                ]}
              />
              <Input
                label="Global leaderboard rows"
                value={currentConfig.rankings.globalLeaderboardSize}
                onChange={(event) =>
                  updateSection('rankings', { globalLeaderboardSize: event.target.value })
                }
              />
              <Input
                label="Challenge leaderboard rows"
                value={currentConfig.rankings.challengeLeaderboardSize}
                onChange={(event) =>
                  updateSection('rankings', { challengeLeaderboardSize: event.target.value })
                }
              />
              <Select
                label="Refresh cadence"
                value={currentConfig.rankings.refreshInterval}
                onChange={(event) =>
                  updateSection('rankings', {
                    refreshInterval:
                      event.target.value as AdminConfig['rankings']['refreshInterval'],
                  })
                }
                options={[
                  { value: '1m', label: 'Every minute' },
                  { value: '5m', label: 'Every 5 minutes' },
                  { value: '15m', label: 'Every 15 minutes' },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ToggleRow
                label="Provisional placements"
                hint="Show temporary ranking movement before the next full standings refresh."
                checked={currentConfig.rankings.displayProvisionalRanks}
                onChange={(value) =>
                  updateSection('rankings', { displayProvisionalRanks: value })
                }
              />
              <ToggleRow
                label="Recent mover highlights"
                hint="Highlight users gaining or losing placement during the active ranking window."
                checked={currentConfig.rankings.highlightRecentMovers}
                onChange={(value) =>
                  updateSection('rankings', { highlightRecentMovers: value })
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="items-start gap-3 border-b border-outline-variant/10 sm:flex-row sm:items-center">
            <div>
              <CardTitle>Submission Moderation</CardTitle>
              <CardDescription>
                Rules for review flow, validation gates, and admin feedback on incoming submissions.
              </CardDescription>
            </div>
            <Badge className="bg-tertiary/10 text-tertiary">Admin review</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <ToggleRow
                label="Require draft validation"
                hint="Check reference SQL and blocked statements before a submission enters review."
                checked={currentConfig.moderation.requireDraftValidation}
                onChange={(value) =>
                  updateSection('moderation', { requireDraftValidation: value })
                }
              />
              <ToggleRow
                label="Block dangerous SQL"
                hint="Stop submissions that include destructive statements or policy violations."
                checked={currentConfig.moderation.blockDangerousSql}
                onChange={(value) =>
                  updateSection('moderation', { blockDangerousSql: value })
                }
              />
              <ToggleRow
                label="Hold high-point submissions"
                hint="Send high-value challenge changes to manual admin review before publish."
                checked={currentConfig.moderation.autoHoldHighPointSubmissions}
                onChange={(value) =>
                  updateSection('moderation', { autoHoldHighPointSubmissions: value })
                }
              />
            </div>

            <Input
              label="Manual review SLA (hours)"
              value={currentConfig.moderation.manualReviewSlaHours}
              onChange={(event) =>
                updateSection('moderation', { manualReviewSlaHours: event.target.value })
              }
            />

            <Textarea
              label="Publish checklist"
              value={currentConfig.moderation.publishChecklist}
              onChange={(event) =>
                updateSection('moderation', { publishChecklist: event.target.value })
              }
              rows={4}
            />

            <Textarea
              label="Default rejection guidance"
              value={currentConfig.moderation.rejectionTemplate}
              onChange={(event) =>
                updateSection('moderation', { rejectionTemplate: event.target.value })
              }
              rows={4}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="items-start gap-3 border-b border-outline-variant/10 sm:flex-row sm:items-center">
            <div>
              <CardTitle>Workers &amp; Storage</CardTitle>
              <CardDescription>
                Runtime defaults for query workers, evaluation throughput, and storage retention.
              </CardDescription>
            </div>
            <Badge className="bg-primary/10 text-primary">Runtime guardrails</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Query worker concurrency"
                value={currentConfig.infrastructure.queryWorkerConcurrency}
                onChange={(event) =>
                  updateSection('infrastructure', {
                    queryWorkerConcurrency: event.target.value,
                  })
                }
              />
              <Input
                label="Evaluation worker concurrency"
                value={currentConfig.infrastructure.evaluationWorkerConcurrency}
                onChange={(event) =>
                  updateSection('infrastructure', {
                    evaluationWorkerConcurrency: event.target.value,
                  })
                }
              />
              <Input
                label="Warm sandbox pool"
                value={currentConfig.infrastructure.sandboxWarmPool}
                onChange={(event) =>
                  updateSection('infrastructure', { sandboxWarmPool: event.target.value })
                }
              />
              <Input
                label="Run retention (days)"
                value={currentConfig.infrastructure.runRetentionDays}
                onChange={(event) =>
                  updateSection('infrastructure', { runRetentionDays: event.target.value })
                }
              />
              <Select
                label="Object storage class"
                value={currentConfig.infrastructure.objectStorageClass}
                onChange={(event) =>
                  updateSection('infrastructure', {
                    objectStorageClass:
                      event.target.value as AdminConfig['infrastructure']['objectStorageClass'],
                  })
                }
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'infrequent', label: 'Infrequent access' },
                  { value: 'archive', label: 'Archive' },
                ]}
              />
              <Input
                label="Storage warning threshold (GB)"
                value={currentConfig.infrastructure.warningThresholdGb}
                onChange={(event) =>
                  updateSection('infrastructure', { warningThresholdGb: event.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ToggleRow
                label="Keep execution snapshots"
                hint="Retain snapshot bundles for challenge review and ranking disputes."
                checked={currentConfig.infrastructure.keepExecutionSnapshots}
                onChange={(value) =>
                  updateSection('infrastructure', { keepExecutionSnapshots: value })
                }
              />
              <ToggleRow
                label="Nightly exports"
                hint="Create nightly admin snapshots for rollback checks and release notes."
                checked={currentConfig.infrastructure.enableNightlyExports}
                onChange={(value) =>
                  updateSection('infrastructure', { enableNightlyExports: value })
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="items-start gap-3 border-b border-outline-variant/10 sm:flex-row sm:items-center">
          <div>
            <CardTitle>Feature Flags</CardTitle>
            <CardDescription>
              Rollout controls for ranking surfaces, review tooling, and admin exports.
            </CardDescription>
          </div>
          <Badge className="bg-surface-container-high text-on-surface-variant">
            {enabledFlagsCount} enabled
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {FEATURE_FLAGS.map((flag) => (
            <div
              key={flag.key}
              className="rounded-xl border border-outline-variant/10 bg-surface-container p-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-on-surface">{flag.label}</p>
                    <Badge
                      className={cn(
                        flag.audience === 'Users'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-surface-container-high text-on-surface-variant',
                      )}
                    >
                      {flag.audience}
                    </Badge>
                  </div>
                  <p className="max-w-2xl text-xs leading-relaxed text-on-surface-variant">
                    {flag.description}
                  </p>
                </div>

                <button
                  type="button"
                  aria-pressed={currentConfig.flags[flag.key]}
                  onClick={() =>
                    updateSection('flags', {
                      [flag.key]: !currentConfig.flags[flag.key],
                    } as Partial<AdminConfig['flags']>)
                  }
                  className={cn(
                    'inline-flex h-9 min-w-28 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors',
                    currentConfig.flags[flag.key]
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-outline-variant/20 bg-surface-container-high text-on-surface-variant',
                  )}
                >
                  {currentConfig.flags[flag.key] ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="items-start gap-3 border-b border-outline-variant/10">
            <div>
              <CardTitle>Release Summary</CardTitle>
              <CardDescription>
                Snapshot of what will change when the current draft is persisted.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-surface-container p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Affected Sections</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingSections.length > 0 ? (
                  pendingSections.map((section) => (
                    <Badge key={section} className="bg-primary/10 text-primary">
                      {SECTION_LABELS[section]}
                    </Badge>
                  ))
                ) : (
                  <Badge className="bg-secondary/10 text-secondary">No unsaved sections</Badge>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-low p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Persisted Scope</p>
              <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
                This config record is stored centrally under the <span className="font-mono">{persisted.scope}</span>{' '}
                scope and is consumed by admin ranking and system surfaces.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="items-start gap-3 border-b border-outline-variant/10">
            <div>
              <CardTitle>Readiness Checks</CardTitle>
              <CardDescription>
                Quick sanity checks before saving admin config to the backend.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {readinessChecks.map((check) => (
              <div
                key={check.label}
                className="flex items-start gap-3 rounded-xl border border-outline-variant/10 bg-surface-container p-3"
              >
                <span
                  className={cn(
                    'material-symbols-outlined text-base',
                    check.ok ? 'text-secondary' : 'text-error',
                  )}
                >
                  {check.ok ? 'check_circle' : 'error'}
                </span>
                <div>
                  <p className="text-sm font-medium text-on-surface">{check.label}</p>
                  <p className="text-xs text-on-surface-variant">
                    {check.ok ? 'Ready' : 'Needs attention before saving'}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
