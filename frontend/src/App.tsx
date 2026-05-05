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
import SafetyBanner from "./components/SafetyBanner";

export default function App() {
  const status = useQuery({
    queryKey: ["auth", "status"],
    queryFn: api.status,
    refetchInterval: 60_000,
  });

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
