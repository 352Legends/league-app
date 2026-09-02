import type { SleeperLeagueUser, SleeperMatchup, SleeperPlayer, SleeperRoster } from "@/lib/sleeper/types";

export type LeagueTeamSummary = {
  rosterId: number;
  ownerId: string | null;
  ownerName: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  playerCount: number;
  starterCount: number;
  matchupId: number | null;
  matchupPoints: number;
  topPlayers: Array<{ id: string; name: string; position: string; team: string }>;
};

function fantasyPoints(settings: Record<string, number | null>) {
  const whole = settings.fpts ?? 0;
  const decimal = settings.fpts_decimal ?? 0;
  return Number(whole) + Number(decimal) / 100;
}

export function buildTeamSummaries(
  rosters: SleeperRoster[],
  users: SleeperLeagueUser[],
  matchups: SleeperMatchup[],
  players: Record<string, SleeperPlayer>,
): LeagueTeamSummary[] {
  const userById = new Map(users.map((user) => [user.user_id, user]));
  const matchupByRoster = new Map(matchups.map((matchup) => [matchup.roster_id, matchup]));

  return rosters
    .map((roster) => {
      const owner = roster.owner_id ? userById.get(roster.owner_id) : undefined;
      const matchup = matchupByRoster.get(roster.roster_id);
      const starterIds = roster.starters ?? [];
      const topPlayers = starterIds.slice(0, 6).map((id) => {
        const player = players[id];
        return {
          id,
          name: player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(" ") || `Player ${id}`,
          position: player?.position ?? "—",
          team: player?.team ?? "FA",
        };
      });

      return {
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        ownerName: owner?.display_name ?? owner?.username ?? `Roster ${roster.roster_id}`,
        teamName: roster.metadata?.team_name ?? owner?.metadata?.team_name ?? owner?.display_name ?? `Team ${roster.roster_id}`,
        wins: Number(roster.settings.wins ?? 0),
        losses: Number(roster.settings.losses ?? 0),
        ties: Number(roster.settings.ties ?? 0),
        pointsFor: fantasyPoints(roster.settings),
        playerCount: roster.players?.length ?? 0,
        starterCount: starterIds.length,
        matchupId: matchup?.matchup_id ?? null,
        matchupPoints: Number(matchup?.points ?? 0),
        topPlayers,
      };
    })
    .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);
}
