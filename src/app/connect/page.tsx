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

type SearchParams = {
  username?: string;
  provider?: string;
  espnError?: string;
};

export default async function ConnectPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const value = query.username?.trim() ?? "";
  const result = value ? await loadSleeperAccount(value) : null;
  const currentSeason = new Date().getFullYear();

  return (
    <div className="page-wrap">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">LEAGUE CONNECTION</p>
          <h1>Connect the league WAR ROOM will scout.</h1>
          <p className="lede">WAR ROOM now supports Sleeper and ESPN Fantasy Football. Each platform is isolated behind its own provider adapter, while the decision engines consume normalized league, roster and scoring data.</p>
        </div>
        <span className="status-chip">SLEEPER + ESPN</span>
      </section>

      <section className="two-column">
        <div className="section-block connect-panel">
          <div className="section-heading">
            <div><p className="eyebrow">SLEEPER</p><h2>Connect by username</h2></div>
            <span className="status-chip">OFFICIAL READ-ONLY API</span>
          </div>
          <form method="get" className="connect-form">
            <input type="hidden" name="provider" value="sleeper" />
            <label htmlFor="username">Sleeper username</label>
            <div className="connect-row">
              <input id="username" name="username" defaultValue={value} placeholder="Enter your Sleeper username" autoComplete="off" />
              <button type="submit" className="connect-button">Find leagues</button>
            </div>
            <p className="metric-detail">WAR ROOM requests public, read-only Sleeper league information and uses your Sleeper user ID to identify your roster.</p>
          </form>
        </div>

        <div className="section-block connect-panel">
          <div className="section-heading">
            <div><p className="eyebrow">ESPN FANTASY FOOTBALL</p><h2>Connect by league ID</h2></div>
            <span className="status-chip">ADAPTER · FAIL-SOFT</span>
          </div>
          <form method="post" action="/api/espn/connect" className="connect-form">
            <label htmlFor="espnLeagueId">ESPN league ID</label>
            <div className="connect-row">
              <input id="espnLeagueId" name="leagueId" inputMode="numeric" placeholder="e.g. 123456789" autoComplete="off" required />
              <input name="season" type="number" min="2018" max="2100" defaultValue={currentSeason} aria-label="ESPN season" required />
            </div>
            <p className="metric-detail">Public ESPN leagues need only the league ID and season. Private leagues can also use the two ESPN browser session cookies below.</p>

            <details className="intel-note">
              <summary><strong>Private ESPN league</strong> · add secure session credentials</summary>
              <div className="connect-form" style={{ marginTop: 12 }}>
                <label htmlFor="swid">SWID</label>
                <input id="swid" name="swid" placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}" autoComplete="off" />
                <label htmlFor="espnS2">espn_s2</label>
                <input id="espnS2" name="espnS2" type="password" placeholder="Paste the espn_s2 cookie value" autoComplete="off" />
                <p className="metric-detail">WAR ROOM never asks for your ESPN password. These values are stored only as HttpOnly app-session cookies for interactive access and are not written into saved league payloads.</p>
              </div>
            </details>
            <button type="submit" className="connect-button">Open ESPN league →</button>
          </form>
        </div>
      </section>

      {query.espnError ? <div className="error-banner">ESPN: {query.espnError}</div> : null}
      {result && !result.ok ? <div className="error-banner">{result.message}</div> : null}

      {result?.ok ? (
        <section className="section-block">
          <div className="section-heading">
            <div><p className="eyebrow">SLEEPER ACCOUNT</p><h2>{result.user.display_name ?? result.user.username ?? value}</h2></div>
            <span className="status-chip">{result.season} · {result.leagues.length} LEAGUE{result.leagues.length === 1 ? "" : "S"}</span>
          </div>
          {result.leagues.length === 0 ? (
            <p className="empty-state">No Sleeper NFL leagues were found for the current league season.</p>
          ) : (
            <div className="league-list">
              {result.leagues.map((league) => {
                const leagueQuery = new URLSearchParams({
                  sleeperUserId: result.user.user_id,
                  sleeperUsername: result.user.username ?? result.user.display_name ?? value,
                });
                return (
                  <article className="league-card" key={league.league_id}>
                    <div>
                      <p className="eyebrow">SLEEPER · {league.status.toUpperCase()}</p>
                      <h3>{league.name}</h3>
                      <p>{league.total_rosters} teams · {league.roster_positions.join(" · ")}</p>
                    </div>
                    <Link href={`/league/${league.league_id}?${leagueQuery.toString()}`} className="connect-button">Open league →</Link>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">PROVIDER DISCIPLINE</p><h2>One WAR ROOM model, isolated data adapters.</h2></div></div>
        <div className="intel-note"><span>i</span><p>Sleeper uses its documented read-only API. ESPN Fantasy does not expose an equivalent supported public developer API, so WAR ROOM isolates ESPN behind a dedicated adapter and fails visibly if ESPN changes an endpoint instead of contaminating the Sleeper path or inventing data.</p></div>
      </section>
    </div>
  );
}
