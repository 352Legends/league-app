import Link from "next/link";
import { sleeper, SleeperApiError } from "@/lib/sleeper/client";

async function loadSleeperAccount(value: string) {
  try {
    const user = await sleeper.getUser(value);
    const state = await sleeper.getNflState();
    const season = state.league_season || state.season;
    const leagues = await sleeper.getLeagues(user.user_id, season);
    return { ok: true as const, user, season, leagues };
  } catch (error) {
    const message = error instanceof SleeperApiError && error.status === 404
      ? "That Sleeper username could not be found."
      : "Sleeper data is temporarily unavailable. WAR ROOM will not invent league data.";
    return { ok: false as const, message };
  }
}

export default async function BreakoutsPage({ searchParams }: { searchParams: Promise<{ username?: string }> }) {
  const { username } = await searchParams;
  const value = username?.trim() ?? "";
  const result = value ? await loadSleeperAccount(value) : null;

  return (
    <div className="page-wrap">
      <section className="hero-panel breakout-hero">
        <div>
          <p className="eyebrow">ALPHA DETECTOR · BREAKOUT RADAR</p>
          <h1>Find the role change before your league sees it.</h1>
          <p className="lede">WAR ROOM compares snap share, targets, carries, target share, depth-chart role and Sleeper market movement to identify emerging fantasy opportunities before season averages catch up.</p>
        </div>
        <span className="status-chip">USAGE > HYPE</span>
      </section>

      <section className="section-block connect-panel">
        <form method="get" className="connect-form">
          <label htmlFor="username">Sleeper username</label>
          <div className="connect-row">
            <input id="username" name="username" defaultValue={value} placeholder="Enter your Sleeper username" autoComplete="off" />
            <button type="submit" className="connect-button">Scan my leagues</button>
          </div>
          <p className="metric-detail">WAR ROOM uses your league rosters to distinguish true free agents from already-rostered breakout candidates.</p>
        </form>
      </section>

      {result && !result.ok ? <div className="error-banner">{result.message}</div> : null}

      {result?.ok ? (
        <section className="section-block">
          <div className="section-heading">
            <div><p className="eyebrow">SELECT LEAGUE</p><h2>{result.user.display_name ?? result.user.username ?? value}</h2></div>
            <span className="status-chip">{result.season} · {result.leagues.length} LEAGUE{result.leagues.length === 1 ? "" : "S"}</span>
          </div>
          {result.leagues.length === 0 ? (
            <p className="empty-state">No Sleeper NFL leagues were found for the current league season.</p>
          ) : (
            <div className="league-list">
              {result.leagues.map((league) => {
                const query = new URLSearchParams({
                  sleeperUserId: result.user.user_id,
                  sleeperUsername: result.user.username ?? result.user.display_name ?? value,
                });
                return (
                  <article className="league-card" key={league.league_id}>
                    <div>
                      <p className="eyebrow">{league.status.toUpperCase()}</p>
                      <h3>{league.name}</h3>
                      <p>{league.total_rosters} teams · league-aware ownership and market context</p>
                    </div>
                    <Link href={`/breakouts/${league.league_id}?${query.toString()}`} className="connect-button">Run Breakout Radar →</Link>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
