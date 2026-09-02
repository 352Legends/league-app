import Link from "next/link";
import { MetricCard } from "@/components/metric-card";
import { PriorityCard } from "@/components/priority-card";

export default function Home() {
  return (
    <div className="page-wrap">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">COMMAND CENTER</p>
          <h1>Win the move <em>before</em> everyone else sees it.</h1>
          <p className="lede">WAR ROOM turns league state, player opportunity, matchup context, market movement, and future schedule into prioritized decisions.</p>
        </div>
        <div className="hero-cta">
          <span className="status-chip">FOUNDATION LIVE</span>
          <Link href="/connect" className="connect-button">Connect Sleeper →</Link>
          <Link href="/saved" className="status-chip">Saved leagues</Link>
        </div>
      </section>

      <section className="metric-grid">
        <MetricCard label="Championship Probability" value="—" detail="Activates after league simulation" />
        <MetricCard label="This Week Win Probability" value="—" detail="Requires projection model" />
        <MetricCard label="Alpha Opportunities" value="—" detail="Role-change model is next" tone="positive" />
        <MetricCard label="Infrastructure" value="LIVE" detail="Sleeper + Supabase foundation" tone="positive" />
      </section>

      <section className="two-column">
        <div className="section-block">
          <div className="section-heading"><div><p className="eyebrow">WAR ROOM PRIORITIES</p><h2>Next best build moves</h2></div><span className="status-chip">SPRINT 2 READY</span></div>
          <div className="priority-list">
            <PriorityCard rank={1} tag="MODEL" impact="HIGHEST IMPACT" title="Establish replacement value" summary="Use league scoring, starting requirements, rostered players, and available-player pools to measure the real cost of every add/drop decision." />
            <PriorityCard rank={2} tag="PROJECTION" impact="HIGH" title="Create the baseline player projection layer" summary="Generate transparent weekly player distributions that become the common input to lineup, waiver, and trade decisions." />
            <PriorityCard rank={3} tag="SIMULATION" impact="NEXT" title="Activate matchup win probability" summary="Move from median-point rankings into thousands of simulated outcomes for the user's actual opponent." />
          </div>
        </div>

        <div className="section-block intel-panel">
          <div className="section-heading"><div><p className="eyebrow">INTELLIGENCE PIPELINE</p><h2>System readiness</h2></div></div>
          <div className="pipeline-list">
            {[['Sleeper league connector','Live'],['Dedicated Supabase database','Live'],['RLS security audit','Passed'],['Persistent league snapshots','Implemented'],['Projection ensemble','Next'],['Championship simulation','Planned'],['Alpha Detector','Planned']].map(([label,status]) => (
              <div className="pipeline-row" key={label}><span>{label}</span><strong>{status}</strong></div>
            ))}
          </div>
          <div className="intel-note"><span>01</span><p><strong>Zero hallucination rule.</strong> If current data cannot be retrieved, WAR ROOM reports data unavailable instead of inventing a recommendation.</p></div>
        </div>
      </section>
    </div>
  );
}
