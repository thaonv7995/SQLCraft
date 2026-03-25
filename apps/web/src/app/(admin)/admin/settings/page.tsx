'use client';

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type SettingsState = {
  platform: {
    defaultDialect: string;
    defaultChallengePoints: string;
    sessionTimeoutMinutes: string;
    dailyQueryBudget: string;
    starterSchemaVisibility: string;
    enableExplainHints: boolean;
    allowSampleDataDownloads: boolean;
    operatorNote: string;
  };
  rankings: {
    globalWindow: string;
    globalLeaderboardSize: string;
    challengeLeaderboardSize: string;
    tieBreaker: string;
    refreshInterval: string;
    displayProvisionalRanks: boolean;
    highlightRecentMovers: boolean;
  };
  moderation: {
    requireDraftValidation: boolean;
    blockDangerousSql: boolean;
    autoHoldHighPointSubmissions: boolean;
    manualReviewSlaHours: string;
    publishChecklist: string;
    rejectionTemplate: string;
  };
  infrastructure: {
    queryWorkerConcurrency: string;
    evaluationWorkerConcurrency: string;
    sandboxWarmPool: string;
    runRetentionDays: string;
    objectStorageClass: string;
    warningThresholdGb: string;
    keepExecutionSnapshots: boolean;
    enableNightlyExports: boolean;
  };
  flags: {
    globalRankings: boolean;
    challengeRankings: boolean;
    submissionQueue: boolean;
    explanationPanel: boolean;
    snapshotExports: boolean;
  };
};

type AuditEntryStatus = 'published' | 'draft' | 'pending' | 'active';

type AuditEntry = {
  id: string;
  title: string;
  summary: string;
  actor: string;
  timeLabel: string;
  status: AuditEntryStatus;
};

type FlagKey = keyof SettingsState['flags'];

type FeatureFlagMeta = {
  key: FlagKey;
  label: string;
  description: string;
  audience: 'Users' | 'Admins';
};

const SECTION_LABELS: Record<keyof SettingsState, string> = {
  platform: 'Platform Defaults',
  rankings: 'Ranking Defaults',
  moderation: 'Submission Moderation',
  infrastructure: 'Workers & Storage',
  flags: 'Feature Flags',
};

const BASELINE_SETTINGS: SettingsState = {
  platform: {
    defaultDialect: 'postgresql-16',
    defaultChallengePoints: '100',
    sessionTimeoutMinutes: '35',
    dailyQueryBudget: '800',
    starterSchemaVisibility: 'schema-only',
    enableExplainHints: true,
    allowSampleDataDownloads: false,
    operatorNote:
      'Keep the default experience fast for new users: stable seed data, fixed points, and limited session drift.',
  },
  rankings: {
    globalWindow: 'all-time',
    globalLeaderboardSize: '100',
    challengeLeaderboardSize: '50',
    tieBreaker: 'completion-speed',
    refreshInterval: '5m',
    displayProvisionalRanks: true,
    highlightRecentMovers: true,
  },
  moderation: {
    requireDraftValidation: true,
    blockDangerousSql: true,
    autoHoldHighPointSubmissions: true,
    manualReviewSlaHours: '24',
    publishChecklist:
      'Reference SQL returns stable rows.\nFixed points match challenge difficulty.\nLeaderboard impact reviewed before publish.',
    rejectionTemplate:
      'Please run draft validation again, confirm the fixed point value, and resubmit after resolving the review notes.',
  },
  infrastructure: {
    queryWorkerConcurrency: '12',
    evaluationWorkerConcurrency: '6',
    sandboxWarmPool: '8',
    runRetentionDays: '14',
    objectStorageClass: 'standard',
    warningThresholdGb: '120',
    keepExecutionSnapshots: true,
    enableNightlyExports: true,
  },
  flags: {
    globalRankings: true,
    challengeRankings: true,
    submissionQueue: true,
    explanationPanel: false,
    snapshotExports: true,
  },
};

const FEATURE_FLAGS: FeatureFlagMeta[] = [
  {
    key: 'globalRankings',
    label: 'Global rankings',
    description: 'Expose the main SQLCraft ranking board across all fixed-point challenges.',
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
    description: 'Allow admins to export the current defaults and moderation profile for audits.',
    audience: 'Admins',
  },
];

const INITIAL_AUDIT_LOG: AuditEntry[] = [
  {
    id: 'published-r18',
    title: 'Published revision r18',
    summary: 'Expanded global rankings to 100 rows and tightened fixed-point review notes.',
    actor: 'Admin',
    timeLabel: 'Today, 09:12',
    status: 'published',
  },
  {
    id: 'draft-r18b',
    title: 'Saved draft for ranking cadence',
    summary: 'Prepared a 5-minute leaderboard refresh with provisional placements enabled.',
    actor: 'Admin',
    timeLabel: 'Today, 08:41',
    status: 'draft',
  },
  {
    id: 'baseline-workers',
    title: 'Baseline restored for worker pool',
    summary: 'Reset warm sandbox pool to 8 after overnight export pressure cleared.',
    actor: 'Admin',
    timeLabel: 'Yesterday, 18:20',
    status: 'active',
  },
  {
    id: 'moderation-policy',
    title: 'Moderation SLA confirmed',
    summary: 'Kept manual review SLA at 24 hours for high-point submissions and publish holds.',
    actor: 'Admin',
    timeLabel: 'Yesterday, 10:05',
    status: 'pending',
  },
];

function cloneSettings(settings: SettingsState): SettingsState {
  return JSON.parse(JSON.stringify(settings)) as SettingsState;
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

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(() => cloneSettings(BASELINE_SETTINGS));
  const [savedSnapshot, setSavedSnapshot] = useState<SettingsState>(() => cloneSettings(BASELINE_SETTINGS));
  const [publishedSnapshot, setPublishedSnapshot] = useState<SettingsState>(() =>
    cloneSettings(BASELINE_SETTINGS),
  );
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>(INITIAL_AUDIT_LOG);
  const [liveRevision, setLiveRevision] = useState(18);
  const [lastSavedLabel, setLastSavedLabel] = useState('Today, 08:41');
  const [lastPublishedLabel, setLastPublishedLabel] = useState('Today, 09:12');

  const enabledFlagsCount = Object.values(settings.flags).filter(Boolean).length;
  const unsavedChanges = countDifferences(settings, savedSnapshot);
  const pendingPublishChanges = countDifferences(settings, publishedSnapshot);
  const pendingSections = (Object.keys(SECTION_LABELS) as Array<keyof SettingsState>).filter(
    (section) => countDifferences(settings[section], publishedSnapshot[section]) > 0,
  );

  const readinessChecks = useMemo(
    () => [
      {
        label: 'Draft validation stays required before submission review',
        ok: settings.moderation.requireDraftValidation && settings.moderation.blockDangerousSql,
      },
      {
        label: 'Global and challenge rankings remain enabled',
        ok: settings.flags.globalRankings && settings.flags.challengeRankings,
      },
      {
        label: 'Warm sandbox pool remains at 6 or higher',
        ok: Number(settings.infrastructure.sandboxWarmPool) >= 6,
      },
    ],
    [settings],
  );

  const updateSection = <K extends keyof SettingsState>(
    section: K,
    patch: Partial<SettingsState[K]>,
  ) => {
    setSettings((current) => ({
      ...current,
      [section]: {
        ...current[section],
        ...patch,
      },
    }));
  };

  const pushAuditEntry = (entry: Omit<AuditEntry, 'id'>) => {
    setAuditEntries((current) => [
      { ...entry, id: `${Date.now()}-${current.length}` },
      ...current,
    ]);
  };

  const handleSaveDraft = () => {
    if (unsavedChanges === 0) {
      toast.success('Draft is already up to date');
      return;
    }

    setSavedSnapshot(cloneSettings(settings));
    setLastSavedLabel('Just now');
    pushAuditEntry({
      title: 'Saved working draft',
      summary: `Captured ${unsavedChanges} updated default${unsavedChanges === 1 ? '' : 's'} for admin review.`,
      actor: 'Admin',
      timeLabel: 'Just now',
      status: 'draft',
    });
    toast.success('Draft saved locally');
  };

  const handlePublishDefaults = () => {
    if (pendingPublishChanges === 0) {
      toast.success('Live defaults already match this draft');
      return;
    }

    const nextRevision = liveRevision + 1;
    setSavedSnapshot(cloneSettings(settings));
    setPublishedSnapshot(cloneSettings(settings));
    setLiveRevision(nextRevision);
    setLastSavedLabel('Just now');
    setLastPublishedLabel('Just now');
    pushAuditEntry({
      title: `Published revision r${nextRevision}`,
      summary: `Pushed updates across ${pendingSections.length} section${pendingSections.length === 1 ? '' : 's'}: ${pendingSections.join(', ')}.`,
      actor: 'Admin',
      timeLabel: 'Just now',
      status: 'published',
    });
    toast.success('Defaults published');
  };

  const handleRestoreBaseline = () => {
    setSettings(cloneSettings(BASELINE_SETTINGS));
    pushAuditEntry({
      title: 'Restored baseline draft',
      summary: 'Reset working settings to the agreed SQLCraft production baseline without touching the live revision.',
      actor: 'Admin',
      timeLabel: 'Just now',
      status: 'active',
    });
    toast.success('Baseline restored to working draft');
  };

  const handleExportSnapshot = () => {
    const fileName = `sqlcraft-settings-r${liveRevision}-draft.json`;
    const payload = {
      exportedAt: new Date().toISOString(),
      liveRevision: `r${liveRevision}`,
      pendingPublishChanges,
      settings,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);

    pushAuditEntry({
      title: 'Exported settings snapshot',
      summary: `Generated ${fileName} for audit review and release notes.`,
      actor: 'Admin',
      timeLabel: 'Just now',
      status: 'pending',
    });
    toast.success('Snapshot exported');
  };

  return (
    <div className="page-shell page-stack">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="page-title">Settings</h1>
            <StatusBadge status={pendingPublishChanges > 0 ? 'draft' : 'published'} />
          </div>
          <p className="page-lead max-w-3xl">
            Manage SQLCraft platform defaults for SQL practice, fixed points, rankings, review flow,
            and runtime guardrails. All controls on this screen are local-only and ready for backend
            wiring later.
          </p>
        </div>

        <div className="rounded-xl bg-surface-container-low px-4 py-3 text-right">
          <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Live Revision</p>
          <p className="mt-2 text-xl font-semibold text-on-surface">{`r${liveRevision}`}</p>
          <p className="mt-1 text-xs text-on-surface-variant">{lastPublishedLabel}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-on-surface">
            {pendingPublishChanges > 0
              ? `${pendingPublishChanges} live change${pendingPublishChanges === 1 ? '' : 's'} pending publish`
              : 'Live defaults are aligned with the working draft'}
          </p>
          <p className="text-xs text-on-surface-variant">
            Saved draft: {lastSavedLabel} · Enabled flags: {enabledFlagsCount} / {FEATURE_FLAGS.length}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            leftIcon={<span className="material-symbols-outlined text-base">save</span>}
            onClick={handleSaveDraft}
          >
            Save Draft
          </Button>
          <Button
            leftIcon={<span className="material-symbols-outlined text-base">publish</span>}
            onClick={handlePublishDefaults}
          >
            Publish Defaults
          </Button>
          <Button
            variant="ghost"
            leftIcon={<span className="material-symbols-outlined text-base">restart_alt</span>}
            onClick={handleRestoreBaseline}
          >
            Restore Baseline
          </Button>
          <Button
            variant="ghost"
            leftIcon={<span className="material-symbols-outlined text-base">download</span>}
            onClick={handleExportSnapshot}
          >
            Export Snapshot
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pending Live Changes"
          value={pendingPublishChanges}
          icon={<span className="material-symbols-outlined">pending_actions</span>}
          accent="primary"
        />
        <StatCard
          label="Unsaved Draft Changes"
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
          value={settings.infrastructure.sandboxWarmPool}
          icon={<span className="material-symbols-outlined">deployed_code</span>}
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
            <Badge className="bg-primary/10 text-primary">SQLCraft Production</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Select
                label="Default SQL dialect"
                value={settings.platform.defaultDialect}
                onChange={(event) =>
                  updateSection('platform', { defaultDialect: event.target.value })
                }
                options={[
                  { value: 'postgresql-16', label: 'PostgreSQL 16' },
                  { value: 'mysql-8', label: 'MySQL 8' },
                  { value: 'sqlite-3', label: 'SQLite 3' },
                ]}
              />
              <Input
                label="Fixed challenge points"
                value={settings.platform.defaultChallengePoints}
                onChange={(event) =>
                  updateSection('platform', { defaultChallengePoints: event.target.value })
                }
              />
              <Input
                label="Session timeout (minutes)"
                value={settings.platform.sessionTimeoutMinutes}
                onChange={(event) =>
                  updateSection('platform', { sessionTimeoutMinutes: event.target.value })
                }
              />
              <Select
                label="Daily query budget"
                value={settings.platform.dailyQueryBudget}
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
                value={settings.platform.starterSchemaVisibility}
                onChange={(event) =>
                  updateSection('platform', { starterSchemaVisibility: event.target.value })
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
                checked={settings.platform.enableExplainHints}
                onChange={(value) => updateSection('platform', { enableExplainHints: value })}
              />
              <ToggleRow
                label="Sample data downloads"
                hint="Allow admins to export sample datasets directly from practice screens."
                checked={settings.platform.allowSampleDataDownloads}
                onChange={(value) =>
                  updateSection('platform', { allowSampleDataDownloads: value })
                }
              />
            </div>

            <Textarea
              label="Operator note"
              value={settings.platform.operatorNote}
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
                value={settings.rankings.globalWindow}
                onChange={(event) => updateSection('rankings', { globalWindow: event.target.value })}
                options={[
                  { value: 'all-time', label: 'All time' },
                  { value: 'seasonal', label: 'Current season' },
                  { value: 'rolling-30', label: 'Rolling 30 days' },
                ]}
              />
              <Select
                label="Tie-break rule"
                value={settings.rankings.tieBreaker}
                onChange={(event) => updateSection('rankings', { tieBreaker: event.target.value })}
                options={[
                  { value: 'completion-speed', label: 'Fastest solve time' },
                  { value: 'accuracy-first', label: 'Most accurate first run' },
                  { value: 'recent-activity', label: 'Most recent activity' },
                ]}
              />
              <Input
                label="Global leaderboard rows"
                value={settings.rankings.globalLeaderboardSize}
                onChange={(event) =>
                  updateSection('rankings', { globalLeaderboardSize: event.target.value })
                }
              />
              <Input
                label="Challenge leaderboard rows"
                value={settings.rankings.challengeLeaderboardSize}
                onChange={(event) =>
                  updateSection('rankings', { challengeLeaderboardSize: event.target.value })
                }
              />
              <Select
                label="Refresh cadence"
                value={settings.rankings.refreshInterval}
                onChange={(event) =>
                  updateSection('rankings', { refreshInterval: event.target.value })
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
                checked={settings.rankings.displayProvisionalRanks}
                onChange={(value) =>
                  updateSection('rankings', { displayProvisionalRanks: value })
                }
              />
              <ToggleRow
                label="Recent mover highlights"
                hint="Highlight users gaining or losing placement during the active ranking window."
                checked={settings.rankings.highlightRecentMovers}
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
                checked={settings.moderation.requireDraftValidation}
                onChange={(value) =>
                  updateSection('moderation', { requireDraftValidation: value })
                }
              />
              <ToggleRow
                label="Block dangerous SQL"
                hint="Stop submissions that include destructive statements or policy violations."
                checked={settings.moderation.blockDangerousSql}
                onChange={(value) =>
                  updateSection('moderation', { blockDangerousSql: value })
                }
              />
              <ToggleRow
                label="Hold high-point submissions"
                hint="Send high-value challenge changes to manual admin review before publish."
                checked={settings.moderation.autoHoldHighPointSubmissions}
                onChange={(value) =>
                  updateSection('moderation', { autoHoldHighPointSubmissions: value })
                }
              />
            </div>

            <Input
              label="Manual review SLA (hours)"
              value={settings.moderation.manualReviewSlaHours}
              onChange={(event) =>
                updateSection('moderation', { manualReviewSlaHours: event.target.value })
              }
            />

            <Textarea
              label="Publish checklist"
              value={settings.moderation.publishChecklist}
              onChange={(event) =>
                updateSection('moderation', { publishChecklist: event.target.value })
              }
              rows={4}
            />

            <Textarea
              label="Default rejection guidance"
              value={settings.moderation.rejectionTemplate}
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
                Local defaults for query workers, evaluation throughput, and storage retention.
              </CardDescription>
            </div>
            <Badge className="bg-primary/10 text-primary">Runtime guardrails</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Query worker concurrency"
                value={settings.infrastructure.queryWorkerConcurrency}
                onChange={(event) =>
                  updateSection('infrastructure', {
                    queryWorkerConcurrency: event.target.value,
                  })
                }
              />
              <Input
                label="Evaluation worker concurrency"
                value={settings.infrastructure.evaluationWorkerConcurrency}
                onChange={(event) =>
                  updateSection('infrastructure', {
                    evaluationWorkerConcurrency: event.target.value,
                  })
                }
              />
              <Input
                label="Warm sandbox pool"
                value={settings.infrastructure.sandboxWarmPool}
                onChange={(event) =>
                  updateSection('infrastructure', { sandboxWarmPool: event.target.value })
                }
              />
              <Input
                label="Run retention (days)"
                value={settings.infrastructure.runRetentionDays}
                onChange={(event) =>
                  updateSection('infrastructure', { runRetentionDays: event.target.value })
                }
              />
              <Select
                label="Object storage class"
                value={settings.infrastructure.objectStorageClass}
                onChange={(event) =>
                  updateSection('infrastructure', { objectStorageClass: event.target.value })
                }
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'infrequent', label: 'Infrequent access' },
                  { value: 'archive', label: 'Archive' },
                ]}
              />
              <Input
                label="Storage warning threshold (GB)"
                value={settings.infrastructure.warningThresholdGb}
                onChange={(event) =>
                  updateSection('infrastructure', { warningThresholdGb: event.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ToggleRow
                label="Keep execution snapshots"
                hint="Retain snapshot bundles for challenge review and ranking disputes."
                checked={settings.infrastructure.keepExecutionSnapshots}
                onChange={(value) =>
                  updateSection('infrastructure', { keepExecutionSnapshots: value })
                }
              />
              <ToggleRow
                label="Nightly exports"
                hint="Create nightly admin snapshots for rollback checks and release notes."
                checked={settings.infrastructure.enableNightlyExports}
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
              Local rollout controls for ranking surfaces, review tooling, and admin exports.
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
                  aria-pressed={settings.flags[flag.key]}
                  onClick={() =>
                    updateSection('flags', {
                      [flag.key]: !settings.flags[flag.key],
                    } as Partial<SettingsState['flags']>)
                  }
                  className={cn(
                    'inline-flex h-9 min-w-28 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors',
                    settings.flags[flag.key]
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-outline-variant/20 bg-surface-container-high text-on-surface-variant',
                  )}
                >
                  {settings.flags[flag.key] ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader className="items-start gap-3 border-b border-outline-variant/10 sm:flex-row sm:items-center">
            <div>
              <CardTitle>Change Log</CardTitle>
              <CardDescription>
                Recent draft saves, publish activity, and local review events for this settings profile.
              </CardDescription>
            </div>
            <Badge className="bg-surface-container-high text-on-surface-variant">
              {auditEntries.length} entries
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {auditEntries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-outline-variant/10 bg-surface-container p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-on-surface">{entry.title}</p>
                      <StatusBadge status={entry.status} />
                    </div>
                    <p className="text-xs leading-relaxed text-on-surface-variant">
                      {entry.summary}
                    </p>
                  </div>
                  <div className="text-xs text-on-surface-variant sm:text-right">
                    <p>{entry.actor}</p>
                    <p>{entry.timeLabel}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="items-start gap-3 border-b border-outline-variant/10">
            <div>
              <CardTitle>Review Summary</CardTitle>
              <CardDescription>
                Final release context before publishing SQLCraft defaults to the live admin console.
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
                  <Badge className="bg-secondary/10 text-secondary">No live changes pending</Badge>
                )}
              </div>
            </div>

            <div className="space-y-3">
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
                      {check.ok ? 'Ready for publish' : 'Needs admin attention before publish'}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-low p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Admin Release Note</p>
              <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
                Current draft keeps SQL practice defaults conservative for users, preserves fixed
                points across ranking surfaces, and leaves the review queue enabled for admin-only
                publication checks.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
