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
  SleeperUser,
} from "./types";

const BASE_URL = "https://api.sleeper.app/v1";

export class SleeperApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "SleeperApiError";
  }
}

async function sleeperFetch<T>(path: string, revalidate = 60): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "WAR-ROOM/0.6" },
    next: { revalidate },
  });

  if (!response.ok) {
    throw new SleeperApiError(
      `Sleeper request failed with ${response.status}`,
      response.status,
      path,
    );
  }

  return (await response.json()) as T;
}

export const sleeper = {
  getUser(usernameOrId: string) {
    return sleeperFetch<SleeperUser>(`/user/${encodeURIComponent(usernameOrId)}`, 300);
  },
  getNflState() {
    return sleeperFetch<SleeperNflState>("/state/nfl", 60);
  },
  getLeagues(userId: string, season: string) {
    return sleeperFetch<SleeperLeague[]>(`/user/${encodeURIComponent(userId)}/leagues/nfl/${encodeURIComponent(season)}`, 120);
  },
  getLeague(leagueId: string) {
    return sleeperFetch<SleeperLeague>(`/league/${encodeURIComponent(leagueId)}`, 60);
  },
  getLeagueUsers(leagueId: string) {
    return sleeperFetch<SleeperLeagueUser[]>(`/league/${encodeURIComponent(leagueId)}/users`, 60);
  },
  getRosters(leagueId: string) {
    return sleeperFetch<SleeperRoster[]>(`/league/${encodeURIComponent(leagueId)}/rosters`, 60);
  },
  getMatchups(leagueId: string, week: number) {
    return sleeperFetch<SleeperMatchup[]>(`/league/${encodeURIComponent(leagueId)}/matchups/${week}`, 30);
  },
  getTransactions(leagueId: string, week: number) {
    return sleeperFetch<SleeperTransaction[]>(`/league/${encodeURIComponent(leagueId)}/transactions/${week}`, 120);
  },
  getDrafts(leagueId: string) {
    return sleeperFetch<SleeperDraft[]>(`/league/${encodeURIComponent(leagueId)}/drafts`, 300);
  },
  getActivePlayers() {
    return sleeperFetch<Record<string, SleeperPlayer>>("/players/nfl?active=true", 86400);
  },
  getTrending(type: "add" | "drop", lookbackHours = 24, limit = 100) {
    return sleeperFetch<SleeperTrendingPlayer[]>(
      `/players/nfl/trending/${type}?lookback_hours=${lookbackHours}&limit=${limit}`,
      300,
    );
  },
};
