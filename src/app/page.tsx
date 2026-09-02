import Link from "next/link";
import { MetricCard } from "@/components/metric-card";

export default function Home() {
  return (
    <div className="page-wrap">
      <section className="hero-panel command-hero">
        <div>
          <p className="eyebrow">WAR ROOM · CHAMPIONSHIP INTELLIGENCE</p>
          <h1>Stop managing categories. <em>Rank the moves.</em></h1>
          <p className="lede">WAR ROOM connects league state, projections, matchup context, usage growth, market movement, trades and season simulation into one question: which available decision most improves your odds of winning the championship?</p>
        </div>
        <div className="hero-cta">
          <span className="status-chip">DECISION ENGINE LIVE</span>
          <Link href="/command" className="connect-button">Open Mission Control →</Link>
          <Link href="/saved" className="status-chip">Saved leagues</Link>
        </div>
      </section>

      <section className="metric-grid">
        <MetricCard label="Priority Engine" value="LIVE" detail="Ranks lineup, waiver, breakout and trade decisions" tone="positive" />
        <MetricCard label="Championship Simulation" value="5K" detail="Monte Carlo season paths in the full engine" tone="positive" />
        <MetricCard label="Alpha Detector" value="LIVE" detail="Snap, target, carry and market-change signals" tone="positive" />
        <MetricCard label="Trade Arbitrage" value="LIVE" detail="Mutual roster fit + realistic package generation" tone="positive" />
      </section>

      <section className="two-column">
        <div className="section-block">
          <div className="section-heading"><div><p className="eyebrow">MISSION CONTROL</p><h2>One scoreboard for every decision type</h2></div><span className="status-chip">Δ CHAMPIONSHIP</span></div>
          <div className="pipeline-list">
            <div className="pipeline-row"><span>Start / sit optimization</span><strong>Live</strong></div>
            <div className="pipeline-row"><span>League-specific waiver upgrades</span><strong>Live</strong></div>
            <div className="pipeline-row"><span>Breakout & market alpha signals</span><strong>Live</strong></div>
            <div className="pipeline-row"><span>Trade target & package generation</span><strong>Live</strong></div>
            <div className="pipeline-row"><span>Playoff / bye / title simulation</span><strong>Live</strong></div>
            <div className="pipeline-row"><span>Cross-decision priority ranking</span><strong>Live</strong></div>
          </div>
          <Link href="/command" className="connect-button" style={{ marginTop: 16 }}>Run the Priority Engine →</Link>
        </div>

        <div className="section-block intel-panel">
          <div className="section-heading"><div><p className="eyebrow">MODEL DISCIPLINE</p><h2>Probability, not fantasy theater</h2></div></div>
          <div className="intel-note"><span>01</span><p><strong>No invented inputs.</strong> Missing provider data is shown as unavailable rather than silently replaced with fake statistics.</p></div>
          <div className="intel-note"><span>02</span><p><strong>League-aware value.</strong> WAR ROOM uses the connected scoring system, roster format, actual free-agent pool and opponent rosters instead of universal rankings.</p></div>
          <div className="intel-note"><span>03</span><p><strong>Decision impact.</strong> Quantified moves are compared through paired season simulation so projected points are translated into playoff and championship impact.</p></div>
        </div>
      </section>
    </div>
  );
}
