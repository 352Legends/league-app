import { NextResponse } from "next/server";
import { espn } from "@/lib/espn/client";
import { readEspnCredentials } from "@/lib/espn/session";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const leagueId = String(form.get("leagueId") ?? "").trim();
  const season = Number(form.get("season") ?? new Date().getFullYear());
  const teamId = Number(form.get("teamId"));
  if (!leagueId || !Number.isInteger(season)) return NextResponse.json({ error: "leagueId and season are required" }, { status: 400 });

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.redirect(new URL("/login", request.url), 303);

  try {
    const credentials = await readEspnCredentials();
    const base = await espn.validateLeague(leagueId, season, credentials);
    const matchups = await espn.getMatchups(leagueId, season, base.state.week, credentials);
    const userRoster = Number.isInteger(teamId) ? base.rosters.find((roster) => roster.roster_id === teamId) : undefined;
    const userById = new Map(base.users.map((user) => [user.user_id, user]));
    const now = new Date().toISOString();

    const { data: savedLeague, error: leagueError } = await supabase
      .from("fantasy_leagues")
      .upsert({
        user_id: authData.user.id,
        provider: "espn",
        provider_league_id: base.league.league_id,
        name: base.league.name,
        season: Number(base.league.season),
        status: base.league.status,
        total_rosters: base.league.total_rosters,
        roster_positions: base.league.roster_positions,
        scoring_settings: base.league.scoring_settings,
        settings: base.league.settings,
        provider_payload: {
          provider: "espn",
          adapter_version: "0.8",
          war_room: {
            espn_team_id: userRoster?.roster_id ?? null,
            espn_owner_id: userRoster?.owner_id ?? null,
            access_mode: credentials.swid && credentials.espnS2 ? "private_session" : "public",
          },
        },
        last_synced_at: now,
        updated_at: now,
      }, { onConflict: "user_id,provider,provider_league_id" })
      .select("id")
      .single();
    if (leagueError) throw leagueError;

    const leagueUuid = savedLeague.id;
    const teamRows = base.rosters.map((roster) => {
      const owner = roster.owner_id ? userById.get(roster.owner_id) : undefined;
      return {
        league_id: leagueUuid,
        provider_roster_id: String(roster.roster_id),
        provider_owner_id: roster.owner_id,
        owner_name: owner?.display_name ?? owner?.username ?? `ESPN Team ${roster.roster_id}`,
        team_name: roster.metadata?.team_name ?? owner?.display_name ?? `ESPN Team ${roster.roster_id}`,
        wins: Number(roster.settings.wins ?? 0),
        losses: Number(roster.settings.losses ?? 0),
        ties: Number(roster.settings.ties ?? 0),
        points_for: Number(roster.settings.fpts ?? 0),
        settings: roster.settings,
        provider_payload: {
          ...roster,
          war_room: { is_user_roster: roster.roster_id === userRoster?.roster_id },
        },
        updated_at: now,
      };
    });

    const { data: savedTeams, error: teamsError } = await supabase
      .from("fantasy_teams")
      .upsert(teamRows, { onConflict: "league_id,provider_roster_id" })
      .select("id,provider_roster_id");
    if (teamsError) throw teamsError;
    const teamIdByRoster = new Map(savedTeams.map((team) => [team.provider_roster_id, team.id]));

    const { error: deleteRosterError } = await supabase.from("fantasy_roster_players").delete().eq("league_id", leagueUuid);
    if (deleteRosterError) throw deleteRosterError;

    const rosterRows = base.rosters.flatMap((roster) => {
      const fantasyTeamId = teamIdByRoster.get(String(roster.roster_id));
      if (!fantasyTeamId) return [];
      const starters = new Set(roster.starters ?? []);
      const reserve = new Set(roster.reserve ?? []);
      return (roster.players ?? []).map((playerId) => ({
        league_id: leagueUuid,
        fantasy_team_id: fantasyTeamId,
        provider_player_id: playerId,
        roster_status: starters.has(playerId) ? "starter" : reserve.has(playerId) ? "ir" : "bench",
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
        season,
        week: base.state.week,
        provider_matchup_id: matchup.matchup_id == null ? null : String(matchup.matchup_id),
        fantasy_team_id: fantasyTeamId,
        points: matchup.points ?? 0,
        starters: matchup.starters ?? [],
        players: matchup.players ?? [],
        provider_payload: matchup,
        retrieved_at: now,
      }];
    });
    if (matchupRows.length) {
      const { error } = await supabase.from("fantasy_matchups").upsert(matchupRows, { onConflict: "league_id,season,week,fantasy_team_id" });
      if (error) throw error;
    }

    await supabase.from("league_sync_runs").insert({
      league_id: leagueUuid,
      provider: "espn",
      status: "succeeded",
      finished_at: now,
      records_written: 1 + teamRows.length + rosterRows.length + matchupRows.length,
      metadata: { season, week: base.state.week, espnTeamId: userRoster?.roster_id ?? null, adapterVersion: "0.8" },
    });

    return NextResponse.redirect(new URL(`/saved?league=${leagueUuid}`, request.url), 303);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ESPN league import failed" }, { status: 502 });
  }
}
