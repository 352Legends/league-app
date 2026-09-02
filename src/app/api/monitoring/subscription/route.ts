import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedCadences = new Set([30, 60, 120, 360, 720, 1440]);

export async function POST(request: Request) {
  const form = await request.formData();
  const providerLeagueId = String(form.get("providerLeagueId") ?? "").trim();
  if (!providerLeagueId) return NextResponse.json({ error: "providerLeagueId is required" }, { status: 400 });

  const cadenceRequested = Number(form.get("cadenceMinutes") ?? 30);
  const cadenceMinutes = allowedCadences.has(cadenceRequested) ? cadenceRequested : 30;
  const threshold = Math.max(25, Math.min(10000, Number(form.get("marketAddThreshold") ?? 150) || 150));

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const { data: league, error: leagueError } = await supabase
    .from("fantasy_leagues")
    .select("id")
    .eq("user_id", authData.user.id)
    .eq("provider", "sleeper")
    .eq("provider_league_id", providerLeagueId)
    .maybeSingle();

  if (leagueError || !league) return NextResponse.json({ error: "Saved league not found" }, { status: 404 });

  const enabled = form.get("enabled") === "on";
  const row = {
    user_id: authData.user.id,
    league_id: league.id,
    enabled,
    cadence_minutes: cadenceMinutes,
    market_add_threshold: threshold,
    watch_roster_changes: form.get("watchRosterChanges") === "on",
    watch_transactions: form.get("watchTransactions") === "on",
    watch_market_acceleration: form.get("watchMarketAcceleration") === "on",
    watch_week_advance: form.get("watchWeekAdvance") === "on",
    next_run_at: enabled ? new Date().toISOString() : new Date(Date.now() + cadenceMinutes * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("monitoring_subscriptions")
    .upsert(row, { onConflict: "user_id,league_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.redirect(new URL(`/monitoring/${providerLeagueId}?saved=1`, request.url), 303);
}
