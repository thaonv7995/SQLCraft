# Surface Product Language Alignment

## Goal

Remove the remaining user-facing LMS and contributor-role language from the web app without breaking the existing backend, schema, or internal route structure.

## Scope For This Pass

1. Add a canonical `/submissions` route for the challenge draft workspace.
2. Point primary navigation and documentation links to `/submissions`.
3. Update visible copy in the submissions workspace to stop framing users as contributors.
4. Update visible copy in the browse flow so `tracks` and `lessons` read as product surfaces rather than a learning platform.
5. Keep legacy internal names such as `tracks`, `lessons`, `challenges`, and `learning_sessions` unchanged for now.

## Files Expected To Change

- `apps/web/src/app/(app)/submissions/page.tsx`
- `apps/web/src/app/(app)/contributor/page.tsx`
- `apps/web/src/app/(app)/contributor/page.test.tsx`
- `apps/web/src/app/(app)/docs/page.tsx`
- `apps/web/src/app/(app)/tracks/page.tsx`
- `apps/web/src/app/(app)/tracks/[trackId]/page.tsx`
- `apps/web/src/app/(app)/tracks/[trackId]/lessons/[lessonId]/page.tsx`
- `apps/web/src/components/layout/sidebar.tsx`
- `apps/web/src/components/layout/navbar.tsx`

## Verification

- `pnpm --filter @sqlcraft/web exec vitest run src/app/'(app)'/contributor/page.test.tsx`
- `pnpm --filter @sqlcraft/web exec eslint src/app/'(app)'/contributor/page.tsx src/app/'(app)'/contributor/page.test.tsx src/app/'(app)'/submissions/page.tsx src/app/'(app)'/docs/page.tsx src/app/'(app)'/tracks/page.tsx src/app/'(app)'/tracks/'[trackId]'/page.tsx src/app/'(app)'/tracks/'[trackId]'/'lessons'/'[lessonId]'/page.tsx src/components/layout/sidebar.tsx src/components/layout/navbar.tsx`

## Follow-Up

- Decide whether the canonical product names for `tracks` and `lessons` should become first-class route and API names.
- If yes, ship that as a dedicated backend, worker, DB, and migration refactor instead of mixing it into a UI-only pass.
