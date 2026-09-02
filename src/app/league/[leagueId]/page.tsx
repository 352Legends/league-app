import Link from "next/link";
import { buildLineupPlan, type LineupPlan, type LineupSwap } from "@/lib/analytics/lineups";
import { buildWaiverBoard, type UserRosterPlayer, type WaiverCandidate } from "@/lib/analytics/waivers";
import { buildTeamSummaries } from "@/lib/league";
import { loadAdvancedPassingStats, loadNflSchedule, loadPlayerIdCrosswalk, loadWeeklyPlayerStats, loadWeeklyTeamStats } from "@/lib/nflverse/client";
import { sleeper, SleeperApiError } from "@/lib/sleeper/client";
import type { SleeperRoster } from "@/lib/sleeper/types";

type LeaguePageProps = {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ sleeperUserId?: string; sleeperUsername?: string }>;
};

function rosterPlayers(roster: SleeperRoster): UserRosterPlayer[] {
  const starters = new Set(roster.starters ?? []);
  const reserve = new Set(roster.reserve ?? []);
  const taxi = new Set(roster.taxi ?? []);

  return (roster.players ?? []).map((playerId) => ({
    playerId,
    status: starters.has(playerId) ? "starter" : reserve.has(playerId) ? "ir" : taxi.has(playerId) ? "taxi" : "bench",
  }));
}

function candidateMetric(value: number | null, suffix = ""): string {
  return value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

function WaiverCard({ candidate, rank }: { candidate: WaiverCandidate; rank: number }) {
  return (
    <article className="waiver-card">
      <div className="waiver-rank">#{rank}</div>
      <div className="waiver-main">
        <div className="waiver-title-row">
          <div>
            <p className="eyebrow">{candidate.position} · {candidate.team}</p>
            <h3>{candidate.name}</h3>
          </div>
          <div className="waiver-badges">
            <span className={`action-chip action-chip--${candidate.action.toLowerCase().replaceAll(" ", "-")}`}>{candidate.action}</span>
            <span className="status-chip">{candidate.confidence}</span>
          </div>
        </div>

        <div className="waiver-metrics">
          <div><span>WAR SCORE</span><strong>{candidate.score.toFixed(1)}</strong></div>
          <div><span>PROJECTION</span><strong>{candidate.projection ? candidate.projection.mean.toFixed(1) : "—"}</strong></div>
          <div><span>VS REPLACEMENT</span><strong>{candidateMetric(candidate.valueOverReplacement)}</strong></div>
          <div><span>NET ROSTER GAIN</span><strong>{candidateMetric(candidate.netRosterGain)}</strong></div>
        </div>

        {candidate.projection && (
          <p className="waiver-range">
            Model range {candidate.projection.floor.toFixed(1)}–{candidate.projection.ceiling.toFixed(1)} · {candidate.projection.recentTargets.toFixed(1)} recent targets · {candidate.projection.recentCarries.toFixed(1)} recent carries
          </p>
        )}

        {candidate.dropPlayer && (
          <div className="drop-callout">
            <span>BEST DROP PAIRING</span>
            <strong>{candidate.dropPlayer.name}</strong>
            <small>{candidate.dropPlayer.projection.toFixed(1)} projected points</small>
          </div>
        )}

        <ul className="reason-list">
          {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </div>
      <div className="waiver-market">
        <span>SLEEPER 24H</span>
        <strong>+{candidate.addCount.toLocaleString()}</strong>
        <small>{candidate.dropCount.toLocaleString()} drops</small>
      </div>
    </article>
  );
}

function LineupSwapCard({ swap, rank }: { swap: LineupSwap; rank: number }) {
  return (
    <article className="swap-card">
      <div className="swap-rank">#{rank}</div>
      <div className="swap-main">
        <div className="swap-header">
          <div>
            <p className="eyebrow">{swap.slot} · {swap.confidence} CONFIDENCE</p>
            <h3>Start {swap.start.name}</h3>
          </div>
          <div className="gain-pill">+{swap.projectedGain.toFixed(1)} PTS</div>
        </div>
        <div className="swap-versus">
          <div className="swap-player swap-player--start">
            <span>START</span>
            <strong>{swap.start.name}</strong>
            <small>{swap.start.position} · {swap.start.team} · {swap.start.gameNote}</small>
            <div className="swap-context"><i>{swap.start.schemeLabel}</i><em>scheme {swap.start.schemeScore.toFixed(0)}</em></div>
            <b>{swap.start.adjustedProjection?.toFixed(1) ?? "—"}</b>
          </div>
          <div className="swap-arrow">→</div>
          <div className="swap-player swap-player--sit">
            <span>SIT</span>
            <strong>{swap.sit.name}</strong>
            <small>{swap.sit.position} · {swap.sit.team} · {swap.sit.gameNote}</small>
            <div className="swap-context"><i>{swap.sit.schemeLabel}</i><em>scheme {swap.sit.schemeScore.toFixed(0)}</em></div>
            <b>{swap.sit.adjustedProjection?.toFixed(1) ?? "—"}</b>
          </div>
        </div>
        <ul className="reason-list">
          {swap.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </div>
    </article>
  );
}

async function loadLeagueData(leagueId: string, sleeperUserId: string | null) {
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
    const userRoster = sleeperUserId ? rosters.find((roster) => roster.owner_id === sleeperUserId) : undefined;
    const rosteredPlayerIds = new Set(rosters.flatMap((roster) => roster.players ?? []));
    const analyticsSeason = Math.max(2020, Number(league.season) - 1);

    let waiverBoard: WaiverCandidate[] = [];
    let waiverError: string | null = null;
    let lineupPlan: LineupPlan | null = null;
    let lineupError: string | null = null;

    if (userRoster) {
      try {
        const [crosswalk, historicalStats] = await Promise.all([
          loadPlayerIdCrosswalk(),
          loadWeeklyPlayerStats(analyticsSeason),
        ]);

        try {
          const [trendingAdds, trendingDrops] = await Promise.all([
            sleeper.getTrending("add", 24, 100),
            sleeper.getTrending("drop", 24, 100),
          ]);
          waiverBoard = buildWaiverBoard({
            leagueSize: league.total_rosters,
            scoring: league.scoring_settings,
            players,
            rosteredPlayerIds,
            userRoster: rosterPlayers(userRoster),
            crosswalk,
            historicalStats,
            trendingAdds,
            trendingDrops,
            currentSeason: Number(league.season),
          });
        } catch (error) {
          waiverError = error instanceof Error ? error.message : "Waiver market sources are temporarily unavailable.";
        }

        try {
          const schedule = await loadNflSchedule(Number(league.season));
          const [teamStats, advancedPassing] = await Promise.all([
            loadWeeklyTeamStats(analyticsSeason).catch(() => []),
            loadAdvancedPassingStats(analyticsSeason).catch(() => []),
          ]);
          lineupPlan = buildLineupPlan({
            roster: userRoster,
            rosterPositions: league.roster_positions,
            scoring: league.scoring_settings,
            players,
            crosswalk,
            historicalStats,
            teamStats,
            advancedPassing,
            schedule,
            season: Number(league.season),
            week: state.week,
            evidenceSeason: analyticsSeason,
          });
        } catch (error) {
          lineupError = error instanceof Error ? error.message : "Weekly matchup sources are temporarily unavailable.";
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Analytics sources are temporarily unavailable.";
        waiverError = message;
        lineupError = message;
      }
    }

    return {
      ok: true as const,
      league,
      state,
      drafts,
      teams,
      userRoster,
      analyticsSeason,
      waiverBoard,
      waiverError,
      lineupPlan,
      lineupError,
    };
  } catch (error) {
    const detail = error instanceof SleeperApiError ? `Sleeper returned ${error.status}.` : "An unexpected provider error occurred.";
    return { ok: false as const, detail };
  }
}

export default async function LeaguePage({ params, searchParams }: LeaguePageProps) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const sleeperUserId = query.sleeperUserId?.trim() || null;
  const sleeperUsername = query.sleeperUsername?.trim() || null;
  const result = await loadLeagueData(leagueId, sleeperUserId);

  if (!result.ok) {
    return (
      <div className="page-wrap">
        <div className="error-banner">League data unavailable. {result.detail} WAR ROOM will not fabricate replacement data.</div>
        <Link href="/connect" className="connect-button">Back to league connection</Link>
      </div>
    );
  }

  const { league, state, drafts, teams, userRoster, analyticsSeason, waiverBoard, waiverError, lineupPlan, lineupError } = result;

  return (
    <div className="page-wrap">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">LIVE LEAGUE INTELLIGENCE</p>
          <h1>{league.name}</h1>
          <p className="lede">Week {state.week} · {league.total_rosters} teams · {league.season} season · {drafts.length} draft record{drafts.length === 1 ? "" : "s"}</p>
        </div>
        <div className="hero-cta">
          <form action="/api/leagues/import" method="post">
            <input type="hidden" name="leagueId" value={leagueId} />
            {sleeperUserId && <input type="hidden" name="sleeperUserId" value={sleeperUserId} />}
            {sleeperUsername && <input type="hidden" name="sleeperUsername" value={sleeperUsername} />}
            <button type="submit" className="connect-button">Save to WAR ROOM</button>
          </form>
          <Link href="/saved" className="status-chip">Saved leagues</Link>
          <Link href="/connect" className="status-chip">Switch league</Link>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card"><p className="eyebrow">TEAMS</p><strong className="metric-value">{teams.length}</strong><p className="metric-detail">Imported from Sleeper</p></article>
        <article className="metric-card"><p className="eyebrow">CURRENT WEEK</p><strong className="metric-value">{state.week}</strong><p className="metric-detail">Sleeper NFL state</p></article>
        <article className="metric-card metric-card--positive"><p className="eyebrow">LEAGUE STATUS</p><strong className="metric-value" style={{ fontSize: 24 }}>{league.status.toUpperCase()}</strong><p className="metric-detail">Live provider state</p></article>
        <article className="metric-card"><p className="eyebrow">YOUR ROSTER</p><strong className="metric-value" style={{ fontSize: 24 }}>{userRoster ? "IDENTIFIED" : "NOT LINKED"}</strong><p className="metric-detail">{userRoster ? `${sleeperUsername ?? "Sleeper manager"} · roster ${userRoster.roster_id}` : "Reconnect through your Sleeper username to unlock personalized decisions."}</p></article>
      </section>

      <section className="section-block lineup-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DECISION ENGINE · START / SIT</p>
            <h2>Weekly lineup command center</h2>
          </div>
          <span className="status-chip">SCHEME + PRESSURE + MATCHUP + WEATHER + VEGAS</span>
        </div>

        {!sleeperUserId || !userRoster ? (
          <div className="intel-note">
            <span>!</span>
            <p>Reconnect through your Sleeper username so WAR ROOM can identify your starters and bench before recommending lineup changes. <Link href="/connect"><strong>Connect roster →</strong></Link></p>
          </div>
        ) : lineupError ? (
          <div className="error-banner">Your roster is connected, but weekly matchup intelligence could not be refreshed: {lineupError} WAR ROOM will not invent a start/sit recommendation.</div>
        ) : lineupPlan ? (
          <>
            <div className="lineup-summary-grid">
              <div><span>CURRENT MODELED</span><strong>{lineupPlan.currentProjectedPoints.toFixed(1)}</strong><small>supported starter points</small></div>
              <div><span>OPTIMIZED</span><strong>{lineupPlan.optimizedProjectedPoints.toFixed(1)}</strong><small>after evidence-backed swaps</small></div>
              <div className="lineup-gain"><span>PROJECTED GAIN</span><strong>+{lineupPlan.projectedGain.toFixed(1)}</strong><small>points available this week</small></div>
              <div><span>CHANGES</span><strong>{lineupPlan.swaps.length}</strong><small>recommended lineup moves</small></div>
            </div>

            <div className="model-note">
              <strong>WEEK {lineupPlan.week} MODEL</strong>
              <span>{lineupPlan.evidenceSeason} NFL production re-scored to this league · positional allowance · team pass/run identity · play volume · pass/rush EPA allowed · sack protection · defensive pressure/blitz profile · current schedule · Vegas total · weather · depth chart · injury · recent opportunity</span>
            </div>

            {lineupPlan.swaps.length ? (
              <div className="swap-list">
                {lineupPlan.swaps.map((swap, index) => <LineupSwapCard key={`${swap.start.playerId}-${swap.sit.playerId}`} swap={swap} rank={index + 1} />)}
              </div>
            ) : (
              <div className="lineup-clear"><strong>HOLD YOUR CURRENT LINEUP</strong><span>WAR ROOM found no evidence-backed bench swap worth at least one projected point with sufficient data.</span></div>
            )}

            <div className="starter-board-heading">
              <p className="eyebrow">CURRENT STARTER MATCHUPS</p>
              <span>{lineupPlan.supportedStarterSlots} modeled QB/RB/WR/TE slots</span>
            </div>
            <div className="starter-matchup-grid">
              {lineupPlan.starters.map((player) => {
                const offense = player.schemeContext.offense;
                const defense = player.schemeContext.defense;
                const defenseEase = player.position === "RB" ? defense?.rushDefenseEasePercentile : defense?.passDefenseEasePercentile;
                return (
                  <article className="starter-matchup-card" key={`${player.slot}-${player.playerId}`}>
                    <div className="starter-card-top">
                      <span>{player.slot}</span>
                      <div className="starter-tags">
                        <b className={`matchup-tag matchup-tag--${player.matchupLabel.toLowerCase()}`}>{player.matchupLabel}</b>
                        <b className={`scheme-tag scheme-tag--${player.schemeLabel.toLowerCase().replaceAll(" ", "-")}`}>{player.schemeLabel} {player.schemeScore.toFixed(0)}</b>
                      </div>
                    </div>
                    <h3>{player.name}</h3>
                    <p>{player.position} · {player.team}</p>
                    <strong>{player.adjustedProjection?.toFixed(1) ?? "—"}</strong>
                    <small>{player.gameNote}</small>
                    {offense && defense && (
                      <div className="scheme-grid">
                        <span><i>PASS RATE</i><b>{Math.round(offense.passRate * 100)}%</b></span>
                        <span><i>PLAYS/G</i><b>{offense.playsPerGame.toFixed(1)}</b></span>
                        <span><i>D EASE</i><b>{defenseEase?.toFixed(0) ?? "—"}</b></span>
                        <span><i>PRESSURE</i><b>{defense.pressureRate == null ? "—" : `${(defense.pressureRate * 100).toFixed(1)}%`}</b></span>
                      </div>
                    )}
                    <em>{player.confidence} confidence</em>
                  </article>
                );
              })}
            </div>
          </>
        ) : null}
      </section>

      <section className="section-block waiver-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DECISION ENGINE · WAIVERS</p>
            <h2>Your league-specific acquisition board</h2>
          </div>
          <span className="status-chip">REPLACEMENT VALUE + MARKET URGENCY</span>
        </div>

        {!sleeperUserId || !userRoster ? (
          <div className="intel-note">
            <span>!</span>
            <p>WAR ROOM needs the Sleeper manager identity used to discover this league before it can recommend a safe drop. <Link href="/connect"><strong>Reconnect the league →</strong></Link></p>
          </div>
        ) : waiverError ? (
          <div className="error-banner">The league is live, but the analytics layer could not be refreshed: {waiverError} WAR ROOM will not substitute invented projections.</div>
        ) : waiverBoard.length === 0 ? (
          <p className="empty-state">No eligible free-agent candidates could be scored from the current league and analytics feeds.</p>
        ) : (
          <>
            <div className="model-note">
              <strong>HOW THIS BOARD IS BUILT</strong>
              <span>{analyticsSeason} regular-season NFL production re-scored to this league · actual rostered/free-agent pool · your bench · 24-hour Sleeper add/drop pressure · depth-chart and rookie draft signals</span>
            </div>
            <div className="waiver-list">
              {waiverBoard.slice(0, 12).map((candidate, index) => <WaiverCard key={candidate.playerId} candidate={candidate} rank={index + 1} />)}
            </div>
          </>
        )}
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
}
