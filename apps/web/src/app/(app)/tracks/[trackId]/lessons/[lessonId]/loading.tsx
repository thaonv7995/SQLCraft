export default function LessonDetailLoading() {
  return (
    <div className="page-shell-narrow page-stack">
      <div className="h-5 w-36 animate-pulse rounded bg-surface-container-low" />
      <div className="h-56 animate-pulse rounded-[1.75rem] bg-surface-container-low" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="h-[36rem] animate-pulse rounded-2xl bg-surface-container-low" />
        <div className="space-y-4">
          {[1, 2, 3].map((card) => (
            <div
              key={card}
              className="h-40 animate-pulse rounded-2xl bg-surface-container-low"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
