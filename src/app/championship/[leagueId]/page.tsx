import Link from "next/link";
import { buildChampionshipImpact } from "@/lib/analytics/championship";
import { loadPlayerIdCrosswalk, loadWeeklyPlayerStats } from "@/lib/nflverse/client";
import { sleeper, SleeperApiError } from "@/lib/sleeper/client";

type ChampionshipLeaguePageProps = {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ sleeperUserId?: string; sleeperUsername?: string; boost?: string }>;
};

function formatDelta(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

function probabilityClass(value: number): string {
  if (value >= 30) return "title-prob title-prob--elite";
  if (value >= 15) return "title-prob title-prob--strong";
  if (value >= 6) return "title-prob title-prob--live";
  return "title-prob";
}

async function loadChampionshipEngine(leagueId: string, sleeperUserId: string, boost: number) {
  try {
    const [league, rosters, users, players, state] = await Promise.all([
      sleeper.getLeague(leagueId),
      sleeper.getRosters(leagueId),
      sleeper.getLeagueUsers(leagueId),
      sleeper.getActivePlayers(),
      sleeper.getNflState(),
    ]);
    const userRoster = rosters.find((roster) => roster.owner_id === sleeperUserId);
    if (!userRoster) return { ok: false as const, message: "WAR ROOM could not match this Sleeper account to a roster in the selected league." };

    const currentSeason = Number(league.season);
    const baselineSeason = Math.max(2020, currentSeason - 1);
    const [crosswalk, baselineStats, currentStats] = await Promise.all([
      loadPlayerIdCrosswalk(),
      loadWeeklyPlayerStats(baselineSeason),
      loadWeeklyPlayerStats(currentSeason).catch(() => new Map()),
    ]);

    const configuredPlayoffWeek = Number(league.settings.playoff_week_start);
    const playoffWeekStart = Number.isFinite(configuredPlayoffWeek) && configuredPlayoffWeek > 0 ? Math.round(configuredPlayoffWeek) : 15;
    const matchupWeeks = Array.from(
      { length: Math.max(0, playoffWeekStart - state.week) },
      (_, index) => state.week + index,
    );
    const matchupPages = await Promise.all(matchupWeeks.map(async (week) => [week, await sleeper.getMatchups(leagueId, week).catch(() => [])] as const));
    const matchupsByWeek = new Map(matchupPages);

    const impact = buildChampionshipImpact({
      rosters,
      users,
      players,
      rosterPositions: league.roster_positions,
      scoring: league.scoring_settings,
      leagueSettings: league.settings,
      crosswalk,
      baselineStats,
      currentStats,
      matchupsByWeek,
      currentWeek: state.week,
      userRosterId: userRoster.roster_id,
      weeklyBoost: boost,
      iterations: 5000,
      seed: 0x57415252,
    });

    return { ok: true as const, league, state, impact, baselineSeason, currentSeason };
  } catch (error) {
    const message = error instanceof SleeperApiError
      ? `Sleeper returned ${error.status}; Championship Engine could not refresh.`
      : error instanceof Error
        ? error.message
        : "Championship simulation data is temporarily unavailable.";
    return { ok: false as const, message };
  }
}

export default async function ChampionshipLeaguePage({ params, searchParams }: ChampionshipLeaguePageProps) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const sleeperUserId = query.sleeperUserId?.trim();
  const sleeperUsername = query.sleeperUsername?.trim();
  const rawBoost = Number(query.boost ?? 0);
  const boost = Number.isFinite(rawBoost) ? Math.max(-15, Math.min(15, rawBoost)) : 0;

  if (!sleeperUserId) {
    return (
      <div className="page-wrap">
        <div className="error-banner">WAR ROOM needs your Sleeper identity to calculate your championship probability.</div>
        <Link href="/championship" className="connect-button">Connect Championship Engine</Link>
      </div>
    );
  }

  const result = await loadChampionshipEngine(leagueId, sleeperUserId, boost);
  if (!result.ok) {
    return (
      <div className="page-wrap">
        <div className="error-banner">{result.message} WAR ROOM will not fabricate playoff or championship probabilities.</div>
        <Link href="/championship" className="connect-button">Back to Championship Engine</Link>
      </div>
    );
  }

  const baselineUser = result.impact.baseline.teams.find((team) => team.rosterId === result.impact.userRosterId)!;
  const scenarioUser = result.impact.scenario?.teams.find((team) => team.rosterId === result.impact.userRosterId) ?? null;
  const backQuery = new URLSearchParams({ sleeperUserId, sleeperUsername: sleeperUsername ?? "" });
  const scheduleCoverage = result.impact.baseline.scheduledWeeks.length + result.impact.baseline.missingScheduleWeeks.length;
  const coveragePct = scheduleCoverage
    ? (result.impact.baseline.scheduledWeeks.length / scheduleCoverage) * 100
    : 100;

  return (
    <div className="page-wrap">
      <section className="hero-panel championship-hero championship-hero--league">
        <div>
          <p className="eyebrow">CHAMPIONSHIP ENGINE · {result.league.name}</p>
          <h1>{baselineUser.championshipProbability.toFixed(1)}% Championship Probability</h1>
          <p className="lede">{sleeperUsername ?? baselineUser.managerName} · Week {result.state.week}. WAR ROOM simulated {result.impact.baseline.iterations.toLocaleString()} complete season outcomes from the current standings through the fantasy playoffs.</p>
        </div>
        <div className="hero-cta">
          <Link href={`/league/${leagueId}?${backQuery.toString()}`} className="connect-button">Back to league</Link>
          <Link href={`/trades/${leagueId}?${backQuery.toString()}`} className="status-chip">Trade Center</Link>
        </div>
      </section>

      <section className="metric-grid championship-summary">
        <article className="metric-card metric-card--positive"><p className="eyebrow">CHAMPIONSHIP</p><strong className="metric-value">{baselineUser.championshipProbability.toFixed(1)}%</strong><p className="metric-detail">Title wins across {result.impact.baseline.iterations.toLocaleString()} simulated seasons</p></article>
        <article className="metric-card"><p className="eyebrow">PLAYOFFS</p><strong className="metric-value">{baselineUser.playoffProbability.toFixed(1)}%</strong><p className="metric-detail">Top {result.impact.baseline.playoffTeams} finish probability</p></article>
        <article className="metric-card"><p className="eyebrow">FIRST-ROUND BYE</p><strong className="metric-value">{result.impact.baseline.byeTeams ? `${baselineUser.byeProbability.toFixed(1)}%` : "N/A"}</strong><p className="metric-detail">{result.impact.baseline.byeTeams ? `${result.impact.baseline.byeTeams} bye seed${result.impact.baseline.byeTeams === 1 ? "" : "s"} modeled` : "League format has no simulated first-round bye"}</p></article>
        <article className="metric-card"><p className="eyebrow">EXPECTED FINISH</p><strong className="metric-value">#{baselineUser.averageSeed.toFixed(1)}</strong><p className="metric-detail">{baselineUser.expectedFinalWins.toFixed(1)} expected regular-season wins</p></article>
      </section>

      <section className="section-block championship-impact-panel">
        <div className="section-heading">
          <div><p className="eyebrow">THE NORTH STAR METRIC</p><h2>Δ Championship Probability</h2></div>
          <span className="status-chip">PAIRED MONTE CARLO</span>
        </div>
        <div className="impact-calculator-grid">
          <form method="get" className="impact-form">
            <input type="hidden" name="sleeperUserId" value={sleeperUserId} />
            <input type="hidden" name="sleeperUsername" value={sleeperUsername ?? ""} />
            <label htmlFor="boost">Sustained weekly lineup change</label>
            <div className="impact-input-row">
              <input id="boost" name="boost" type="number" min="-15" max="15" step="0.5" defaultValue={boost || 1} />
              <span>points / week</span>
              <button type="submit" className="connect-button">Simulate impact</button>
            </div>
            <p className="metric-detail">Use a trade&apos;s Net Lineup Gain, a waiver upgrade, or any evidence-backed weekly scoring change. WAR ROOM reruns the same random season worlds so the difference isolates the modeled move.</p>
          </form>

          <div className="impact-results">
            <div><span>BASELINE TITLE ODDS</span><strong>{baselineUser.championshipProbability.toFixed(1)}%</strong></div>
            <div><span>SCENARIO TITLE ODDS</span><strong>{scenarioUser ? `${scenarioUser.championshipProbability.toFixed(1)}%` : "—"}</strong></div>
            <div className="impact-delta"><span>Δ CHAMPIONSHIP</span><strong>{formatDelta(result.impact.championshipDelta)}</strong></div>
            <div><span>Δ PLAYOFF</span><strong>{formatDelta(result.impact.playoffDelta)}</strong></div>
          </div>
        </div>
        {scenarioUser ? (
          <div className="championship-scenario-note">
            <strong>{boost > 0 ? `+${boost.toFixed(1)}` : boost.toFixed(1)} PTS/WEEK SCENARIO</strong>
            <span>Championship probability moves from {baselineUser.championshipProbability.toFixed(1)}% to {scenarioUser.championshipProbability.toFixed(1)}% ({formatDelta(result.impact.championshipDelta)}). This models the scoring change as sustained for each remaining simulated week.</span>
          </div>
        ) : null}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">LEAGUE POWER MAP</p><h2>Who actually has the best path to the title?</h2></div>
          <span className="status-chip">CURRENT STANDINGS + ROSTER DISTRIBUTIONS</span>
        </div>
        <div className="championship-table-wrap">
          <table className="championship-table">
            <thead><tr><th>Rank</th><th>Team</th><th>Record</th><th>Modeled Pts</th><th>Playoffs</th><th>Bye</th><th>Championship</th><th>Avg Seed</th></tr></thead>
            <tbody>
              {result.impact.baseline.teams.map((team, index) => (
                <tr key={team.rosterId} className={team.rosterId === result.impact.userRosterId ? "championship-user-row" : ""}>
                  <td>#{index + 1}</td>
                  <td><strong>{team.teamName}</strong><small>{team.managerName}{team.rosterId === result.impact.userRosterId ? " · YOU" : ""}</small></td>
                  <td>{team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ""}</td>
                  <td><strong>{team.projectedMean.toFixed(1)}</strong><small>{team.projectedFloor.toFixed(0)}–{team.projectedCeiling.toFixed(0)} range</small></td>
                  <td>{team.playoffProbability.toFixed(1)}%</td>
                  <td>{result.impact.baseline.byeTeams ? `${team.byeProbability.toFixed(1)}%` : "—"}</td>
                  <td><span className={probabilityClass(team.championshipProbability)}>{team.championshipProbability.toFixed(1)}%</span></td>
                  <td>#{team.averageSeed.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="two-column">
        <div className="section-block">
          <div className="section-heading"><div><p className="eyebrow">SIMULATION INPUTS</p><h2>Your modeled roster</h2></div><span className="status-chip">{baselineUser.evidenceLabel}</span></div>
          <div className="simulation-facts">
            <div><span>Weekly mean</span><strong>{baselineUser.projectedMean.toFixed(1)}</strong></div>
            <div><span>Weekly volatility</span><strong>{baselineUser.projectedSd.toFixed(1)}</strong></div>
            <div><span>Modeled starters</span><strong>{baselineUser.supportedStarters}/{baselineUser.totalStarterSlots}</strong></div>
            <div><span>Playoff start</span><strong>Week {result.impact.baseline.playoffWeekStart}</strong></div>
          </div>
          <p className="metric-detail">QB/RB/WR/TE projections blend {result.baselineSeason} evidence with {result.currentSeason} production as it becomes available. Unsupported starter slots receive a neutral league-level allowance rather than invented player projections.</p>
        </div>

        <div className="section-block">
          <div className="section-heading"><div><p className="eyebrow">SCHEDULE INTEGRITY</p><h2>{coveragePct.toFixed(0)}% remaining schedule coverage</h2></div><span className="status-chip">SLEEPER MATCHUPS</span></div>
          <div className="simulation-facts">
            <div><span>Simulated weeks</span><strong>{result.impact.baseline.scheduledWeeks.length}</strong></div>
            <div><span>Missing weeks</span><strong>{result.impact.baseline.missingScheduleWeeks.length}</strong></div>
            <div><span>Playoff teams</span><strong>{result.impact.baseline.playoffTeams}</strong></div>
            <div><span>First-round byes</span><strong>{result.impact.baseline.byeTeams}</strong></div>
          </div>
          {result.impact.baseline.missingScheduleWeeks.length ? (
            <div className="error-banner">Sleeper did not return a complete matchup pairing for week{result.impact.baseline.missingScheduleWeeks.length === 1 ? "" : "s"} {result.impact.baseline.missingScheduleWeeks.join(", ")}. Those weeks are excluded rather than fabricated.</div>
          ) : (
            <p className="metric-detail">All remaining regular-season weeks before the configured fantasy playoff start have complete Sleeper matchup pairings.</p>
          )}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">MODEL DISCIPLINE</p><h2>What Championship Probability means</h2></div><span className="status-chip">PROBABILITY, NOT PROMISE</span></div>
        <div className="intel-note"><span>i</span><p>Championship Probability is the share of modeled season paths that end in a title. Each team score is sampled from a roster-level distribution built from league-scored NFL production, current role/injury context and actual fantasy scoring as the season develops. Playoff seeding uses simulated record then points-for as the tiebreaker. The model does not claim to know injuries, trades or role changes that have not happened yet; those become new inputs when evidence changes.</p></div>
      </section>
    </div>
  );
}
