import { ExternalLink } from 'lucide-react';
import { openPlaywrightHtmlReport, playwrightReportFromOutput } from '@/lib/playwrightSpec';

export function PlaywrightReportButton({
  output,
  className = 'btn-secondary',
}: {
  output?: string;
  className?: string;
}) {
  const report = playwrightReportFromOutput(output);
  if (!report.html && !report.reportUrl) return null;
  return (
    <button
      type="button"
      className={className}
      aria-label="Open Playwright report"
      onClick={() => {
        void (async () => {
          if (report.reportUrl) {
            const url = new URL(report.reportUrl, window.location.origin).href;
            try {
              const ping = await fetch(url, { method: 'HEAD' });
              if (ping.ok) {
                window.open(url, '_blank', 'noopener,noreferrer');
                return;
              }
            } catch {
              // Fall back to the embedded report when the on-disk folder is gone.
            }
          }
          if (report.html) openPlaywrightHtmlReport(report.html);
        })();
      }}
    >
      <ExternalLink className="w-4 h-4" /> Open Playwright report
    </button>
  );
}

export function findPlaywrightReportOutput(outputs: Array<{ output?: string } | undefined>): string | undefined {
  for (let i = outputs.length - 1; i >= 0; i -= 1) {
    const output = outputs[i]?.output;
    const report = playwrightReportFromOutput(output);
    if (report.html || report.reportUrl) return output;
  }
  return undefined;
}
