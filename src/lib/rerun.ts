export function resolveRerunInput(
  run: { runtimeInput?: string; nodeExecutions?: { input?: string }[] },
  workflow: { defaultInput?: string },
): string {
  const stored = run.runtimeInput?.trim();
  if (stored) return stored;
  const startInput = run.nodeExecutions?.[0]?.input?.trim();
  if (startInput && startInput !== '{"sample":"input"}') return startInput;
  const fallback = workflow.defaultInput?.trim();
  if (fallback) return fallback;
  return '{}';
}
