/** Deterministic DB name used inside sandbox containers (matches `index.ts` provisioning). */
export function sandboxDbNameFromInstanceId(sandboxId: string): string {
  return `s_${sandboxId.replace(/-/g, '').slice(0, 16)}`;
}
