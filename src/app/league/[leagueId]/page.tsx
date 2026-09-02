import Link from "next/link";
import { buildTeamSummaries } from "@/lib/league";
import { sleeper, SleeperApiError } from "@/lib/sleeper/client";

export default async function LeaguePage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;

  try {
    const [league, users, rosters, state, drafts, players] = await Promise.all([
      sleeper.getLeague(leagueId),
      sleeper.getLeagueUsers(leagueId),
      sleeper.getRosters(leagueId),
      sleeper.getNflState(),
      sleeper.getDrafts(leagueId),
      sleeper.getActivePlayers(),
    ]);
    const matchups = await sleeper.getMatchups(leagueId, state.week);
    const teams = buildTeamSummaries(rosters, users, matchups, players);

    return (
      <div className="page-wrap">
        <section className="hero-panel">
          <div>
            <p className="eyebrow">LIVE LEAGUE INTELLIGENCE</p>
            <h1>{league.name}</h1>
            <p className="lede">Week {state.week} · {league.total_rosters} teams · {league.season} season · {drafts.length} draft record{drafts.length === 1 ? "" : "s"}</p>
          </div>
          <Link href="/connect" className="connect-button">Switch league</Link>
        </section>

        <section className="metric-grid">
          <article className="metric-card"><p className="eyebrow">TEAMS</p><strong className="metric-value">{teams.length}</strong><p className="metric-detail">Imported from Sleeper</p></article>
          <article className="metric-card"><p className="eyebrow">CURRENT WEEK</p><strong className="metric-value">{state.week}</strong><p className="metric-detail">Sleeper NFL state</p></article>
          <article className="metric-card metric-card--positive"><p className="eyebrow">LEAGUE STATUS</p><strong className="metric-value" style={{fontSize:24}}>{league.status.toUpperCase()}</strong><p className="metric-detail">Live provider state</p></article>
          <article className="metric-card"><p className="eyebrow">DATA SOURCE</p><strong className="metric-value" style={{fontSize:24}}>SLEEPER</strong><p className="metric-detail">Read-only live API</p></article>
        </section>

        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">LEAGUE POWER BASELINE</p><h2>Current standings and starters</h2></div><span className="status-chip">LIVE</span></div>
          <div className="team-grid">
            {teams.map((team, index) => (
              <article className="team-card" key={team.rosterId}>
                <p className="eyebrow">#{index + 1} · ROSTER {team.rosterId}</p>
                <h3>{team.teamName}</h3>
                <div className="team-meta"><span>{team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ""}</span><span>{team.pointsFor.toFixed(2)} PF</span><span>Week {state.week}: {team.matchupPoints.toFixed(2)}</span></div>
                <div className="player-pills">
                  {team.topPlayers.map((player) => <span className="player-pill" key={player.id}>{player.position} · {player.name} · {player.team}</span>)}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  } catch (error) {
    const detail = error instanceof SleeperApiError ? `Sleeper returned ${error.status}.` : "An unexpected provider error occurred.";
    return <div className="page-wrap"><div className="error-banner">League data unavailable. {detail} WAR ROOM will not fabricate replacement data.</div><Link href="/connect" className="connect-button">Back to league connection</Link></div>;
  }
}
