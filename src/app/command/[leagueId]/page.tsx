import Link from "next/link";
import { buildBreakoutRadar } from "@/lib/analytics/breakouts";
import { buildChampionshipImpact } from "@/lib/analytics/championship";
import { buildLineupPlan } from "@/lib/analytics/lineups";
import { attachChampionshipImpact, collectPriorityCandidates, rankPriorities, type PriorityCandidate } from "@/lib/analytics/priorities";
import { buildTradeBoard } from "@/lib/analytics/trades";
import { buildWaiverBoard, type UserRosterPlayer } from "@/lib/analytics/waivers";
import {
  loadAdvancedPassingStats,
  loadNflSchedule,
  loadPlayerIdCrosswalk,
  loadSnapCounts,
  loadWeeklyPlayerStats,
  loadWeeklyTeamStats,
} from "@/lib/nflverse/client";
import { sleeper, SleeperApiError } from "@/lib/sleeper/client";
import type { SleeperMatchup, SleeperRoster } from "@/lib/sleeper/types";

type CommandPageProps = {
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

function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) power *= 2;
  return power;
}

function estimatedPlayoffRounds(playoffTeams: number): number {
  return Math.max(1, Math.log2(nextPowerOfTwo(Math.max(2, playoffTeams))));
}

function currentOpponent(matchups: SleeperMatchup[], userRosterId: number): number | null {
  const mine = matchups.find((matchup) => matchup.roster_id === userRosterId);
  if (mine?.matchup_id == null) return null;
  return matchups.find((matchup) => matchup.matchup_id === mine.matchup_id && matchup.roster_id !== userRosterId)?.roster_id ?? null;
}

function winProbability(meanA: number, sdA: number, meanB: number, sdB: number): number {
  const combinedSd = Math.max(1, Math.sqrt(sdA ** 2 + sdB ** 2));
  const z = (meanA - meanB) / combinedSd;
  // Logistic approximation of the normal CDF; deterministic and sufficient for a dashboard probability signal.
  return Math.max(0.01, Math.min(0.99, 1 / (1 + Math.exp(-1.702 * z)))) * 100;
}

function delta(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

function typeLabel(candidate: PriorityCandidate): string {
  if (candidate.type === "WAIVER" && candidate.breakoutSignal) return "WAIVER + ALPHA";
  return candidate.type;
}

function PriorityMove({ candidate, rank }: { candidate: PriorityCandidate; rank: number }) {
  return (
    <article className={`command-priority command-priority--${rank}`}>
      <div className="command-rank">#{rank}</div>
      <div className="command-priority-main">
        <div className="command-priority-title">
          <div>
            <p className="eyebrow">{typeLabel(candidate)} · {candidate.confidence} CONFIDENCE</p>
            <h3>{candidate.title}</h3>
            <p>{candidate.summary}</p>
          </div>
          <div className="command-delta">
            <span>Δ CHAMPIONSHIP</span>
            <strong>{delta(candidate.championshipDelta)}</strong>
            <small>{candidate.horizon === "ONE_WEEK" ? "one-week impact, horizon-normalized" : "sustained roster impact"}</small>
          </div>
        </div>
        <div className="command-move-metrics">
          <div><span>MODELED GAIN</span><strong>+{candidate.weeklyGain.toFixed(1)}</strong><small>{candidate.horizon === "ONE_WEEK" ? "this week" : "pts / week"}</small></div>
          <div><span>Δ PLAYOFF</span><strong>{delta(candidate.playoffDelta)}</strong><small>paired simulation</small></div>
          <div><span>URGENCY</span><strong>{candidate.urgency.toFixed(0)}</strong><small>market + timing</small></div>
          <div><span>PRIORITY SCORE</span><strong>{candidate.priorityScore.toFixed(1)}</strong><small>tie-break intelligence</small></div>
          {candidate.breakoutSignal ? <div><span>ALPHA SCORE</span><strong>{candidate.breakoutSignal.alphaScore.toFixed(0)}</strong><small>{candidate.breakoutSignal.breakoutProbability.toFixed(0)}% breakout</small></div> : null}
        </div>
        <ul className="reason-list">{candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <Link href={candidate.href} className="connect-button command-action">Open decision evidence →</Link>
      </div>
    </article>
  );
}

async function loadCommandCenter(leagueId: string, sleeperUserId: string) {
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
    const evidenceSeason = Math.max(2020, currentSeason - 1);
    const configuredPlayoffWeek = Number(league.settings.playoff_week_start);
    const playoffWeekStart = Number.isFinite(configuredPlayoffWeek) && configuredPlayoffWeek > 0 ? Math.round(configuredPlayoffWeek) : 15;
    const matchupWeeks = Array.from({ length: Math.max(1, playoffWeekStart - state.week) }, (_, index) => state.week + index);

    const [
      crosswalk,
      baselineStats,
      baselineSnaps,
      trendingAdds,
      trendingDrops,
      teamStats,
      advancedPassing,
      schedule,
      matchupPages,
    ] = await Promise.all([
      loadPlayerIdCrosswalk(),
      loadWeeklyPlayerStats(evidenceSeason),
      loadSnapCounts(evidenceSeason).catch(() => new Map()),
      sleeper.getTrending("add", 24, 250),
      sleeper.getTrending("drop", 24, 250),
      loadWeeklyTeamStats(evidenceSeason).catch(() => []),
      loadAdvancedPassingStats(evidenceSeason).catch(() => []),
      loadNflSchedule(currentSeason).catch(() => []),
      Promise.all(matchupWeeks.map(async (week) => [week, await sleeper.getMatchups(leagueId, week).catch(() => [])] as const)),
    ]);
    const [currentStats, currentSnaps] = await Promise.all([
      loadWeeklyPlayerStats(currentSeason).catch(() => new Map()),
      loadSnapCounts(currentSeason).catch(() => new Map()),
    ]);
    const matchupsByWeek = new Map(matchupPages);
    const currentMatchups = matchupsByWeek.get(state.week) ?? [];

    const transactionWeeks = Array.from({ length: Math.max(1, state.week) }, (_, index) => index + 1);
    const transactionPages = await Promise.all(transactionWeeks.map((week) => sleeper.getTransactions(leagueId, week).catch(() => [])));
    const transactions = [...new Map(transactionPages.flat().map((transaction) => [transaction.transaction_id, transaction])).values()];

    const rosteredPlayerIds = new Set(rosters.flatMap((roster) => roster.players ?? []));
    const userPlayerIds = new Set(userRoster.players ?? []);
    const breakoutRadar = buildBreakoutRadar({
      players,
      crosswalk,
      currentStats,
      baselineStats,
      currentSnaps,
      baselineSnaps,
      trendingAdds,
      trendingDrops,
      rosteredPlayerIds,
      userPlayerIds,
      currentSeason,
    });

    const waiverBoard = buildWaiverBoard({
      leagueSize: league.total_rosters,
      scoring: league.scoring_settings,
      players,
      rosteredPlayerIds,
      userRoster: rosterPlayers(userRoster),
      crosswalk,
      historicalStats: currentStats.size >= 30 ? currentStats : baselineStats,
      trendingAdds,
      trendingDrops,
      currentSeason,
    });

    const lineupPlan = buildLineupPlan({
      roster: userRoster,
      rosterPositions: league.roster_positions,
      scoring: league.scoring_settings,
      players,
      crosswalk,
      historicalStats: currentStats.size >= 30 ? currentStats : baselineStats,
      teamStats,
      advancedPassing,
      schedule,
      season: currentSeason,
      week: state.week,
      evidenceSeason,
    });

    const tradeBoard = buildTradeBoard({
      userRosterId: userRoster.roster_id,
      rosters,
      users,
      players,
      rosterPositions: league.roster_positions,
      scoring: league.scoring_settings,
      crosswalk,
      baselineStats,
      currentStats,
      breakoutRadar,
      transactions,
      evidenceSeason,
      currentSeason,
    });

    const championshipArgs = {
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
      seed: 0x57415252,
    };

    const baselineImpact = buildChampionshipImpact({ ...championshipArgs, weeklyBoost: 0, iterations: 3000 });
    const playoffRounds = estimatedPlayoffRounds(baselineImpact.baseline.playoffTeams);
    const candidates = collectPriorityCandidates({
      lineupPlan,
      waiverBoard,
      tradeBoard,
      breakoutRadar,
      leagueId,
      sleeperUserId,
      sleeperUsername: users.find((user) => user.user_id === sleeperUserId)?.username ?? "",
      remainingRegularWeeks: baselineImpact.baseline.scheduledWeeks.length,
      estimatedPlayoffRounds: playoffRounds,
    });

    const simulated = candidates.map((candidate) => {
      const impact = buildChampionshipImpact({
        ...championshipArgs,
        weeklyBoost: candidate.simulationBoost,
        iterations: 1200,
      });
      return attachChampionshipImpact(candidate, impact);
    });
    const priorities = rankPriorities(simulated);

    const userTeam = baselineImpact.baseline.teams.find((team) => team.rosterId === userRoster.roster_id)!;
    const opponentRosterId = currentOpponent(currentMatchups, userRoster.roster_id);
    const opponentTeam = opponentRosterId == null ? null : baselineImpact.baseline.teams.find((team) => team.rosterId === opponentRosterId) ?? null;
    const thisWeekWinProbability = opponentTeam
      ? winProbability(userTeam.projectedMean, userTeam.projectedSd, opponentTeam.projectedMean, opponentTeam.projectedSd)
      : null;

    return {
      ok: true as const,
      league,
      state,
      userRoster,
      userTeam,
      opponentTeam,
      thisWeekWinProbability,
      baselineImpact,
      priorities,
      breakoutRadar,
      waiverBoard,
      lineupPlan,
      tradeBoard,
    };
  } catch (error) {
    const message = error instanceof SleeperApiError
      ? `Sleeper returned ${error.status}; Mission Control could not refresh.`
      : error instanceof Error
        ? error.message
        : "Decision intelligence is temporarily unavailable.";
    return { ok: false as const, message };
  }
}

export default async function CommandLeaguePage({ params, searchParams }: CommandPageProps) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const sleeperUserId = query.sleeperUserId?.trim();
  const sleeperUsername = query.sleeperUsername?.trim() ?? "";

  if (!sleeperUserId) {
    return <div className="page-wrap"><div className="error-banner">WAR ROOM needs your Sleeper identity to rank decisions for your roster.</div><Link href="/command" className="connect-button">Connect Mission Control</Link></div>;
  }

  const result = await loadCommandCenter(leagueId, sleeperUserId);
  if (!result.ok) {
    return <div className="page-wrap"><div className="error-banner">{result.message} WAR ROOM will not fabricate a priority ranking.</div><Link href="/command" className="connect-button">Back to Mission Control</Link></div>;
  }

  const top = result.priorities.slice(0, 3);
  const actionableBreakouts = result.breakoutRadar.filter((candidate) => candidate.ownership === "AVAILABLE" && ["ADD NOW", "STASH"].includes(candidate.action));
  const urgent = result.priorities.filter((candidate) => candidate.urgency >= 75).length;
  const queryString = new URLSearchParams({ sleeperUserId, sleeperUsername }).toString();

  return (
    <div className="page-wrap">
      <section className="hero-panel command-hero command-hero--live">
        <div>
          <p className="eyebrow">MISSION CONTROL · {result.league.name}</p>
          <h1>The three moves that matter most right now.</h1>
          <p className="lede">{sleeperUsername || result.userTeam.managerName} · Week {result.state.week}. WAR ROOM scanned your lineup, available-player pool, breakout signals, every tradeable roster and the remaining season, then ranked quantified moves by championship impact.</p>
        </div>
        <div className="hero-cta">
          <span className="status-chip">{result.baselineImpact.baseline.iterations.toLocaleString()} BASELINE SIMS</span>
          <Link href={`/championship/${leagueId}?${queryString}`} className="connect-button">Full Championship Engine →</Link>
          <Link href="/command" className="status-chip">Switch league</Link>
        </div>
      </section>

      <section className="metric-grid command-summary">
        <article className="metric-card metric-card--positive"><p className="eyebrow">CHAMPIONSHIP</p><strong className="metric-value">{result.userTeam.championshipProbability.toFixed(1)}%</strong><p className="metric-detail">Current modeled title probability</p></article>
        <article className="metric-card"><p className="eyebrow">THIS WEEK WIN</p><strong className="metric-value">{result.thisWeekWinProbability == null ? "—" : `${result.thisWeekWinProbability.toFixed(0)}%`}</strong><p className="metric-detail">{result.opponentTeam ? `vs ${result.opponentTeam.teamName}` : "Current opponent unavailable"}</p></article>
        <article className="metric-card"><p className="eyebrow">ALPHA OPPORTUNITIES</p><strong className="metric-value">{actionableBreakouts.length}</strong><p className="metric-detail">Available ADD NOW / STASH signals</p></article>
        <article className="metric-card"><p className="eyebrow">URGENT DECISIONS</p><strong className="metric-value">{urgent}</strong><p className="metric-detail">Priority actions with urgency ≥75</p></article>
      </section>

      <section className="section-block command-priority-section">
        <div className="section-heading">
          <div><p className="eyebrow">WAR ROOM PRIORITIES</p><h2>Ranked by Δ Championship Probability</h2></div>
          <span className="status-chip">LINEUP + WAIVERS + ALPHA + TRADES</span>
        </div>
        <div className="command-model-note">
          <strong>DECISION PRIORITY ENGINE v1</strong>
          <span>Sustained roster changes are simulated as weekly scoring changes. One-week start/sit gains are horizon-normalized before entering Championship Simulation so a single lineup decision is not falsely treated as permanent.</span>
        </div>
        {top.length ? <div className="command-priority-list">{top.map((candidate, index) => <PriorityMove key={candidate.id} candidate={candidate} rank={index + 1} />)}</div> : <div className="lineup-clear"><strong>NO QUANTIFIED UPGRADE FOUND</strong><span>WAR ROOM found no current lineup, waiver or trade action with a positive modeled roster gain and sufficient evidence.</span></div>}
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">DECISION MATRIX</p><h2>Everything that survived the first screening</h2></div><span className="status-chip">SIMULATED CANDIDATES</span></div>
        <div className="command-table-wrap">
          <table className="command-table">
            <thead><tr><th>Rank</th><th>Decision</th><th>Type</th><th>Gain</th><th>Δ Champ</th><th>Δ Playoff</th><th>Confidence</th><th>Urgency</th></tr></thead>
            <tbody>{result.priorities.map((candidate, index) => (
              <tr key={candidate.id}>
                <td>#{index + 1}</td>
                <td><Link href={candidate.href}><strong>{candidate.title}</strong></Link><small>{candidate.summary}</small></td>
                <td>{typeLabel(candidate)}</td>
                <td>+{candidate.weeklyGain.toFixed(1)}</td>
                <td className={(candidate.championshipDelta ?? 0) > 0 ? "command-positive" : ""}>{delta(candidate.championshipDelta)}</td>
                <td>{delta(candidate.playoffDelta)}</td>
                <td>{candidate.confidence}</td>
                <td>{candidate.urgency.toFixed(0)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="two-column">
        <div className="section-block">
          <div className="section-heading"><div><p className="eyebrow">SOURCE ENGINES</p><h2>Decision inventory</h2></div></div>
          <div className="pipeline-list">
            <div className="pipeline-row"><span>Lineup swaps</span><strong>{result.lineupPlan.swaps.length}</strong></div>
            <div className="pipeline-row"><span>Positive waiver upgrades</span><strong>{result.waiverBoard.filter((candidate) => (candidate.netRosterGain ?? 0) > 0).length}</strong></div>
            <div className="pipeline-row"><span>Available alpha signals</span><strong>{actionableBreakouts.length}</strong></div>
            <div className="pipeline-row"><span>Trade proposals</span><strong>{result.tradeBoard.proposals.length}</strong></div>
          </div>
        </div>
        <div className="section-block">
          <div className="section-heading"><div><p className="eyebrow">MODEL DISCIPLINE</p><h2>Priority does not mean certainty</h2></div><span className="status-chip">DECISION SUPPORT</span></div>
          <div className="intel-note"><span>i</span><p>Δ Championship Probability compares modeled season paths, not guaranteed outcomes. Trade acceptance remains uncertain, waiver acquisition is not guaranteed, and one-week lineup impact is horizon-normalized because the current Championship Engine&apos;s scenario input is sustained. WAR ROOM ranks only quantified moves; unquantified hype cannot outrank a simulated improvement.</p></div>
        </div>
      </section>
    </div>
  );
}
