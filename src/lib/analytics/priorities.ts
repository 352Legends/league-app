import type { BreakoutCandidate } from "@/lib/analytics/breakouts";
import type { ChampionshipImpact } from "@/lib/analytics/championship";
import type { LineupPlan } from "@/lib/analytics/lineups";
import type { TradeBoard } from "@/lib/analytics/trades";
import type { WaiverCandidate } from "@/lib/analytics/waivers";

export type DecisionType = "LINEUP" | "WAIVER" | "TRADE";
export type DecisionHorizon = "ONE_WEEK" | "SUSTAINED";

export type PriorityCandidate = {
  id: string;
  type: DecisionType;
  horizon: DecisionHorizon;
  title: string;
  summary: string;
  weeklyGain: number;
  simulationBoost: number;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "SPECULATIVE";
  urgency: number;
  href: string;
  reasons: string[];
  breakoutSignal: BreakoutCandidate | null;
  impact: ChampionshipImpact | null;
  championshipDelta: number | null;
  playoffDelta: number | null;
  priorityScore: number;
};

type CollectArgs = {
  lineupPlan: LineupPlan | null;
  waiverBoard: WaiverCandidate[];
  tradeBoard: TradeBoard | null;
  breakoutRadar: BreakoutCandidate[];
  leagueId: string;
  sleeperUserId: string;
  sleeperUsername: string;
  remainingRegularWeeks: number;
  estimatedPlayoffRounds: number;
};

const confidenceWeight: Record<PriorityCandidate["confidence"], number> = {
  HIGH: 10,
  MEDIUM: 7,
  LOW: 4,
  SPECULATIVE: 1,
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function contextQuery(args: Pick<CollectArgs, "sleeperUserId" | "sleeperUsername">): string {
  return new URLSearchParams({
    sleeperUserId: args.sleeperUserId,
    sleeperUsername: args.sleeperUsername,
  }).toString();
}

function mapConfidence(value: string): PriorityCandidate["confidence"] {
  if (value === "HIGH") return "HIGH";
  if (value === "MEDIUM") return "MEDIUM";
  if (value === "SPECULATIVE") return "SPECULATIVE";
  return "LOW";
}

export function collectPriorityCandidates(args: CollectArgs): PriorityCandidate[] {
  const query = contextQuery(args);
  const breakoutById = new Map(args.breakoutRadar.map((candidate) => [candidate.playerId, candidate]));
  const candidates: PriorityCandidate[] = [];

  for (const swap of (args.lineupPlan?.swaps ?? []).slice(0, 4)) {
    if (swap.projectedGain <= 0) continue;
    const horizonGames = Math.max(1, args.remainingRegularWeeks + args.estimatedPlayoffRounds);
    // Championship v1 models sustained boosts. Normalize a one-week lineup gain across the
    // remaining modeled horizon so a start/sit decision is not accidentally treated as permanent.
    const equivalentBoost = swap.projectedGain / horizonGames;
    candidates.push({
      id: `lineup:${swap.start.playerId}:${swap.sit.playerId}`,
      type: "LINEUP",
      horizon: "ONE_WEEK",
      title: `Start ${swap.start.name} over ${swap.sit.name}`,
      summary: `${swap.slot} change worth +${swap.projectedGain.toFixed(1)} modeled points this week.`,
      weeklyGain: round(swap.projectedGain),
      simulationBoost: round(equivalentBoost, 3),
      confidence: mapConfidence(swap.confidence),
      urgency: 96,
      href: `/league/${args.leagueId}?${query}`,
      reasons: swap.reasons.slice(0, 3),
      breakoutSignal: null,
      impact: null,
      championshipDelta: null,
      playoffDelta: null,
      priorityScore: 0,
    });
  }

  for (const waiver of args.waiverBoard.filter((candidate) => (candidate.netRosterGain ?? 0) > 0).slice(0, 5)) {
    const breakout = breakoutById.get(waiver.playerId) ?? null;
    const dropName = waiver.dropPlayer?.name;
    const breakoutText = breakout && breakout.alphaScore >= 60
      ? ` Breakout Radar also flags ${breakout.alphaScore.toFixed(0)} Alpha / ${breakout.breakoutProbability.toFixed(0)}% breakout.`
      : "";
    candidates.push({
      id: `waiver:${waiver.playerId}:${waiver.dropPlayer?.playerId ?? "none"}`,
      type: "WAIVER",
      horizon: "SUSTAINED",
      title: `Add ${waiver.name}${dropName ? ` · drop ${dropName}` : ""}`,
      summary: `Projected +${(waiver.netRosterGain ?? 0).toFixed(1)} points versus the best comparable roster cut.${breakoutText}`,
      weeklyGain: round(waiver.netRosterGain ?? 0),
      simulationBoost: round(waiver.netRosterGain ?? 0),
      confidence: mapConfidence(waiver.confidence),
      urgency: clamp(55 + waiver.marketScore * 0.35 + (waiver.action === "CLAIM" ? 14 : waiver.action === "ADD" ? 8 : 0), 0, 100),
      href: `/league/${args.leagueId}?${query}#waivers`,
      reasons: [
        ...waiver.reasons,
        ...(breakout?.reasons.slice(0, 1) ?? []),
      ].slice(0, 4),
      breakoutSignal: breakout,
      impact: null,
      championshipDelta: null,
      playoffDelta: null,
      priorityScore: 0,
    });
  }

  for (const proposal of (args.tradeBoard?.proposals ?? []).filter((candidate) => candidate.netLineupGain > 0).slice(0, 5)) {
    candidates.push({
      id: `trade:${proposal.target.playerId}:${proposal.give.map((player) => player.playerId).join("-")}`,
      type: "TRADE",
      horizon: "SUSTAINED",
      title: `Trade for ${proposal.target.name}`,
      summary: `Send ${proposal.give.map((player) => player.name).join(" + ")} · +${proposal.netLineupGain.toFixed(1)} modeled starter points/week.`,
      weeklyGain: round(proposal.netLineupGain),
      simulationBoost: round(proposal.netLineupGain),
      confidence: mapConfidence(proposal.confidence),
      urgency: clamp(45 + proposal.acceptanceFit * 0.35 + proposal.opponentTradeActivity * 0.2, 0, 100),
      href: `/trades/${args.leagueId}?${query}`,
      reasons: proposal.reasons.slice(0, 4),
      breakoutSignal: null,
      impact: null,
      championshipDelta: null,
      playoffDelta: null,
      priorityScore: 0,
    });
  }

  return candidates
    .sort((a, b) => {
      const aPre = a.weeklyGain * 5 + a.urgency * 0.2 + confidenceWeight[a.confidence];
      const bPre = b.weeklyGain * 5 + b.urgency * 0.2 + confidenceWeight[b.confidence];
      return bPre - aPre;
    })
    .slice(0, 9);
}

export function attachChampionshipImpact(candidate: PriorityCandidate, impact: ChampionshipImpact): PriorityCandidate {
  const championshipDelta = impact.championshipDelta;
  const playoffDelta = impact.playoffDelta;
  const deltaScore = (championshipDelta ?? 0) * 18 + (playoffDelta ?? 0) * 4;
  const gainScore = clamp(candidate.weeklyGain, 0, 12) * 1.6;
  const confidenceScore = confidenceWeight[candidate.confidence];
  const urgencyScore = candidate.urgency * 0.08;
  const priorityScore = round(deltaScore + gainScore + confidenceScore + urgencyScore, 1);

  return {
    ...candidate,
    impact,
    championshipDelta,
    playoffDelta,
    priorityScore,
  };
}

export function rankPriorities(candidates: PriorityCandidate[]): PriorityCandidate[] {
  return [...candidates].sort((a, b) =>
    (b.championshipDelta ?? -999) - (a.championshipDelta ?? -999) ||
    b.priorityScore - a.priorityScore ||
    b.weeklyGain - a.weeklyGain,
  );
}
