import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type ManagerIdentity = {
  sleeperUserId?: string;
  sleeperUsername?: string;
  espnTeamId?: number;
  espnOwnerId?: string;
};

function readManagerIdentity(payload: unknown): ManagerIdentity {
  if (!payload || typeof payload !== "object") return {};
  const warRoom = (payload as Record<string, unknown>).war_room;
  if (!warRoom || typeof warRoom !== "object") return {};
  const identity = warRoom as Record<string, unknown>;

  return {
    sleeperUserId: typeof identity.sleeper_user_id === "string" ? identity.sleeper_user_id : undefined,
    sleeperUsername: typeof identity.sleeper_username === "string" ? identity.sleeper_username : undefined,
    espnTeamId: typeof identity.espn_team_id === "number" ? identity.espn_team_id : undefined,
    espnOwnerId: typeof identity.espn_owner_id === "string" ? identity.espn_owner_id : undefined,
  };
}

function sleeperFeatureHref(base: string, providerLeagueId: string, payload: unknown): string {
  const identity = readManagerIdentity(payload);
  const query = new URLSearchParams();
  if (identity.sleeperUserId) query.set("sleeperUserId", identity.sleeperUserId);
  if (identity.sleeperUsername) query.set("sleeperUsername", identity.sleeperUsername);
  const suffix = query.toString();
  return `${base}/${providerLeagueId}${suffix ? `?${suffix}` : ""}`;
}

function espnHref(providerLeagueId: string, season: number, payload: unknown): string {
  const identity = readManagerIdentity(payload);
  const query = new URLSearchParams({ season: String(season) });
  if (identity.espnTeamId != null) query.set("teamId", String(identity.espnTeamId));
  return `/espn/${providerLeagueId}?${query.toString()}`;
}

export default async function SavedLeaguesPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return (
      <div className="page-wrap">
        <section className="hero-panel">
          <div><p className="eyebrow">SAVED WAR ROOMS</p><h1>Sign in to access your persistent league intelligence.</h1><p className="lede">Connected league snapshots are private to your WAR ROOM account.</p></div>
          <Link href="/login" className="connect-button">Sign in</Link>
        </section>
      </div>
    );
  }

  const { data: leagues, error } = await supabase
    .from("fantasy_leagues")
    .select("id,name,season,status,total_rosters,provider,provider_league_id,provider_payload,last_synced_at")
    .order("updated_at", { ascending: false });

  return (
    <div className="page-wrap">
      <section className="hero-panel">
        <div><p className="eyebrow">PERSISTENT LEAGUE INTELLIGENCE</p><h1>Your saved WAR ROOM leagues.</h1><p className="lede">Sleeper and ESPN snapshots share the same WAR ROOM persistence model while provider-specific access remains isolated.</p></div>
        <Link href="/connect" className="connect-button">Add another league</Link>
      </section>
      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">CONNECTED LEAGUES</p><h2>{leagues?.length ?? 0} saved</h2></div><span className="status-chip">PRIVATE</span></div>
        {error ? <div className="error-banner">Unable to read saved leagues.</div> : null}
        {!error && !leagues?.length ? <p className="empty-state">No leagues saved yet. Connect a Sleeper or ESPN league and choose Save to WAR ROOM.</p> : null}
        <div className="league-list">
          {leagues?.map((league) => {
            const identity = readManagerIdentity(league.provider_payload);
            const isEspn = league.provider === "espn";
            const canPersonalizeSleeper = Boolean(identity.sleeperUserId);
            return (
              <article className="league-card" key={league.id}>
                <div>
                  <p className="eyebrow">{league.provider.toUpperCase()} · {league.season}{identity.sleeperUsername ? ` · ${identity.sleeperUsername}` : ""}</p>
                  <h3>{league.name}</h3>
                  <p>{league.total_rosters ?? "—"} teams · {league.status ?? "unknown"} · Last synced {league.last_synced_at ? new Date(league.last_synced_at).toLocaleString() : "never"}</p>
                </div>
                <div className="hero-cta">
                  {isEspn ? (
                    <>
                      <Link href={espnHref(league.provider_league_id, league.season, league.provider_payload)} className="connect-button">Open ESPN WAR ROOM →</Link>
                      <span className="status-chip">ESPN ADAPTER</span>
                    </>
                  ) : (
                    <>
                      {canPersonalizeSleeper ? <Link href={sleeperFeatureHref("/command", league.provider_league_id, league.provider_payload)} className="connect-button">Open Mission Control →</Link> : <Link href={sleeperFeatureHref("/league", league.provider_league_id, league.provider_payload)} className="connect-button">Open decision room →</Link>}
                      {canPersonalizeSleeper ? <Link href={sleeperFeatureHref("/memory", league.provider_league_id, league.provider_payload)} className="status-chip">Decision History</Link> : null}
                      {canPersonalizeSleeper ? <Link href={sleeperFeatureHref("/championship", league.provider_league_id, league.provider_payload)} className="status-chip">Championship</Link> : null}
                      {canPersonalizeSleeper ? <Link href={sleeperFeatureHref("/trades", league.provider_league_id, league.provider_payload)} className="status-chip">Trade Center</Link> : null}
                      {canPersonalizeSleeper ? <Link href={sleeperFeatureHref("/breakouts", league.provider_league_id, league.provider_payload)} className="status-chip">Breakout Radar</Link> : null}
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
