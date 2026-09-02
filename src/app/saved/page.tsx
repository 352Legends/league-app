import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function SavedLeaguesPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return (
      <div className="page-wrap">
        <section className="hero-panel">
          <div><p className="eyebrow">SAVED WAR ROOMS</p><h1>Sign in to access your persistent league intelligence.</h1><p className="lede">Connected league snapshots are private to your WAR ROOM account.</p></div>
          <Link href="/login" className="connect-button">Sign in</Link>
        </section>
      </div>
    );
  }

  const { data: leagues, error } = await supabase
    .from("fantasy_leagues")
    .select("id,name,season,status,total_rosters,provider,provider_league_id,last_synced_at")
    .order("updated_at", { ascending: false });

  return (
    <div className="page-wrap">
      <section className="hero-panel">
        <div><p className="eyebrow">PERSISTENT LEAGUE INTELLIGENCE</p><h1>Your saved WAR ROOM leagues.</h1><p className="lede">These records survive refreshes and sessions and are protected by Supabase Row Level Security.</p></div>
        <Link href="/connect" className="connect-button">Add another league</Link>
      </section>
      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">CONNECTED LEAGUES</p><h2>{leagues?.length ?? 0} saved</h2></div><span className="status-chip">PRIVATE</span></div>
        {error ? <div className="error-banner">Unable to read saved leagues.</div> : null}
        {!error && !leagues?.length ? <p className="empty-state">No leagues saved yet. Connect a Sleeper league and choose Save to WAR ROOM.</p> : null}
        <div className="league-list">
          {leagues?.map((league) => (
            <article className="league-card" key={league.id}>
              <div><p className="eyebrow">{league.provider.toUpperCase()} · {league.season}</p><h3>{league.name}</h3><p>{league.total_rosters ?? "—"} teams · {league.status ?? "unknown"} · Last synced {league.last_synced_at ? new Date(league.last_synced_at).toLocaleString() : "never"}</p></div>
              <Link href={`/league/${league.provider_league_id}`} className="connect-button">Open live view →</Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
