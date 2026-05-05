import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Small, persistent (per-session-dismissable) banner restating the cross-cutting
 * clinical principles. Always re-appears on full reload.
 */
export default function SafetyBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="bg-amber-500/12 text-amber-200 border-b border-amber-500/30 text-xs px-4 py-1.5 flex items-center gap-3">
      <span aria-hidden>⚕</span>
      <span className="flex-1 truncate">{t("safety.banner")}</span>
      <button
        onClick={() => setDismissed(true)}
        className="text-amber-200/70 hover:text-amber-200 px-1"
        aria-label={t("safety.dismiss")}
      >
        ×
      </button>
    </div>
  );
}
