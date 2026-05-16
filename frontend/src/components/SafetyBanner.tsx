import { useTranslation } from "react-i18next";
import { Icons } from "../ui/clario";

/**
 * Persistent clinical-safety banner. Restating "patient-reported context,
 * not a diagnosis" on every unlocked screen. Dismissible for the session;
 * always re-appears on a full reload.
 */
export default function SafetyBanner({ onHide }: { onHide?: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        background: "var(--warn-tint)",
        borderBottom: "1px solid color-mix(in oklch, var(--warn) 25%, var(--border))",
        color: "oklch(38% 0.07 75)",
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "var(--warn)", display: "inline-flex", flexShrink: 0 }}>{Icons.shield}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ color: "oklch(32% 0.08 75)", fontWeight: 600 }}>
          Patient-reported context — not a diagnosis.
        </b>
        &nbsp;{t("safety.banner")}
      </span>
      {onHide && (
        <button
          onClick={onHide}
          className="btn ghost sm"
          style={{ height: 22, fontSize: 11.5, flexShrink: 0 }}
          aria-label={t("safety.dismiss")}
        >
          Hide for this session
        </button>
      )}
    </div>
  );
}
