import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ saved?: string }>;
};

function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not yet";
}

export default async function MonitoringCenterPage({ params, searchParams }: PageProps) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return <div className="page-wrap"><div className="error-banner">Sign in to manage Automated GM monitoring.</div><Link className="connect-button" href="/login">Sign in</Link></div>;
  }

  const { data: league } = await supabase
    .from("fantasy_leagues")
    .select("id,name,season,provider_league_id,provider_payload")
    .eq("user_id", authData.user.id)
    .eq("provider", "sleeper")
    .eq("provider_league_id", leagueId)
    .maybeSingle();

  if (!league) {
    return <div className="page-wrap"><div className="error-banner">Save this Sleeper league to WAR ROOM before enabling Automated GM monitoring.</div><Link className="connect-button" href="/connect">Connect league</Link></div>;
  }

  const [{ data: subscription }, { data: alerts }, { data: runs }] = await Promise.all([
    supabase.from("monitoring_subscriptions").select("*").eq("league_id", league.id).maybeSingle(),
    supabase.from("monitoring_alerts").select("id,alert_type,severity,title,summary,recalculation_required,created_at,resolved_at").eq("league_id", league.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("monitoring_runs").select("id,status,signals_checked,alerts_created,started_at,finished_at,error_summary").eq("league_id", league.id).order("started_at", { ascending: false }).limit(12),
  ]);

  const openAlerts = (alerts ?? []).filter((alert) => !alert.resolved_at);
  const enabled = subscription?.enabled ?? false;
  const cadence = Number(subscription?.cadence_minutes ?? 30);
  const threshold = Number(subscription?.market_add_threshold ?? 150);

  return (
    <div className="page-wrap">
      <section className="hero-panel command-hero command-hero--live">
        <div>
          <p className="eyebrow">AUTOMATED GM · {league.name}</p>
          <h1>Watch the league while you are away.</h1>
          <p className="lede">WAR ROOM checks Sleeper on a controlled cadence for roster changes, transactions, waiver-market acceleration and week transitions. Alerts trigger a fresh Mission Control evaluation instead of pretending a lightweight watcher can calculate championship impact by itself.</p>
        </div>
        <div className="hero-cta">
          <span className="status-chip">{enabled ? "MONITORING ACTIVE" : "MONITORING OFF"}</span>
          <Link href={`/command/${leagueId}`} className="connect-button">Open Mission Control →</Link>
          <Link href={`/memory/${leagueId}`} className="status-chip">Decision Memory</Link>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card"><p className="eyebrow">OPEN ALERTS</p><strong className="metric-value">{openAlerts.length}</strong><p className="metric-detail">Unresolved external changes</p></article>
        <article className="metric-card"><p className="eyebrow">CADENCE</p><strong className="metric-value">{cadence}m</strong><p className="metric-detail">Supabase Cron checks every 30 minutes; due leagues respect their own cadence</p></article>
        <article className="metric-card"><p className="eyebrow">LAST CHECK</p><strong className="metric-value" style={{fontSize:18}}>{when(subscription?.last_checked_at)}</strong><p className="metric-detail">Most recent successful league signal poll</p></article>
        <article className="metric-card"><p className="eyebrow">NEXT DUE</p><strong className="metric-value" style={{fontSize:18}}>{enabled ? when(subscription?.next_run_at) : "Paused"}</strong><p className="metric-detail">Next eligible monitoring run</p></article>
      </section>

      {query.saved === "1" ? <div className="intel-note"><span>✓</span><p>Automated GM monitoring settings were saved.</p></div> : null}

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">WATCH POLICY</p><h2>Only interrupt me for meaningful change.</h2></div><span className="status-chip">IN-APP ALERTS</span></div>
        <form method="post" action="/api/monitoring/subscription" className="connect-form">
          <input type="hidden" name="providerLeagueId" value={leagueId} />
          <label><input type="checkbox" name="enabled" defaultChecked={enabled} /> Enable Automated GM monitoring for this league</label>
          <label>League monitoring cadence
            <select name="cadenceMinutes" defaultValue={String(cadence)}>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every hour</option>
              <option value="120">Every 2 hours</option>
              <option value="360">Every 6 hours</option>
              <option value="720">Every 12 hours</option>
              <option value="1440">Daily</option>
            </select>
          </label>
          <label>Market acceleration threshold
            <input name="marketAddThreshold" type="number" min="25" max="10000" step="25" defaultValue={threshold} />
          </label>
          <div className="team-grid">
            <label className="team-card"><input type="checkbox" name="watchRosterChanges" defaultChecked={subscription?.watch_roster_changes ?? true} /> <strong>Roster changes</strong><p className="metric-detail">Your Sleeper roster adds/drops or roster composition changes.</p></label>
            <label className="team-card"><input type="checkbox" name="watchTransactions" defaultChecked={subscription?.watch_transactions ?? true} /> <strong>Transactions</strong><p className="metric-detail">New Sleeper transactions involving your roster.</p></label>
            <label className="team-card"><input type="checkbox" name="watchMarketAcceleration" defaultChecked={subscription?.watch_market_acceleration ?? true} /> <strong>Waiver acceleration</strong><p className="metric-detail">Large increases in 24-hour Sleeper add activity.</p></label>
            <label className="team-card"><input type="checkbox" name="watchWeekAdvance" defaultChecked={subscription?.watch_week_advance ?? true} /> <strong>Week transition</strong><p className="metric-detail">NFL/fantasy week advances and matchup context changes.</p></label>
          </div>
          <button className="connect-button" type="submit">Save monitoring policy</button>
        </form>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">ALERT INBOX</p><h2>Changes that survived the thresholds</h2></div><span className="status-chip">{openAlerts.length} OPEN</span></div>
        {!alerts?.length ? <p className="empty-state">No alerts yet. The first monitoring run establishes a baseline and deliberately does not manufacture alerts.</p> : (
          <div className="priority-list">
            {alerts.map((alert) => (
              <article className="priority-card" key={alert.id}>
                <div className="priority-rank">!</div>
                <div className="priority-body">
                  <div className="priority-meta"><span>{alert.alert_type.replaceAll("_", " ")}</span><strong>{alert.severity.toUpperCase()}</strong><span>{when(alert.created_at)}</span></div>
                  <h3>{alert.title}</h3>
                  <p>{alert.summary}</p>
                </div>
                <div className="priority-arrow">{alert.resolved_at ? "✓" : alert.recalculation_required ? "↻" : "→"}</div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">WATCHER HEALTH</p><h2>Recent monitoring runs</h2></div><span className="status-chip">SUPABASE EDGE + CRON</span></div>
        {!runs?.length ? <p className="empty-state">No league-specific monitoring runs yet.</p> : (
          <div className="pipeline-list">
            {runs.map((run) => <div className="pipeline-row" key={run.id}><span>{when(run.started_at)} · {run.status.toUpperCase()}{run.error_summary ? ` · ${run.error_summary}` : ""}</span><strong>{run.alerts_created} alerts / {run.signals_checked} signals</strong></div>)}
          </div>
        )}
      </section>
    </div>
  );
}
