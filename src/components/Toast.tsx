import { useStore } from '@/store';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

export function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-80" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="card animate-slide-in flex items-start gap-3 p-3.5"
        >
          {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
          {t.type === 'error' && <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
          {t.type === 'info' && <Info className="w-5 h-5 text-brand-500 shrink-0" />}
          <p className="text-sm text-slate-700 dark:text-slate-200 flex-1">{t.message}</p>
          <button onClick={() => removeToast(t.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Dismiss notification">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
