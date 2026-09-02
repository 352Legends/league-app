import { projectPlayer, type PlayerProjection } from "@/lib/analytics/waivers";
import type { NflGame, PlayerIdCrosswalk, WeeklyPlayerStat } from "@/lib/nflverse/client";
import type { SleeperPlayer, SleeperRoster } from "@/lib/sleeper/types";

export type LineupPlayer = {
  playerId: string;
  name: string;
  position: string;
  team: string;
  slot: string | null;
  isCurrentStarter: boolean;
  opponent: string | null;
  venue: "HOME" | "AWAY" | null;
  projection: PlayerProjection | null;
  adjustedProjection: number | null;
  matchupMultiplier: number | null;
  environmentMultiplier: number;
  injuryMultiplier: number;
  matchupLabel: "ELITE" | "PLUS" | "NEUTRAL" | "TOUGH" | "AVOID" | "UNKNOWN";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
  gameNote: string;
  reasons: string[];
};

export type LineupSwap = {
  slot: string;
  start: LineupPlayer;
  sit: LineupPlayer;
  projectedGain: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
};

export type LineupPlan = {
  starters: LineupPlayer[];
  bench: LineupPlayer[];
  swaps: LineupSwap[];
  currentProjectedPoints: number;
  optimizedProjectedPoints: number;
  projectedGain: number;
  supportedStarterSlots: number;
  evidenceSeason: number;
  week: number;
};

type BuildLineupPlanArgs = {
  roster: SleeperRoster;
  rosterPositions: string[];
  scoring: Record<string, number>;
  players: Record<string, SleeperPlayer>;
  crosswalk: Map<string, PlayerIdCrosswalk>;
  historicalStats: Map<string, WeeklyPlayerStat[]>;
  schedule: NflGame[];
  season: number;
  week: number;
  evidenceSeason: number;
};

const CORE_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const NON_STARTER_SLOTS = new Set(["BN", "IR", "TAXI"]);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
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

function playerName(playerId: string, player: SleeperPlayer | undefined, crosswalk: PlayerIdCrosswalk | undefined): string {
  return player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || crosswalk?.name || playerId;
}

function slotSupports(slot: string, position: string): boolean {
  if (slot === position) return true;
  if (["FLEX", "WRT", "WRRBTE_FLEX"].includes(slot)) return ["RB", "WR", "TE"].includes(position);
  if (["SUPER_FLEX", "SUPERFLEX", "OP"].includes(slot)) return ["QB", "RB", "WR", "TE"].includes(position);
  if (["REC_FLEX", "WRTE_FLEX"].includes(slot)) return ["WR", "TE"].includes(position);
  if (["WRRB_FLEX", "RBWR_FLEX"].includes(slot)) return ["RB", "WR"].includes(position);
  return false;
}

function defenseMatchups(historicalStats: Map<string, WeeklyPlayerStat[]>, scoring: Record<string, number>) {
  const weeklyTotals = new Map<string, number>();
  for (const stats of historicalStats.values()) {
    for (const stat of stats) {
      if (!stat.opponent || !CORE_POSITIONS.has(stat.position)) continue;
      const key = `${stat.opponent}|${stat.week}|${stat.position}`;
      weeklyTotals.set(key, (weeklyTotals.get(key) ?? 0) + scoreStat(stat, scoring));
    }
  }

  const defensePosition = new Map<string, number[]>();
  const positionLeague = new Map<string, number[]>();
  for (const [key, points] of weeklyTotals) {
    const [defense, , position] = key.split("|");
    const defenseKey = `${defense}|${position}`;
    const defenseValues = defensePosition.get(defenseKey) ?? [];
    defenseValues.push(points);
    defensePosition.set(defenseKey, defenseValues);
    const leagueValues = positionLeague.get(position) ?? [];
    leagueValues.push(points);
    positionLeague.set(position, leagueValues);
  }

  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return (defense: string | null, position: string): number | null => {
    if (!defense) return null;
    const defenseAverage = average(defensePosition.get(`${defense}|${position}`) ?? []);
    const leagueAverage = average(positionLeague.get(position) ?? []);
    if (!defenseAverage || !leagueAverage) return null;
    return clamp(defenseAverage / leagueAverage, 0.88, 1.12);
  };
}

function gameForTeam(schedule: NflGame[], season: number, week: number, team: string): NflGame | undefined {
  return schedule.find((game) => game.season === season && game.week === week && (game.awayTeam === team || game.homeTeam === team));
}

function injuryMultiplier(player: SleeperPlayer | undefined): number {
  const injury = `${player?.injury_status ?? ""} ${player?.status ?? ""}`.toLowerCase();
  if (injury.includes("out") || injury.includes("reserve") || injury.includes("ir")) return 0.05;
  if (injury.includes("doubt")) return 0.55;
  if (injury.includes("question")) return 0.9;
  return 1;
}

function environmentMultiplier(game: NflGame | undefined, position: string): { multiplier: number; note: string; reasons: string[] } {
  if (!game) return { multiplier: 1, note: "NFL game environment unavailable", reasons: [] };
  let multiplier = 1;
  const reasons: string[] = [];
  const roof = game.roof.toLowerCase();
  const protectedEnvironment = roof.includes("dome") || roof.includes("closed");

  if (game.totalLine != null) {
    if (game.totalLine >= 50) {
      multiplier *= 1.03;
      reasons.push(`High-scoring environment: ${game.totalLine.toFixed(1)} Vegas total.`);
    } else if (game.totalLine >= 46) {
      multiplier *= 1.015;
    } else if (game.totalLine <= 37) {
      multiplier *= 0.96;
      reasons.push(`Low-scoring environment: ${game.totalLine.toFixed(1)} Vegas total.`);
    } else if (game.totalLine <= 40) {
      multiplier *= 0.98;
    }
  }

  if (!protectedEnvironment && game.wind != null) {
    if (game.wind >= 20 && ["QB", "WR", "TE"].includes(position)) {
      multiplier *= 0.93;
      reasons.push(`${game.wind.toFixed(0)} mph wind creates meaningful passing-game risk.`);
    } else if (game.wind >= 15 && ["QB", "WR", "TE"].includes(position)) {
      multiplier *= 0.96;
      reasons.push(`${game.wind.toFixed(0)} mph wind modestly reduces passing efficiency.`);
    }
  }

  if (!protectedEnvironment && game.temp != null && game.temp <= 20 && ["QB", "WR", "TE"].includes(position)) {
    multiplier *= 0.98;
    reasons.push(`${game.temp.toFixed(0)}°F outdoor conditions add a small passing-game penalty.`);
  }

  const environmentParts = [
    game.totalLine != null ? `O/U ${game.totalLine.toFixed(1)}` : null,
    protectedEnvironment ? game.roof || "indoors" : game.temp != null ? `${game.temp.toFixed(0)}°F` : null,
    !protectedEnvironment && game.wind != null ? `${game.wind.toFixed(0)} mph wind` : null,
  ].filter(Boolean);

  return {
    multiplier: clamp(multiplier, 0.88, 1.08),
    note: environmentParts.join(" · ") || "Standard game environment",
    reasons,
  };
}

function matchupLabel(multiplier: number | null): LineupPlayer["matchupLabel"] {
  if (multiplier == null) return "UNKNOWN";
  if (multiplier >= 1.08) return "ELITE";
  if (multiplier >= 1.03) return "PLUS";
  if (multiplier <= 0.92) return "AVOID";
  if (multiplier <= 0.97) return "TOUGH";
  return "NEUTRAL";
}

function buildPlayer(
  playerId: string,
  slot: string | null,
  isCurrentStarter: boolean,
  args: BuildLineupPlanArgs,
  matchupFor: (defense: string | null, position: string) => number | null,
): LineupPlayer | null {
  const player = args.players[playerId];
  const crosswalk = args.crosswalk.get(playerId);
  const position = player?.position || crosswalk?.position || "";
  if (!CORE_POSITIONS.has(position)) return null;
  const team = player?.team || crosswalk?.team || "";
  const game = team ? gameForTeam(args.schedule, args.season, args.week, team) : undefined;
  const opponent = game ? (game.homeTeam === team ? game.awayTeam : game.homeTeam) : null;
  const venue = game ? (game.homeTeam === team ? "HOME" : "AWAY") : null;
  const gsisId = crosswalk?.gsisId;
  const projection = gsisId ? projectPlayer(args.historicalStats.get(gsisId), args.scoring) : null;
  const matchup = matchupFor(opponent, position);
  const environment = environmentMultiplier(game, position);
  const injury = injuryMultiplier(player);
  const opportunity = projection ? clamp(1 + (projection.opportunityTrend - 50) / 500, 0.95, 1.05) : 1;
  const depth = player?.depth_chart_position ?? player?.depth_chart_order;
  const role = depth === 1 ? 1.02 : depth != null && depth >= 4 ? 0.95 : 1;
  const adjustedProjection = projection
    ? round(projection.mean * (matchup ?? 1) * environment.multiplier * injury * opportunity * role, 2)
    : null;

  const reasons: string[] = [];
  if (matchup != null && opponent) {
    const pct = Math.abs((matchup - 1) * 100).toFixed(0);
    if (matchup >= 1.03) reasons.push(`${opponent} allowed about ${pct}% more ${position} fantasy production than the sampled league baseline.`);
    else if (matchup <= 0.97) reasons.push(`${opponent} allowed about ${pct}% less ${position} fantasy production than the sampled league baseline.`);
  }
  reasons.push(...environment.reasons);
  if (projection?.opportunityTrend != null) {
    if (projection.opportunityTrend >= 65) reasons.push("Recent targets/carries are running above the sampled baseline.");
    else if (projection.opportunityTrend <= 35) reasons.push("Recent opportunity is running below the sampled baseline.");
  }
  if (injury < 1) reasons.push(`Current injury/status designation applies a ${Math.round((1 - injury) * 100)}% availability penalty.`);
  if (!projection) reasons.push("No qualifying prior-season weekly sample is mapped, so WAR ROOM will not manufacture a start/sit projection.");

  const confidence: LineupPlayer["confidence"] = !projection
    ? "INSUFFICIENT"
    : projection.sampleSize >= 6 && matchup != null
      ? "HIGH"
      : projection.sampleSize >= 4
        ? "MEDIUM"
        : "LOW";

  return {
    playerId,
    name: playerName(playerId, player, crosswalk),
    position,
    team: team || "FA",
    slot,
    isCurrentStarter,
    opponent,
    venue,
    projection,
    adjustedProjection,
    matchupMultiplier: matchup,
    environmentMultiplier: environment.multiplier,
    injuryMultiplier: injury,
    matchupLabel: matchupLabel(matchup),
    confidence,
    gameNote: game ? `${venue === "HOME" ? "vs" : "@"} ${opponent} · ${environment.note}` : "No current-week NFL game found",
    reasons,
  };
}

export function buildLineupPlan(args: BuildLineupPlanArgs): LineupPlan {
  const matchupFor = defenseMatchups(args.historicalStats, args.scoring);
  const starterSlots = args.rosterPositions.filter((slot) => !NON_STARTER_SLOTS.has(slot));
  const starterIds = args.roster.starters ?? [];
  const starterSet = new Set(starterIds);

  const starters = starterIds
    .map((playerId, index) => buildPlayer(playerId, starterSlots[index] ?? null, true, args, matchupFor))
    .filter((player): player is LineupPlayer => Boolean(player));

  const bench = (args.roster.players ?? [])
    .filter((playerId) => !starterSet.has(playerId))
    .map((playerId) => buildPlayer(playerId, null, false, args, matchupFor))
    .filter((player): player is LineupPlayer => Boolean(player));

  const opportunities: LineupSwap[] = [];
  for (const starter of starters) {
    if (!starter.slot || starter.adjustedProjection == null) continue;
    for (const candidate of bench) {
      if (candidate.adjustedProjection == null || !slotSupports(starter.slot, candidate.position)) continue;
      const gain = candidate.adjustedProjection - starter.adjustedProjection;
      const starterUnavailable = starter.injuryMultiplier <= 0.55;
      if (gain < 1 && !starterUnavailable) continue;
      if (gain <= 0 && !starterUnavailable) continue;
      const confidence: LineupSwap["confidence"] = candidate.confidence === "HIGH" && starter.confidence === "HIGH"
        ? "HIGH"
        : candidate.confidence === "LOW" || starter.confidence === "LOW"
          ? "LOW"
          : "MEDIUM";
      const reasons = [
        `${candidate.name} projects ${round(Math.max(gain, 0), 1).toFixed(1)} points above ${starter.name} in the ${starter.slot} slot.`,
        ...candidate.reasons.slice(0, 2),
      ];
      if (starterUnavailable) reasons.unshift(`${starter.name}'s current status materially lowers his playable projection.`);
      opportunities.push({
        slot: starter.slot,
        start: candidate,
        sit: starter,
        projectedGain: round(Math.max(gain, 0), 1),
        confidence,
        reasons,
      });
    }
  }

  opportunities.sort((a, b) => b.projectedGain - a.projectedGain);
  const usedStarts = new Set<string>();
  const usedSits = new Set<string>();
  const swaps: LineupSwap[] = [];
  for (const opportunity of opportunities) {
    if (usedStarts.has(opportunity.start.playerId) || usedSits.has(opportunity.sit.playerId)) continue;
    swaps.push(opportunity);
    usedStarts.add(opportunity.start.playerId);
    usedSits.add(opportunity.sit.playerId);
    if (swaps.length >= 5) break;
  }

  const currentProjectedPoints = round(starters.reduce((sum, player) => sum + (player.adjustedProjection ?? 0), 0), 1);
  const projectedGain = round(swaps.reduce((sum, swap) => sum + swap.projectedGain, 0), 1);

  return {
    starters,
    bench: bench.sort((a, b) => (b.adjustedProjection ?? -1) - (a.adjustedProjection ?? -1)),
    swaps,
    currentProjectedPoints,
    optimizedProjectedPoints: round(currentProjectedPoints + projectedGain, 1),
    projectedGain,
    supportedStarterSlots: starters.length,
    evidenceSeason: args.evidenceSeason,
    week: args.week,
  };
}
