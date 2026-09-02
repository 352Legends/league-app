import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

type Json = Record<string, unknown>;
type Subscription = {
  id: string;
  league_id: string;
  user_id: string;
  cadence_minutes: number;
  market_add_threshold: number;
  watch_roster_changes: boolean;
  watch_transactions: boolean;
  watch_market_acceleration: boolean;
  watch_week_advance: boolean;
  last_signal_state: Json;
  fantasy_leagues: {
    provider_league_id: string;
    provider_payload: Json;
    name: string;
    season: number;
  } | null;
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const SLEEPER = "https://api.sleeper.app/v1";

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const secretMap = Deno.env.get("SUPABASE_SECRET_KEYS");
  const secret = secretMap ? JSON.parse(secretMap).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Supabase secret key unavailable to monitoring worker");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sleeperJson(path: string) {
  const response = await fetch(`${SLEEPER}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "WAR-ROOM-Automated-GM/1.0" },
  });
  if (!response.ok) throw new Error(`Sleeper ${path} returned ${response.status}`);
  return await response.json();
}

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
}
function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function managerId(payload: Json): string | null {
  const value = asObject(payload.war_room).sleeper_user_id;
  return typeof value === "string" && value.length ? value : null;
}
function trendingMap(rows: unknown): Record<string, number> {
  const map: Record<string, number> = {};
  if (!Array.isArray(rows)) return map;
  for (const row of rows.slice(0, 100)) {
    const item = asObject(row);
    const playerId = typeof item.player_id === "string" ? item.player_id : null;
    if (playerId) map[playerId] = numberValue(item.count);
  }
  return map;
}
function transactionIds(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => asObject(row).transaction_id).filter((id): id is string => typeof id === "string").sort();
}

Deno.serve(async (req: Request) => {
  const supabase = adminClient();
  const now = new Date();

  const { data: runtime, error: runtimeError } = await supabase
    .from("monitoring_runtime")
    .select("last_started_at,auth_secret_hash")
    .eq("singleton", true)
    .maybeSingle();
  if (runtimeError) return new Response(JSON.stringify({ ok: false, error: "monitoring runtime unavailable" }), { status: 500, headers: JSON_HEADERS });

  const suppliedSecret = req.headers.get("x-war-room-monitor-key") ?? "";
  if (!runtime?.auth_secret_hash || !suppliedSecret || await sha256(suppliedSecret) !== runtime.auth_secret_hash) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized monitoring invocation" }), { status: 401, headers: JSON_HEADERS });
  }

  if (runtime.last_started_at && now.getTime() - new Date(runtime.last_started_at).getTime() < 20 * 60 * 1000) {
    return new Response(JSON.stringify({ ok: true, skipped: "rate_gate" }), { headers: JSON_HEADERS });
  }

  await supabase.from("monitoring_runtime").update({ last_started_at: now.toISOString(), last_status: "running", updated_at: now.toISOString() }).eq("singleton", true);

  try {
    const [{ data: subscriptions, error }, nflState, adds, drops] = await Promise.all([
      supabase.from("monitoring_subscriptions")
        .select("id,league_id,user_id,cadence_minutes,market_add_threshold,watch_roster_changes,watch_transactions,watch_market_acceleration,watch_week_advance,last_signal_state,fantasy_leagues!inner(provider_league_id,provider_payload,name,season)")
        .eq("enabled", true).lte("next_run_at", now.toISOString()).order("next_run_at", { ascending: true }).limit(25),
      sleeperJson("/state/nfl"),
      sleeperJson("/players/nfl/trending/add?lookback_hours=24&limit=100").catch(() => []),
      sleeperJson("/players/nfl/trending/drop?lookback_hours=24&limit=100").catch(() => []),
    ]);
    if (error) throw error;

    const week = Math.max(1, numberValue(asObject(nflState).week));
    const addMap = trendingMap(adds);
    const dropMap = trendingMap(drops);
    let alertsCreated = 0;
    let processed = 0;

    for (const raw of (subscriptions ?? []) as unknown as Subscription[]) {
      const league = raw.fantasy_leagues;
      if (!league) continue;
      const { data: run } = await supabase.from("monitoring_runs").insert({ subscription_id: raw.id, league_id: raw.league_id, user_id: raw.user_id, status: "running" }).select("id").single();

      try {
        const [rosters, transactions] = await Promise.all([
          sleeperJson(`/league/${league.provider_league_id}/rosters`),
          sleeperJson(`/league/${league.provider_league_id}/transactions/${week}`).catch(() => []),
        ]);
        const manager = managerId(asObject(league.provider_payload));
        const rosterRows = Array.isArray(rosters) ? rosters.map(asObject) : [];
        const userRoster = manager ? rosterRows.find((row) => row.owner_id === manager) : undefined;
        const rosterId = userRoster ? numberValue(userRoster.roster_id) : 0;
        const userPlayers = userRoster ? stringArray(userRoster.players).sort() : [];
        const currentTransactionIds = transactionIds(transactions);
        const previous = asObject(raw.last_signal_state);
        const previousWeek = numberValue(previous.week);
        const previousPlayers = stringArray(previous.userRosterPlayers).sort();
        const previousTransactions = new Set(stringArray(previous.transactionIds));
        const previousAdds = asObject(previous.topAdds);
        const firstCheck = Object.keys(previous).length === 0;
        const alerts: Json[] = [];

        if (!firstCheck && raw.watch_week_advance && week > previousWeek) {
          alerts.push({ event_key: `week:${week}`, alert_type: "WEEK_ADVANCED", severity: "important", title: `NFL Week ${week} monitoring is active`, summary: `League state advanced from Week ${previousWeek} to Week ${week}. Re-run Mission Control for new matchup and championship-impact decisions.`, evidence: [{ previousWeek, currentWeek: week }] });
        }

        if (!firstCheck && raw.watch_roster_changes && JSON.stringify(previousPlayers) !== JSON.stringify(userPlayers)) {
          const before = new Set(previousPlayers);
          const after = new Set(userPlayers);
          const added = userPlayers.filter((id) => !before.has(id));
          const removed = previousPlayers.filter((id) => !after.has(id));
          alerts.push({ event_key: `roster:${week}:${hash(userPlayers.join(","))}`, alert_type: "ROSTER_CHANGE", severity: "urgent", title: "Your Sleeper roster changed", summary: `Automated GM detected ${added.length} addition${added.length === 1 ? "" : "s"} and ${removed.length} removal${removed.length === 1 ? "" : "s"}. Mission Control should recalculate all priorities.`, evidence: [{ addedPlayerIds: added, removedPlayerIds: removed }] });
        }

        if (!firstCheck && raw.watch_transactions && Array.isArray(transactions)) {
          for (const tx of transactions.map(asObject)) {
            const id = typeof tx.transaction_id === "string" ? tx.transaction_id : "";
            const rosterIds = Array.isArray(tx.roster_ids) ? tx.roster_ids.map(numberValue) : [];
            if (!id || previousTransactions.has(id) || (rosterId && !rosterIds.includes(rosterId))) continue;
            const type = typeof tx.type === "string" ? tx.type : "transaction";
            alerts.push({ event_key: `tx:${id}`, alert_type: "LEAGUE_TRANSACTION", severity: "urgent", title: `New ${type} involving your roster`, summary: "Sleeper recorded a new transaction involving your team. WAR ROOM should recalculate waivers, trades, lineup strength and title odds.", evidence: [{ transactionId: id, type, status: tx.status ?? null, rosterIds }] });
          }
        }

        if (!firstCheck && raw.watch_market_acceleration) {
          const threshold = raw.market_add_threshold;
          for (const [playerId, count] of Object.entries(addMap).slice(0, 40)) {
            const prior = numberValue(previousAdds[playerId]);
            const acceleration = count - prior;
            if (acceleration < threshold) continue;
            alerts.push({ event_key: `market:${week}:${playerId}:${Math.floor(count / threshold)}`, alert_type: "MARKET_ACCELERATION", severity: acceleration >= threshold * 2 ? "urgent" : "important", title: "Waiver market acceleration detected", summary: `Sleeper adds for player ${playerId} accelerated by ${acceleration} in the monitored 24-hour signal. Breakout Radar and waiver priority should be refreshed.`, evidence: [{ playerId, currentAdds: count, previousAdds: prior, acceleration, currentDrops: dropMap[playerId] ?? 0 }] });
          }
        }

        if (alerts.length) {
          const rows = alerts.map((alert) => ({ subscription_id: raw.id, league_id: raw.league_id, user_id: raw.user_id, ...alert, recalculation_required: true }));
          const { data: inserted } = await supabase.from("monitoring_alerts").upsert(rows, { onConflict: "user_id,league_id,event_key", ignoreDuplicates: true }).select("id");
          alertsCreated += inserted?.length ?? 0;
        }

        await supabase.from("monitoring_subscriptions").update({
          last_checked_at: now.toISOString(),
          next_run_at: new Date(now.getTime() + raw.cadence_minutes * 60 * 1000).toISOString(),
          last_signal_state: { week, userRosterPlayers: userPlayers, transactionIds: currentTransactionIds, topAdds: addMap, topDrops: dropMap },
          updated_at: now.toISOString(),
        }).eq("id", raw.id);

        if (run?.id) await supabase.from("monitoring_runs").update({ status: "succeeded", signals_checked: 4, alerts_created: alerts.length, finished_at: new Date().toISOString(), metadata: { week, firstCheck } }).eq("id", run.id);
        processed += 1;
      } catch (runError) {
        if (run?.id) await supabase.from("monitoring_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_summary: runError instanceof Error ? runError.message : "monitoring failure" }).eq("id", run.id);
      }
    }

    await supabase.from("monitoring_runtime").update({ last_finished_at: new Date().toISOString(), last_status: "succeeded", updated_at: new Date().toISOString() }).eq("singleton", true);
    return new Response(JSON.stringify({ ok: true, processed, alertsCreated, week }), { headers: JSON_HEADERS });
  } catch (error) {
    await supabase.from("monitoring_runtime").update({ last_finished_at: new Date().toISOString(), last_status: "failed", updated_at: new Date().toISOString() }).eq("singleton", true);
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "monitoring failure" }), { status: 500, headers: JSON_HEADERS });
  }
});
