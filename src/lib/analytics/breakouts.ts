import type { PlayerIdCrosswalk, SnapCountStat, WeeklyPlayerStat } from "@/lib/nflverse/client";
import type { SleeperPlayer, SleeperTrendingPlayer } from "@/lib/sleeper/types";

export type BreakoutCandidate = {
  playerId: string;
  name: string;
  position: string;
  team: string;
  ownership: "AVAILABLE" | "YOUR ROSTER" | "ROSTERED";
  breakoutProbability: number;
  alphaScore: number;
  marketAwareness: number;
  signalStrength: number;
  recentSnapPct: number | null;
  baselineSnapPct: number | null;
  snapDelta: number | null;
  recentTargets: number;
  recentCarries: number;
  recentTargetShare: number;
  opportunityDelta: number;
  targetShareDelta: number;
  currentSeasonGames: number;
  addCount: number;
  dropCount: number;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "SPECULATIVE";
  action: "ADD NOW" | "STASH" | "HOLD" | "TRADE TARGET" | "WATCH";
  reasons: string[];
};

type BuildBreakoutRadarArgs = {
  players: Record<string, SleeperPlayer>;
  crosswalk: Map<string, PlayerIdCrosswalk>;
  currentStats: Map<string, WeeklyPlayerStat[]>;
  baselineStats: Map<string, WeeklyPlayerStat[]>;
  currentSnaps: Map<string, SnapCountStat[]>;
  baselineSnaps: Map<string, SnapCountStat[]>;
  trendingAdds: SleeperTrendingPlayer[];
  trendingDrops: SleeperTrendingPlayer[];
  rosteredPlayerIds: Set<string>;
  userPlayerIds: Set<string>;
  currentSeason: number;
};

const SKILL_POSITIONS = new Set(["RB", "WR", "TE"]);
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function recentAndBaseline<T>(current: T[], baseline: T[], recentCount = 3): { recent: T[]; prior: T[]; currentGames: number } {
  if (current.length) {
    return {
      recent: current.slice(-recentCount),
      prior: baseline.slice(-6),
      currentGames: current.length,
    };
  }
  const recent = baseline.slice(-recentCount);
  const prior = baseline.slice(Math.max(0, baseline.length - recentCount - 5), Math.max(0, baseline.length - recentCount));
  return { recent, prior, currentGames: 0 };
}

function depthRoleScore(player: SleeperPlayer, crosswalk: PlayerIdCrosswalk | undefined, currentSeason: number): number {
  let score = 45;
  const depth = player.depth_chart_position ?? player.depth_chart_order;
  if (depth === 1) score += 34;
  else if (depth === 2) score += 20;
  else if (depth === 3) score += 7;
  else if (depth != null && depth >= 5) score -= 16;

  if ((player.status ?? "").toLowerCase() === "active") score += 6;
  const injury = `${player.injury_status ?? ""} ${player.status ?? ""}`.toLowerCase();
  if (injury.includes("out") || injury.includes("reserve") || injury.includes("ir")) score -= 55;
  else if (injury.includes("doubt")) score -= 30;
  else if (injury.includes("question")) score -= 10;

  if (crosswalk?.draftYear === currentSeason) {
    if (crosswalk.draftRound === 1) score += 18;
    else if (crosswalk.draftRound === 2) score += 13;
    else if (crosswalk.draftRound === 3) score += 8;
    else if (crosswalk.draftRound != null && crosswalk.draftRound <= 5) score += 4;
  }
  return clamp(score);
}

function rookieSignal(crosswalk: PlayerIdCrosswalk | undefined, currentSeason: number): number {
  if (crosswalk?.draftYear !== currentSeason) return 35;
  if (crosswalk.draftRound === 1) return 100;
  if (crosswalk.draftRound === 2) return 88;
  if (crosswalk.draftRound === 3) return 75;
  if (crosswalk.draftRound != null && crosswalk.draftRound <= 5) return 58;
  return 48;
}

function marketAwareness(adds: number, drops: number, maxAdds: number, maxDrops: number): number {
  const addSignal = maxAdds > 0 ? Math.log1p(adds) / Math.log1p(maxAdds) : 0;
  const dropSignal = maxDrops > 0 ? Math.log1p(drops) / Math.log1p(maxDrops) : 0;
  return clamp(addSignal * 100 - dropSignal * 25);
}

function nameFor(playerId: string, player: SleeperPlayer, crosswalk: PlayerIdCrosswalk | undefined): string {
  return player.full_name || [player.first_name, player.last_name].filter(Boolean).join(" ") || crosswalk?.name || playerId;
}

function ownershipFor(playerId: string, rostered: Set<string>, user: Set<string>): BreakoutCandidate["ownership"] {
  if (user.has(playerId)) return "YOUR ROSTER";
  if (rostered.has(playerId)) return "ROSTERED";
  return "AVAILABLE";
}

export function buildBreakoutRadar(args: BuildBreakoutRadarArgs): BreakoutCandidate[] {
  const addMap = new Map(args.trendingAdds.map((item) => [item.player_id, item.count]));
  const dropMap = new Map(args.trendingDrops.map((item) => [item.player_id, item.count]));
  const maxAdds = Math.max(0, ...args.trendingAdds.map((item) => item.count));
  const maxDrops = Math.max(0, ...args.trendingDrops.map((item) => item.count));
  const candidates: BreakoutCandidate[] = [];

  for (const [playerId, player] of Object.entries(args.players)) {
    const crosswalk = args.crosswalk.get(playerId);
    const position = player.position || crosswalk?.position || "";
    if (!SKILL_POSITIONS.has(position) || !player.team) continue;

    const currentPlayerStats = crosswalk?.gsisId ? args.currentStats.get(crosswalk.gsisId) ?? [] : [];
    const baselinePlayerStats = crosswalk?.gsisId ? args.baselineStats.get(crosswalk.gsisId) ?? [] : [];
    const currentPlayerSnaps = crosswalk?.pfrId ? args.currentSnaps.get(crosswalk.pfrId) ?? [] : [];
    const baselinePlayerSnaps = crosswalk?.pfrId ? args.baselineSnaps.get(crosswalk.pfrId) ?? [] : [];
    const statWindows = recentAndBaseline(currentPlayerStats, baselinePlayerStats);
    const snapWindows = recentAndBaseline(currentPlayerSnaps, baselinePlayerSnaps);

    const recentTargets = average(statWindows.recent.map((stat) => stat.targets));
    const priorTargets = average(statWindows.prior.map((stat) => stat.targets));
    const recentCarries = average(statWindows.recent.map((stat) => stat.carries));
    const priorCarries = average(statWindows.prior.map((stat) => stat.carries));
    const recentTargetShare = average(statWindows.recent.map((stat) => stat.targetShare).filter((value) => value > 0));
    const priorTargetShare = average(statWindows.prior.map((stat) => stat.targetShare).filter((value) => value > 0));
    const recentSnapPct = snapWindows.recent.length ? average(snapWindows.recent.map((snap) => snap.offensePct)) : null;
    const baselineSnapPct = snapWindows.prior.length ? average(snapWindows.prior.map((snap) => snap.offensePct)) : null;
    const snapDelta = recentSnapPct != null && baselineSnapPct != null ? recentSnapPct - baselineSnapPct : null;
    const opportunityDelta = (recentTargets + recentCarries) - (priorTargets + priorCarries);
    const targetShareDelta = recentTargetShare - priorTargetShare;

    const adds = addMap.get(playerId) ?? 0;
    const drops = dropMap.get(playerId) ?? 0;
    const awareness = marketAwareness(adds, drops, maxAdds, maxDrops);
    const role = depthRoleScore(player, crosswalk, args.currentSeason);
    const rookie = rookieSignal(crosswalk, args.currentSeason);
    const snapLevel = recentSnapPct == null ? 45 : clamp(recentSnapPct * 100);
    const momentum = clamp(
      50 +
      (snapDelta ?? 0) * 135 +
      opportunityDelta * 4.2 +
      targetShareDelta * 150,
    );

    const establishedBaselineOpportunity = priorTargets + priorCarries;
    let establishedPenalty = 0;
    if ((baselineSnapPct ?? 0) >= 0.76 && establishedBaselineOpportunity >= 10) establishedPenalty = 28;
    else if ((baselineSnapPct ?? 0) >= 0.66 && establishedBaselineOpportunity >= 7) establishedPenalty = 17;
    else if ((baselineSnapPct ?? 0) >= 0.58 && establishedBaselineOpportunity >= 5) establishedPenalty = 9;

    let breakout = momentum * 0.36 + role * 0.22 + snapLevel * 0.16 + awareness * 0.12 + rookie * 0.14 - establishedPenalty;
    if (!statWindows.currentGames && !currentPlayerSnaps.length) breakout = Math.min(breakout, 78);
    breakout = clamp(breakout);

    const ownership = ownershipFor(playerId, args.rosteredPlayerIds, args.userPlayerIds);
    const acquisitionBonus = ownership === "AVAILABLE" ? 100 : ownership === "YOUR ROSTER" ? 70 : 35;
    const marketIgnorance = 100 - awareness;
    const alpha = clamp(breakout * 0.68 + marketIgnorance * 0.20 + acquisitionBonus * 0.12);
    const evidenceGames = Math.max(statWindows.currentGames, currentPlayerSnaps.length);
    const signalStrength = clamp(momentum * 0.55 + role * 0.25 + snapLevel * 0.20);

    const depth = player.depth_chart_position ?? player.depth_chart_order;
    const hasSignal =
      breakout >= 48 ||
      adds > 0 ||
      (snapDelta != null && snapDelta >= 0.08) ||
      opportunityDelta >= 2 ||
      targetShareDelta >= 0.04 ||
      depth === 1 ||
      crosswalk?.draftYear === args.currentSeason;
    if (!hasSignal) continue;

    const confidence: BreakoutCandidate["confidence"] = evidenceGames >= 3
      ? "HIGH"
      : evidenceGames === 2
        ? "MEDIUM"
        : evidenceGames === 1
          ? "LOW"
          : "SPECULATIVE";

    let action: BreakoutCandidate["action"];
    if (ownership === "AVAILABLE" && breakout >= 72 && alpha >= 68) action = "ADD NOW";
    else if (ownership === "AVAILABLE" && breakout >= 58) action = "STASH";
    else if (ownership === "YOUR ROSTER" && breakout >= 60) action = "HOLD";
    else if (ownership === "ROSTERED" && breakout >= 70 && alpha >= 62) action = "TRADE TARGET";
    else action = "WATCH";

    const reasons: string[] = [];
    if (snapDelta != null && snapDelta >= 0.08) reasons.push(`Offensive snap share is up ${round(snapDelta * 100)} percentage points versus the comparison window.`);
    if (opportunityDelta >= 2) reasons.push(`Targets + carries increased by ${round(opportunityDelta)} opportunities per game.`);
    if (targetShareDelta >= 0.04) reasons.push(`Target share increased by ${round(targetShareDelta * 100)} percentage points.`);
    if (recentSnapPct != null && recentSnapPct >= 0.70) reasons.push(`Recent offensive snap share is ${round(recentSnapPct * 100)}%, confirming meaningful playing time.`);
    if (depth === 1) reasons.push("Sleeper currently lists the player first on the depth chart.");
    if (crosswalk?.draftYear === args.currentSeason && (crosswalk.draftRound ?? 99) <= 3) reasons.push(`Day ${crosswalk.draftRound === 1 ? "1" : "2"} rookie draft capital raises the probability of an expanding role.`);
    if (adds > 0 && awareness >= 55) reasons.push(`${adds.toLocaleString()} Sleeper adds signal that the market is beginning to notice.`);
    if (awareness <= 30 && breakout >= 60) reasons.push("Market awareness remains low relative to the underlying breakout score—potential early alpha.");
    if (!evidenceGames) reasons.push("No current-season game sample is available yet, so the signal relies on prior usage, current depth-chart role, rookie capital and live market behavior.");
    if (!reasons.length) reasons.push("Composite signal combines role, snap participation, opportunity, target share and market behavior.");

    candidates.push({
      playerId,
      name: nameFor(playerId, player, crosswalk),
      position,
      team: player.team,
      ownership,
      breakoutProbability: round(breakout),
      alphaScore: round(alpha),
      marketAwareness: round(awareness),
      signalStrength: round(signalStrength),
      recentSnapPct: recentSnapPct == null ? null : round(recentSnapPct * 100),
      baselineSnapPct: baselineSnapPct == null ? null : round(baselineSnapPct * 100),
      snapDelta: snapDelta == null ? null : round(snapDelta * 100),
      recentTargets: round(recentTargets),
      recentCarries: round(recentCarries),
      recentTargetShare: round(recentTargetShare * 100),
      opportunityDelta: round(opportunityDelta),
      targetShareDelta: round(targetShareDelta * 100),
      currentSeasonGames: evidenceGames,
      addCount: adds,
      dropCount: drops,
      confidence,
      action,
      reasons,
    });
  }

  return candidates
    .sort((a, b) => {
      const actionWeight = (candidate: BreakoutCandidate) => candidate.action === "ADD NOW" ? 30 : candidate.action === "STASH" ? 20 : candidate.action === "TRADE TARGET" ? 15 : candidate.action === "HOLD" ? 10 : 0;
      return (b.alphaScore + actionWeight(b)) - (a.alphaScore + actionWeight(a));
    })
    .slice(0, 30);
}
