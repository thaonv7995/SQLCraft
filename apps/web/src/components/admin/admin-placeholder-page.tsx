import Link from 'next/link';

interface PlaceholderHighlight {
  label: string;
  value: string;
}

interface AdminPlaceholderPageProps {
  title: string;
  description: string;
  icon: string;
  highlights: PlaceholderHighlight[];
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  note?: string;
}

export function AdminPlaceholderPage({
  title,
  description,
  icon,
  highlights,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  note,
}: AdminPlaceholderPageProps) {
  return (
    <div className="page-shell-narrow page-stack">
      <div className="section-card card-padding">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container-high border border-outline-variant text-on-surface">
              <span className="material-symbols-outlined">{icon}</span>
            </div>
            <h1 className="page-title-lg">{title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
              {description}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href={primaryHref}
              className="inline-flex items-center justify-center rounded-lg border border-outline-variant bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:brightness-110"
            >
              {primaryLabel}
            </Link>
            {secondaryHref && secondaryLabel ? (
              <Link
                href={secondaryHref}
                className="inline-flex items-center justify-center rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-highest"
              >
                {secondaryLabel}
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {highlights.map((item) => (
          <div
            key={item.label}
            className="section-card p-5"
          >
            <p className="text-xs uppercase tracking-[0.18em] text-outline">{item.label}</p>
            <p className="mt-3 text-lg font-semibold text-on-surface">{item.value}</p>
          </div>
        ))}
      </div>

      {note ? (
        <div className="rounded-2xl border border-dashed border-outline-variant/20 bg-surface-container-low/70 p-5 text-sm leading-relaxed text-on-surface-variant">
          {note}
        </div>
      ) : null}
    </div>
  );
}
