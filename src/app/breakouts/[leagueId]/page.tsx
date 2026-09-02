import Link from "next/link";
import { buildBreakoutRadar, type BreakoutCandidate } from "@/lib/analytics/breakouts";
import { loadPlayerIdCrosswalk, loadSnapCounts, loadWeeklyPlayerStats } from "@/lib/nflverse/client";
import { sleeper, SleeperApiError } from "@/lib/sleeper/client";

type BreakoutPageProps = {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ sleeperUserId?: string; sleeperUsername?: string }>;
};

function metric(value: number | null, suffix = ""): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

function BreakoutCard({ candidate, rank }: { candidate: BreakoutCandidate; rank: number }) {
  return (
    <article className="breakout-card">
      <div className="breakout-rank">#{rank}</div>
      <div className="breakout-main">
        <div className="breakout-title-row">
          <div>
            <p className="eyebrow">{candidate.position} · {candidate.team} · {candidate.ownership}</p>
            <h3>{candidate.name}</h3>
          </div>
          <div className="breakout-actions">
            <span className={`alpha-action alpha-action--${candidate.action.toLowerCase().replaceAll(" ", "-")}`}>{candidate.action}</span>
            <span className="status-chip">{candidate.confidence}</span>
          </div>
        </div>

        <div className="breakout-score-grid">
          <div className="breakout-primary"><span>BREAKOUT</span><strong>{candidate.breakoutProbability.toFixed(0)}%</strong></div>
          <div className="breakout-primary"><span>ALPHA SCORE</span><strong>{candidate.alphaScore.toFixed(0)}</strong></div>
          <div><span>SNAP SHARE</span><strong>{candidate.recentSnapPct == null ? "—" : `${candidate.recentSnapPct.toFixed(0)}%`}</strong><small>{candidate.snapDelta == null ? "no comparison" : `${metric(candidate.snapDelta, " pts")} trend`}</small></div>
          <div><span>OPPORTUNITY</span><strong>{metric(candidate.opportunityDelta)}</strong><small>targets + carries / game</small></div>
          <div><span>TARGET SHARE</span><strong>{candidate.recentTargetShare > 0 ? `${candidate.recentTargetShare.toFixed(1)}%` : "—"}</strong><small>{candidate.targetShareDelta ? `${metric(candidate.targetShareDelta, " pts")} trend` : "no material move"}</small></div>
          <div><span>MARKET AWARENESS</span><strong>{candidate.marketAwareness.toFixed(0)}</strong><small>{candidate.addCount.toLocaleString()} adds · {candidate.dropCount.toLocaleString()} drops</small></div>
        </div>

        <ul className="reason-list">
          {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </div>
    </article>
  );
}

async function loadRadar(leagueId: string, sleeperUserId: string) {
  try {
    const [league, rosters, players, state] = await Promise.all([
      sleeper.getLeague(leagueId),
      sleeper.getRosters(leagueId),
      sleeper.getActivePlayers(),
      sleeper.getNflState(),
    ]);
    const currentSeason = Number(league.season);
    const baselineSeason = Math.max(2020, currentSeason - 1);
    const userRoster = rosters.find((roster) => roster.owner_id === sleeperUserId);
    if (!userRoster) return { ok: false as const, message: "WAR ROOM could not match this Sleeper account to a roster in the selected league." };

    const [crosswalk, baselineStats, baselineSnaps, trendingAdds, trendingDrops] = await Promise.all([
      loadPlayerIdCrosswalk(),
      loadWeeklyPlayerStats(baselineSeason),
      loadSnapCounts(baselineSeason).catch(() => new Map()),
      sleeper.getTrending("add", 24, 250),
      sleeper.getTrending("drop", 24, 250),
    ]);

    const [currentStats, currentSnaps] = await Promise.all([
      loadWeeklyPlayerStats(currentSeason).catch(() => new Map()),
      loadSnapCounts(currentSeason).catch(() => new Map()),
    ]);

    const rosteredPlayerIds = new Set(rosters.flatMap((roster) => roster.players ?? []));
    const userPlayerIds = new Set(userRoster.players ?? []);
    const radar = buildBreakoutRadar({
      players,
      crosswalk,
      currentStats,
      baselineStats,
      currentSnaps,
      baselineSnaps,
      trendingAdds,
      trendingDrops,
      rosteredPlayerIds,
      userPlayerIds,
      currentSeason,
    });

    const currentEvidenceAvailable = currentStats.size > 0 || currentSnaps.size > 0;
    return { ok: true as const, league, state, radar, currentSeason, baselineSeason, currentEvidenceAvailable };
  } catch (error) {
    const message = error instanceof SleeperApiError
      ? `Sleeper returned ${error.status}; Breakout Radar could not refresh.`
      : error instanceof Error
        ? error.message
        : "Breakout Radar data is temporarily unavailable.";
    return { ok: false as const, message };
  }
}

export default async function BreakoutLeaguePage({ params, searchParams }: BreakoutPageProps) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const sleeperUserId = query.sleeperUserId?.trim();
  const sleeperUsername = query.sleeperUsername?.trim();

  if (!sleeperUserId) {
    return (
      <div className="page-wrap">
        <div className="error-banner">WAR ROOM needs your Sleeper identity to calculate true league availability.</div>
        <Link href="/breakouts" className="connect-button">Connect Breakout Radar</Link>
      </div>
    );
  }

  const result = await loadRadar(leagueId, sleeperUserId);
  if (!result.ok) {
    return (
      <div className="page-wrap">
        <div className="error-banner">{result.message} WAR ROOM will not fabricate usage signals.</div>
        <Link href="/breakouts" className="connect-button">Back to Breakout Radar</Link>
      </div>
    );
  }

  const available = result.radar.filter((candidate) => candidate.ownership === "AVAILABLE");
  const addNow = available.filter((candidate) => candidate.action === "ADD NOW");
  const lowAwareness = result.radar.filter((candidate) => candidate.marketAwareness <= 35 && candidate.alphaScore >= 60);
  const confirmed = result.radar.filter((candidate) => candidate.currentSeasonGames >= 2 && candidate.confidence !== "SPECULATIVE");

  return (
    <div className="page-wrap">
      <section className="hero-panel breakout-hero">
        <div>
          <p className="eyebrow">ALPHA DETECTOR · {result.league.name}</p>
          <h1>Breakout Radar</h1>
          <p className="lede">{sleeperUsername ?? "Your roster"} · Week {result.state.week}. WAR ROOM is hunting for usage growth that has not yet been fully priced into your league.</p>
        </div>
        <div className="hero-cta">
          <Link href={`/league/${leagueId}?${new URLSearchParams({ sleeperUserId, sleeperUsername: sleeperUsername ?? "" }).toString()}`} className="connect-button">Back to league</Link>
          <Link href="/breakouts" className="status-chip">Switch league</Link>
        </div>
      </section>

      <section className="metric-grid breakout-summary">
        <article className="metric-card metric-card--positive"><p className="eyebrow">ADD NOW</p><strong className="metric-value">{addNow.length}</strong><p className="metric-detail">Available players with high breakout + alpha scores</p></article>
        <article className="metric-card"><p className="eyebrow">AVAILABLE SIGNALS</p><strong className="metric-value">{available.length}</strong><p className="metric-detail">Scored free agents with meaningful role or market signals</p></article>
        <article className="metric-card"><p className="eyebrow">MARKET BLIND SPOTS</p><strong className="metric-value">{lowAwareness.length}</strong><p className="metric-detail">Strong alpha signals with market awareness ≤35</p></article>
        <article className="metric-card"><p className="eyebrow">CONFIRMED RISERS</p><strong className="metric-value">{confirmed.length}</strong><p className="metric-detail">Multiple current-season games supporting the signal</p></article>
      </section>

      <section className="section-block breakout-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PLAYER USAGE INTELLIGENCE</p>
            <h2>Highest-value emerging signals</h2>
          </div>
          <span className="status-chip">SNAPS + TARGETS + CARRIES + MARKET</span>
        </div>

        <div className="model-note">
          <strong>{result.currentEvidenceAvailable ? `${result.currentSeason} LIVE SIGNAL` : "PRESEASON MODE"}</strong>
          <span>
            {result.currentEvidenceAvailable
              ? `${result.currentSeason} game-level usage is compared with ${result.baselineSeason} baselines. Snap counts, targets, target share and carries receive the most weight; depth-chart role and market movement confirm or weaken the signal.`
              : `No ${result.currentSeason} regular-season snap/stat sample is available yet. Scores are deliberately capped and use late-${result.baselineSeason} usage, current depth chart, rookie draft capital and live Sleeper adds/drops until games create stronger evidence.`}
          </span>
        </div>

        {result.radar.length ? (
          <div className="breakout-list">
            {result.radar.slice(0, 18).map((candidate, index) => <BreakoutCard key={candidate.playerId} candidate={candidate} rank={index + 1} />)}
          </div>
        ) : (
          <p className="empty-state">No players currently meet WAR ROOM&apos;s minimum breakout-signal threshold.</p>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">MODEL DISCIPLINE</p><h2>What WAR ROOM is not claiming</h2></div>
          <span className="status-chip">ZERO-HALLUCINATION RULE</span>
        </div>
        <div className="intel-note">
          <span>i</span>
          <p>Snap share is live when the source has published the game. Route participation, first-read share and current-season coverage assignments are not inferred from snap counts. Those signals will only enter Breakout Radar when a validated provider supplies them.</p>
        </div>
      </section>
    </div>
  );
}
