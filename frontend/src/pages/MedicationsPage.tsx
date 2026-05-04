import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export default function MedicationsPage() {
  const { t } = useTranslation();
  const meds = useQuery({
    queryKey: ["medications", "timeline"],
    queryFn: api.medicationsTimeline,
  });

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-ink/10 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-ink/60 hover:text-ink">
          ← {t("nav.timeline")}
        </Link>
        <h1 className="text-lg font-semibold">{t("medications.heading")}</h1>
        <div className="ml-auto flex gap-3">
          <Link to="/documents" className="text-sm text-ink/60 hover:text-ink">
            {t("labs.documentsLink")}
          </Link>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto p-6">
        {meds.isLoading ? (
          <div className="text-ink/60">{t("medications.loading")}</div>
        ) : meds.data && meds.data.length === 0 ? (
          <div className="text-ink/60">{t("medications.empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-ink/50 text-left text-xs uppercase">
              <tr>
                <th className="py-2">{t("medications.cols.drug")}</th>
                <th>{t("medications.cols.dose")}</th>
                <th>{t("medications.cols.frequency")}</th>
                <th>{t("medications.cols.duration")}</th>
                <th>{t("medications.cols.prescribed")}</th>
              </tr>
            </thead>
            <tbody>
              {(meds.data ?? []).map((m) => (
                <tr key={m.id} className="border-t border-ink/10">
                  <td className="py-2">
                    <span className="font-medium">{m.drug_name_raw}</span>
                  </td>
                  <td>{m.dose ?? "—"}</td>
                  <td>{m.frequency ?? "—"}</td>
                  <td>{m.duration ?? "—"}</td>
                  <td className="text-ink/60">
                    {m.prescribed_at?.slice(0, 10) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
