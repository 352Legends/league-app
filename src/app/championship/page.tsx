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
      : "Sleeper data is temporarily unavailable. WAR ROOM will not invent championship probabilities.";
    return { ok: false as const, message };
  }
}

export default async function ChampionshipPage({ searchParams }: { searchParams: Promise<{ username?: string }> }) {
  const { username } = await searchParams;
  const value = username?.trim() ?? "";
  const result = value ? await loadSleeperAccount(value) : null;

  return (
    <div className="page-wrap">
      <section className="hero-panel championship-hero">
        <div>
          <p className="eyebrow">MONTE CARLO · CHAMPIONSHIP ENGINE</p>
          <h1>Measure the move by what it does to your title odds.</h1>
          <p className="lede">WAR ROOM simulates the remaining fantasy season thousands of times using your league standings, remaining schedule, roster scoring distributions and playoff structure.</p>
        </div>
        <span className="status-chip">5,000 SEASONS · PAIRED SCENARIOS</span>
      </section>

      <section className="section-block connect-panel">
        <form method="get" className="connect-form">
          <label htmlFor="username">Sleeper username</label>
          <div className="connect-row">
            <input id="username" name="username" defaultValue={value} placeholder="Enter your Sleeper username" autoComplete="off" />
            <button type="submit" className="connect-button">Scan my leagues</button>
          </div>
          <p className="metric-detail">Your Sleeper identity lets WAR ROOM isolate your roster and calculate your personal playoff, bye and championship probabilities.</p>
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
                      <p>{league.total_rosters} teams · standings, schedule, playoff seeding and roster distributions</p>
                    </div>
                    <Link href={`/championship/${league.league_id}?${query.toString()}`} className="connect-button">Run Championship Engine →</Link>
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
