import type { WeeklyPlayerStat, PlayerIdCrosswalk } from "@/lib/nflverse/client";
import type { SleeperPlayer, SleeperTrendingPlayer } from "@/lib/sleeper/types";

export type PlayerProjection = {
  mean: number;
  floor: number;
  ceiling: number;
  sampleSize: number;
  recentTargets: number;
  recentCarries: number;
  targetShareTrend: number;
  opportunityTrend: number;
};

export type WaiverCandidate = {
  playerId: string;
  name: string;
  position: string;
  team: string;
  score: number;
  projection: PlayerProjection | null;
  replacementBaseline: number | null;
  valueOverReplacement: number | null;
  dropPlayer: { playerId: string; name: string; projection: number } | null;
  netRosterGain: number | null;
  addCount: number;
  dropCount: number;
  marketScore: number;
  roleScore: number;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "SPECULATIVE";
  action: "CLAIM" | "ADD" | "WATCH" | "DEEP STASH";
  reasons: string[];
};

export type UserRosterPlayer = {
  playerId: string;
  status: string;
};

type BuildWaiverBoardArgs = {
  leagueSize: number;
  scoring: Record<string, number>;
  players: Record<string, SleeperPlayer>;
  rosteredPlayerIds: Set<string>;
  userRoster: UserRosterPlayer[];
  crosswalk: Map<string, PlayerIdCrosswalk>;
  historicalStats: Map<string, WeeklyPlayerStat[]>;
  trendingAdds: SleeperTrendingPlayer[];
  trendingDrops: SleeperTrendingPlayer[];
  currentSeason: number;
};

const CORE_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function scoreStat(stat: WeeklyPlayerStat, scoring: Record<string, number>): number {
  const get = (key: string, fallback: number) => scoring[key] ?? fallback;
  return (
    stat.passingYards * get("pass_yd", 0.04) +
    stat.passingTds * get("pass_td", 4) +
    stat.passingInterceptions * get("pass_int", -1) +
    stat.passing2pt * get("pass_2pt", 2) +
    stat.rushingYards * get("rush_yd", 0.1) +
    stat.rushingTds * get("rush_td", 6) +
    stat.rushing2pt * get("rush_2pt", 2) +
    stat.receptions * get("rec", 0) +
    stat.receivingYards * get("rec_yd", 0.1) +
    stat.receivingTds * get("rec_td", 6) +
    stat.receiving2pt * get("rec_2pt", 2) +
    stat.fumblesLost * get("fum_lost", -2)
  );
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function projectPlayer(stats: WeeklyPlayerStat[] | undefined, scoring: Record<string, number>): PlayerProjection | null {
  if (!stats?.length) return null;
  const games = stats.slice(-8).reverse();
  const scored = games.map((stat, index) => ({ stat, points: scoreStat(stat, scoring), weight: Math.pow(0.86, index) }));
  const weightTotal = scored.reduce((sum, game) => sum + game.weight, 0);
  const mean = scored.reduce((sum, game) => sum + game.points * game.weight, 0) / weightTotal;
  const variance = scored.reduce((sum, game) => sum + game.weight * Math.pow(game.points - mean, 2), 0) / weightTotal;
  const sd = Math.sqrt(Math.max(variance, 0));

  const chronological = [...games].reverse();
  const recent = chronological.slice(-4);
  const seasonTargets = average(chronological.map((game) => game.stat.targets));
  const seasonCarries = average(chronological.map((game) => game.stat.carries));
  const recentTargets = average(recent.map((game) => game.stat.targets));
  const recentCarries = average(recent.map((game) => game.stat.carries));
  const seasonTargetShare = average(chronological.map((game) => game.stat.targetShare).filter((value) => value > 0));
  const recentTargetShare = average(recent.map((game) => game.stat.targetShare).filter((value) => value > 0));
  const targetShareTrend = recentTargetShare - seasonTargetShare;
  const opportunityDelta = (recentTargets + recentCarries) - (seasonTargets + seasonCarries);
  const opportunityTrend = clamp(50 + targetShareTrend * 180 + opportunityDelta * 3);

  return {
    mean: round(mean),
    floor: round(Math.max(0, mean - sd * 0.9)),
    ceiling: round(mean + sd * 1.15),
    sampleSize: games.length,
    recentTargets: round(recentTargets, 1),
    recentCarries: round(recentCarries, 1),
    targetShareTrend: round(targetShareTrend * 100, 1),
    opportunityTrend: round(opportunityTrend, 1),
  };
}

function roleScore(player: SleeperPlayer, crosswalk: PlayerIdCrosswalk | undefined, currentSeason: number): number {
  let score = 50;
  const depth = player.depth_chart_position ?? player.depth_chart_order;
  if (depth === 1) score += 25;
  else if (depth === 2) score += 12;
  else if (depth != null && depth >= 4) score -= 12;

  if ((player.status ?? "").toLowerCase() === "active") score += 8;
  const injury = (player.injury_status ?? "").toLowerCase();
  if (injury.includes("out") || injury.includes("ir")) score -= 48;
  else if (injury.includes("doubt")) score -= 30;
  else if (injury.includes("question")) score -= 12;

  if (crosswalk?.draftYear === currentSeason) {
    if (crosswalk.draftRound === 1) score += 18;
    else if (crosswalk.draftRound === 2) score += 12;
    else if (crosswalk.draftRound === 3) score += 7;
  }
  return clamp(score);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function marketScore(addCount: number, dropCount: number, maxAdds: number, maxDrops: number): number {
  const addSignal = maxAdds > 0 ? Math.log1p(addCount) / Math.log1p(maxAdds) : 0;
  const dropSignal = maxDrops > 0 ? Math.log1p(dropCount) / Math.log1p(maxDrops) : 0;
  return clamp(addSignal * 100 - dropSignal * 30);
}

function percentileScore(value: number, values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length <= 1) return 50;
  const below = sorted.filter((candidate) => candidate < value).length;
  return (below / (sorted.length - 1)) * 100;
}

function dropCompatibility(candidatePosition: string, rosterPosition: string): boolean {
  if (candidatePosition === rosterPosition) return true;
  return FLEX_POSITIONS.has(candidatePosition) && FLEX_POSITIONS.has(rosterPosition);
}

export function buildWaiverBoard(args: BuildWaiverBoardArgs): WaiverCandidate[] {
  const addMap = new Map(args.trendingAdds.map((item) => [item.player_id, item.count]));
  const dropMap = new Map(args.trendingDrops.map((item) => [item.player_id, item.count]));
  const maxAdds = Math.max(0, ...args.trendingAdds.map((item) => item.count));
  const maxDrops = Math.max(0, ...args.trendingDrops.map((item) => item.count));

  const projectionBySleeper = new Map<string, PlayerProjection | null>();
  const getProjection = (playerId: string) => {
    if (projectionBySleeper.has(playerId)) return projectionBySleeper.get(playerId) ?? null;
    const gsisId = args.crosswalk.get(playerId)?.gsisId;
    const projection = gsisId ? projectPlayer(args.historicalStats.get(gsisId), args.scoring) : null;
    projectionBySleeper.set(playerId, projection);
    return projection;
  };

  const available = Object.entries(args.players)
    .filter(([playerId, player]) => !args.rosteredPlayerIds.has(playerId) && CORE_POSITIONS.has(player.position ?? "") && Boolean(player.team))
    .map(([playerId, player]) => ({
      playerId,
      player,
      projection: getProjection(playerId),
      crosswalk: args.crosswalk.get(playerId),
    }));

  const projectedByPosition = new Map<string, number[]>();
  for (const candidate of available) {
    if (!candidate.projection) continue;
    const position = candidate.player.position ?? "";
    const values = projectedByPosition.get(position) ?? [];
    values.push(candidate.projection.mean);
    projectedByPosition.set(position, values);
  }

  const replacementByPosition = new Map<string, number | null>();
  for (const position of CORE_POSITIONS) {
    const pool = [...(projectedByPosition.get(position) ?? [])].sort((a, b) => b - a);
    const count = Math.max(3, Math.ceil(args.leagueSize * 0.25));
    replacementByPosition.set(position, median(pool.slice(0, count)));
  }

  const bench = args.userRoster
    .filter((item) => !["starter", "ir", "taxi"].includes(item.status))
    .map((item) => ({
      ...item,
      player: args.players[item.playerId],
      projection: getProjection(item.playerId),
    }));

  const candidateRows = available.map((candidate) => {
    const player = candidate.player;
    const position = player.position ?? "";
    const projection = candidate.projection;
    const replacement = replacementByPosition.get(position) ?? null;
    const valueOverReplacement = projection && replacement != null ? projection.mean - replacement : null;
    const compatibleDrops = bench
      .filter((item) => item.player?.position && dropCompatibility(position, item.player.position))
      .filter((item) => item.projection)
      .sort((a, b) => (a.projection?.mean ?? 999) - (b.projection?.mean ?? 999));
    const drop = compatibleDrops[0];
    const netRosterGain = projection && drop?.projection ? projection.mean - drop.projection.mean : null;
    const adds = addMap.get(candidate.playerId) ?? 0;
    const drops = dropMap.get(candidate.playerId) ?? 0;
    const market = marketScore(adds, drops, maxAdds, maxDrops);
    const role = roleScore(player, candidate.crosswalk, args.currentSeason);

    let score: number;
    if (projection) {
      const projectionRank = percentileScore(projection.mean, projectedByPosition.get(position) ?? []);
      const vorScore = valueOverReplacement == null ? 50 : clamp(50 + valueOverReplacement * 6);
      const rosterGainScore = netRosterGain == null ? 50 : clamp(50 + netRosterGain * 5);
      score = projectionRank * 0.30 + vorScore * 0.20 + rosterGainScore * 0.20 + market * 0.15 + role * 0.10 + projection.opportunityTrend * 0.05;
    } else {
      score = market * 0.60 + role * 0.40;
    }

    const confidence: WaiverCandidate["confidence"] = !projection
      ? "SPECULATIVE"
      : projection.sampleSize >= 6 && netRosterGain != null
        ? "HIGH"
        : projection.sampleSize >= 4
          ? "MEDIUM"
          : "LOW";
    const roundedScore = round(clamp(score), 1);
    const action: WaiverCandidate["action"] = roundedScore >= 78 ? "CLAIM" : roundedScore >= 64 ? "ADD" : roundedScore >= 50 ? "WATCH" : "DEEP STASH";

    const reasons: string[] = [];
    if (netRosterGain != null && netRosterGain >= 2) reasons.push(`Projects ${round(netRosterGain, 1)} points above the best comparable bench drop.`);
    if (valueOverReplacement != null && valueOverReplacement >= 1.5) reasons.push(`${round(valueOverReplacement, 1)} points above this league's ${position} replacement baseline.`);
    if (projection?.targetShareTrend && projection.targetShareTrend >= 3) reasons.push(`Recent target share is up ${projection.targetShareTrend.toFixed(1)} percentage points versus his sampled baseline.`);
    if (projection && projection.opportunityTrend >= 65) reasons.push("Recent targets/carries are trending above the sampled season baseline.");
    if (adds > 0 && market >= 60) reasons.push(`${adds.toLocaleString()} Sleeper adds in the selected market window signal rising acquisition pressure.`);
    if (!projection) reasons.push("No qualifying prior-season NFL sample is mapped; score is driven by live market, depth-chart and draft signals with speculative confidence.");
    if (!reasons.length) reasons.push("Composite value is driven by projection rank, market movement, role security and league-specific scarcity.");

    return {
      playerId: candidate.playerId,
      name: player.full_name || [player.first_name, player.last_name].filter(Boolean).join(" ") || candidate.crosswalk?.name || candidate.playerId,
      position,
      team: player.team ?? "FA",
      score: roundedScore,
      projection,
      replacementBaseline: replacement == null ? null : round(replacement),
      valueOverReplacement: valueOverReplacement == null ? null : round(valueOverReplacement),
      dropPlayer: drop?.projection ? {
        playerId: drop.playerId,
        name: drop.player?.full_name || [drop.player?.first_name, drop.player?.last_name].filter(Boolean).join(" ") || drop.playerId,
        projection: drop.projection.mean,
      } : null,
      netRosterGain: netRosterGain == null ? null : round(netRosterGain),
      addCount: adds,
      dropCount: drops,
      marketScore: round(market, 1),
      roleScore: round(role, 1),
      confidence,
      action,
      reasons: reasons.slice(0, 3),
    } satisfies WaiverCandidate;
  });

  return candidateRows.sort((a, b) => b.score - a.score).slice(0, 75);
}
