import { createClient } from "@/lib/supabase/server";

export type MonitoringAlertSummary = {
  id: string;
  alertType: string;
  severity: "info" | "watch" | "important" | "urgent";
  title: string;
  summary: string;
  createdAt: string;
};

export type MonitoringSummary = {
  available: boolean;
  enabled: boolean;
  openCount: number;
  lastCheckedAt: string | null;
  alerts: MonitoringAlertSummary[];
};

export async function loadMonitoringSummary(providerLeagueId: string): Promise<MonitoringSummary> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return { available: false, enabled: false, openCount: 0, lastCheckedAt: null, alerts: [] };

    const { data: league } = await supabase
      .from("fantasy_leagues")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("provider", "sleeper")
      .eq("provider_league_id", providerLeagueId)
      .maybeSingle();
    if (!league) return { available: false, enabled: false, openCount: 0, lastCheckedAt: null, alerts: [] };

    const [{ data: subscription }, { data: alerts }, { count }] = await Promise.all([
      supabase.from("monitoring_subscriptions").select("enabled,last_checked_at").eq("league_id", league.id).maybeSingle(),
      supabase.from("monitoring_alerts").select("id,alert_type,severity,title,summary,created_at").eq("league_id", league.id).is("resolved_at", null).order("created_at", { ascending: false }).limit(4),
      supabase.from("monitoring_alerts").select("id", { count: "exact", head: true }).eq("league_id", league.id).is("resolved_at", null),
    ]);

    return {
      available: true,
      enabled: subscription?.enabled ?? false,
      openCount: count ?? 0,
      lastCheckedAt: subscription?.last_checked_at ?? null,
      alerts: (alerts ?? []).map((alert) => ({
        id: alert.id,
        alertType: alert.alert_type,
        severity: alert.severity,
        title: alert.title,
        summary: alert.summary,
        createdAt: alert.created_at,
      })),
    };
  } catch {
    return { available: false, enabled: false, openCount: 0, lastCheckedAt: null, alerts: [] };
  }
}
