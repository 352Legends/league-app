# WAR ROOM — Fantasy Football Championship Intelligence

WAR ROOM is a multi-provider fantasy-football decision system built around one question:

> Which available move most improves this roster's probability of ultimately winning its championship?

## Live capabilities

- Sleeper league connection through Sleeper's documented read-only API
- ESPN Fantasy Football connection through an isolated, fail-soft provider adapter
- Public ESPN leagues by league ID + season
- Private ESPN leagues using user-supplied `SWID` + `espn_s2` browser-session cookies; WAR ROOM never requests an ESPN password
- Provider-normalized league settings, scoring, teams, rosters, starters, standings and fantasy schedule
- Canonical player identity joins into nflverse/NFL evidence
- League-specific Start/Sit modeling
- Replacement value and waiver opportunity analysis
- Breakout / Alpha detection
- Trade construction and roster-improvement analysis
- Monte Carlo playoff, bye and championship simulation
- Cross-decision Mission Control ranking by Δ Championship Probability
- Supabase Auth + persistent saved leagues with Row Level Security
- Decision Memory for versioned recommendations
- Automated GM monitoring for supported Sleeper signals through Supabase Edge Functions + Cron

## Provider architecture

WAR ROOM keeps provider access separate from the analytics model. Provider-native data is normalized before it reaches lineup, waiver, trade or championship engines.

### Sleeper

Sleeper uses its documented public read-only endpoints. WAR ROOM uses Sleeper league, roster, matchup, transaction and trending data when available.

### ESPN Fantasy Football

ESPN Fantasy Football does not provide an equivalent supported public developer API. WAR ROOM therefore treats ESPN as an isolated compatibility adapter using the currently available Fantasy v3 read endpoints.

Current ESPN support includes:

- League metadata and settings
- Scoring normalization
- Teams, managers and standings
- Rosters, starters and IR
- Current and future fantasy matchups
- Active-player pool retrieval with roster-player fallback
- ESPN player-ID → canonical GSIS/PFR crosswalk
- Start/Sit, waiver, trade and championship modeling
- ESPN Mission Control with Top-3 decisions ranked by Δ Championship Probability
- Saved ESPN league snapshots

WAR ROOM deliberately does **not** fake provider parity. ESPN currently lacks a WAR ROOM-supported equivalent of Sleeper's public add/drop trending feed and the same transaction-history shape, so those market/tendency factors remain neutral or lower-confidence rather than being copied from Sleeper.

Private ESPN credentials are stored only in HttpOnly, SameSite app-session cookies for interactive access. `SWID` and `espn_s2` are not written into saved league provider payloads. Automated GM background monitoring for private ESPN leagues is not enabled until a server-side secret-vault workflow is added.

Because ESPN's Fantasy endpoints are not an official supported developer contract, ESPN access is fail-soft: an ESPN endpoint or payload change surfaces an explicit ESPN provider error without breaking Sleeper or canonical NFL analytics.

## Persistence and security

WAR ROOM uses the dedicated Supabase project created for this application. Public tables use Row Level Security and saved leagues are scoped to the authenticated owner. Provider session secrets are never exposed in client-side configuration.

Decision Memory preserves recommendation snapshots as they existed at evaluation time rather than rewriting historical advice with hindsight.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and configure the WAR ROOM Supabase URL and publishable key. Do not place service-role or other server secrets in `NEXT_PUBLIC_*` variables.

Quality gate:

```bash
npm run typecheck
npm run lint
npm run build
```

## Modeling discipline

WAR ROOM recommendations are probabilistic decision support, not guarantees. Missing data is surfaced or neutralized instead of invented. Schedule gaps are excluded instead of fabricating opponents, and action duration is respected inside championship simulation: one-week lineup changes affect the current week, while trades and waiver acquisitions can produce sustained roster impact.
