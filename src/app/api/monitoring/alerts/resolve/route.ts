import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ providerLeagueId: z.string().min(1).max(100) });

export async function POST(request: Request) {
  let providerLeagueId: string;
  try {
    providerLeagueId = schema.parse(await request.json()).providerLeagueId;
  } catch {
    return NextResponse.json({ error: "Invalid league" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: league } = await supabase
    .from("fantasy_leagues")
    .select("id")
    .eq("user_id", authData.user.id)
    .eq("provider", "sleeper")
    .eq("provider_league_id", providerLeagueId)
    .maybeSingle();
  if (!league) return NextResponse.json({ error: "Saved league not found" }, { status: 404 });

  const resolvedAt = new Date().toISOString();
  const { error } = await supabase
    .from("monitoring_alerts")
    .update({ resolved_at: resolvedAt, read_at: resolvedAt })
    .eq("league_id", league.id)
    .is("resolved_at", null)
    .eq("recalculation_required", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ resolved: true, resolvedAt });
}
