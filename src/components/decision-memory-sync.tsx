"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionMemorySnapshotPayload } from "@/lib/analytics/decision-memory";

type SyncState = "idle" | "saving" | "saved" | "duplicate" | "unsaved-league" | "error";

export function DecisionMemorySync({ payload }: { payload: DecisionMemorySnapshotPayload }) {
  const [state, setState] = useState<SyncState>("idle");
  const [message, setMessage] = useState("Decision Memory is ready to record this evaluation.");
  const body = useMemo(() => JSON.stringify(payload), [payload]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function persist() {
      setState("saving");
      setMessage("Recording this Mission Control evaluation…");
      try {
        const response = await fetch("/api/decisions/snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        });
        const result = await response.json().catch(() => ({})) as { error?: string; code?: string; duplicate?: boolean };
        if (!active) return;

        if (response.status === 401) {
          setState("error");
          setMessage("Sign in to activate persistent Decision Memory.");
          return;
        }
        if (response.status === 409 && result.code === "LEAGUE_NOT_SAVED") {
          setState("unsaved-league");
          setMessage("Save this league to WAR ROOM to activate persistent Decision Memory.");
          return;
        }
        if (!response.ok) throw new Error(result.error || "Decision Memory save failed");

        // A successful Mission Control evaluation satisfies any background alert that requested
        // a full recalculation. Alert resolution is best-effort and never invalidates the snapshot.
        await fetch("/api/monitoring/alerts/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerLeagueId: payload.providerLeagueId }),
          signal: controller.signal,
        }).catch(() => undefined);
        if (!active) return;

        if (result.duplicate) {
          setState("duplicate");
          setMessage("Decision Memory is current; this evaluation already exists and monitoring alerts were reconciled.");
        } else {
          setState("saved");
          setMessage("Decision Memory recorded this evaluation and reconciled background monitoring alerts.");
        }
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setState("error");
        setMessage(error instanceof Error ? error.message : "Decision Memory could not record this evaluation.");
      }
    }

    void persist();
    return () => {
      active = false;
      controller.abort();
    };
  }, [body, payload.providerLeagueId]);

  return (
    <div className={`memory-sync memory-sync--${state}`} aria-live="polite">
      <span className="memory-sync-dot" />
      <strong>DECISION MEMORY</strong>
      <small>{message}</small>
    </div>
  );
}
