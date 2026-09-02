"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Alert = {
  id: string;
  alert_type: string;
  severity: "info" | "watch" | "important" | "urgent";
  title: string;
  summary: string;
  created_at: string;
};

type AlertResponse = {
  available: boolean;
  enabled?: boolean;
  lastCheckedAt?: string | null;
  openCount: number;
  alerts: Alert[];
};

export function AutomatedGmBanner() {
  const pathname = usePathname();
  const leagueId = useMemo(() => {
    const match = pathname.match(/^\/command\/([^/]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }, [pathname]);
  const [data, setData] = useState<AlertResponse | null>(null);

  useEffect(() => {
    if (!leagueId) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/monitoring/alerts?providerLeagueId=${encodeURIComponent(leagueId)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<AlertResponse> : null)
      .then((result) => setData(result))
      .catch(() => undefined);
    return () => controller.abort();
  }, [leagueId]);

  if (!leagueId || !data?.available || data.openCount === 0) return null;
  const primary = data.alerts[0];
  if (!primary) return null;

  return (
    <div className={`automated-gm-banner automated-gm-banner--${primary.severity}`} role="status">
      <div className="automated-gm-banner__signal">!</div>
      <div>
        <strong>AUTOMATED GM DETECTED A MATERIAL CHANGE</strong>
        <span>{primary.title}</span>
        <small>{primary.summary}{data.openCount > 1 ? ` · ${data.openCount - 1} additional alert${data.openCount === 2 ? "" : "s"}.` : ""}</small>
      </div>
      <Link href={`/monitoring/${leagueId}`}>Review watcher evidence →</Link>
    </div>
  );
}
