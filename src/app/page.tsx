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
          <span className="status-chip">SETUP REQUIRED</span>
          <Link href="/connect">Connect Sleeper →</Link>
        </div>
      </section>

      <section className="metric-grid">
        <MetricCard label="Championship Probability" value="—" detail="Activates after league simulation" />
        <MetricCard label="This Week Win Probability" value="—" detail="Requires current matchup" />
        <MetricCard label="Alpha Opportunities" value="—" detail="Role-change model is Sprint 2" tone="positive" />
        <MetricCard label="Urgent Decisions" value="1" detail="Connect your league" tone="warning" />
      </section>

      <section className="two-column">
        <div className="section-block">
          <div className="section-heading"><div><p className="eyebrow">WAR ROOM PRIORITIES</p><h2>Next best moves</h2></div><span className="status-chip">PRE-LIVE</span></div>
          <div className="priority-list">
            <PriorityCard rank={1} tag="FOUNDATION" impact="HIGH IMPACT" title="Connect your Sleeper league" summary="Import league settings, teams, rosters, draft context, and current matchup state so recommendations become specific to your team." />
            <PriorityCard rank={2} tag="MODEL" impact="SPRINT 2" title="Establish replacement value" summary="Once your roster is known, WAR ROOM can compare every waiver decision against the player you would actually have to drop." />
            <PriorityCard rank={3} tag="SIMULATION" impact="SPRINT 3" title="Activate matchup win probability" summary="Move from simple point projections to simulated lineup choices optimized for your actual opponent." />
          </div>
        </div>

        <div className="section-block intel-panel">
          <div className="section-heading"><div><p className="eyebrow">INTELLIGENCE PIPELINE</p><h2>System readiness</h2></div></div>
          <div className="pipeline-list">
            {[['Sleeper league connector','Ready'],['Canonical player IDs','Schema ready'],['Supabase persistence','Awaiting project'],['Projection ensemble','Next sprint'],['Championship simulation','Planned'],['Alpha Detector','Planned']].map(([label,status]) => (
              <div className="pipeline-row" key={label}><span>{label}</span><strong>{status}</strong></div>
            ))}
          </div>
          <div className="intel-note"><span>01</span><p><strong>Zero hallucination rule.</strong> If current data cannot be retrieved, WAR ROOM reports data unavailable instead of inventing a recommendation.</p></div>
        </div>
      </section>
    </div>
  );
}
