import Link from "next/link";
import { sleeper, SleeperApiError } from "@/lib/sleeper/client";

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ username?: string }> }) {
  const { username } = await searchParams;
  const value = username?.trim() ?? "";
  let content: React.ReactNode = null;

  if (value) {
    try {
      const user = await sleeper.getUser(value);
      const state = await sleeper.getNflState();
      const season = state.league_season || state.season;
      const leagues = await sleeper.getLeagues(user.user_id, season);

      content = (
        <section className="section-block">
          <div className="section-heading">
            <div><p className="eyebrow">SLEEPER ACCOUNT</p><h2>{user.display_name ?? user.username ?? value}</h2></div>
            <span className="status-chip">{season} · {leagues.length} LEAGUE{leagues.length === 1 ? "" : "S"}</span>
          </div>
          {leagues.length === 0 ? (
            <p className="empty-state">No Sleeper NFL leagues were found for the current league season.</p>
          ) : (
            <div className="league-list">
              {leagues.map((league) => {
                const query = new URLSearchParams({
                  sleeperUserId: user.user_id,
                  sleeperUsername: user.username ?? user.display_name ?? value,
                });
                return (
                  <article className="league-card" key={league.league_id}>
                    <div>
                      <p className="eyebrow">{league.status.toUpperCase()}</p>
                      <h3>{league.name}</h3>
                      <p>{league.total_rosters} teams · {league.roster_positions.join(" · ")}</p>
                    </div>
                    <Link href={`/league/${league.league_id}?${query.toString()}`} className="connect-button">Open league →</Link>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      );
    } catch (error) {
      const message = error instanceof SleeperApiError && error.status === 404
        ? "That Sleeper username could not be found."
        : "Sleeper data is temporarily unavailable. WAR ROOM will not invent league data.";
      content = <div className="error-banner">{message}</div>;
    }
  }

  return (
    <div className="page-wrap">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">LEAGUE CONNECTION</p>
          <h1>Connect the league WAR ROOM will scout.</h1>
          <p className="lede">Sleeper's read-only API lets WAR ROOM discover your leagues without asking for a fantasy-platform password. The selected account is also used to identify which roster is yours.</p>
        </div>
        <span className="status-chip">LIVE SLEEPER DATA</span>
      </section>

      <section className="section-block connect-panel">
        <form method="get" className="connect-form">
          <label htmlFor="username">Sleeper username</label>
          <div className="connect-row">
            <input id="username" name="username" defaultValue={value} placeholder="Enter your Sleeper username" autoComplete="off" />
            <button type="submit" className="connect-button">Find leagues</button>
          </div>
          <p className="metric-detail">WAR ROOM requests only public, read-only Sleeper league information.</p>
        </form>
      </section>

      {content}
    </div>
  );
}
