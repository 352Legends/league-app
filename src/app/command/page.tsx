import Link from "next/link";
import { sleeper, SleeperApiError } from "@/lib/sleeper/client";

async function loadAccount(value: string) {
  try {
    const user = await sleeper.getUser(value);
    const state = await sleeper.getNflState();
    const season = state.league_season || state.season;
    const leagues = await sleeper.getLeagues(user.user_id, season);
    return { ok: true as const, user, season, leagues };
  } catch (error) {
    const message = error instanceof SleeperApiError && error.status === 404
      ? "That Sleeper username could not be found."
      : "Sleeper data is temporarily unavailable. WAR ROOM will not invent decision intelligence.";
    return { ok: false as const, message };
  }
}

export default async function CommandSelectorPage({ searchParams }: { searchParams: Promise<{ username?: string }> }) {
  const { username } = await searchParams;
  const value = username?.trim() ?? "";
  const result = value ? await loadAccount(value) : null;

  return (
    <div className="page-wrap">
      <section className="hero-panel command-hero">
        <div>
          <p className="eyebrow">MISSION CONTROL · DECISION PRIORITY ENGINE</p>
          <h1>What is the single best move you can make right now?</h1>
          <p className="lede">WAR ROOM compares lineup changes, waiver acquisitions, breakout signals and trade opportunities on one scoreboard: modeled impact on your probability of winning the championship.</p>
        </div>
        <span className="status-chip">Δ CHAMPIONSHIP PROBABILITY</span>
      </section>

      <section className="section-block connect-panel">
        <form method="get" className="connect-form">
          <label htmlFor="username">Sleeper username</label>
          <div className="connect-row">
            <input id="username" name="username" defaultValue={value} placeholder="Enter your Sleeper username" autoComplete="off" />
            <button type="submit" className="connect-button">Open Mission Control</button>
          </div>
          <p className="metric-detail">Select a league to run the full decision stack. WAR ROOM remains read-only and never changes your roster automatically.</p>
        </form>
      </section>

      {result && !result.ok ? <div className="error-banner">{result.message}</div> : null}

      {result?.ok ? (
        <section className="section-block">
          <div className="section-heading">
            <div><p className="eyebrow">SELECT LEAGUE</p><h2>{result.user.display_name ?? result.user.username ?? value}</h2></div>
            <span className="status-chip">{result.season} · {result.leagues.length} LEAGUE{result.leagues.length === 1 ? "" : "S"}</span>
          </div>
          {result.leagues.length === 0 ? <p className="empty-state">No Sleeper NFL leagues were found for the current league season.</p> : (
            <div className="league-list">
              {result.leagues.map((league) => {
                const query = new URLSearchParams({
                  sleeperUserId: result.user.user_id,
                  sleeperUsername: result.user.username ?? result.user.display_name ?? value,
                });
                return (
                  <article className="league-card" key={league.league_id}>
                    <div>
                      <p className="eyebrow">{league.status.toUpperCase()} · {league.total_rosters} TEAMS</p>
                      <h3>{league.name}</h3>
                      <p>Cross-decision ranking · championship simulation · lineup · waivers · breakouts · trades</p>
                    </div>
                    <Link href={`/command/${league.league_id}?${query.toString()}`} className="connect-button">Run Priority Engine →</Link>
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
