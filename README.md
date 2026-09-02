# WAR ROOM — Fantasy Football Championship Intelligence

Sprint 1 vertical slice for the fantasy-football decision engine.

## What works now

- Premium WAR ROOM command-center shell
- Live Sleeper username lookup
- Current Sleeper NFL league discovery
- Live league settings, users, roster, matchup, draft, and active-player retrieval
- League team/standing normalization
- Honest provider/data error states
- Supabase-ready schema with user ownership and Row Level Security
- API health endpoint

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and select **Connect League**.

Supabase is optional for the first live slice. When a dedicated WAR ROOM project is provisioned, copy `.env.example` to `.env.local` and add the new project URL/publishable key/secret server key.

## Safety / architecture notes

The existing Supabase project named `GameDay` was not modified because its migration history indicates it belongs to a different application. The WAR ROOM migration is therefore packaged but unapplied.

Sleeper's public API is read-only. WAR ROOM does not request a Sleeper password or API token.
