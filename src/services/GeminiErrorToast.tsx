import { useEffect, useState } from "react";
import { GeminiError } from "./geminiService";

// ————————————————————————————————————————————
//  استخدام:
//
//  } catch (err) {
//    if (err instanceof GeminiError) setGeminiError(err);
//    else throw err;
//  }
//
//  <GeminiErrorToast error={geminiError} onClose={() => setGeminiError(null)} />
// ————————————————————————————————————————————

interface Props {
  error: GeminiError | null;
  onClose: () => void;
  onRetry?: () => void;
}

const CONFIG: Record<
  GeminiError["type"],
  { icon: string; title: string; color: string; bg: string; border: string }
> = {
  server_busy: {
    icon: "⏳",
    title: "الخوادم مشغولة مؤقتاً",
    color: "#b45309",
    bg: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
    border: "#fbbf24",
  },
  quota_exceeded: {
    icon: "🚫",
    title: "تجاوزت حصة الاستخدام",
    color: "#9333ea",
    bg: "linear-gradient(135deg, #faf5ff 0%, #ede9fe 100%)",
    border: "#a855f7",
  },
  invalid_key: {
    icon: "🔑",
    title: "مفتاح API غير صالح",
    color: "#dc2626",
    bg: "linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)",
    border: "#f87171",
  },
  unknown: {
    icon: "⚠️",
    title: "حدث خطأ غير متوقع",
    color: "#475569",
    bg: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
    border: "#94a3b8",
  },
};

export function GeminiErrorToast({ error, onClose, onRetry }: Props) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (!error) { setVisible(false); return; }
    setVisible(true);
    setProgress(100);

    // شريط التقدم: يختفي بعد 8 ثواني تلقائياً
    const duration = 8000;
    const interval = 50;
    const step = (interval / duration) * 100;
    const timer = setInterval(() => {
      setProgress((p) => {
        if (p <= 0) { clearInterval(timer); onClose(); return 0; }
        return p - step;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [error]);

  if (!error || !visible) return null;

  const cfg = CONFIG[error.type];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap');

        .gei-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 24px;
          pointer-events: none;
          font-family: 'IBM Plex Sans Arabic', sans-serif;
          direction: rtl;
        }

        .gei-card {
          pointer-events: all;
          width: min(480px, calc(100vw - 32px));
          border-radius: 16px;
          border: 1.5px solid var(--gei-border);
          background: var(--gei-bg);
          box-shadow:
            0 4px 6px -1px rgba(0,0,0,0.08),
            0 20px 40px -8px rgba(0,0,0,0.12),
            0 0 0 1px rgba(255,255,255,0.6) inset;
          overflow: hidden;
          animation: gei-slide-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        .gei-card.gei-hiding {
          animation: gei-slide-out 0.25s ease-in both;
        }

        @keyframes gei-slide-in {
          from { opacity: 0; transform: translateY(-20px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes gei-slide-out {
          from { opacity: 1; transform: translateY(0)    scale(1);    }
          to   { opacity: 0; transform: translateY(-12px) scale(0.97); }
        }

        .gei-body {
          padding: 20px 20px 16px;
          display: flex;
          gap: 14px;
          align-items: flex-start;
        }

        .gei-icon {
          font-size: 28px;
          line-height: 1;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .gei-content { flex: 1; }

        .gei-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--gei-color);
          margin: 0 0 5px;
          letter-spacing: -0.01em;
        }

        .gei-message {
          font-size: 13.5px;
          color: #374151;
          line-height: 1.65;
          margin: 0 0 14px;
        }

        .gei-models {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 14px;
        }
        .gei-model-tag {
          font-size: 11px;
          font-weight: 500;
          padding: 3px 8px;
          border-radius: 20px;
          background: rgba(0,0,0,0.06);
          color: #6b7280;
          border: 1px solid rgba(0,0,0,0.08);
        }

        .gei-actions {
          display: flex;
          gap: 8px;
        }

        .gei-btn {
          flex: 1;
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          font-family: inherit;
          transition: all 0.15s;
        }

        .gei-btn-retry {
          background: var(--gei-color);
          color: #fff;
        }
        .gei-btn-retry:hover { opacity: 0.88; transform: translateY(-1px); }

        .gei-btn-close {
          background: rgba(0,0,0,0.06);
          color: #374151;
          border: 1px solid rgba(0,0,0,0.08);
        }
        .gei-btn-close:hover { background: rgba(0,0,0,0.1); }

        .gei-close-x {
          background: none;
          border: none;
          cursor: pointer;
          color: #9ca3af;
          font-size: 18px;
          line-height: 1;
          padding: 2px;
          flex-shrink: 0;
          transition: color 0.15s;
        }
        .gei-close-x:hover { color: #374151; }

        .gei-progress {
          height: 3px;
          background: rgba(0,0,0,0.06);
        }
        .gei-progress-bar {
          height: 100%;
          background: var(--gei-color);
          transition: width 50ms linear;
          opacity: 0.6;
        }
      `}</style>

      <div className="gei-overlay">
        <div
          className="gei-card"
          style={{
            "--gei-color": cfg.color,
            "--gei-bg": cfg.bg,
            "--gei-border": cfg.border,
          } as React.CSSProperties}
        >
          {/* شريط التقدم في الأعلى */}
          <div className="gei-progress">
            <div className="gei-progress-bar" style={{ width: `${progress}%` }} />
          </div>

          <div className="gei-body">
            <div className="gei-icon">{cfg.icon}</div>

            <div className="gei-content">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <p className="gei-title">{cfg.title}</p>
                <button className="gei-close-x" onClick={onClose}>×</button>
              </div>

              <p className="gei-message">{error.message}</p>

              {/* الموديلات التي جُرّبت */}
              {error.retriedModels && error.retriedModels.length > 0 && (
                <div className="gei-models">
                  <span style={{ fontSize: 11, color: "#9ca3af", alignSelf: "center" }}>جُرِّب:</span>
                  {error.retriedModels.map((m) => (
                    <span key={m} className="gei-model-tag">{m}</span>
                  ))}
                </div>
              )}

              <div className="gei-actions">
                {onRetry && (
                  <button className="gei-btn gei-btn-retry" onClick={() => { onClose(); onRetry(); }}>
                    ↩ إعادة المحاولة
                  </button>
                )}
                <button className="gei-btn gei-btn-close" onClick={onClose}>
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
