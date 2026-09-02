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

export default async function TradesPage({ searchParams }: { searchParams: Promise<{ username?: string }> }) {
  const { username } = await searchParams;
  const value = username?.trim() ?? "";
  const result = value ? await loadSleeperAccount(value) : null;

  return (
    <div className="page-wrap">
      <section className="hero-panel trade-hero">
        <div>
          <p className="eyebrow">ROSTER ARBITRAGE · TRADE CENTER</p>
          <h1>Find the deal that makes both rosters better.</h1>
          <p className="lede">WAR ROOM scans every manager, position group and tradable player to identify your best upgrade targets, realistic return packages and the managers whose roster construction makes a deal plausible.</p>
        </div>
        <span className="status-chip">FIT + FAIR VALUE + ACTIVITY</span>
      </section>

      <section className="section-block connect-panel">
        <form method="get" className="connect-form">
          <label htmlFor="username">Sleeper username</label>
          <div className="connect-row">
            <input id="username" name="username" defaultValue={value} placeholder="Enter your Sleeper username" autoComplete="off" />
            <button type="submit" className="connect-button">Scan my leagues</button>
          </div>
          <p className="metric-detail">Sleeper remains read-only. WAR ROOM analyzes and proposes trades; it never submits a trade on your behalf.</p>
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
                      <p>{league.total_rosters} teams · roster needs, surpluses and manager trade behavior</p>
                    </div>
                    <Link href={`/trades/${league.league_id}?${query.toString()}`} className="connect-button">Open Trade Center →</Link>
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
