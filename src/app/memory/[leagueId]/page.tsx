import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type MemoryPageProps = {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ sleeperUserId?: string; sleeperUsername?: string }>;
};

type EvaluationRow = {
  id: string;
  season: number;
  week: number;
  model_version: string;
  championship_probability: number | string | null;
  playoff_probability: number | string | null;
  week_win_probability: number | string | null;
  alpha_opportunities: number;
  urgent_decisions: number;
  top_decision_key: string | null;
  top_decision_title: string | null;
  top_championship_delta: number | string | null;
  generated_at: string;
};

type RecommendationRow = {
  evaluation_id: string | null;
  recommendation_type: string;
  title: string;
  confidence: string;
  championship_delta: number | string | null;
  weekly_gain: number | string | null;
  urgency: number | string | null;
  source_href: string | null;
};

function pct(value: number | string | null): string {
  return value == null ? "—" : `${Number(value).toFixed(1)}%`;
}

function delta(value: number | string | null): string {
  if (value == null) return "—";
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(1)} pts`;
}

export default async function DecisionMemoryPage({ params, searchParams }: MemoryPageProps) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const sleeperUserId = query.sleeperUserId?.trim() ?? "";
  const sleeperUsername = query.sleeperUsername?.trim() ?? "";
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return <div className="page-wrap"><div className="error-banner">Sign in to access private Decision Memory.</div><Link href="/login" className="connect-button">Sign in</Link></div>;
  }

  const { data: league } = await supabase
    .from("fantasy_leagues")
    .select("id,name,season")
    .eq("user_id", authData.user.id)
    .eq("provider", "sleeper")
    .eq("provider_league_id", leagueId)
    .maybeSingle();

  if (!league) {
    return <div className="page-wrap"><div className="error-banner">Decision Memory is only available after this league is saved to WAR ROOM.</div><Link href="/saved" className="connect-button">Saved leagues</Link></div>;
  }

  const { data: evaluations, error } = await supabase
    .from("decision_evaluations")
    .select("id,season,week,model_version,championship_probability,playoff_probability,week_win_probability,alpha_opportunities,urgent_decisions,top_decision_key,top_decision_title,top_championship_delta,generated_at")
    .eq("league_id", league.id)
    .order("generated_at", { ascending: false })
    .limit(30);

  const evaluationRows = (evaluations ?? []) as EvaluationRow[];
  const evaluationIds = evaluationRows.map((evaluation) => evaluation.id);
  let topByEvaluation = new Map<string, RecommendationRow>();

  if (evaluationIds.length) {
    const { data: recommendations } = await supabase
      .from("recommendations")
      .select("evaluation_id,recommendation_type,title,confidence,championship_delta,weekly_gain,urgency,source_href")
      .in("evaluation_id", evaluationIds)
      .eq("priority_rank", 1);
    topByEvaluation = new Map(((recommendations ?? []) as RecommendationRow[])
      .filter((recommendation) => recommendation.evaluation_id)
      .map((recommendation) => [recommendation.evaluation_id as string, recommendation]));
  }

  const context = new URLSearchParams();
  if (sleeperUserId) context.set("sleeperUserId", sleeperUserId);
  if (sleeperUsername) context.set("sleeperUsername", sleeperUsername);
  const suffix = context.toString();
  const commandHref = `/command/${leagueId}${suffix ? `?${suffix}` : ""}`;

  return (
    <div className="page-wrap">
      <section className="hero-panel command-hero command-hero--live">
        <div>
          <p className="eyebrow">DECISION MEMORY · {league.name}</p>
          <h1>WAR ROOM remembers what it recommended—and when it changed.</h1>
          <p className="lede">The latest {evaluationRows.length} versioned Mission Control evaluations are preserved without hindsight edits, creating an audit trail for the Automated GM.</p>
        </div>
        <div className="hero-cta">
          <span className="status-chip">PRIVATE HISTORY</span>
          <Link href={commandHref} className="connect-button">Back to Mission Control →</Link>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card metric-card--positive"><p className="eyebrow">EVALUATIONS</p><strong className="metric-value">{evaluationRows.length}</strong><p className="metric-detail">Versioned snapshots retained</p></article>
        <article className="metric-card"><p className="eyebrow">LATEST WEEK</p><strong className="metric-value">{evaluationRows[0]?.week ?? "—"}</strong><p className="metric-detail">Fantasy week in newest snapshot</p></article>
        <article className="metric-card"><p className="eyebrow">LATEST TITLE ODDS</p><strong className="metric-value">{pct(evaluationRows[0]?.championship_probability ?? null)}</strong><p className="metric-detail">Baseline championship probability</p></article>
        <article className="metric-card"><p className="eyebrow">MODEL</p><strong className="metric-value" style={{ fontSize: 20 }}>{evaluationRows[0]?.model_version ?? "—"}</strong><p className="metric-detail">Latest Decision Memory model version</p></article>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">AUTOMATED GM AUDIT TRAIL</p><h2>Decision history</h2></div><span className="status-chip">NO HINDSIGHT OVERWRITES</span></div>
        {error ? <div className="error-banner">Decision history could not be loaded.</div> : null}
        {!error && !evaluationRows.length ? <p className="empty-state">No evaluations recorded yet. Open Mission Control once to establish the first Decision Memory baseline.</p> : null}
        {evaluationRows.length ? (
          <div className="command-table-wrap">
            <table className="command-table memory-table">
              <thead><tr><th>Recorded</th><th>Week</th><th>#1 Move</th><th>Type</th><th>Title Odds</th><th>Δ Champ</th><th>This Week</th><th>Alpha</th><th>Urgent</th></tr></thead>
              <tbody>{evaluationRows.map((evaluation) => {
                const top = topByEvaluation.get(evaluation.id);
                return (
                  <tr key={evaluation.id}>
                    <td><strong>{new Date(evaluation.generated_at).toLocaleDateString()}</strong><small>{new Date(evaluation.generated_at).toLocaleTimeString()}</small></td>
                    <td>W{evaluation.week}</td>
                    <td>{top?.source_href ? <Link href={top.source_href}><strong>{evaluation.top_decision_title ?? top.title}</strong></Link> : <strong>{evaluation.top_decision_title ?? top?.title ?? "No quantified move"}</strong>}<small>{top ? `+${Number(top.weekly_gain ?? 0).toFixed(1)} modeled points · ${top.confidence}` : "Snapshot only"}</small></td>
                    <td>{top?.recommendation_type ?? "—"}</td>
                    <td>{pct(evaluation.championship_probability)}</td>
                    <td className={Number(evaluation.top_championship_delta ?? 0) > 0 ? "command-positive" : ""}>{delta(evaluation.top_championship_delta)}</td>
                    <td>{pct(evaluation.week_win_probability)}</td>
                    <td>{evaluation.alpha_opportunities}</td>
                    <td>{evaluation.urgent_decisions}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">WHY THIS MATTERS</p><h2>Model learning starts with preserved predictions.</h2></div><span className="status-chip">FOUNDATION FOR BACKTESTING</span></div>
        <div className="intel-note"><span>i</span><p>WAR ROOM stores the recommendation and its contemporaneous probability estimate before the outcome is known. That creates the evidence needed for future calibration, recommendation hit-rate analysis, waiver ROI, trade ROI and model-error journals without rewriting history after games are played.</p></div>
      </section>
    </div>
  );
}
