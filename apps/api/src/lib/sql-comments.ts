/** Strip leading line comments (`--`) and block comments, then whitespace (aligned with web `stripLeadingSqlComments`). */
export function stripLeadingSqlComments(sql: string | null | undefined): string {
  if (sql == null || typeof sql !== 'string') {
    return '';
  }

  let remaining = sql.trimStart();

  while (remaining.length > 0) {
    if (remaining.startsWith('--')) {
      const newlineIndex = remaining.indexOf('\n');
      remaining = newlineIndex === -1 ? '' : remaining.slice(newlineIndex + 1).trimStart();
      continue;
    }

    if (remaining.startsWith('/*')) {
      const blockEnd = remaining.indexOf('*/');
      remaining = blockEnd === -1 ? '' : remaining.slice(blockEnd + 2).trimStart();
      continue;
    }

    break;
  }

  return remaining.trimStart();
}
