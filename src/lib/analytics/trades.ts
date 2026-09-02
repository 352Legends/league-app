import type { BreakoutCandidate } from "@/lib/analytics/breakouts";
import { projectPlayer, type PlayerProjection } from "@/lib/analytics/waivers";
import type { PlayerIdCrosswalk, WeeklyPlayerStat } from "@/lib/nflverse/client";
import type { SleeperLeagueUser, SleeperPlayer, SleeperRoster, SleeperTransaction } from "@/lib/sleeper/types";

export type TradePlayerValue = {
  playerId: string;
  name: string;
  position: string;
  team: string;
  rosterId: number;
  ownerName: string;
  currentStarter: boolean;
  projection: PlayerProjection;
  replacementBaseline: number | null;
  valueOverReplacement: number | null;
  fairValue: number;
  breakoutProbability: number;
  alphaScore: number;
  roleScore: number;
  reasons: string[];
};

export type ManagerTradeProfile = {
  rosterId: number;
  managerName: string;
  completedTrades: number;
  activityScore: number;
  strongestPositions: string[];
  weakestPositions: string[];
  surplusPositions: string[];
};

export type TradeProposal = {
  target: TradePlayerValue;
  give: TradePlayerValue[];
  opponentRosterId: number;
  opponentName: string;
  packageType: "1 FOR 1" | "2 FOR 1";
  targetScore: number;
  acceptanceFit: number;
  fairnessScore: number;
  projectedStarterGain: number;
  outgoingLineupCost: number;
  netLineupGain: number;
  opponentNeedFit: number;
  opponentTradeActivity: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
};

export type TradeBoard = {
  proposals: TradeProposal[];
  userNeeds: Array<{ position: string; score: number }>;
  userSurpluses: string[];
  managers: ManagerTradeProfile[];
  evidenceSeason: number;
  currentSeason: number;
};

type BuildTradeBoardArgs = {
  userRosterId: number;
  rosters: SleeperRoster[];
  users: SleeperLeagueUser[];
  players: Record<string, SleeperPlayer>;
  rosterPositions: string[];
  scoring: Record<string, number>;
  crosswalk: Map<string, PlayerIdCrosswalk>;
  baselineStats: Map<string, WeeklyPlayerStat[]>;
  currentStats: Map<string, WeeklyPlayerStat[]>;
  breakoutRadar: BreakoutCandidate[];
  transactions: SleeperTransaction[];
  evidenceSeason: number;
  currentSeason: number;
};

const CORE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type CorePosition = (typeof CORE_POSITIONS)[number];
const CORE_SET = new Set<string>(CORE_POSITIONS);
const NON_STARTER_SLOTS = new Set(["BN", "IR", "TAXI"]);
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

function percentile(value: number, values: number[]): number {
  if (values.length <= 1) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((candidate) => candidate < value).length;
  return clamp((below / (sorted.length - 1)) * 100);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function playerName(playerId: string, player: SleeperPlayer | undefined, crosswalk: PlayerIdCrosswalk | undefined): string {
  return player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || crosswalk?.name || playerId;
}

function managerNames(users: SleeperLeagueUser[]): Map<string, string> {
  return new Map(users.map((user) => [
    user.user_id,
    user.metadata?.team_name || user.display_name || user.username || `Manager ${user.user_id.slice(-4)}`,
  ]));
}

function combinedEvidence(
  playerId: string,
  crosswalk: Map<string, PlayerIdCrosswalk>,
  baselineStats: Map<string, WeeklyPlayerStat[]>,
  currentStats: Map<string, WeeklyPlayerStat[]>,
): WeeklyPlayerStat[] {
  const gsisId = crosswalk.get(playerId)?.gsisId;
  if (!gsisId) return [];
  const baseline = baselineStats.get(gsisId) ?? [];
  const current = currentStats.get(gsisId) ?? [];
  if (current.length >= 3) return current.slice(-8);
  if (current.length) return [...baseline.slice(-(6 - current.length)), ...current];
  return baseline.slice(-8);
}

function roleScore(player: SleeperPlayer | undefined): number {
  if (!player) return 40;
  let score = 50;
  const depth = player.depth_chart_position ?? player.depth_chart_order;
  if (depth === 1) score += 28;
  else if (depth === 2) score += 13;
  else if (depth != null && depth >= 4) score -= 14;
  const status = `${player.status ?? ""} ${player.injury_status ?? ""}`.toLowerCase();
  if (status.includes("out") || status.includes("reserve") || status.includes("ir")) score -= 50;
  else if (status.includes("doubt")) score -= 28;
  else if (status.includes("question")) score -= 10;
  else if ((player.status ?? "").toLowerCase() === "active") score += 7;
  return clamp(score);
}

function requiredCounts(rosterPositions: string[]): Record<CorePosition, number> {
  const counts: Record<CorePosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const slot of rosterPositions) {
    if (slot === "QB") counts.QB += 1;
    else if (slot === "RB") counts.RB += 1;
    else if (slot === "WR") counts.WR += 1;
    else if (slot === "TE") counts.TE += 1;
    else if (["SUPER_FLEX", "SUPERFLEX", "OP"].includes(slot)) {
      counts.QB += 0.65; counts.RB += 0.12; counts.WR += 0.15; counts.TE += 0.08;
    } else if (["FLEX", "WRT", "WRRBTE_FLEX"].includes(slot)) {
      counts.RB += 0.34; counts.WR += 0.46; counts.TE += 0.20;
    } else if (["REC_FLEX", "WRTE_FLEX"].includes(slot)) {
      counts.WR += 0.7; counts.TE += 0.3;
    } else if (["WRRB_FLEX", "RBWR_FLEX"].includes(slot)) {
      counts.RB += 0.45; counts.WR += 0.55;
    }
  }
  for (const position of CORE_POSITIONS) counts[position] = Math.max(counts[position], position === "QB" || position === "TE" ? 1 : 2);
  return counts;
}

function slotSupports(slot: string, position: string): boolean {
  if (slot === position) return true;
  if (["FLEX", "WRT", "WRRBTE_FLEX"].includes(slot)) return ["RB", "WR", "TE"].includes(position);
  if (["SUPER_FLEX", "SUPERFLEX", "OP"].includes(slot)) return CORE_SET.has(position);
  if (["REC_FLEX", "WRTE_FLEX"].includes(slot)) return ["WR", "TE"].includes(position);
  if (["WRRB_FLEX", "RBWR_FLEX"].includes(slot)) return ["RB", "WR"].includes(position);
  return false;
}

function starterSlotMap(roster: SleeperRoster, rosterPositions: string[]): Map<string, string> {
  const starterSlots = rosterPositions.filter((slot) => !NON_STARTER_SLOTS.has(slot));
  return new Map((roster.starters ?? []).map((playerId, index) => [playerId, starterSlots[index] ?? ""]));
}

function tradeActivity(transactions: SleeperTransaction[]): Map<number, { count: number; score: number }> {
  const byRoster = new Map<number, Set<string>>();
  for (const transaction of transactions) {
    if (transaction.type !== "trade" || transaction.status !== "complete") continue;
    for (const rosterId of transaction.roster_ids ?? []) {
      const ids = byRoster.get(rosterId) ?? new Set<string>();
      ids.add(transaction.transaction_id);
      byRoster.set(rosterId, ids);
    }
  }
  const result = new Map<number, { count: number; score: number }>();
  for (const [rosterId, ids] of byRoster) result.set(rosterId, { count: ids.size, score: clamp(38 + ids.size * 16, 38, 92) });
  return result;
}

function teamPositionStrength(
  rosterValues: TradePlayerValue[],
  position: CorePosition,
  required: Record<CorePosition, number>,
): number {
  const count = Math.max(1, Math.ceil(required[position]));
  const values = rosterValues.filter((player) => player.position === position).map((player) => player.fairValue).sort((a, b) => b - a);
  while (values.length < count) values.push(15);
  return values.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
}

function buildNeedScores(
  valuesByRoster: Map<number, TradePlayerValue[]>,
  required: Record<CorePosition, number>,
): Map<number, Record<CorePosition, number>> {
  const strengthsByPosition = new Map<CorePosition, Array<{ rosterId: number; strength: number }>>();
  for (const position of CORE_POSITIONS) {
    strengthsByPosition.set(position, [...valuesByRoster.entries()].map(([rosterId, values]) => ({
      rosterId,
      strength: teamPositionStrength(values, position, required),
    })));
  }

  const result = new Map<number, Record<CorePosition, number>>();
  for (const rosterId of valuesByRoster.keys()) {
    const scores = {} as Record<CorePosition, number>;
    for (const position of CORE_POSITIONS) {
      const rows = strengthsByPosition.get(position) ?? [];
      const own = rows.find((row) => row.rosterId === rosterId)?.strength ?? 0;
      const league = rows.map((row) => row.strength);
      scores[position] = round(100 - percentile(own, league));
    }
    result.set(rosterId, scores);
  }
  return result;
}

function surplusPositions(values: TradePlayerValue[], required: Record<CorePosition, number>): string[] {
  return CORE_POSITIONS.filter((position) => {
    const positionValues = values.filter((player) => player.position === position && player.fairValue >= 52).sort((a, b) => b.fairValue - a.fairValue);
    return positionValues.length > Math.ceil(required[position]);
  });
}

function isPositionSurplusPlayer(player: TradePlayerValue, rosterValues: TradePlayerValue[], required: Record<CorePosition, number>): boolean {
  const peers = rosterValues.filter((candidate) => candidate.position === player.position).sort((a, b) => b.fairValue - a.fairValue);
  const index = peers.findIndex((candidate) => candidate.playerId === player.playerId);
  return index >= Math.ceil(required[player.position as CorePosition]);
}

function lineupUpgrade(target: TradePlayerValue, roster: SleeperRoster, values: TradePlayerValue[], rosterPositions: string[]): number {
  const slotMap = starterSlotMap(roster, rosterPositions);
  const compatibleStarters = values
    .filter((player) => player.currentStarter && slotSupports(slotMap.get(player.playerId) ?? "", target.position))
    .filter((player) => Number.isFinite(player.projection.mean));
  if (!compatibleStarters.length) return 0;
  const weakest = [...compatibleStarters].sort((a, b) => a.projection.mean - b.projection.mean)[0];
  return round(Math.max(0, target.projection.mean - weakest.projection.mean));
}

function outgoingCost(give: TradePlayerValue[], roster: SleeperRoster, values: TradePlayerValue[], rosterPositions: string[]): number {
  const slotMap = starterSlotMap(roster, rosterPositions);
  let cost = 0;
  for (const outgoing of give) {
    if (!outgoing.currentStarter) continue;
    const slot = slotMap.get(outgoing.playerId) ?? "";
    const replacements = values
      .filter((candidate) => candidate.playerId !== outgoing.playerId && !give.some((player) => player.playerId === candidate.playerId))
      .filter((candidate) => slotSupports(slot, candidate.position))
      .sort((a, b) => b.projection.mean - a.projection.mean);
    const replacement = replacements[0]?.projection.mean ?? outgoing.replacementBaseline ?? 0;
    cost += Math.max(0, outgoing.projection.mean - replacement);
  }
  return round(cost);
}

function confidenceFor(target: TradePlayerValue, give: TradePlayerValue[], acceptanceFit: number): TradeProposal["confidence"] {
  const minSample = Math.min(target.projection.sampleSize, ...give.map((player) => player.projection.sampleSize));
  if (minSample >= 6 && acceptanceFit >= 64) return "HIGH";
  if (minSample >= 4) return "MEDIUM";
  return "LOW";
}

export function buildTradeBoard(args: BuildTradeBoardArgs): TradeBoard {
  const names = managerNames(args.users);
  const required = requiredCounts(args.rosterPositions);
  const activity = tradeActivity(args.transactions);
  const breakoutById = new Map(args.breakoutRadar.map((candidate) => [candidate.playerId, candidate]));
  const rosteredIds = new Set(args.rosters.flatMap((roster) => roster.players ?? []));
  const starterIds = new Map<number, Set<string>>(args.rosters.map((roster) => [roster.roster_id, new Set(roster.starters ?? [])]));

  const projectionCache = new Map<string, PlayerProjection | null>();
  const getProjection = (playerId: string) => {
    if (projectionCache.has(playerId)) return projectionCache.get(playerId) ?? null;
    const evidence = combinedEvidence(playerId, args.crosswalk, args.baselineStats, args.currentStats);
    const projection = projectPlayer(evidence, args.scoring);
    projectionCache.set(playerId, projection);
    return projection;
  };

  const availableByPosition = new Map<CorePosition, number[]>();
  for (const [playerId, player] of Object.entries(args.players)) {
    const position = (player.position || args.crosswalk.get(playerId)?.position || "") as CorePosition;
    if (!CORE_SET.has(position) || rosteredIds.has(playerId) || !player.team) continue;
    const projection = getProjection(playerId);
    if (!projection) continue;
    const list = availableByPosition.get(position) ?? [];
    list.push(projection.mean);
    availableByPosition.set(position, list);
  }

  const replacement = new Map<CorePosition, number | null>();
  for (const position of CORE_POSITIONS) {
    const pool = [...(availableByPosition.get(position) ?? [])].sort((a, b) => b - a);
    const count = Math.max(3, Math.ceil(args.rosters.length * 0.25));
    replacement.set(position, median(pool.slice(0, count)));
  }

  const interim: Array<{
    playerId: string;
    player: SleeperPlayer;
    position: CorePosition;
    roster: SleeperRoster;
    projection: PlayerProjection;
    breakout: BreakoutCandidate | undefined;
    role: number;
  }> = [];

  for (const roster of args.rosters) {
    for (const playerId of roster.players ?? []) {
      const player = args.players[playerId];
      const position = (player?.position || args.crosswalk.get(playerId)?.position || "") as CorePosition;
      if (!player || !CORE_SET.has(position)) continue;
      const projection = getProjection(playerId);
      if (!projection) continue;
      interim.push({ playerId, player, position, roster, projection, breakout: breakoutById.get(playerId), role: roleScore(player) });
    }
  }

  const meanByPosition = new Map<CorePosition, number[]>();
  const ceilingByPosition = new Map<CorePosition, number[]>();
  for (const row of interim) {
    const means = meanByPosition.get(row.position) ?? [];
    means.push(row.projection.mean);
    meanByPosition.set(row.position, means);
    const ceilings = ceilingByPosition.get(row.position) ?? [];
    ceilings.push(row.projection.ceiling);
    ceilingByPosition.set(row.position, ceilings);
  }

  const values: TradePlayerValue[] = interim.map((row) => {
    const baseline = replacement.get(row.position) ?? null;
    const vor = baseline == null ? null : row.projection.mean - baseline;
    const projectionRank = percentile(row.projection.mean, meanByPosition.get(row.position) ?? []);
    const ceilingRank = percentile(row.projection.ceiling, ceilingByPosition.get(row.position) ?? []);
    const vorScore = vor == null ? 50 : clamp(50 + vor * 6.5);
    const breakout = row.breakout?.breakoutProbability ?? 45;
    const alpha = row.breakout?.alphaScore ?? 45;
    let fairValue =
      projectionRank * 0.32 +
      vorScore * 0.25 +
      ceilingRank * 0.12 +
      row.projection.opportunityTrend * 0.12 +
      breakout * 0.08 +
      alpha * 0.06 +
      row.role * 0.05;

    const health = `${row.player.status ?? ""} ${row.player.injury_status ?? ""}`.toLowerCase();
    if (health.includes("out") || health.includes("reserve") || health.includes("ir")) fairValue *= 0.68;
    else if (health.includes("doubt")) fairValue *= 0.82;
    else if (health.includes("question")) fairValue *= 0.94;

    const ownerName = row.roster.owner_id ? names.get(row.roster.owner_id) ?? `Roster ${row.roster.roster_id}` : `Roster ${row.roster.roster_id}`;
    const reasons: string[] = [];
    if (vor != null && vor >= 2) reasons.push(`${round(vor)} projected points above this league's ${row.position} replacement level.`);
    if (row.projection.opportunityTrend >= 65) reasons.push("Recent opportunity is above the sampled baseline.");
    if (breakout >= 65) reasons.push(`Breakout signal is elevated at ${round(breakout, 0)}%.`);
    if (row.role >= 70) reasons.push("Depth-chart and availability signals support a stable role.");

    return {
      playerId: row.playerId,
      name: playerName(row.playerId, row.player, args.crosswalk.get(row.playerId)),
      position: row.position,
      team: row.player.team ?? "FA",
      rosterId: row.roster.roster_id,
      ownerName,
      currentStarter: starterIds.get(row.roster.roster_id)?.has(row.playerId) ?? false,
      projection: row.projection,
      replacementBaseline: baseline == null ? null : round(baseline),
      valueOverReplacement: vor == null ? null : round(vor),
      fairValue: round(clamp(fairValue)),
      breakoutProbability: round(breakout),
      alphaScore: round(alpha),
      roleScore: round(row.role),
      reasons,
    };
  });

  const valuesByRoster = new Map<number, TradePlayerValue[]>();
  for (const value of values) {
    const list = valuesByRoster.get(value.rosterId) ?? [];
    list.push(value);
    valuesByRoster.set(value.rosterId, list);
  }

  const needs = buildNeedScores(valuesByRoster, required);
  const userRoster = args.rosters.find((roster) => roster.roster_id === args.userRosterId);
  const userValues = valuesByRoster.get(args.userRosterId) ?? [];
  if (!userRoster || !userValues.length) {
    return { proposals: [], userNeeds: [], userSurpluses: [], managers: [], evidenceSeason: args.evidenceSeason, currentSeason: args.currentSeason };
  }

  const managers: ManagerTradeProfile[] = args.rosters
    .filter((roster) => roster.roster_id !== args.userRosterId)
    .map((roster) => {
      const rosterValues = valuesByRoster.get(roster.roster_id) ?? [];
      const rosterNeeds = needs.get(roster.roster_id) ?? { QB: 50, RB: 50, WR: 50, TE: 50 };
      const sorted = CORE_POSITIONS.map((position) => ({ position, need: rosterNeeds[position] })).sort((a, b) => b.need - a.need);
      const history = activity.get(roster.roster_id) ?? { count: 0, score: 38 };
      return {
        rosterId: roster.roster_id,
        managerName: roster.owner_id ? names.get(roster.owner_id) ?? `Roster ${roster.roster_id}` : `Roster ${roster.roster_id}`,
        completedTrades: history.count,
        activityScore: history.score,
        weakestPositions: sorted.slice(0, 2).map((row) => row.position),
        strongestPositions: sorted.slice(-2).reverse().map((row) => row.position),
        surplusPositions: surplusPositions(rosterValues, required),
      };
    });
  const managerByRoster = new Map(managers.map((manager) => [manager.rosterId, manager]));

  const userNeedScores = needs.get(args.userRosterId) ?? { QB: 50, RB: 50, WR: 50, TE: 50 };
  const userNeeds = CORE_POSITIONS.map((position) => ({ position, score: userNeedScores[position] })).sort((a, b) => b.score - a.score);
  const userSurpluses = surplusPositions(userValues, required);

  const userGiveCandidates = userValues
    .filter((player) => player.fairValue >= 30)
    .sort((a, b) => {
      if (a.currentStarter !== b.currentStarter) return a.currentStarter ? 1 : -1;
      return b.fairValue - a.fairValue;
    });

  const proposals: TradeProposal[] = [];

  for (const [opponentRosterId, opponentValues] of valuesByRoster) {
    if (opponentRosterId === args.userRosterId) continue;
    const opponentRoster = args.rosters.find((roster) => roster.roster_id === opponentRosterId);
    if (!opponentRoster) continue;
    const opponentNeeds = needs.get(opponentRosterId) ?? { QB: 50, RB: 50, WR: 50, TE: 50 };
    const manager = managerByRoster.get(opponentRosterId);
    const activityScore = manager?.activityScore ?? 38;

    const targets = opponentValues
      .filter((player) => player.fairValue >= 44)
      .sort((a, b) => b.fairValue - a.fairValue)
      .slice(0, 12);

    for (const target of targets) {
      const starterGain = lineupUpgrade(target, userRoster, userValues, args.rosterPositions);
      const userNeed = userNeedScores[target.position as CorePosition] ?? 50;
      const targetSurplus = isPositionSurplusPlayer(target, opponentValues, required);
      if (starterGain < 0.6 && userNeed < 58 && target.breakoutProbability < 68) continue;

      const targetScore = clamp(
        target.fairValue * 0.38 +
        userNeed * 0.24 +
        clamp(50 + starterGain * 8) * 0.20 +
        target.breakoutProbability * 0.10 +
        (targetSurplus ? 90 : 45) * 0.08,
      );

      let bestOne: TradeProposal | null = null;
      for (const give of userGiveCandidates.slice(0, 18)) {
        if (give.playerId === target.playerId) continue;
        const ratio = give.fairValue / Math.max(target.fairValue, 1);
        if (ratio < 0.76 || ratio > 1.24) continue;
        const givePosition = give.position as CorePosition;
        const opponentNeed = opponentNeeds[givePosition] ?? 50;
        const fairness = clamp(100 - Math.abs(give.fairValue - target.fairValue) / Math.max(target.fairValue, 1) * 130);
        const cost = outgoingCost([give], userRoster, userValues, args.rosterPositions);
        const netGain = round(starterGain - cost);
        if (netGain < 0.4) continue;
        const acceptance = clamp(
          fairness * 0.44 +
          opponentNeed * 0.25 +
          activityScore * 0.14 +
          (targetSurplus ? 88 : 48) * 0.12 +
          (ratio >= 0.98 ? 72 : 45) * 0.05,
        );
        const proposal: TradeProposal = {
          target,
          give: [give],
          opponentRosterId,
          opponentName: target.ownerName,
          packageType: "1 FOR 1",
          targetScore: round(targetScore),
          acceptanceFit: round(acceptance),
          fairnessScore: round(fairness),
          projectedStarterGain: round(starterGain),
          outgoingLineupCost: cost,
          netLineupGain: netGain,
          opponentNeedFit: round(opponentNeed),
          opponentTradeActivity: round(activityScore),
          confidence: "MEDIUM",
          reasons: [],
        };
        proposal.confidence = confidenceFor(target, proposal.give, proposal.acceptanceFit);
        proposal.reasons = [
          `${target.name} projects to improve your best compatible starting slot by about ${proposal.projectedStarterGain.toFixed(1)} points before outgoing cost.`,
          `${give.name} addresses a ${give.position} need score of ${proposal.opponentNeedFit.toFixed(0)}/100 for ${proposal.opponentName}.`,
          `WAR ROOM fair-value balance is ${proposal.fairnessScore.toFixed(0)}/100; acceptance fit also accounts for roster construction and observed trade activity.`,
        ];
        if (targetSurplus) proposal.reasons.push(`${proposal.opponentName} has enough ${target.position} depth for WAR ROOM to classify the target as movable surplus.`);
        if (!bestOne || proposal.acceptanceFit + proposal.netLineupGain * 4 > bestOne.acceptanceFit + bestOne.netLineupGain * 4) bestOne = proposal;
      }
      if (bestOne) proposals.push(bestOne);

      let bestPair: TradeProposal | null = null;
      const pairPool = userGiveCandidates.filter((player) => !player.currentStarter || userSurpluses.includes(player.position)).slice(0, 12);
      for (let i = 0; i < pairPool.length; i += 1) {
        for (let j = i + 1; j < pairPool.length; j += 1) {
          const give = [pairPool[i], pairPool[j]];
          const adjustedGiveValue = (give[0].fairValue + give[1].fairValue) * 0.88;
          const ratio = adjustedGiveValue / Math.max(target.fairValue, 1);
          if (ratio < 0.84 || ratio > 1.28) continue;
          const needFit = (opponentNeeds[give[0].position as CorePosition] + opponentNeeds[give[1].position as CorePosition]) / 2;
          if (needFit < 48) continue;
          const fairness = clamp(100 - Math.abs(adjustedGiveValue - target.fairValue) / Math.max(target.fairValue, 1) * 115);
          const cost = outgoingCost(give, userRoster, userValues, args.rosterPositions);
          const netGain = round(starterGain - cost);
          if (netGain < 0.5) continue;
          const acceptance = clamp(
            fairness * 0.42 +
            needFit * 0.28 +
            activityScore * 0.14 +
            (targetSurplus ? 88 : 48) * 0.11 +
            45 * 0.05,
          );
          const proposal: TradeProposal = {
            target,
            give,
            opponentRosterId,
            opponentName: target.ownerName,
            packageType: "2 FOR 1",
            targetScore: round(targetScore),
            acceptanceFit: round(acceptance),
            fairnessScore: round(fairness),
            projectedStarterGain: round(starterGain),
            outgoingLineupCost: cost,
            netLineupGain: netGain,
            opponentNeedFit: round(needFit),
            opponentTradeActivity: round(activityScore),
            confidence: "MEDIUM",
            reasons: [],
          };
          proposal.confidence = confidenceFor(target, proposal.give, proposal.acceptanceFit);
          proposal.reasons = [
            `This consolidation package targets ${target.name} for a modeled net starting-lineup gain of ${proposal.netLineupGain.toFixed(1)} points.`,
            `${give.map((player) => `${player.name} (${player.position})`).join(" + ")} collectively attack ${proposal.opponentName}'s weaker roster areas.`,
            `WAR ROOM applies a package/consolidation discount before scoring fairness, producing a ${proposal.fairnessScore.toFixed(0)}/100 fair-value balance.`,
          ];
          if (!bestPair || proposal.acceptanceFit + proposal.netLineupGain * 4 > bestPair.acceptanceFit + bestPair.netLineupGain * 4) bestPair = proposal;
        }
      }
      if (bestPair && (!bestOne || bestPair.acceptanceFit >= bestOne.acceptanceFit + 5)) proposals.push(bestPair);
    }
  }

  const deduped = new Map<string, TradeProposal>();
  for (const proposal of proposals) {
    const key = `${proposal.target.playerId}|${proposal.give.map((player) => player.playerId).sort().join("+")}`;
    const existing = deduped.get(key);
    const score = proposal.targetScore * 0.35 + proposal.acceptanceFit * 0.35 + clamp(50 + proposal.netLineupGain * 8) * 0.30;
    const existingScore = existing ? existing.targetScore * 0.35 + existing.acceptanceFit * 0.35 + clamp(50 + existing.netLineupGain * 8) * 0.30 : -1;
    if (!existing || score > existingScore) deduped.set(key, proposal);
  }

  const ranked = [...deduped.values()]
    .sort((a, b) => {
      const scoreA = a.targetScore * 0.35 + a.acceptanceFit * 0.35 + clamp(50 + a.netLineupGain * 8) * 0.30;
      const scoreB = b.targetScore * 0.35 + b.acceptanceFit * 0.35 + clamp(50 + b.netLineupGain * 8) * 0.30;
      return scoreB - scoreA;
    })
    .slice(0, 20);

  return {
    proposals: ranked,
    userNeeds,
    userSurpluses,
    managers: managers.sort((a, b) => b.activityScore - a.activityScore),
    evidenceSeason: args.evidenceSeason,
    currentSeason: args.currentSeason,
  };
}
