import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, clearOnLocked, setOnLocked } from "./api/client";
import Setup from "./pages/Setup";
import Unlock from "./pages/Unlock";
import Timeline from "./pages/Timeline";
import Tags from "./pages/Tags";
import LlmSetup from "./pages/LlmSetup";
import GraphPage from "./pages/GraphPage";
import DocumentsPage from "./pages/DocumentsPage";
import LabsPage from "./pages/LabsPage";
import MedicationsPage from "./pages/MedicationsPage";
import HypothesesPage from "./pages/HypothesesPage";
import InsightsPage from "./pages/InsightsPage";
import MobileCompanion from "./pages/MobileCompanion";
import MobileCapture from "./pages/MobileCapture";
import MobilePair from "./pages/MobilePair";
import AppShell from "./components/AppShell";

export default function App() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["auth", "status"],
    queryFn: api.status,
    refetchInterval: 60_000,
  });

  // When any backend call returns 401 detail=locked, refresh the auth
  // status query so the routing tree flips to /unlock instantly.
  useEffect(() => {
    const handler = () => {
      qc.invalidateQueries({ queryKey: ["auth", "status"] });
    };
    setOnLocked(handler);
    return () => clearOnLocked(handler);
  }, [qc]);

  // Inactivity heartbeat: while unlocked, ping /api/auth/heartbeat on real
  // user input (debounced to once per 30s) so the journal only auto-locks
  // after a real period of idleness.
  const unlockedNow = status.data?.unlocked === true;
  useEffect(() => {
    if (!unlockedNow || typeof window === "undefined") return;
    let lastBump = 0;
    const bump = () => {
      const t = Date.now();
      if (t - lastBump < 30_000) return;
      lastBump = t;
      api.heartbeat().catch(() => {
        /* ignore — if the call 401s, the locked handler above takes over. */
      });
    };
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "keydown",
      "click",
      "touchstart",
      "scroll",
    ];
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, [unlockedNow]);

  // Mobile-companion routes are open to the phone, which has no desktop
  // session cookie. Skip the auth-gate Routes entirely on `/m/*`.
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/m/")) {
    return (
      <Routes>
        <Route path="/m/pair" element={<MobilePair />} />
        <Route path="/m/capture" element={<MobileCapture />} />
        <Route path="*" element={<Navigate to="/m/capture" replace />} />
      </Routes>
    );
  }

  if (status.isLoading) {
    return <FullScreenMessage>Loading…</FullScreenMessage>;
  }
  if (status.isError || !status.data) {
    return <FullScreenMessage>Backend unreachable</FullScreenMessage>;
  }

  const { setup, unlocked } = status.data;
  return <AppRoutes setup={setup} unlocked={unlocked} />;
}

function AppRoutes({ setup, unlocked }: { setup: boolean; unlocked: boolean }) {
  const gate = (el: React.ReactNode) =>
    !setup ? <Navigate to="/setup" /> : !unlocked ? <Navigate to="/unlock" /> : el;

  return (
    <Routes>
      <Route
        path="/setup"
        element={setup ? <Navigate to={unlocked ? "/" : "/unlock"} /> : <Setup />}
      />
      <Route
        path="/unlock"
        element={!setup ? <Navigate to="/setup" /> : unlocked ? <Navigate to="/" /> : <Unlock />}
      />

      {/* Unlocked screens share the persistent Clario shell */}
      <Route element={<AppShell />}>
        <Route path="/" element={gate(<Timeline />)} />
        <Route path="/tags" element={gate(<Tags />)} />
        <Route path="/graph" element={gate(<GraphPage />)} />
        <Route path="/llm" element={gate(<LlmSetup />)} />
        <Route path="/documents" element={gate(<DocumentsPage />)} />
        <Route path="/labs" element={gate(<LabsPage />)} />
        <Route path="/medications" element={gate(<MedicationsPage />)} />
        <Route path="/hypotheses" element={gate(<HypothesesPage />)} />
        <Route path="/insights" element={gate(<InsightsPage />)} />
        <Route path="/mobile" element={gate(<MobileCompanion />)} />
      </Route>

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--ink-3)",
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}
