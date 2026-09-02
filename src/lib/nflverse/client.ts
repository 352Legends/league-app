import { csvNumber, parseCsv, type CsvRow } from "@/lib/csv";

const PLAYER_IDS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";
const STATS_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
const SCHEDULE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

export type PlayerIdCrosswalk = {
  sleeperId: string;
  gsisId: string;
  name: string;
  position: string;
  team: string;
  draftYear: number | null;
  draftRound: number | null;
  draftPick: number | null;
};

export type WeeklyPlayerStat = {
  gsisId: string;
  name: string;
  position: string;
  team: string;
  opponent: string;
  season: number;
  week: number;
  completions: number;
  attempts: number;
  passingYards: number;
  passingTds: number;
  passingInterceptions: number;
  passing2pt: number;
  carries: number;
  rushingYards: number;
  rushingTds: number;
  rushing2pt: number;
  receptions: number;
  targets: number;
  receivingYards: number;
  receivingTds: number;
  receiving2pt: number;
  targetShare: number;
  fumblesLost: number;
};

export type NflGame = {
  season: number;
  week: number;
  gameType: string;
  awayTeam: string;
  homeTeam: string;
  gameday: string;
  gametime: string;
  roof: string;
  temp: number | null;
  wind: number | null;
  totalLine: number | null;
  spreadLine: number | null;
};

async function fetchText(url: string, revalidate: number): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: "text/csv", "User-Agent": "WAR-ROOM/0.3" },
    next: { revalidate },
  });
  if (!response.ok) throw new Error(`Analytics source request failed (${response.status})`);
  return response.text();
}

function nullableNumber(value: string): number | null {
  if (!value || value === "NA") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadPlayerIdCrosswalk(): Promise<Map<string, PlayerIdCrosswalk>> {
  const rows = parseCsv(await fetchText(PLAYER_IDS_URL, 86400));
  const bySleeper = new Map<string, PlayerIdCrosswalk>();
  for (const row of rows) {
    const sleeperId = row.sleeper_id;
    const gsisId = row.gsis_id;
    if (!sleeperId || sleeperId === "NA" || !gsisId || gsisId === "NA") continue;
    bySleeper.set(sleeperId, {
      sleeperId,
      gsisId,
      name: row.name || "Unknown player",
      position: row.position || "",
      team: row.team || "",
      draftYear: nullableNumber(row.draft_year),
      draftRound: nullableNumber(row.draft_round),
      draftPick: nullableNumber(row.draft_pick),
    });
  }
  return bySleeper;
}

function totalFumblesLost(row: CsvRow): number {
  if (row.fumbles_lost) return csvNumber(row, "fumbles_lost");
  return Math.max(
    csvNumber(row, "sack_fumbles_lost"),
    csvNumber(row, "rushing_fumbles_lost"),
    csvNumber(row, "receiving_fumbles_lost"),
  );
}

export async function loadWeeklyPlayerStats(season: number): Promise<Map<string, WeeklyPlayerStat[]>> {
  const rows = parseCsv(await fetchText(STATS_URL(season), 86400));
  const byPlayer = new Map<string, WeeklyPlayerStat[]>();

  for (const row of rows) {
    if ((row.season_type || "REG") !== "REG") continue;
    const gsisId = row.player_id;
    const position = row.position;
    if (!gsisId || !["QB", "RB", "WR", "TE"].includes(position)) continue;

    const stat: WeeklyPlayerStat = {
      gsisId,
      name: row.player_display_name || row.player_name || gsisId,
      position,
      team: row.team || row.recent_team || "",
      opponent: row.opponent_team || "",
      season: csvNumber(row, "season"),
      week: csvNumber(row, "week"),
      completions: csvNumber(row, "completions"),
      attempts: csvNumber(row, "attempts"),
      passingYards: csvNumber(row, "passing_yards"),
      passingTds: csvNumber(row, "passing_tds"),
      passingInterceptions: csvNumber(row, row.passing_interceptions ? "passing_interceptions" : "interceptions"),
      passing2pt: csvNumber(row, "passing_2pt_conversions"),
      carries: csvNumber(row, "carries"),
      rushingYards: csvNumber(row, "rushing_yards"),
      rushingTds: csvNumber(row, "rushing_tds"),
      rushing2pt: csvNumber(row, "rushing_2pt_conversions"),
      receptions: csvNumber(row, "receptions"),
      targets: csvNumber(row, "targets"),
      receivingYards: csvNumber(row, "receiving_yards"),
      receivingTds: csvNumber(row, "receiving_tds"),
      receiving2pt: csvNumber(row, "receiving_2pt_conversions"),
      targetShare: csvNumber(row, "target_share"),
      fumblesLost: totalFumblesLost(row),
    };
    const list = byPlayer.get(gsisId) ?? [];
    list.push(stat);
    byPlayer.set(gsisId, list);
  }

  for (const stats of byPlayer.values()) stats.sort((a, b) => a.week - b.week);
  return byPlayer;
}

export async function loadNflSchedule(season: number): Promise<NflGame[]> {
  const rows = parseCsv(await fetchText(SCHEDULE_URL, 300));
  return rows
    .filter((row) => csvNumber(row, "season") === season && (row.game_type || "REG") === "REG")
    .map((row) => ({
      season,
      week: csvNumber(row, "week"),
      gameType: row.game_type || "REG",
      awayTeam: row.away_team || "",
      homeTeam: row.home_team || "",
      gameday: row.gameday || "",
      gametime: row.gametime || "",
      roof: row.roof || "",
      temp: nullableNumber(row.temp),
      wind: nullableNumber(row.wind),
      totalLine: nullableNumber(row.total_line),
      spreadLine: nullableNumber(row.spread_line),
    }))
    .filter((game) => Boolean(game.awayTeam && game.homeTeam));
}
