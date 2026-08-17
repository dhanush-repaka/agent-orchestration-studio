export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

export function isTransientNetworkError(err: unknown): boolean {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('aborted')
  );
}

export function isMissingRelation(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = String((err as { code: unknown }).code);
    if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') return true;
  }
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table')
  );
}

export function logStoreError(action: string, err: unknown) {
  if (isTransientNetworkError(err) || isMissingRelation(err)) return;
  console.error(`${action}:`, errorMessage(err));
}
