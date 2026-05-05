import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
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
  const status = useQuery({
    queryKey: ["auth", "status"],
    queryFn: api.status,
    refetchInterval: 60_000,
  });

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
