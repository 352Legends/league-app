import type { AdvancedPassingStat, WeeklyTeamStat } from "@/lib/nflverse/client";

export type TeamMatchupProfile = {
  team: string;
  games: number;
  passRate: number;
  playsPerGame: number;
  sackRateAllowed: number;
  offenseEpaPerPlay: number;
  passEpaAllowedPerDropback: number;
  rushEpaAllowedPerCarry: number;
  defensiveSackRate: number;
  pressureRate: number | null;
  blitzesPerGame: number | null;
  passRatePercentile: number;
  pacePercentile: number;
  protectionRiskPercentile: number;
  passDefenseEasePercentile: number;
  rushDefenseEasePercentile: number;
  pressureThreatPercentile: number | null;
};

export type MatchupIntelligence = {
  score: number;
  multiplier: number;
  label: "EXPLOIT" | "PLUS" | "NEUTRAL" | "TOUGH" | "RED FLAG" | "UNKNOWN";
  offense: TeamMatchupProfile | null;
  defense: TeamMatchupProfile | null;
  reasons: string[];
};

type RawProfile = {
  games: number;
  passRates: number[];
  plays: number[];
  sackRatesAllowed: number[];
  offenseEpaPerPlay: number[];
  passEpaAllowed: number[];
  rushEpaAllowed: number[];
  defensiveSackRates: number[];
  pressureRates: number[];
  blitzes: number[];
};

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 3) => Number(value.toFixed(digits));

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(value: number, values: number[]): number {
  if (values.length <= 1) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((candidate) => candidate < value).length;
  const equal = sorted.filter((candidate) => candidate === value).length;
  return clamp(((below + Math.max(0, equal - 1) * 0.5) / (sorted.length - 1)) * 100);
}

function rawFor(map: Map<string, RawProfile>, team: string): RawProfile {
  const existing = map.get(team);
  if (existing) return existing;
  const created: RawProfile = {
    games: 0,
    passRates: [],
    plays: [],
    sackRatesAllowed: [],
    offenseEpaPerPlay: [],
    passEpaAllowed: [],
    rushEpaAllowed: [],
    defensiveSackRates: [],
    pressureRates: [],
    blitzes: [],
  };
  map.set(team, created);
  return created;
}

function normalizedPressurePct(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > 1.5 ? value / 100 : value;
}

export function buildTeamMatchupProfiles(
  teamStats: WeeklyTeamStat[],
  advancedPassing: AdvancedPassingStat[],
): Map<string, TeamMatchupProfile> {
  const raw = new Map<string, RawProfile>();

  for (const stat of teamStats) {
    const offense = rawFor(raw, stat.team);
    const defense = rawFor(raw, stat.opponent);
    const dropbacks = Math.max(1, stat.attempts + stat.sacksSuffered);
    const rushes = Math.max(1, stat.carries);
    const plays = Math.max(1, dropbacks + stat.carries);

    offense.games += 1;
    offense.passRates.push(dropbacks / plays);
    offense.plays.push(plays);
    offense.sackRatesAllowed.push(stat.sacksSuffered / dropbacks);
    offense.offenseEpaPerPlay.push((stat.passingEpa + stat.rushingEpa) / plays);

    defense.passEpaAllowed.push(stat.passingEpa / dropbacks);
    defense.rushEpaAllowed.push(stat.rushingEpa / rushes);
    defense.defensiveSackRates.push(stat.sacksSuffered / dropbacks);
  }

  for (const stat of advancedPassing) {
    const defense = rawFor(raw, stat.opponent);
    const pressure = normalizedPressurePct(stat.timesPressuredPct);
    if (pressure != null) defense.pressureRates.push(pressure);
    if (stat.timesBlitzed > 0) defense.blitzes.push(stat.timesBlitzed);
  }

  const base = [...raw.entries()].map(([team, data]) => ({
    team,
    games: data.games,
    passRate: average(data.passRates),
    playsPerGame: average(data.plays),
    sackRateAllowed: average(data.sackRatesAllowed),
    offenseEpaPerPlay: average(data.offenseEpaPerPlay),
    passEpaAllowedPerDropback: average(data.passEpaAllowed),
    rushEpaAllowedPerCarry: average(data.rushEpaAllowed),
    defensiveSackRate: average(data.defensiveSackRates),
    pressureRate: data.pressureRates.length ? average(data.pressureRates) : null,
    blitzesPerGame: data.blitzes.length ? average(data.blitzes) : null,
  }));

  const passRates = base.map((profile) => profile.passRate);
  const paces = base.map((profile) => profile.playsPerGame);
  const sackRatesAllowed = base.map((profile) => profile.sackRateAllowed);
  const passDefense = base.map((profile) => profile.passEpaAllowedPerDropback);
  const rushDefense = base.map((profile) => profile.rushEpaAllowedPerCarry);
  const pressureRates = base.map((profile) => profile.pressureRate).filter((value): value is number => value != null);

  return new Map(base.map((profile) => [profile.team, {
    ...profile,
    passRate: round(profile.passRate),
    playsPerGame: round(profile.playsPerGame, 1),
    sackRateAllowed: round(profile.sackRateAllowed),
    offenseEpaPerPlay: round(profile.offenseEpaPerPlay),
    passEpaAllowedPerDropback: round(profile.passEpaAllowedPerDropback),
    rushEpaAllowedPerCarry: round(profile.rushEpaAllowedPerCarry),
    defensiveSackRate: round(profile.defensiveSackRate),
    pressureRate: profile.pressureRate == null ? null : round(profile.pressureRate),
    blitzesPerGame: profile.blitzesPerGame == null ? null : round(profile.blitzesPerGame, 1),
    passRatePercentile: round(percentile(profile.passRate, passRates), 1),
    pacePercentile: round(percentile(profile.playsPerGame, paces), 1),
    protectionRiskPercentile: round(percentile(profile.sackRateAllowed, sackRatesAllowed), 1),
    passDefenseEasePercentile: round(percentile(profile.passEpaAllowedPerDropback, passDefense), 1),
    rushDefenseEasePercentile: round(percentile(profile.rushEpaAllowedPerCarry, rushDefense), 1),
    pressureThreatPercentile: profile.pressureRate == null ? null : round(percentile(profile.pressureRate, pressureRates), 1),
  }]));
}

function schemeLabel(score: number): MatchupIntelligence["label"] {
  if (score >= 72) return "EXPLOIT";
  if (score >= 58) return "PLUS";
  if (score <= 28) return "RED FLAG";
  if (score <= 42) return "TOUGH";
  return "NEUTRAL";
}

function signedPercentileEdge(percentileValue: number): number {
  return (percentileValue - 50) / 50;
}

export function buildMatchupIntelligence(
  team: string,
  opponent: string | null,
  position: string,
  profiles: Map<string, TeamMatchupProfile>,
): MatchupIntelligence {
  const offense = profiles.get(team) ?? null;
  const defense = opponent ? profiles.get(opponent) ?? null : null;
  if (!offense || !defense) {
    return { score: 50, multiplier: 1, label: "UNKNOWN", offense, defense, reasons: [] };
  }

  let multiplier = 1;
  const reasons: string[] = [];

  const paceEdge = signedPercentileEdge(offense.pacePercentile);
  multiplier += paceEdge * 0.012;
  if (offense.pacePercentile >= 70) reasons.push(`${team} played at a high-volume ${offense.playsPerGame.toFixed(1)} plays/game profile (${offense.pacePercentile.toFixed(0)}th percentile).`);
  else if (offense.pacePercentile <= 30) reasons.push(`${team} carried a lower-volume ${offense.playsPerGame.toFixed(1)} plays/game profile (${offense.pacePercentile.toFixed(0)}th percentile).`);

  if (["QB", "WR", "TE"].includes(position)) {
    const passEase = signedPercentileEdge(defense.passDefenseEasePercentile);
    multiplier += passEase * 0.03;
    if (defense.passDefenseEasePercentile >= 70) reasons.push(`${opponent}'s pass defense graded as an easier EPA matchup (${defense.passDefenseEasePercentile.toFixed(0)}th ease percentile).`);
    else if (defense.passDefenseEasePercentile <= 30) reasons.push(`${opponent}'s pass defense graded as a difficult EPA matchup (${defense.passDefenseEasePercentile.toFixed(0)}th ease percentile).`);

    const passVolume = signedPercentileEdge(offense.passRatePercentile);
    multiplier += passVolume * (position === "QB" ? 0.012 : 0.015);
    if (offense.passRatePercentile >= 70) reasons.push(`${team} used a pass-heavy ${Math.round(offense.passRate * 100)}% dropback share (${offense.passRatePercentile.toFixed(0)}th percentile).`);

    if (defense.pressureThreatPercentile != null) {
      const pressureThreat = signedPercentileEdge(defense.pressureThreatPercentile);
      multiplier -= pressureThreat * (position === "QB" ? 0.025 : 0.012);
      if (defense.pressureThreatPercentile >= 70 && defense.pressureRate != null) {
        reasons.push(`${opponent} created a high-pressure profile: ${(defense.pressureRate * 100).toFixed(1)}% pressured (${defense.pressureThreatPercentile.toFixed(0)}th percentile).`);
      } else if (defense.pressureThreatPercentile <= 30 && defense.pressureRate != null) {
        reasons.push(`${opponent} generated a below-average ${(defense.pressureRate * 100).toFixed(1)}% pressure profile.`);
      }
    }

    if (position === "QB" && defense.pressureThreatPercentile != null && defense.pressureThreatPercentile >= 70 && offense.protectionRiskPercentile >= 70) {
      multiplier -= 0.015;
      reasons.push(`${team}'s protection risk (${offense.protectionRiskPercentile.toFixed(0)}th percentile sack rate allowed) collides with a high-pressure defense.`);
    }
  }

  if (position === "RB") {
    const rushEase = signedPercentileEdge(defense.rushDefenseEasePercentile);
    multiplier += rushEase * 0.032;
    if (defense.rushDefenseEasePercentile >= 70) reasons.push(`${opponent}'s run defense graded as an easier EPA matchup (${defense.rushDefenseEasePercentile.toFixed(0)}th ease percentile).`);
    else if (defense.rushDefenseEasePercentile <= 30) reasons.push(`${opponent}'s run defense graded as a difficult EPA matchup (${defense.rushDefenseEasePercentile.toFixed(0)}th ease percentile).`);

    const runFriendly = -signedPercentileEdge(offense.passRatePercentile);
    multiplier += runFriendly * 0.015;
    if (offense.passRatePercentile <= 30) reasons.push(`${team}'s offensive identity leaned run-heavy relative to the league.`);
    else if (offense.passRatePercentile >= 75) reasons.push(`${team}'s pass-heavy identity modestly reduces expected RB rushing volume.`);
  }

  multiplier = clamp(multiplier, 0.90, 1.10);
  const score = round(clamp(50 + (multiplier - 1) * 500), 1);

  if (defense.blitzesPerGame != null && defense.blitzesPerGame >= 10 && position === "QB") {
    reasons.push(`${opponent} sent ${defense.blitzesPerGame.toFixed(1)} charted blitzes per sampled game; WAR ROOM treats that as context until QB-vs-blitz splits are connected.`);
  }

  return {
    score,
    multiplier: round(multiplier),
    label: schemeLabel(score),
    offense,
    defense,
    reasons,
  };
}
