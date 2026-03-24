import toast from 'react-hot-toast';

/** Extract meaningful message from Error / string / unknown */
export function formatErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }
  if (typeof err === 'string' && err.trim()) {
    return err.trim();
  }
  return 'No details available (check network or API response).';
}

/**
 * Error toast format: [context] — [server/network detail]
 */
export function toastError(context: string, err?: unknown) {
  const detail = err !== undefined ? formatErrorMessage(err) : '';
  const line = detail ? `${context} — ${detail}` : context;
  toast.error(line, { duration: 5200 });
}
