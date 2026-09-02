import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerLeagueId = url.searchParams.get("providerLeagueId")?.trim();
  if (!providerLeagueId) return NextResponse.json({ error: "providerLeagueId is required" }, { status: 400 });

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ available: false, alerts: [], openCount: 0 }, { status: 200 });

  const { data: league } = await supabase
    .from("fantasy_leagues")
    .select("id")
    .eq("user_id", authData.user.id)
    .eq("provider", "sleeper")
    .eq("provider_league_id", providerLeagueId)
    .maybeSingle();
  if (!league) return NextResponse.json({ available: false, alerts: [], openCount: 0 }, { status: 200 });

  const [{ data: subscription }, { data: alerts }, { count }] = await Promise.all([
    supabase.from("monitoring_subscriptions").select("enabled,last_checked_at").eq("league_id", league.id).maybeSingle(),
    supabase.from("monitoring_alerts")
      .select("id,alert_type,severity,title,summary,created_at")
      .eq("league_id", league.id)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase.from("monitoring_alerts").select("id", { count: "exact", head: true }).eq("league_id", league.id).is("resolved_at", null),
  ]);

  return NextResponse.json({
    available: true,
    enabled: subscription?.enabled ?? false,
    lastCheckedAt: subscription?.last_checked_at ?? null,
    openCount: count ?? 0,
    alerts: alerts ?? [],
  });
}
