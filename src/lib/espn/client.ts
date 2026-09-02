import type {
  SleeperDraft,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperMatchup,
  SleeperNflState,
  SleeperPlayer,
  SleeperRoster,
  SleeperTransaction,
  SleeperTrendingPlayer,
} from "@/lib/sleeper/types";

const READ_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

export type EspnCredentials = {
  swid?: string | null;
  espnS2?: string | null;
};

type Json = Record<string, unknown>;

export class EspnApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
    public readonly code: "ACCESS_DENIED" | "NOT_FOUND" | "UPSTREAM" = "UPSTREAM",
  ) {
    super(message);
    this.name = "EspnApiError";
  }
}

const SLOT_MAP: Record<number, string> = {
  0: "QB",
  1: "QB",
  2: "RB",
  3: "FLEX",
  4: "WR",
  5: "REC_FLEX",
  6: "TE",
  7: "SUPER_FLEX",
  16: "DEF",
  17: "K",
  20: "BN",
  21: "IR",
  23: "FLEX",
};

const POSITION_MAP: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DEF",
};

const PRO_TEAM_MAP: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function bool(value: unknown): boolean {
  return value === true;
}

function cookieHeader(credentials?: EspnCredentials): string | undefined {
  const swid = credentials?.swid?.trim();
  const espnS2 = credentials?.espnS2?.trim();
  if (!swid || !espnS2) return undefined;
  return `SWID=${swid}; espn_s2=${espnS2}`;
}

async function espnFetch<T>(url: string, credentials?: EspnCredentials, init?: RequestInit & { revalidate?: number }): Promise<T> {
  const cookie = cookieHeader(credentials);
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set("User-Agent", "WAR-ROOM/0.8 ESPN-Adapter");
  if (cookie) headers.set("Cookie", cookie);

  const response = await fetch(url, {
    ...init,
    headers,
    next: { revalidate: init?.revalidate ?? 60 },
  });
  if (response.status === 401 || response.status === 403) {
    throw new EspnApiError("ESPN league access requires valid SWID and espn_s2 credentials.", response.status, url, "ACCESS_DENIED");
  }
  if (response.status === 404) {
    throw new EspnApiError("ESPN league was not found for that season.", 404, url, "NOT_FOUND");
  }
  if (!response.ok) {
    throw new EspnApiError(`ESPN request failed with ${response.status}.`, response.status, url);
  }
  const payload = await response.json();
  return (Array.isArray(payload) && payload.length === 1 ? payload[0] : payload) as T;
}

function leagueUrl(leagueId: string, season: number): string {
  return `${READ_BASE}/seasons/${season}/segments/0/leagues/${encodeURIComponent(leagueId)}`;
}

async function getRawLeague(leagueId: string, season: number, credentials?: EspnCredentials, views = ["mTeam", "mRoster", "mMatchup", "mSettings", "mStandings"]): Promise<Json> {
  const url = new URL(leagueUrl(leagueId, season));
  for (const view of views) url.searchParams.append("view", view);
  return espnFetch<Json>(url.toString(), credentials, { revalidate: 45 });
}

function expandRosterPositions(settings: Json): string[] {
  const rosterSettings = object(settings.rosterSettings);
  const counts = object(rosterSettings.lineupSlotCounts);
  const positions: string[] = [];
  for (const [slotId, rawCount] of Object.entries(counts)) {
    const label = SLOT_MAP[number(slotId)] ?? `SLOT_${slotId}`;
    const count = Math.max(0, Math.round(number(rawCount)));
    for (let i = 0; i < count; i += 1) positions.push(label);
  }
  return positions;
}

function normalizedScoring(settings: Json): Record<string, number> {
  const items = array(object(settings.scoringSettings).scoringItems).map(object);
  const result: Record<string, number> = {};
  const set = (key: string, value: number) => { if (Number.isFinite(value)) result[key] = value; };

  for (const item of items) {
    const statId = number(item.statId, -1);
    const points = number(item.points);
    const overrides = object(item.pointsOverrides);
    const effective = number(overrides["16"], points);
    if (statId === 3) set("pass_yd", effective);
    else if (statId === 4) set("pass_td", effective);
    else if (statId === 19) set("pass_2pt", effective);
    else if (statId === 20) set("pass_int", effective);
    else if (statId === 24) set("rush_yd", effective);
    else if (statId === 25) set("rush_td", effective);
    else if (statId === 26) set("rush_2pt", effective);
    else if (statId === 41 || statId === 53) set("rec", effective);
    else if (statId === 42 || statId === 61) set("rec_yd", effective);
    else if (statId === 43) set("rec_td", effective);
    else if (statId === 44) set("rec_2pt", effective);
    else if (statId === 72) set("fum_lost", effective);
  }
  return result;
}

function leagueStatus(raw: Json): string {
  const status = object(raw.status);
  const finalPeriod = number(status.finalScoringPeriod, 18);
  const current = number(raw.scoringPeriodId, number(status.latestScoringPeriod, 1));
  if (bool(object(raw.draftDetail).drafted) === false && current <= 1) return "pre_draft";
  if (current > finalPeriod) return "complete";
  return "in_season";
}

function normalizeLeague(raw: Json, leagueId: string, season: number): SleeperLeague {
  const settings = object(raw.settings);
  const schedule = object(settings.scheduleSettings);
  const regularPeriods = number(schedule.matchupPeriodCount, 14);
  return {
    league_id: String(raw.id ?? leagueId),
    name: text(settings.name, `ESPN League ${leagueId}`),
    season: String(raw.seasonId ?? season),
    sport: "nfl",
    status: leagueStatus(raw),
    total_rosters: number(settings.size, array(raw.teams).length),
    draft_id: null,
    avatar: null,
    roster_positions: expandRosterPositions(settings),
    scoring_settings: normalizedScoring(settings),
    settings: {
      playoff_week_start: regularPeriods + 1,
      playoff_teams: number(schedule.playoffTeamCount, 6),
      regular_season_weeks: regularPeriods,
      provider: "espn",
    },
  };
}

function normalizeUsers(raw: Json): SleeperLeagueUser[] {
  return array(raw.members).map(object).map((member) => ({
    user_id: text(member.id),
    username: text(member.displayName, text(member.firstName, "ESPN Manager")),
    display_name: text(member.displayName, text(member.firstName, "ESPN Manager")),
    avatar: null,
    metadata: { provider: "espn" },
  })).filter((user) => Boolean(user.user_id));
}

function rawPlayerFromEntry(entry: Json): Json {
  const pool = object(entry.playerPoolEntry);
  return object(pool.player ?? entry.player);
}

function normalizePlayer(raw: Json): SleeperPlayer {
  const id = String(raw.id ?? "");
  const eligible = array(raw.eligibleSlots).map((slot) => SLOT_MAP[number(slot)]).filter((slot): slot is string => Boolean(slot));
  const position = POSITION_MAP[number(raw.defaultPositionId)] ?? eligible.find((slot) => ["QB", "RB", "WR", "TE", "K", "DEF"].includes(slot)) ?? null;
  const injury = text(raw.injuryStatus).toLowerCase();
  return {
    player_id: id,
    full_name: text(raw.fullName, id),
    first_name: text(raw.firstName) || null,
    last_name: text(raw.lastName) || null,
    team: PRO_TEAM_MAP[number(raw.proTeamId)] ?? null,
    position,
    fantasy_positions: eligible,
    status: bool(raw.active) || !bool(raw.injured) ? "Active" : "Inactive",
    injury_status: injury || null,
    number: number(raw.jersey) || null,
  };
}

function normalizeRosters(raw: Json, leagueId: string): SleeperRoster[] {
  return array(raw.teams).map(object).map((team) => {
    const entries = array(object(team.roster).entries).map(object);
    const ids: string[] = [];
    const starters: string[] = [];
    const reserve: string[] = [];
    for (const entry of entries) {
      const player = rawPlayerFromEntry(entry);
      const id = String(player.id ?? "");
      if (!id) continue;
      ids.push(id);
      const slot = number(entry.lineupSlotId, 20);
      if (slot === 21) reserve.push(id);
      else if (slot !== 20) starters.push(id);
    }
    const record = object(object(team.record).overall);
    return {
      roster_id: number(team.id),
      owner_id: array(team.owners).map(String)[0] ?? null,
      league_id: leagueId,
      players: ids,
      starters,
      reserve,
      taxi: [],
      settings: {
        wins: number(record.wins),
        losses: number(record.losses),
        ties: number(record.ties),
        fpts: number(record.pointsFor),
        fpts_against: number(record.pointsAgainst),
        rank: number(team.playoffSeed),
        waiver_position: number(team.waiverRank),
      },
      metadata: {
        team_name: text(team.name, `${text(team.location)} ${text(team.nickname)}`.trim()),
        abbreviation: text(team.abbrev),
        provider: "espn",
      },
    };
  });
}

function normalizePlayersFromLeague(raw: Json): Record<string, SleeperPlayer> {
  const players: Record<string, SleeperPlayer> = {};
  for (const team of array(raw.teams).map(object)) {
    for (const entry of array(object(team.roster).entries).map(object)) {
      const rawPlayer = rawPlayerFromEntry(entry);
      const player = normalizePlayer(rawPlayer);
      if (player.player_id) players[player.player_id] = player;
    }
  }
  return players;
}

function normalizeMatchups(raw: Json, week: number, rosters: SleeperRoster[]): SleeperMatchup[] {
  const rosterById = new Map(rosters.map((roster) => [roster.roster_id, roster]));
  const rows: SleeperMatchup[] = [];
  for (const matchup of array(raw.schedule).map(object)) {
    if (number(matchup.matchupPeriodId) !== week) continue;
    const matchupId = number(matchup.id, rows.length + 1);
    for (const sideKey of ["home", "away"] as const) {
      const side = object(matchup[sideKey]);
      const teamId = number(side.teamId, -1);
      if (teamId < 0) continue;
      const roster = rosterById.get(teamId);
      rows.push({
        roster_id: teamId,
        matchup_id: matchupId,
        points: number(side.totalPoints),
        custom_points: null,
        players: roster?.players ?? [],
        starters: roster?.starters ?? [],
      });
    }
  }
  return rows;
}

function normalizeState(raw: Json, season: number): SleeperNflState {
  const status = object(raw.status);
  const week = Math.max(1, number(raw.scoringPeriodId, number(status.latestScoringPeriod, 1)));
  return {
    week,
    leg: week,
    season: String(raw.seasonId ?? season),
    season_type: "regular",
    display_week: week,
    league_season: String(raw.seasonId ?? season),
  };
}

async function getActivePlayers(season: number, credentials?: EspnCredentials): Promise<Record<string, SleeperPlayer>> {
  const url = `${READ_BASE}/seasons/${season}/players?view=players_wl`;
  const filter = JSON.stringify({ filterActive: { value: true } });
  const raw = await espnFetch<unknown[]>(url, credentials, {
    headers: { "x-fantasy-filter": filter },
    revalidate: 21600,
  });
  const result: Record<string, SleeperPlayer> = {};
  for (const entry of array(raw).map(object)) {
    const player = normalizePlayer(entry);
    if (player.player_id) result[player.player_id] = player;
  }
  return result;
}

function providerFromRaw(raw: Json, leagueId: string, season: number) {
  const league = normalizeLeague(raw, leagueId, season);
  const rosters = normalizeRosters(raw, leagueId);
  return {
    league,
    users: normalizeUsers(raw),
    rosters,
    state: normalizeState(raw, season),
    rosterPlayers: normalizePlayersFromLeague(raw),
  };
}

export const espn = {
  async validateLeague(leagueId: string, season: number, credentials?: EspnCredentials) {
    const raw = await getRawLeague(leagueId, season, credentials);
    return providerFromRaw(raw, leagueId, season);
  },
  async getLeague(leagueId: string, season: number, credentials?: EspnCredentials) {
    return normalizeLeague(await getRawLeague(leagueId, season, credentials), leagueId, season);
  },
  async getLeagueUsers(leagueId: string, season: number, credentials?: EspnCredentials) {
    return normalizeUsers(await getRawLeague(leagueId, season, credentials, ["mTeam"]));
  },
  async getRosters(leagueId: string, season: number, credentials?: EspnCredentials) {
    return normalizeRosters(await getRawLeague(leagueId, season, credentials, ["mTeam", "mRoster"]), leagueId);
  },
  async getState(leagueId: string, season: number, credentials?: EspnCredentials) {
    return normalizeState(await getRawLeague(leagueId, season, credentials, ["mSettings"]), season);
  },
  async getMatchups(leagueId: string, season: number, week: number, credentials?: EspnCredentials) {
    const raw = await getRawLeague(leagueId, season, credentials, ["mTeam", "mRoster", "mMatchup"]);
    const rosters = normalizeRosters(raw, leagueId);
    return normalizeMatchups(raw, week, rosters);
  },
  async getActivePlayers(leagueId: string, season: number, credentials?: EspnCredentials) {
    const raw = await getRawLeague(leagueId, season, credentials, ["mTeam", "mRoster"]);
    const rosterPlayers = normalizePlayersFromLeague(raw);
    try {
      return { ...(await getActivePlayers(season, credentials)), ...rosterPlayers };
    } catch {
      return rosterPlayers;
    }
  },
  async getDrafts(leagueId: string, season: number, credentials?: EspnCredentials): Promise<SleeperDraft[]> {
    const raw = await getRawLeague(leagueId, season, credentials, ["mDraftDetail"]);
    const detail = object(raw.draftDetail);
    if (!bool(detail.drafted)) return [];
    return [{
      draft_id: `espn:${leagueId}:${season}`,
      league_id: leagueId,
      season: String(season),
      status: "complete",
      type: text(detail.type, "snake").toLowerCase(),
      start_time: number(detail.date) || null,
      settings: {},
      metadata: { provider: "espn" },
    }];
  },
  async getTransactions(): Promise<SleeperTransaction[]> {
    return [];
  },
  async getTrending(): Promise<SleeperTrendingPlayer[]> {
    return [];
  },
};
