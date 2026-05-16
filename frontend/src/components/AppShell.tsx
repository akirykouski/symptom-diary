import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Sidebar } from "../ui/clario";
import { DEMO } from "../ui/demo";
import SafetyBanner from "./SafetyBanner";
import PresenterBar from "./PresenterBar";

/**
 * Persistent Clario shell: left sidebar (nav + AI queue status + user/lock)
 * and a scrolling content column with the safety banner pinned on top.
 * Wraps every unlocked screen via a react-router layout route.
 */
export default function AppShell() {
  const qc = useQueryClient();
  const loc = useLocation();
  const [bannerHidden, setBannerHidden] = useState(false);

  const queue = useQuery({
    queryKey: ["queue", "status"],
    queryFn: api.queueStatus,
    refetchInterval: 3_000,
  });
  const llm = useQuery({
    queryKey: ["llm", "status"],
    queryFn: api.llmStatus,
    refetchInterval: 30_000,
  });
  const persona = useQuery({ queryKey: ["demo", "active"], queryFn: api.activePersona });

  const lockM = useMutation({
    mutationFn: () => api.lock(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "status"] }),
  });

  const processing = (queue.data?.queued ?? 0) + (queue.data?.running ?? 0);
  const ollamaUp = llm.data?.ollama ?? false;
  const installed = llm.data?.installed ?? [];
  const llmModel = installed[0];

  // Friendly user label: real persona if one is loaded, otherwise the
  // design's synthetic patient so the shell never reads empty.
  const personaId = persona.data?.persona_id;
  const user = personaId
    ? { name: cap(personaId), initials: cap(personaId).slice(0, 2) }
    : DEMO.user;

  return (
    <div style={{ height: "100%", display: "flex", minWidth: 0 }}>
      <Sidebar
        user={user}
        queueProcessing={processing}
        llmModel={llmModel}
        ollamaUp={ollamaUp}
        onLock={() => lockM.mutate()}
      />
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          background: "var(--bg)",
        }}
      >
        {!bannerHidden && <SafetyBanner onHide={() => setBannerHidden(true)} />}
        <div
          key={loc.pathname}
          className="route-fade"
          style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}
        >
          <Outlet />
        </div>
      </main>
      <PresenterBar />
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
