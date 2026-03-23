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
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="rounded-3xl border border-outline-variant/10 bg-surface-container-low p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <span className="material-symbols-outlined">{icon}</span>
            </div>
            <h1 className="font-headline text-3xl font-bold text-on-surface">{title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
              {description}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href={primaryHref}
              className="inline-flex items-center justify-center rounded-lg bg-gradient-to-br from-[#bac3ff] to-[#4453a7] px-4 py-2 text-sm font-semibold text-[#00105b] transition-opacity hover:opacity-90"
            >
              {primaryLabel}
            </Link>
            {secondaryHref && secondaryLabel ? (
              <Link
                href={secondaryHref}
                className="inline-flex items-center justify-center rounded-lg bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
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
            className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-5"
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
