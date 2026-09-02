import { NextResponse } from "next/server";
import { buildTeamSummaries } from "@/lib/league";
import { sleeper } from "@/lib/sleeper/client";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const leagueId = String(form.get("leagueId") ?? "").trim();
  if (!leagueId) return NextResponse.json({ error: "leagueId is required" }, { status: 400 });

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.redirect(new URL("/login", request.url), 303);

  try {
    const [league, users, rosters, state, players] = await Promise.all([
      sleeper.getLeague(leagueId),
      sleeper.getLeagueUsers(leagueId),
      sleeper.getRosters(leagueId),
      sleeper.getNflState(),
      sleeper.getActivePlayers(),
    ]);
    const matchups = await sleeper.getMatchups(leagueId, state.week);
    const teams = buildTeamSummaries(rosters, users, matchups, players);

    const { data: savedLeague, error: leagueError } = await supabase
      .from("fantasy_leagues")
      .upsert({
        user_id: authData.user.id,
        provider: "sleeper",
        provider_league_id: league.league_id,
        name: league.name,
        season: Number(league.season),
        status: league.status,
        total_rosters: league.total_rosters,
        roster_positions: league.roster_positions,
        scoring_settings: league.scoring_settings,
        settings: league.settings,
        provider_payload: league,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider,provider_league_id" })
      .select("id")
      .single();
    if (leagueError) throw leagueError;

    const leagueUuid = savedLeague.id;
    const teamRows = teams.map((team) => {
      const raw = rosters.find((roster) => roster.roster_id === team.rosterId)!;
      return {
        league_id: leagueUuid,
        provider_roster_id: String(team.rosterId),
        provider_owner_id: team.ownerId,
        owner_name: team.ownerName,
        team_name: team.teamName,
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        points_for: team.pointsFor,
        settings: raw.settings,
        provider_payload: raw,
        updated_at: new Date().toISOString(),
      };
    });

    const { data: savedTeams, error: teamsError } = await supabase
      .from("fantasy_teams")
      .upsert(teamRows, { onConflict: "league_id,provider_roster_id" })
      .select("id,provider_roster_id");
    if (teamsError) throw teamsError;

    const teamIdByRoster = new Map(savedTeams.map((team) => [team.provider_roster_id, team.id]));

    const { error: deleteRosterError } = await supabase
      .from("fantasy_roster_players")
      .delete()
      .eq("league_id", leagueUuid);
    if (deleteRosterError) throw deleteRosterError;

    const rosterRows = rosters.flatMap((roster) => {
      const fantasyTeamId = teamIdByRoster.get(String(roster.roster_id));
      if (!fantasyTeamId) return [];
      const starters = new Set(roster.starters ?? []);
      const reserve = new Set(roster.reserve ?? []);
      const taxi = new Set(roster.taxi ?? []);
      return (roster.players ?? []).map((playerId) => ({
        league_id: leagueUuid,
        fantasy_team_id: fantasyTeamId,
        provider_player_id: playerId,
        roster_status: starters.has(playerId) ? "starter" : reserve.has(playerId) ? "ir" : taxi.has(playerId) ? "taxi" : "bench",
      }));
    });
    if (rosterRows.length) {
      const { error } = await supabase.from("fantasy_roster_players").insert(rosterRows);
      if (error) throw error;
    }

    const matchupRows = matchups.flatMap((matchup) => {
      const fantasyTeamId = teamIdByRoster.get(String(matchup.roster_id));
      if (!fantasyTeamId) return [];
      return [{
        league_id: leagueUuid,
        season: Number(league.season),
        week: state.week,
        provider_matchup_id: matchup.matchup_id == null ? null : String(matchup.matchup_id),
        fantasy_team_id: fantasyTeamId,
        points: matchup.points ?? 0,
        starters: matchup.starters ?? [],
        players: matchup.players ?? [],
        provider_payload: matchup,
        retrieved_at: new Date().toISOString(),
      }];
    });
    if (matchupRows.length) {
      const { error } = await supabase.from("fantasy_matchups").upsert(matchupRows, { onConflict: "league_id,season,week,fantasy_team_id" });
      if (error) throw error;
    }

    await supabase.from("league_sync_runs").insert({
      league_id: leagueUuid,
      provider: "sleeper",
      status: "succeeded",
      finished_at: new Date().toISOString(),
      records_written: 1 + teamRows.length + rosterRows.length + matchupRows.length,
      metadata: { season: league.season, week: state.week },
    });

    return NextResponse.redirect(new URL(`/saved?league=${leagueUuid}`, request.url), 303);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "League import failed" }, { status: 502 });
  }
}
