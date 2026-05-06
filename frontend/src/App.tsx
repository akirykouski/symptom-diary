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
import MobileCapture from "./pages/MobileCapture";
import MobilePair from "./pages/MobilePair";
import SafetyBanner from "./components/SafetyBanner";

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
  // after a real period of idleness — not while the user is reading the
  // brief or scrolling labs without making other API calls.
  const unlockedNow = status.data?.unlocked === true;
  useEffect(() => {
    if (!unlockedNow || typeof window === "undefined") return;
    let lastBump = 0;
    const bump = () => {
      const t = Date.now();
      if (t - lastBump < 30_000) return;
      lastBump = t;
      api.heartbeat().catch(() => {
        // ignore — if the call 401s, the locked handler above takes over.
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
      <div className="h-full flex flex-col">
        <Routes>
          <Route path="/m/pair" element={<MobilePair />} />
          <Route path="/m/capture" element={<MobileCapture />} />
          <Route path="*" element={<Navigate to="/m/capture" replace />} />
        </Routes>
      </div>
    );
  }

  if (status.isLoading) {
    return <FullScreenMessage>Loading…</FullScreenMessage>;
  }
  if (status.isError || !status.data) {
    return <FullScreenMessage>Backend unreachable</FullScreenMessage>;
  }

  const { setup, unlocked } = status.data;

  return (
    <div className="h-full flex flex-col">
      {unlocked && <SafetyBanner />}
      <div className="flex-1 min-h-0">
        <AppRoutes setup={setup} unlocked={unlocked} />
      </div>
    </div>
  );
}

function AppRoutes({ setup, unlocked }: { setup: boolean; unlocked: boolean }) {
  return (
    <Routes>
      <Route
        path="/setup"
        element={setup ? <Navigate to={unlocked ? "/" : "/unlock"} /> : <Setup />}
      />
      <Route
        path="/unlock"
        element={
          !setup ? <Navigate to="/setup" /> : unlocked ? <Navigate to="/" /> : <Unlock />
        }
      />
      <Route
        path="/"
        element={
          !setup ? <Navigate to="/setup" /> : !unlocked ? <Navigate to="/unlock" /> : <Timeline />
        }
      />
      <Route
        path="/tags"
        element={
          !setup ? <Navigate to="/setup" /> : !unlocked ? <Navigate to="/unlock" /> : <Tags />
        }
      />
      <Route
        path="/graph"
        element={
          !setup ? <Navigate to="/setup" /> : !unlocked ? <Navigate to="/unlock" /> : <GraphPage />
        }
      />
      <Route
        path="/llm"
        element={
          !setup ? <Navigate to="/setup" /> : !unlocked ? <Navigate to="/unlock" /> : <LlmSetup />
        }
      />
      <Route
        path="/documents"
        element={
          !setup ? <Navigate to="/setup" /> : !unlocked ? <Navigate to="/unlock" /> : <DocumentsPage />
        }
      />
      <Route
        path="/labs"
        element={
          !setup ? <Navigate to="/setup" /> : !unlocked ? <Navigate to="/unlock" /> : <LabsPage />
        }
      />
      <Route
        path="/medications"
        element={
          !setup ? <Navigate to="/setup" /> : !unlocked ? <Navigate to="/unlock" /> : <MedicationsPage />
        }
      />
      <Route
        path="/hypotheses"
        element={
          !setup ? <Navigate to="/setup" /> : !unlocked ? <Navigate to="/unlock" /> : <HypothesesPage />
        }
      />
      <Route
        path="/insights"
        element={
          !setup ? <Navigate to="/setup" /> : !unlocked ? <Navigate to="/unlock" /> : <InsightsPage />
        }
      />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-full text-ink/60">
      {children}
    </div>
  );
}
