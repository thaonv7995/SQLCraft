export default function TrackDetailLoading() {
  return (
    <div className="page-shell-narrow page-stack">
      <div className="h-5 w-28 animate-pulse rounded bg-surface-container-low" />
      <div className="h-56 animate-pulse rounded-[1.75rem] bg-surface-container-low" />
      <div className="space-y-3">
        {[1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="h-32 animate-pulse rounded-2xl bg-surface-container-low"
          />
        ))}
      </div>
    </div>
  );
}
