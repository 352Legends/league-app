import { projectPlayer, type PlayerProjection } from "@/lib/analytics/waivers";
import type { PlayerIdCrosswalk, WeeklyPlayerStat } from "@/lib/nflverse/client";
import type { SleeperLeagueUser, SleeperMatchup, SleeperPlayer, SleeperRoster } from "@/lib/sleeper/types";

export type TeamSeasonProfile = {
  rosterId: number;
  managerName: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  projectedMean: number;
  projectedSd: number;
  projectedFloor: number;
  projectedCeiling: number;
  supportedStarters: number;
  totalStarterSlots: number;
  evidenceLabel: string;
};

export type TeamSimulationResult = TeamSeasonProfile & {
  playoffProbability: number;
  byeProbability: number;
  championshipProbability: number;
  averageSeed: number;
  expectedFinalWins: number;
};

export type ChampionshipSimulation = {
  iterations: number;
  currentWeek: number;
  playoffWeekStart: number;
  playoffTeams: number;
  byeTeams: number;
  scheduledWeeks: number[];
  missingScheduleWeeks: number[];
  teams: TeamSimulationResult[];
};

export type ChampionshipImpact = {
  baseline: ChampionshipSimulation;
  scenario: ChampionshipSimulation | null;
  userRosterId: number;
  weeklyBoost: number;
  playoffDelta: number | null;
  byeDelta: number | null;
  championshipDelta: number | null;
};

type BuildChampionshipImpactArgs = {
  rosters: SleeperRoster[];
  users: SleeperLeagueUser[];
  players: Record<string, SleeperPlayer>;
  rosterPositions: string[];
  scoring: Record<string, number>;
  leagueSettings: Record<string, number | string | null>;
  crosswalk: Map<string, PlayerIdCrosswalk>;
  baselineStats: Map<string, WeeklyPlayerStat[]>;
  currentStats: Map<string, WeeklyPlayerStat[]>;
  matchupsByWeek: Map<number, SleeperMatchup[]>;
  currentWeek: number;
  userRosterId: number;
  weeklyBoost?: number;
  iterations?: number;
  seed?: number;
};

type SimStanding = {
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
};

type PlayerModel = {
  projection: PlayerProjection;
  mean: number;
  sd: number;
  floor: number;
  ceiling: number;
};

const CORE_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const NON_STARTER_SLOTS = new Set(["BN", "IR", "TAXI"]);
const UNMODELED_SLOT_MEAN = 7.5;
const UNMODELED_SLOT_SD = 4.0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

function managerNames(users: SleeperLeagueUser[]): Map<string, { manager: string; team: string }> {
  return new Map(users.map((user) => {
    const manager = user.display_name || user.username || `Manager ${user.user_id.slice(-4)}`;
    return [user.user_id, { manager, team: user.metadata?.team_name || manager }];
  }));
}

function fantasyPoints(settings: Record<string, number | null>): number {
  return Number(settings.fpts ?? 0) + Number(settings.fpts_decimal ?? 0) / 100;
}

function combinedEvidence(
  playerId: string,
  crosswalk: Map<string, PlayerIdCrosswalk>,
  baselineStats: Map<string, WeeklyPlayerStat[]>,
  currentStats: Map<string, WeeklyPlayerStat[]>,
): { baseline: WeeklyPlayerStat[]; current: WeeklyPlayerStat[] } {
  const gsisId = crosswalk.get(playerId)?.gsisId;
  if (!gsisId) return { baseline: [], current: [] };
  return {
    baseline: baselineStats.get(gsisId) ?? [],
    current: currentStats.get(gsisId) ?? [],
  };
}

function injuryRoleMultiplier(player: SleeperPlayer | undefined): number {
  if (!player) return 0.95;
  const status = `${player.status ?? ""} ${player.injury_status ?? ""}`.toLowerCase();
  if (status.includes("out") || status.includes("reserve") || status.includes("ir")) return 0.3;
  if (status.includes("doubt")) return 0.65;
  if (status.includes("question")) return 0.92;
  const depth = player.depth_chart_position ?? player.depth_chart_order;
  if (depth === 1) return 1.02;
  if (depth != null && depth >= 4) return 0.94;
  return 1;
}

function blendProjection(
  baseline: PlayerProjection | null,
  current: PlayerProjection | null,
  player: SleeperPlayer | undefined,
): PlayerModel | null {
  if (!baseline && !current) return null;
  const currentWeight = current ? clamp(current.sampleSize * 0.18, 0.18, 0.78) : 0;
  const baselineWeight = baseline ? 1 - currentWeight : 0;
  const normalizer = baselineWeight + currentWeight || 1;
  const weighted = (base: number | undefined, now: number | undefined) =>
    ((base ?? 0) * baselineWeight + (now ?? 0) * currentWeight) / normalizer;

  const role = injuryRoleMultiplier(player);
  const mean = weighted(baseline?.mean, current?.mean) * role;
  const floor = weighted(baseline?.floor, current?.floor) * role;
  const ceiling = weighted(baseline?.ceiling, current?.ceiling) * role;
  const sd = Math.max(1.8, (ceiling - floor) / 2.05);
  const projection = current ?? baseline!;
  return { projection, mean, sd, floor, ceiling };
}

function slotSupports(slot: string, position: string): boolean {
  if (slot === position) return true;
  if (["FLEX", "WRT", "WRRBTE_FLEX"].includes(slot)) return ["RB", "WR", "TE"].includes(position);
  if (["SUPER_FLEX", "SUPERFLEX", "OP"].includes(slot)) return ["QB", "RB", "WR", "TE"].includes(position);
  if (["REC_FLEX", "WRTE_FLEX"].includes(slot)) return ["WR", "TE"].includes(position);
  if (["WRRB_FLEX", "RBWR_FLEX"].includes(slot)) return ["RB", "WR"].includes(position);
  return false;
}

function slotFlexibility(slot: string): number {
  if (["QB", "RB", "WR", "TE"].includes(slot)) return 1;
  if (["REC_FLEX", "WRTE_FLEX", "WRRB_FLEX", "RBWR_FLEX"].includes(slot)) return 2;
  if (["FLEX", "WRT", "WRRBTE_FLEX"].includes(slot)) return 3;
  if (["SUPER_FLEX", "SUPERFLEX", "OP"].includes(slot)) return 4;
  return 10;
}

function buildTeamProfiles(args: BuildChampionshipImpactArgs): TeamSeasonProfile[] {
  const names = managerNames(args.users);
  const starterSlots = args.rosterPositions.filter((slot) => !NON_STARTER_SLOTS.has(slot));
  const modelCache = new Map<string, PlayerModel | null>();

  const getModel = (playerId: string): PlayerModel | null => {
    if (modelCache.has(playerId)) return modelCache.get(playerId) ?? null;
    const player = args.players[playerId];
    const position = player?.position || args.crosswalk.get(playerId)?.position || "";
    if (!CORE_POSITIONS.has(position)) {
      modelCache.set(playerId, null);
      return null;
    }
    const evidence = combinedEvidence(playerId, args.crosswalk, args.baselineStats, args.currentStats);
    const baseline = projectPlayer(evidence.baseline, args.scoring);
    const current = projectPlayer(evidence.current, args.scoring);
    const model = blendProjection(baseline, current, player);
    modelCache.set(playerId, model);
    return model;
  };

  return args.rosters.map((roster) => {
    const owner = roster.owner_id ? names.get(roster.owner_id) : undefined;
    const available = (roster.players ?? [])
      .map((playerId) => {
        const player = args.players[playerId];
        const position = player?.position || args.crosswalk.get(playerId)?.position || "";
        const model = getModel(playerId);
        return { playerId, position, model };
      })
      .filter((row): row is { playerId: string; position: string; model: PlayerModel } => Boolean(row.model && CORE_POSITIONS.has(row.position)));

    const used = new Set<string>();
    const selected: PlayerModel[] = [];
    const coreSlots = starterSlots
      .filter((slot) => slotFlexibility(slot) < 10)
      .sort((a, b) => slotFlexibility(a) - slotFlexibility(b));

    for (const slot of coreSlots) {
      const best = available
        .filter((row) => !used.has(row.playerId) && slotSupports(slot, row.position))
        .sort((a, b) => b.model.mean - a.model.mean)[0];
      if (!best) continue;
      used.add(best.playerId);
      selected.push(best.model);
    }

    const unsupportedSlots = Math.max(0, starterSlots.length - selected.length);
    let mean = selected.reduce((sum, model) => sum + model.mean, 0) + unsupportedSlots * UNMODELED_SLOT_MEAN;
    let variance = selected.reduce((sum, model) => sum + model.sd ** 2, 0) + unsupportedSlots * UNMODELED_SLOT_SD ** 2;
    let floor = selected.reduce((sum, model) => sum + model.floor, 0) + unsupportedSlots * Math.max(0, UNMODELED_SLOT_MEAN - UNMODELED_SLOT_SD);
    let ceiling = selected.reduce((sum, model) => sum + model.ceiling, 0) + unsupportedSlots * (UNMODELED_SLOT_MEAN + UNMODELED_SLOT_SD * 1.3);

    const wins = Number(roster.settings.wins ?? 0);
    const losses = Number(roster.settings.losses ?? 0);
    const ties = Number(roster.settings.ties ?? 0);
    const pointsFor = fantasyPoints(roster.settings);
    const completedGames = wins + losses + ties;
    if (completedGames >= 2 && pointsFor > 0) {
      const actualPpg = pointsFor / completedGames;
      const actualWeight = clamp(completedGames * 0.045, 0.08, 0.38);
      mean = mean * (1 - actualWeight) + actualPpg * actualWeight;
      floor = floor * (1 - actualWeight) + Math.max(0, actualPpg - Math.sqrt(variance)) * actualWeight;
      ceiling = ceiling * (1 - actualWeight) + (actualPpg + Math.sqrt(variance)) * actualWeight;
    }

    variance *= 1.08;
    const currentEvidencePlayers = (roster.players ?? []).filter((playerId) => {
      const gsisId = args.crosswalk.get(playerId)?.gsisId;
      return gsisId ? (args.currentStats.get(gsisId)?.length ?? 0) > 0 : false;
    }).length;

    return {
      rosterId: roster.roster_id,
      managerName: owner?.manager ?? `Roster ${roster.roster_id}`,
      teamName: owner?.team ?? `Team ${roster.roster_id}`,
      wins,
      losses,
      ties,
      pointsFor,
      projectedMean: round(mean, 2),
      projectedSd: round(Math.max(7.5, Math.sqrt(variance)), 2),
      projectedFloor: round(Math.max(0, floor), 2),
      projectedCeiling: round(Math.max(mean, ceiling), 2),
      supportedStarters: selected.length,
      totalStarterSlots: starterSlots.length,
      evidenceLabel: currentEvidencePlayers >= 4 ? "CURRENT + BASELINE" : currentEvidencePlayers > 0 ? "EARLY CURRENT + BASELINE" : "BASELINE + CURRENT ROLE",
    };
  });
}

function settingNumber(settings: Record<string, number | string | null>, key: string, fallback: number): number {
  const value = Number(settings[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) power *= 2;
  return power;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalRandom(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampledScore(profile: TeamSeasonProfile, rng: () => number, boost = 0): number {
  return Math.max(0, profile.projectedMean + boost + normalRandom(rng) * profile.projectedSd);
}

function sortStandings(standings: SimStanding[]): SimStanding[] {
  return [...standings].sort((a, b) => {
    const aRecord = a.wins + a.ties * 0.5;
    const bRecord = b.wins + b.ties * 0.5;
    return bRecord - aRecord || b.pointsFor - a.pointsFor || a.rosterId - b.rosterId;
  });
}

function matchupPairs(matchups: SleeperMatchup[]): Array<[number, number]> {
  const groups = new Map<number, number[]>();
  for (const matchup of matchups) {
    if (matchup.matchup_id == null) continue;
    const list = groups.get(matchup.matchup_id) ?? [];
    list.push(matchup.roster_id);
    groups.set(matchup.matchup_id, list);
  }
  return [...groups.values()].filter((group) => group.length === 2).map((group) => [group[0], group[1]] as [number, number]);
}

function simulatePlayoffs(
  seeds: SimStanding[],
  profiles: Map<number, TeamSeasonProfile>,
  byeTeams: number,
  rng: () => number,
  scenarioRosterId: number,
  weeklyBoost: number,
): number | null {
  if (seeds.length < 2) return seeds[0]?.rosterId ?? null;
  const seedRank = new Map(seeds.map((team, index) => [team.rosterId, index + 1]));
  let alive = seeds.map((team) => team.rosterId);
  const byes = alive.slice(0, byeTeams);
  let active = alive.slice(byeTeams);

  const playRound = (teams: number[]): number[] => {
    const sorted = [...teams].sort((a, b) => (seedRank.get(a) ?? 99) - (seedRank.get(b) ?? 99));
    const winners: number[] = [];
    while (sorted.length >= 2) {
      const high = sorted.shift()!;
      const low = sorted.pop()!;
      const highProfile = profiles.get(high);
      const lowProfile = profiles.get(low);
      if (!highProfile || !lowProfile) continue;
      const highScore = sampledScore(highProfile, rng, high === scenarioRosterId ? weeklyBoost : 0);
      const lowScore = sampledScore(lowProfile, rng, low === scenarioRosterId ? weeklyBoost : 0);
      winners.push(highScore >= lowScore ? high : low);
    }
    if (sorted.length === 1) winners.push(sorted[0]);
    return winners;
  };

  active = playRound(active);
  alive = [...byes, ...active];
  while (alive.length > 1) alive = playRound(alive);
  return alive[0] ?? null;
}

function simulate(
  args: BuildChampionshipImpactArgs,
  profiles: TeamSeasonProfile[],
  weeklyBoost: number,
): ChampionshipSimulation {
  const iterations = clamp(Math.round(args.iterations ?? 5000), 1000, 20000);
  const playoffWeekStart = Math.round(settingNumber(args.leagueSettings, "playoff_week_start", 15));
  const defaultPlayoffTeams = args.rosters.length >= 10 ? 6 : Math.min(4, args.rosters.length);
  const playoffTeams = Math.min(args.rosters.length, Math.max(2, Math.round(settingNumber(args.leagueSettings, "playoff_teams", defaultPlayoffTeams))));
  const byeTeams = Math.max(0, Math.min(playoffTeams - 2, nextPowerOfTwo(playoffTeams) - playoffTeams));
  const regularSeasonWeeks = Array.from(
    { length: Math.max(0, playoffWeekStart - args.currentWeek) },
    (_, index) => args.currentWeek + index,
  );
  const pairsByWeek = new Map<number, Array<[number, number]>>();
  const scheduledWeeks: number[] = [];
  const missingScheduleWeeks: number[] = [];
  for (const week of regularSeasonWeeks) {
    const pairs = matchupPairs(args.matchupsByWeek.get(week) ?? []);
    pairsByWeek.set(week, pairs);
    const coveredTeams = new Set(pairs.flat());
    if (pairs.length && coveredTeams.size >= Math.max(2, args.rosters.length - (args.rosters.length % 2))) scheduledWeeks.push(week);
    else missingScheduleWeeks.push(week);
  }

  const profileById = new Map(profiles.map((profile) => [profile.rosterId, profile]));
  const counters = new Map(profiles.map((profile) => [profile.rosterId, {
    playoffs: 0,
    byes: 0,
    titles: 0,
    seedTotal: 0,
    winsTotal: 0,
  }]));
  const seed = (args.seed ?? 0x57415252) >>> 0;
  const rng = mulberry32(seed);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const standings = new Map<number, SimStanding>(profiles.map((profile) => [profile.rosterId, {
      rosterId: profile.rosterId,
      wins: profile.wins,
      losses: profile.losses,
      ties: profile.ties,
      pointsFor: profile.pointsFor,
    }]));

    for (const week of scheduledWeeks) {
      for (const [rosterA, rosterB] of pairsByWeek.get(week) ?? []) {
        const standingA = standings.get(rosterA);
        const standingB = standings.get(rosterB);
        const profileA = profileById.get(rosterA);
        const profileB = profileById.get(rosterB);
        if (!standingA || !standingB || !profileA || !profileB) continue;
        const scoreA = sampledScore(profileA, rng, rosterA === args.userRosterId ? weeklyBoost : 0);
        const scoreB = sampledScore(profileB, rng, rosterB === args.userRosterId ? weeklyBoost : 0);
        standingA.pointsFor += scoreA;
        standingB.pointsFor += scoreB;
        if (Math.abs(scoreA - scoreB) < 0.05) {
          standingA.ties += 1;
          standingB.ties += 1;
        } else if (scoreA > scoreB) {
          standingA.wins += 1;
          standingB.losses += 1;
        } else {
          standingB.wins += 1;
          standingA.losses += 1;
        }
      }
    }

    const ranked = sortStandings([...standings.values()]);
    const seeds = ranked.slice(0, playoffTeams);
    for (let index = 0; index < ranked.length; index += 1) {
      const counter = counters.get(ranked[index].rosterId)!;
      counter.seedTotal += index + 1;
      counter.winsTotal += ranked[index].wins + ranked[index].ties * 0.5;
      if (index < playoffTeams) counter.playoffs += 1;
      if (index < byeTeams) counter.byes += 1;
    }

    const champion = simulatePlayoffs(seeds, profileById, byeTeams, rng, args.userRosterId, weeklyBoost);
    if (champion != null) counters.get(champion)!.titles += 1;
  }

  const teams = profiles.map((profile) => {
    const counter = counters.get(profile.rosterId)!;
    return {
      ...profile,
      playoffProbability: round((counter.playoffs / iterations) * 100, 1),
      byeProbability: round((counter.byes / iterations) * 100, 1),
      championshipProbability: round((counter.titles / iterations) * 100, 1),
      averageSeed: round(counter.seedTotal / iterations, 2),
      expectedFinalWins: round(counter.winsTotal / iterations, 2),
    } satisfies TeamSimulationResult;
  }).sort((a, b) => b.championshipProbability - a.championshipProbability || b.playoffProbability - a.playoffProbability);

  return {
    iterations,
    currentWeek: args.currentWeek,
    playoffWeekStart,
    playoffTeams,
    byeTeams,
    scheduledWeeks,
    missingScheduleWeeks,
    teams,
  };
}

export function buildChampionshipImpact(args: BuildChampionshipImpactArgs): ChampionshipImpact {
  const profiles = buildTeamProfiles(args);
  const weeklyBoost = clamp(Number(args.weeklyBoost ?? 0), -15, 15);
  const baseline = simulate(args, profiles, 0);
  const scenario = Math.abs(weeklyBoost) >= 0.05 ? simulate(args, profiles, weeklyBoost) : null;
  const baselineUser = baseline.teams.find((team) => team.rosterId === args.userRosterId);
  const scenarioUser = scenario?.teams.find((team) => team.rosterId === args.userRosterId);

  return {
    baseline,
    scenario,
    userRosterId: args.userRosterId,
    weeklyBoost: round(weeklyBoost, 1),
    playoffDelta: baselineUser && scenarioUser ? round(scenarioUser.playoffProbability - baselineUser.playoffProbability, 1) : null,
    byeDelta: baselineUser && scenarioUser ? round(scenarioUser.byeProbability - baselineUser.byeProbability, 1) : null,
    championshipDelta: baselineUser && scenarioUser ? round(scenarioUser.championshipProbability - baselineUser.championshipProbability, 1) : null,
  };
}
