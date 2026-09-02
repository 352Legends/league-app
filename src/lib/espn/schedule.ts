import "server-only";
import type { EspnCredentials } from "@/lib/espn/client";
import type { SleeperMatchup, SleeperRoster } from "@/lib/sleeper/types";

const READ_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getEspnMatchupsByWeek(args: {
  leagueId: string;
  season: number;
  weeks: number[];
  rosters: SleeperRoster[];
  credentials?: EspnCredentials;
}): Promise<Map<number, SleeperMatchup[]>> {
  const url = new URL(`${READ_BASE}/seasons/${args.season}/segments/0/leagues/${encodeURIComponent(args.leagueId)}`);
  url.searchParams.append("view", "mMatchup");
  url.searchParams.append("view", "mMatchupScore");
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "WAR-ROOM/0.8 ESPN-Schedule" };
  if (args.credentials?.swid && args.credentials?.espnS2) headers.Cookie = `SWID=${args.credentials.swid}; espn_s2=${args.credentials.espnS2}`;
  const response = await fetch(url, { headers, next: { revalidate: 45 } });
  if (!response.ok) return new Map(args.weeks.map((week) => [week, []]));
  const payload = await response.json();
  const raw = object(Array.isArray(payload) ? payload[0] : payload);
  const rosterById = new Map(args.rosters.map((roster) => [roster.roster_id, roster]));
  const wanted = new Set(args.weeks);
  const byWeek = new Map<number, SleeperMatchup[]>(args.weeks.map((week) => [week, []]));

  for (const matchup of array(raw.schedule).map(object)) {
    const week = number(matchup.matchupPeriodId);
    if (!wanted.has(week)) continue;
    const rows = byWeek.get(week) ?? [];
    const matchupId = number(matchup.id, rows.length + 1);
    for (const sideKey of ["home", "away"] as const) {
      const side = object(matchup[sideKey]);
      const rosterId = number(side.teamId, -1);
      if (rosterId < 0) continue;
      const roster = rosterById.get(rosterId);
      rows.push({
        roster_id: rosterId,
        matchup_id: matchupId,
        points: number(side.totalPoints),
        custom_points: null,
        players: roster?.players ?? [],
        starters: roster?.starters ?? [],
      });
    }
    byWeek.set(week, rows);
  }
  return byWeek;
}
