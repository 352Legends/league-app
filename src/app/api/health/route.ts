import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    app: "WAR ROOM",
    status: "ok",
    season: 2026,
    sleeper: "configured",
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    timestamp: new Date().toISOString(),
  });
}
