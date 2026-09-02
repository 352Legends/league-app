import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function MonitoringHubPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return <div className="page-wrap"><section className="hero-panel"><div><p className="eyebrow">AUTOMATED GM</p><h1>Sign in to monitor your leagues.</h1><p className="lede">Monitoring is private to saved WAR ROOM leagues.</p></div><Link href="/login" className="connect-button">Sign in</Link></section></div>;
  }

  const [{ data: leagues }, { data: subscriptions }, { data: alerts }] = await Promise.all([
    supabase.from("fantasy_leagues").select("id,name,season,provider_league_id,last_synced_at").order("updated_at", { ascending: false }),
    supabase.from("monitoring_subscriptions").select("league_id,enabled,cadence_minutes,last_checked_at,next_run_at"),
    supabase.from("monitoring_alerts").select("league_id,id").is("resolved_at", null),
  ]);

  const subscriptionByLeague = new Map((subscriptions ?? []).map((row) => [row.league_id, row]));
  const openAlertCounts = new Map<string, number>();
  for (const alert of alerts ?? []) openAlertCounts.set(alert.league_id, (openAlertCounts.get(alert.league_id) ?? 0) + 1);

  return (
    <div className="page-wrap">
      <section className="hero-panel command-hero command-hero--live">
        <div><p className="eyebrow">AUTOMATED GM · MONITORING HUB</p><h1>WAR ROOM watches the league between decisions.</h1><p className="lede">Supabase Cron invokes the private monitoring worker every 30 minutes. Each league is checked only when its own cadence is due, and the first run establishes a baseline rather than creating fake alerts.</p></div>
        <span className="status-chip">SCHEDULED WATCHER LIVE</span>
      </section>

      <section className="metric-grid">
        <article className="metric-card"><p className="eyebrow">SAVED LEAGUES</p><strong className="metric-value">{leagues?.length ?? 0}</strong><p className="metric-detail">Eligible for monitoring</p></article>
        <article className="metric-card"><p className="eyebrow">ACTIVE WATCHES</p><strong className="metric-value">{(subscriptions ?? []).filter((row) => row.enabled).length}</strong><p className="metric-detail">Enabled league policies</p></article>
        <article className="metric-card"><p className="eyebrow">OPEN ALERTS</p><strong className="metric-value">{alerts?.length ?? 0}</strong><p className="metric-detail">Awaiting Mission Control reconciliation</p></article>
        <article className="metric-card"><p className="eyebrow">SCHEDULER</p><strong className="metric-value" style={{fontSize:24}}>30 MIN</strong><p className="metric-detail">Global cron cadence with per-league due times</p></article>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">LEAGUE WATCHES</p><h2>Monitoring status</h2></div><Link href="/connect" className="status-chip">Add league</Link></div>
        {!leagues?.length ? <p className="empty-state">No saved leagues yet. Save a Sleeper league to create its Automated GM watch policy.</p> : (
          <div className="league-list">
            {leagues.map((league) => {
              const subscription = subscriptionByLeague.get(league.id);
              const openAlerts = openAlertCounts.get(league.id) ?? 0;
              return (
                <article className="league-card" key={league.id}>
                  <div>
                    <p className="eyebrow">{league.season} · {subscription?.enabled ? "WATCHING" : "PAUSED"} · {openAlerts} OPEN ALERT{openAlerts === 1 ? "" : "S"}</p>
                    <h3>{league.name}</h3>
                    <p>{subscription ? `${subscription.cadence_minutes} minute cadence · last check ${subscription.last_checked_at ? new Date(subscription.last_checked_at).toLocaleString() : "not yet"}` : "Monitoring policy will be created the next time this league is saved/refreshed."}</p>
                  </div>
                  <Link href={`/monitoring/${league.provider_league_id}`} className="connect-button">Open Monitoring Center →</Link>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
