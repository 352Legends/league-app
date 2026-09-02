import Link from "next/link";
import { buildBreakoutRadar } from "@/lib/analytics/breakouts";
import { buildTradeBoard, type TradeProposal } from "@/lib/analytics/trades";
import { loadPlayerIdCrosswalk, loadSnapCounts, loadWeeklyPlayerStats } from "@/lib/nflverse/client";
import { sleeper, SleeperApiError } from "@/lib/sleeper/client";

type TradePageProps = {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ sleeperUserId?: string; sleeperUsername?: string }>;
};

function TradeCard({ proposal, rank, impactHref }: { proposal: TradeProposal; rank: number; impactHref: string }) {
  return (
    <article className="trade-card">
      <div className="trade-rank">#{rank}</div>
      <div className="trade-main">
        <div className="trade-title-row">
          <div>
            <p className="eyebrow">TARGET · {proposal.target.position} · {proposal.target.team} · {proposal.opponentName}</p>
            <h3>{proposal.target.name}</h3>
          </div>
          <div className="trade-badges">
            <span className="trade-package">{proposal.packageType}</span>
            <span className="status-chip">{proposal.confidence}</span>
          </div>
        </div>

        <div className="trade-flow">
          <div className="trade-side trade-side--receive">
            <span>YOU RECEIVE</span>
            <strong>{proposal.target.name}</strong>
            <small>{proposal.target.position} · {proposal.target.team} · WAR value {proposal.target.fairValue.toFixed(0)}</small>
            <b>{proposal.target.projection.mean.toFixed(1)} proj</b>
          </div>
          <div className="trade-arrow">⇄</div>
          <div className="trade-side trade-side--send">
            <span>YOU SEND</span>
            <strong>{proposal.give.map((player) => player.name).join(" + ")}</strong>
            <small>{proposal.give.map((player) => `${player.position} ${player.fairValue.toFixed(0)}`).join(" · ")}</small>
            <b>{proposal.give.reduce((sum, player) => sum + player.projection.mean, 0).toFixed(1)} proj</b>
          </div>
        </div>

        <div className="trade-metrics">
          <div className="trade-primary"><span>NET LINEUP GAIN</span><strong>+{proposal.netLineupGain.toFixed(1)}</strong><small>modeled weekly starter points</small></div>
          <div><span>ACCEPTANCE FIT</span><strong>{proposal.acceptanceFit.toFixed(0)}</strong><small>heuristic, not probability</small></div>
          <div><span>FAIRNESS</span><strong>{proposal.fairnessScore.toFixed(0)}</strong><small>WAR ROOM value balance</small></div>
          <div><span>OPPONENT NEED</span><strong>{proposal.opponentNeedFit.toFixed(0)}</strong><small>fit for what you send</small></div>
          <div><span>TRADE ACTIVITY</span><strong>{proposal.opponentTradeActivity.toFixed(0)}</strong><small>observed manager activity</small></div>
          <div><span>TARGET SCORE</span><strong>{proposal.targetScore.toFixed(0)}</strong><small>value to your roster</small></div>
        </div>

        <ul className="reason-list">
          {proposal.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
        <Link href={impactHref} className="connect-button trade-impact-button">Simulate +{proposal.netLineupGain.toFixed(1)} pts/week championship impact →</Link>
      </div>
    </article>
  );
}

async function loadTradeCenter(leagueId: string, sleeperUserId: string) {
  try {
    const [league, rosters, users, players, state] = await Promise.all([
      sleeper.getLeague(leagueId),
      sleeper.getRosters(leagueId),
      sleeper.getLeagueUsers(leagueId),
      sleeper.getActivePlayers(),
      sleeper.getNflState(),
    ]);
    const userRoster = rosters.find((roster) => roster.owner_id === sleeperUserId);
    if (!userRoster) return { ok: false as const, message: "WAR ROOM could not match this Sleeper account to a roster in the selected league." };

    const currentSeason = Number(league.season);
    const evidenceSeason = Math.max(2020, currentSeason - 1);
    const [crosswalk, baselineStats, baselineSnaps, trendingAdds, trendingDrops] = await Promise.all([
      loadPlayerIdCrosswalk(),
      loadWeeklyPlayerStats(evidenceSeason),
      loadSnapCounts(evidenceSeason).catch(() => new Map()),
      sleeper.getTrending("add", 24, 250),
      sleeper.getTrending("drop", 24, 250),
    ]);
    const [currentStats, currentSnaps] = await Promise.all([
      loadWeeklyPlayerStats(currentSeason).catch(() => new Map()),
      loadSnapCounts(currentSeason).catch(() => new Map()),
    ]);

    const transactionWeeks = Array.from({ length: Math.max(1, state.week) }, (_, index) => index + 1);
    const transactionPages = await Promise.all(transactionWeeks.map((week) => sleeper.getTransactions(leagueId, week).catch(() => [])));
    const transactionMap = new Map(transactionPages.flat().map((transaction) => [transaction.transaction_id, transaction]));
    const transactions = [...transactionMap.values()];

    const rosteredPlayerIds = new Set(rosters.flatMap((roster) => roster.players ?? []));
    const userPlayerIds = new Set(userRoster.players ?? []);
    const breakoutRadar = buildBreakoutRadar({
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

    const board = buildTradeBoard({
      userRosterId: userRoster.roster_id,
      rosters,
      users,
      players,
      rosterPositions: league.roster_positions,
      scoring: league.scoring_settings,
      crosswalk,
      baselineStats,
      currentStats,
      breakoutRadar,
      transactions,
      evidenceSeason,
      currentSeason,
    });

    return { ok: true as const, league, state, board, transactionCount: transactions.filter((transaction) => transaction.type === "trade" && transaction.status === "complete").length };
  } catch (error) {
    const message = error instanceof SleeperApiError
      ? `Sleeper returned ${error.status}; Trade Center could not refresh.`
      : error instanceof Error
        ? error.message
        : "Trade intelligence is temporarily unavailable.";
    return { ok: false as const, message };
  }
}

export default async function TradeLeaguePage({ params, searchParams }: TradePageProps) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const sleeperUserId = query.sleeperUserId?.trim();
  const sleeperUsername = query.sleeperUsername?.trim();

  if (!sleeperUserId) {
    return (
      <div className="page-wrap">
        <div className="error-banner">WAR ROOM needs your Sleeper identity before it can distinguish your assets from opponent rosters.</div>
        <Link href="/trades" className="connect-button">Connect Trade Center</Link>
      </div>
    );
  }

  const result = await loadTradeCenter(leagueId, sleeperUserId);
  if (!result.ok) {
    return (
      <div className="page-wrap">
        <div className="error-banner">{result.message} WAR ROOM will not fabricate trade values.</div>
        <Link href="/trades" className="connect-button">Back to Trade Center</Link>
      </div>
    );
  }

  const best = result.board.proposals[0];
  const activeManagers = result.board.managers.filter((manager) => manager.completedTrades > 0);
  const strongFits = result.board.proposals.filter((proposal) => proposal.acceptanceFit >= 65);
  const averageGain = result.board.proposals.length
    ? result.board.proposals.reduce((sum, proposal) => sum + proposal.netLineupGain, 0) / result.board.proposals.length
    : 0;
  const backQuery = new URLSearchParams({ sleeperUserId, sleeperUsername: sleeperUsername ?? "" });

  return (
    <div className="page-wrap">
      <section className="hero-panel trade-hero">
        <div>
          <p className="eyebrow">TRADE CENTER · {result.league.name}</p>
          <h1>Roster Arbitrage</h1>
          <p className="lede">{sleeperUsername ?? "Your roster"} · Week {result.state.week}. WAR ROOM is searching every opposing roster for deals that upgrade your starters while giving the other manager a reason to engage.</p>
        </div>
        <div className="hero-cta">
          <Link href={`/league/${leagueId}?${backQuery.toString()}`} className="connect-button">Back to league</Link>
          <Link href={`/championship/${leagueId}?${backQuery.toString()}`} className="status-chip">Championship odds</Link>
          <Link href="/trades" className="status-chip">Switch league</Link>
        </div>
      </section>

      <section className="metric-grid trade-summary">
        <article className="metric-card metric-card--positive"><p className="eyebrow">BEST STARTER GAIN</p><strong className="metric-value">{best ? `+${best.netLineupGain.toFixed(1)}` : "—"}</strong><p className="metric-detail">Modeled weekly points after outgoing lineup cost</p></article>
        <article className="metric-card"><p className="eyebrow">TRADE FITS</p><strong className="metric-value">{result.board.proposals.length}</strong><p className="metric-detail">Positive roster-arbitrage proposals found</p></article>
        <article className="metric-card"><p className="eyebrow">STRONG ACCEPTANCE FIT</p><strong className="metric-value">{strongFits.length}</strong><p className="metric-detail">Heuristic fit score ≥65; not an acceptance probability</p></article>
        <article className="metric-card"><p className="eyebrow">ACTIVE TRADERS</p><strong className="metric-value">{activeManagers.length}</strong><p className="metric-detail">Managers with completed trades in loaded current-season history</p></article>
      </section>

      <section className="section-block trade-section">
        <div className="section-heading">
          <div><p className="eyebrow">BEST AVAILABLE DEALS</p><h2>Offers worth opening a conversation with</h2></div>
          <span className="status-chip">FAIR VALUE + MUTUAL NEED + HISTORY</span>
        </div>
        <div className="model-note">
          <strong>ARBITRAGE MODEL v1</strong>
          <span>{result.board.evidenceSeason} production re-scored to this league · actual free-agent replacement level · current roster construction · usage trajectory · Breakout Radar · injury/role signals · current-season Sleeper trade history. Average modeled gain across ranked deals: +{averageGain.toFixed(1)} points.</span>
        </div>
        {result.board.proposals.length ? (
          <div className="trade-list">
            {result.board.proposals.slice(0, 12).map((proposal, index) => {
              const impactQuery = new URLSearchParams({
                sleeperUserId,
                sleeperUsername: sleeperUsername ?? "",
                boost: proposal.netLineupGain.toFixed(1),
              });
              return <TradeCard key={`${proposal.target.playerId}-${proposal.give.map((player) => player.playerId).join("-")}`} proposal={proposal} rank={index + 1} impactHref={`/championship/${leagueId}?${impactQuery.toString()}`} />;
            })}
          </div>
        ) : (
          <div className="lineup-clear"><strong>DO NOT FORCE A TRADE</strong><span>WAR ROOM found no modeled player-for-player package that both improves your starting lineup and clears its minimum opponent-fit threshold.</span></div>
        )}
      </section>

      <section className="two-column">
        <div className="section-block">
          <div className="section-heading"><div><p className="eyebrow">YOUR ROSTER MARKET</p><h2>Needs & surpluses</h2></div><span className="status-chip">LEAGUE RELATIVE</span></div>
          <div className="trade-need-list">
            {result.board.userNeeds.map((need) => (
              <div className="trade-need-row" key={need.position}><span>{need.position}</span><div><i style={{ width: `${need.score}%` }} /></div><strong>{need.score.toFixed(0)}</strong></div>
            ))}
          </div>
          <p className="metric-detail">Higher scores indicate a weaker position relative to this league. Surplus groups: {result.board.userSurpluses.length ? result.board.userSurpluses.join(", ") : "none identified"}.</p>
        </div>

        <div className="section-block">
          <div className="section-heading"><div><p className="eyebrow">MANAGER INTELLIGENCE</p><h2>Who is structurally tradeable?</h2></div><span className="status-chip">CURRENT-SEASON HISTORY</span></div>
          <div className="manager-trade-list">
            {result.board.managers.slice(0, 8).map((manager) => (
              <div className="manager-trade-row" key={manager.rosterId}>
                <div><strong>{manager.managerName}</strong><small>Needs {manager.weakestPositions.join(" / ")} · surplus {manager.surplusPositions.join(" / ") || "none"}</small></div>
                <div><b>{manager.activityScore.toFixed(0)}</b><span>{manager.completedTrades} trades</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">MODEL DISCIPLINE</p><h2>What the score means</h2></div><span className="status-chip">NO FALSE CERTAINTY</span></div>
        <div className="intel-note"><span>i</span><p><strong>Acceptance Fit is not a probability that a human manager will accept.</strong> It is a transparent heuristic combining fair-value balance, the opponent&apos;s positional need, whether the target looks like roster surplus, and observed trade activity. Draft-pick valuation and dynasty-specific future assets are intentionally excluded from this v1 player-for-player model. Sleeper remains read-only, so WAR ROOM cannot submit the trade.</p></div>
      </section>
    </div>
  );
}
