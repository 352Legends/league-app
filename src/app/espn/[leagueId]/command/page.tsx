import Link from "next/link";
import { buildBreakoutRadar } from "@/lib/analytics/breakouts";
import { buildChampionshipImpact } from "@/lib/analytics/championship";
import { buildLineupPlan } from "@/lib/analytics/lineups";
import { attachChampionshipImpact, collectPriorityCandidates, rankPriorities, type PriorityCandidate } from "@/lib/analytics/priorities";
import { buildTradeBoard } from "@/lib/analytics/trades";
import { buildWaiverBoard, type UserRosterPlayer } from "@/lib/analytics/waivers";
import { espn, EspnApiError } from "@/lib/espn/client";
import { getEspnMatchupsByWeek } from "@/lib/espn/schedule";
import { readEspnCredentials } from "@/lib/espn/session";
import {
  loadAdvancedPassingStats,
  loadNflSchedule,
  loadSnapCounts,
  loadWeeklyPlayerStats,
  loadWeeklyTeamStats,
} from "@/lib/nflverse/client";
import { loadProviderPlayerIdCrosswalk } from "@/lib/nflverse/provider-crosswalk";
import type { SleeperMatchup, SleeperRoster } from "@/lib/sleeper/types";

type PageProps = {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ season?: string; teamId?: string }>;
};

function rosterPlayers(roster: SleeperRoster): UserRosterPlayer[] {
  const starters = new Set(roster.starters ?? []);
  const reserve = new Set(roster.reserve ?? []);
  return (roster.players ?? []).map((playerId) => ({
    playerId,
    status: starters.has(playerId) ? "starter" : reserve.has(playerId) ? "ir" : "bench",
  }));
}

function currentOpponent(matchups: SleeperMatchup[], userRosterId: number): number | null {
  const mine = matchups.find((matchup) => matchup.roster_id === userRosterId);
  if (mine?.matchup_id == null) return null;
  return matchups.find((matchup) => matchup.matchup_id === mine.matchup_id && matchup.roster_id !== userRosterId)?.roster_id ?? null;
}

function winProbability(meanA: number, sdA: number, meanB: number, sdB: number): number {
  const combinedSd = Math.max(1, Math.sqrt(sdA ** 2 + sdB ** 2));
  const z = (meanA - meanB) / combinedSd;
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

export default async function EspnMissionControlPage({ params, searchParams }: PageProps) {
  const [{ leagueId }, query, credentials] = await Promise.all([params, searchParams, readEspnCredentials()]);
  const season = Number(query.season ?? new Date().getFullYear());
  const teamId = Number(query.teamId);
  if (!Number.isInteger(teamId)) {
    return <div className="page-wrap"><div className="error-banner">Choose your ESPN team before opening Mission Control.</div><Link href={`/espn/${leagueId}?season=${season}`} className="connect-button">Choose team</Link></div>;
  }

  try {
    const base = await espn.validateLeague(leagueId, season, credentials);
    const userRoster = base.rosters.find((roster) => roster.roster_id === teamId);
    if (!userRoster) return <div className="page-wrap"><div className="error-banner">WAR ROOM could not match ESPN team {teamId} to this league.</div><Link href={`/espn/${leagueId}?season=${season}`} className="connect-button">Choose team</Link></div>;

    const currentSeason = season;
    const evidenceSeason = Math.max(2020, currentSeason - 1);
    const playoffWeekStart = Number(base.league.settings.playoff_week_start ?? 15);
    const matchupWeeks = Array.from({ length: Math.max(1, playoffWeekStart - base.state.week) }, (_, index) => base.state.week + index);

    const [
      players,
      crosswalk,
      baselineStats,
      baselineSnaps,
      currentStats,
      currentSnaps,
      teamStats,
      advancedPassing,
      schedule,
      matchupsByWeek,
    ] = await Promise.all([
      espn.getActivePlayers(leagueId, season, credentials),
      loadProviderPlayerIdCrosswalk("espn"),
      loadWeeklyPlayerStats(evidenceSeason),
      loadSnapCounts(evidenceSeason).catch(() => new Map()),
      loadWeeklyPlayerStats(currentSeason).catch(() => new Map()),
      loadSnapCounts(currentSeason).catch(() => new Map()),
      loadWeeklyTeamStats(evidenceSeason).catch(() => []),
      loadAdvancedPassingStats(evidenceSeason).catch(() => []),
      loadNflSchedule(currentSeason).catch(() => []),
      getEspnMatchupsByWeek({ leagueId, season, weeks: matchupWeeks, rosters: base.rosters, credentials }),
    ]);

    const currentMatchups = matchupsByWeek.get(base.state.week) ?? [];
    const rosteredPlayerIds = new Set(base.rosters.flatMap((roster) => roster.players ?? []));
    const userPlayerIds = new Set(userRoster.players ?? []);
    const breakoutRadar = buildBreakoutRadar({
      players,
      crosswalk,
      currentStats,
      baselineStats,
      currentSnaps,
      baselineSnaps,
      trendingAdds: [],
      trendingDrops: [],
      rosteredPlayerIds,
      userPlayerIds,
      currentSeason,
    });

    const waiverBoard = buildWaiverBoard({
      leagueSize: base.league.total_rosters,
      scoring: base.league.scoring_settings,
      players,
      rosteredPlayerIds,
      userRoster: rosterPlayers(userRoster),
      crosswalk,
      historicalStats: currentStats.size >= 30 ? currentStats : baselineStats,
      trendingAdds: [],
      trendingDrops: [],
      currentSeason,
    });

    const lineupPlan = buildLineupPlan({
      roster: userRoster,
      rosterPositions: base.league.roster_positions,
      scoring: base.league.scoring_settings,
      players,
      crosswalk,
      historicalStats: currentStats.size >= 30 ? currentStats : baselineStats,
      teamStats,
      advancedPassing,
      schedule,
      season: currentSeason,
      week: base.state.week,
      evidenceSeason,
    });

    const tradeBoard = buildTradeBoard({
      userRosterId: userRoster.roster_id,
      rosters: base.rosters,
      users: base.users,
      players,
      rosterPositions: base.league.roster_positions,
      scoring: base.league.scoring_settings,
      crosswalk,
      baselineStats,
      currentStats,
      breakoutRadar,
      transactions: [],
      evidenceSeason,
      currentSeason,
    });

    const championshipArgs = {
      rosters: base.rosters,
      users: base.users,
      players,
      rosterPositions: base.league.roster_positions,
      scoring: base.league.scoring_settings,
      leagueSettings: base.league.settings,
      crosswalk,
      baselineStats,
      currentStats,
      matchupsByWeek,
      currentWeek: base.state.week,
      userRosterId: userRoster.roster_id,
      seed: 0x4553504e,
    };

    const baselineImpact = buildChampionshipImpact({ ...championshipArgs, weeklyBoost: 0, iterations: 3000 });
    const owner = base.users.find((user) => user.user_id === userRoster.owner_id);
    const sourcePath = `/espn/${leagueId}?season=${season}&teamId=${teamId}`;
    const candidates = collectPriorityCandidates({
      lineupPlan,
      waiverBoard,
      tradeBoard,
      breakoutRadar,
      leagueId,
      sleeperUserId: String(teamId),
      sleeperUsername: owner?.display_name ?? owner?.username ?? `ESPN Team ${teamId}`,
    }).map((candidate) => ({
      ...candidate,
      href: candidate.type === "WAIVER" ? `${sourcePath}#waivers` : sourcePath,
    }));

    const priorities = rankPriorities(candidates.map((candidate) => {
      const impact = buildChampionshipImpact({
        ...championshipArgs,
        weeklyBoost: candidate.simulationBoost,
        scenarioHorizon: candidate.horizon === "ONE_WEEK" ? "CURRENT_WEEK" : "SUSTAINED",
        iterations: 1200,
      });
      return attachChampionshipImpact(candidate, impact);
    }));

    const userTeam = baselineImpact.baseline.teams.find((team) => team.rosterId === userRoster.roster_id);
    if (!userTeam) throw new Error("ESPN roster could not be included in championship simulation.");
    const opponentRosterId = currentOpponent(currentMatchups, userRoster.roster_id);
    const opponentTeam = opponentRosterId == null ? null : baselineImpact.baseline.teams.find((team) => team.rosterId === opponentRosterId) ?? null;
    const thisWeekWin = opponentTeam ? winProbability(userTeam.projectedMean, userTeam.projectedSd, opponentTeam.projectedMean, opponentTeam.projectedSd) : null;
    const actionableBreakouts = breakoutRadar.filter((candidate) => candidate.ownership === "AVAILABLE" && ["ADD NOW", "STASH"].includes(candidate.action));
    const urgent = priorities.filter((candidate) => candidate.urgency >= 75).length;
    const top = priorities.slice(0, 3);

    return (
      <div className="page-wrap">
        <section className="hero-panel command-hero command-hero--live">
          <div>
            <p className="eyebrow">ESPN · MISSION CONTROL · {base.league.name}</p>
            <h1>The three ESPN moves that matter most right now.</h1>
            <p className="lede">Week {base.state.week}. WAR ROOM normalized ESPN scoring, rosters and schedule into the same NFL evidence and Monte Carlo decision stack used by the championship model.</p>
          </div>
          <div className="hero-cta">
            <span className="status-chip">{baselineImpact.baseline.iterations.toLocaleString()} BASELINE SIMS</span>
            <Link href={sourcePath} className="connect-button">Open ESPN decision room →</Link>
            <Link href="/saved" className="status-chip">Saved leagues</Link>
          </div>
        </section>

        <section className="metric-grid command-summary">
          <article className="metric-card metric-card--positive"><p className="eyebrow">CHAMPIONSHIP</p><strong className="metric-value">{userTeam.championshipProbability.toFixed(1)}%</strong><p className="metric-detail">ESPN league-specific title probability</p></article>
          <article className="metric-card"><p className="eyebrow">THIS WEEK WIN</p><strong className="metric-value">{thisWeekWin == null ? "—" : `${thisWeekWin.toFixed(0)}%`}</strong><p className="metric-detail">{opponentTeam ? `vs ${opponentTeam.teamName}` : "Current matchup unavailable"}</p></article>
          <article className="metric-card"><p className="eyebrow">ALPHA OPPORTUNITIES</p><strong className="metric-value">{actionableBreakouts.length}</strong><p className="metric-detail">NFL evidence; ESPN market factor neutral</p></article>
          <article className="metric-card"><p className="eyebrow">URGENT DECISIONS</p><strong className="metric-value">{urgent}</strong><p className="metric-detail">Priority actions with urgency ≥75</p></article>
        </section>

        <section className="section-block command-priority-section">
          <div className="section-heading"><div><p className="eyebrow">WAR ROOM PRIORITIES · ESPN</p><h2>Ranked by Δ Championship Probability</h2></div><span className="status-chip">LINEUP + WAIVERS + ALPHA + TRADES</span></div>
          <div className="command-model-note"><strong>PROVIDER-NORMALIZED</strong><span>ESPN supplies league rules, rosters, standings and schedule. Canonical NFL evidence supplies player performance and matchup modeling. Missing ESPN market/activity signals are left neutral rather than copied from another provider.</span></div>
          {top.length ? <div className="command-priority-list">{top.map((candidate, index) => (
            <article className={`command-priority command-priority--${index + 1}`} key={candidate.id}>
              <div className="command-rank">#{index + 1}</div>
              <div className="command-priority-main">
                <div className="command-priority-title"><div><p className="eyebrow">{typeLabel(candidate)} · {candidate.confidence} CONFIDENCE</p><h3>{candidate.title}</h3><p>{candidate.summary}</p></div><div className="command-delta"><span>Δ CHAMPIONSHIP</span><strong>{delta(candidate.championshipDelta)}</strong><small>{candidate.horizon === "ONE_WEEK" ? "current-week only" : "sustained impact"}</small></div></div>
                <div className="command-move-metrics"><div><span>MODELED GAIN</span><strong>+{candidate.weeklyGain.toFixed(1)}</strong><small>{candidate.horizon === "ONE_WEEK" ? "this week" : "pts / week"}</small></div><div><span>Δ PLAYOFF</span><strong>{delta(candidate.playoffDelta)}</strong><small>paired simulation</small></div><div><span>URGENCY</span><strong>{candidate.urgency.toFixed(0)}</strong><small>timing signal</small></div><div><span>PRIORITY SCORE</span><strong>{candidate.priorityScore.toFixed(1)}</strong><small>cross-decision rank</small></div></div>
                <ul className="reason-list">{candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                <Link href={candidate.href} className="connect-button command-action">Open decision evidence →</Link>
              </div>
            </article>
          ))}</div> : <div className="lineup-clear"><strong>NO QUANTIFIED UPGRADE FOUND</strong><span>No ESPN lineup, waiver or trade action cleared the positive-value evidence threshold.</span></div>}
        </section>

        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">DECISION INVENTORY</p><h2>What ESPN Mission Control evaluated</h2></div><span className="status-chip">NORMALIZED PROVIDER DATA</span></div>
          <div className="pipeline-list">
            <div className="pipeline-row"><span>Lineup swaps</span><strong>{lineupPlan.swaps.length}</strong></div>
            <div className="pipeline-row"><span>Positive waiver upgrades</span><strong>{waiverBoard.filter((candidate) => (candidate.netRosterGain ?? 0) > 0).length}</strong></div>
            <div className="pipeline-row"><span>Available Alpha signals</span><strong>{actionableBreakouts.length}</strong></div>
            <div className="pipeline-row"><span>Trade proposals</span><strong>{tradeBoard.proposals.length}</strong></div>
            <div className="pipeline-row"><span>Schedule weeks supplied to simulation</span><strong>{baselineImpact.baseline.scheduledWeeks.length}</strong></div>
          </div>
        </section>

        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">MODEL DISCIPLINE</p><h2>ESPN parity without fake parity.</h2></div></div>
          <div className="intel-note"><span>i</span><p>ESPN does not expose every Sleeper signal WAR ROOM uses, especially a public add/drop trend feed and the same transaction-history shape. Those dimensions remain neutral or lower-confidence. Championship impact still uses ESPN league settings, rosters and schedule plus canonical NFL evidence; it does not substitute Sleeper league behavior into an ESPN league.</p></div>
        </section>
      </div>
    );
  } catch (error) {
    const message = error instanceof EspnApiError ? error.message : error instanceof Error ? error.message : "ESPN Mission Control failed.";
    return <div className="page-wrap"><div className="error-banner">{message} WAR ROOM will not fabricate ESPN recommendations.</div><Link href={`/espn/${leagueId}?season=${season}&teamId=${teamId}`} className="connect-button">Back to ESPN league</Link></div>;
  }
}
