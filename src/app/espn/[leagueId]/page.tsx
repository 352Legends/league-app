import Link from "next/link";
import { buildLineupPlan } from "@/lib/analytics/lineups";
import { buildWaiverBoard, type UserRosterPlayer } from "@/lib/analytics/waivers";
import { espn, EspnApiError, type EspnCredentials } from "@/lib/espn/client";
import { readEspnCredentials } from "@/lib/espn/session";
import { buildTeamSummaries } from "@/lib/league";
import {
  loadAdvancedPassingStats,
  loadNflSchedule,
  loadWeeklyPlayerStats,
  loadWeeklyTeamStats,
} from "@/lib/nflverse/client";
import { loadProviderPlayerIdCrosswalk } from "@/lib/nflverse/provider-crosswalk";
import type { SleeperRoster } from "@/lib/sleeper/types";

type PageProps = {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ season?: string; teamId?: string }>;
};

function identity(value: string | null | undefined) {
  return (value ?? "").replace(/[{}]/g, "").toLowerCase();
}

function rosterPlayers(roster: SleeperRoster): UserRosterPlayer[] {
  const starters = new Set(roster.starters ?? []);
  const reserve = new Set(roster.reserve ?? []);
  return (roster.players ?? []).map((playerId) => ({
    playerId,
    status: starters.has(playerId) ? "starter" : reserve.has(playerId) ? "ir" : "bench",
  }));
}

async function loadEspnLeagueWorkspace(args: {
  leagueId: string;
  season: number;
  selectedTeamId: number | null;
  credentials: EspnCredentials;
}) {
  const { leagueId, season, selectedTeamId, credentials } = args;
  try {
    const base = await espn.validateLeague(leagueId, season, credentials);
    const [matchups, players] = await Promise.all([
      espn.getMatchups(leagueId, season, base.state.week, credentials),
      espn.getActivePlayers(leagueId, season, credentials),
    ]);
    const teams = buildTeamSummaries(base.rosters, base.users, matchups, players);
    const credentialOwner = identity(credentials.swid);
    const userRoster = base.rosters.find((roster) =>
      selectedTeamId != null
        ? roster.roster_id === selectedTeamId
        : Boolean(credentialOwner && identity(roster.owner_id) === credentialOwner),
    );

    const analyticsSeason = Math.max(2020, season - 1);
    let waiverBoard: ReturnType<typeof buildWaiverBoard> = [];
    let lineupPlan: ReturnType<typeof buildLineupPlan> | null = null;
    let analyticsError: string | null = null;

    if (userRoster) {
      try {
        const [crosswalk, historicalStats, schedule, teamStats, advancedPassing] = await Promise.all([
          loadProviderPlayerIdCrosswalk("espn"),
          loadWeeklyPlayerStats(analyticsSeason),
          loadNflSchedule(season).catch(() => []),
          loadWeeklyTeamStats(analyticsSeason).catch(() => []),
          loadAdvancedPassingStats(analyticsSeason).catch(() => []),
        ]);
        const rosteredPlayerIds = new Set(base.rosters.flatMap((roster) => roster.players ?? []));
        waiverBoard = buildWaiverBoard({
          leagueSize: base.league.total_rosters,
          scoring: base.league.scoring_settings,
          players,
          rosteredPlayerIds,
          userRoster: rosterPlayers(userRoster),
          crosswalk,
          historicalStats,
          trendingAdds: [],
          trendingDrops: [],
          currentSeason: season,
        });
        lineupPlan = buildLineupPlan({
          roster: userRoster,
          rosterPositions: base.league.roster_positions,
          scoring: base.league.scoring_settings,
          players,
          crosswalk,
          historicalStats,
          teamStats,
          advancedPassing,
          schedule,
          season,
          week: base.state.week,
          evidenceSeason: analyticsSeason,
        });
      } catch (error) {
        analyticsError = error instanceof Error ? error.message : "ESPN analytics normalization failed.";
      }
    }

    return {
      ok: true as const,
      base,
      teams,
      userRoster,
      waiverBoard,
      lineupPlan,
      analyticsError,
      publicMode: !credentials.swid || !credentials.espnS2,
    };
  } catch (error) {
    const message = error instanceof EspnApiError
      ? error.code === "ACCESS_DENIED"
        ? "ESPN denied access to this league. Reconnect with fresh SWID and espn_s2 values if the league is private."
        : error.message
      : "ESPN league data could not be normalized.";
    return { ok: false as const, message };
  }
}

export default async function EspnLeaguePage({ params, searchParams }: PageProps) {
  const [{ leagueId }, query, credentials] = await Promise.all([params, searchParams, readEspnCredentials()]);
  const season = Number(query.season ?? new Date().getFullYear());
  const selectedTeamId = query.teamId ? Number(query.teamId) : null;
  const result = await loadEspnLeagueWorkspace({ leagueId, season, selectedTeamId, credentials });

  if (!result.ok) {
    return (
      <div className="page-wrap">
        <div className="error-banner">{result.message} WAR ROOM will not fabricate ESPN data.</div>
        <Link href="/connect" className="connect-button">Reconnect ESPN league</Link>
      </div>
    );
  }

  const { base, teams, userRoster, waiverBoard, lineupPlan, analyticsError, publicMode } = result;
  const myTeam = userRoster ? teams.find((team) => team.rosterId === userRoster.roster_id) : null;
  const topWaivers = waiverBoard
    .filter((candidate) => (candidate.netRosterGain ?? candidate.valueOverReplacement ?? 0) > 0)
    .slice(0, 5);
  const selectedQuery = userRoster ? `season=${season}&teamId=${userRoster.roster_id}` : `season=${season}`;

  return (
    <div className="page-wrap">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">ESPN FANTASY · LIVE LEAGUE INTELLIGENCE</p>
          <h1>{base.league.name}</h1>
          <p className="lede">Week {base.state.week} · {base.league.total_rosters} teams · {season} · normalized into WAR ROOM&apos;s common decision model.</p>
        </div>
        <div className="hero-cta">
          <span className="status-chip">ESPN ADAPTER ACTIVE</span>
          {userRoster ? <Link href={`/espn/${leagueId}/command?${selectedQuery}`} className="connect-button">Open ESPN Mission Control →</Link> : null}
          <form action="/api/leagues/import/espn" method="post">
            <input type="hidden" name="leagueId" value={leagueId} />
            <input type="hidden" name="season" value={season} />
            {userRoster ? <input type="hidden" name="teamId" value={userRoster.roster_id} /> : null}
            <button type="submit" className={userRoster ? "status-chip" : "connect-button"}>Save to WAR ROOM</button>
          </form>
          <Link href="/connect" className="status-chip">Switch league</Link>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card"><p className="eyebrow">PROVIDER</p><strong className="metric-value" style={{ fontSize: 24 }}>ESPN</strong><p className="metric-detail">Isolated v3 adapter</p></article>
        <article className="metric-card"><p className="eyebrow">CURRENT WEEK</p><strong className="metric-value">{base.state.week}</strong><p className="metric-detail">ESPN scoring period</p></article>
        <article className="metric-card metric-card--positive"><p className="eyebrow">YOUR TEAM</p><strong className="metric-value" style={{ fontSize: 20 }}>{myTeam?.teamName ?? "SELECT TEAM"}</strong><p className="metric-detail">{myTeam ? `${myTeam.wins}-${myTeam.losses}${myTeam.ties ? `-${myTeam.ties}` : ""} · ${myTeam.pointsFor.toFixed(1)} PF` : "Choose your roster below to unlock personalized decisions."}</p></article>
        <article className="metric-card"><p className="eyebrow">ACCESS</p><strong className="metric-value" style={{ fontSize: 20 }}>{publicMode ? "PUBLIC" : "PRIVATE"}</strong><p className="metric-detail">{publicMode ? "No ESPN credential stored" : "HttpOnly ESPN session active"}</p></article>
      </section>

      {!userRoster ? (
        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">ROSTER IDENTITY</p><h2>Which ESPN team is yours?</h2></div><span className="status-chip">ONE-TIME SELECTION</span></div>
          <p className="metric-detail">Private leagues are usually matched automatically from SWID. Public leagues need a team selection because ESPN does not expose the viewer&apos;s identity.</p>
          <div className="league-list">
            {teams.map((team) => (
              <article className="league-card" key={team.rosterId}>
                <div><p className="eyebrow">TEAM {team.rosterId}</p><h3>{team.teamName}</h3><p>{team.ownerName} · {team.wins}-{team.losses} · {team.pointsFor.toFixed(1)} PF</p></div>
                <Link className="connect-button" href={`/espn/${leagueId}?season=${season}&teamId=${team.rosterId}`}>This is my team →</Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {userRoster ? (
        <section className="section-block lineup-section">
          <div className="section-heading"><div><p className="eyebrow">START / SIT · ESPN</p><h2>Weekly lineup command center</h2></div><span className="status-chip">LEAGUE-SPECIFIC SCORING</span></div>
          {analyticsError ? <div className="error-banner">ESPN league data connected, but analytics could not be normalized: {analyticsError}</div> : lineupPlan ? (
            <>
              <div className="lineup-summary-grid">
                <div><span>CURRENT MODELED</span><strong>{lineupPlan.currentProjectedPoints.toFixed(1)}</strong><small>supported starter points</small></div>
                <div><span>OPTIMIZED</span><strong>{lineupPlan.optimizedProjectedPoints.toFixed(1)}</strong><small>best modeled lineup</small></div>
                <div className="lineup-gain"><span>AVAILABLE GAIN</span><strong>+{lineupPlan.projectedGain.toFixed(1)}</strong><small>this week</small></div>
                <div><span>CHANGES</span><strong>{lineupPlan.swaps.length}</strong><small>evidence-backed swaps</small></div>
              </div>
              {lineupPlan.swaps.length ? <div className="pipeline-list">{lineupPlan.swaps.map((swap, index) => <div className="pipeline-row" key={`${swap.start.playerId}-${swap.sit.playerId}`}><span>#{index + 1} Start <strong>{swap.start.name}</strong> over {swap.sit.name} · {swap.slot}</span><strong>+{swap.projectedGain.toFixed(1)} pts</strong></div>)}</div> : <div className="lineup-clear"><strong>HOLD CURRENT LINEUP</strong><span>No supported bench swap clears WAR ROOM&apos;s evidence threshold.</span></div>}
            </>
          ) : null}
        </section>
      ) : null}

      {userRoster ? (
        <section className="section-block" id="waivers">
          <div className="section-heading"><div><p className="eyebrow">WAIVER VALUE · ESPN</p><h2>Best available roster upgrades</h2></div><span className="status-chip">PROJECTION + REPLACEMENT VALUE</span></div>
          <div className="intel-note"><span>i</span><p>ESPN does not provide WAR ROOM with a Sleeper-style public add/drop trend feed. ESPN waiver candidates are therefore ranked from league-specific scoring, roster replacement cost, role and NFL evidence; market-urgency scoring remains neutral instead of being fabricated.</p></div>
          {topWaivers.length ? <div className="priority-list">{topWaivers.map((candidate, index) => <article className="priority-card" key={candidate.playerId}><div className="priority-rank">#{index + 1}</div><div className="priority-body"><div className="priority-meta"><span>{candidate.position} · {candidate.team}</span><strong>{candidate.confidence}</strong><span>{candidate.action}</span></div><h3>{candidate.name}</h3><p>{candidate.netRosterGain == null ? "Replacement-value candidate" : `Net modeled roster gain +${candidate.netRosterGain.toFixed(1)} pts/week`}{candidate.dropPlayer ? ` · Best drop: ${candidate.dropPlayer.name}` : ""}</p></div><div className="priority-arrow">→</div></article>)}</div> : <p className="empty-state">No positive ESPN waiver upgrade cleared the current evidence threshold.</p>}
        </section>
      ) : null}

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">LEAGUE POWER MAP</p><h2>ESPN standings and roster snapshot</h2></div><span className="status-chip">{teams.length} TEAMS</span></div>
        <div className="team-grid">
          {teams.map((team) => (
            <article className="team-card" key={team.rosterId}>
              <div className="team-card-top"><span>#{team.rosterId}</span><strong>{team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ""}</strong></div>
              <h3>{team.teamName}</h3>
              <p className="metric-detail">{team.ownerName} · {team.pointsFor.toFixed(1)} PF · {team.playerCount} rostered</p>
              <div className="player-chips">{team.topPlayers.slice(0, 4).map((player) => <span key={player.id}>{player.position} {player.name}</span>)}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">ESPN PROVIDER STATUS</p><h2>Fail-soft by design.</h2></div></div>
        <div className="intel-note"><span>!</span><p>ESPN Fantasy&apos;s league endpoints are not a supported public developer API. WAR ROOM keeps this adapter isolated: if ESPN changes access or payloads, ESPN surfaces an explicit provider error while Sleeper and canonical NFL analytics remain operational.</p></div>
      </section>
    </div>
  );
}
