import { parseCsv } from "@/lib/csv";
import type { PlayerIdCrosswalk } from "@/lib/nflverse/client";

const PLAYER_IDS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

export type FantasyProviderName = "sleeper" | "espn";

function nullableNumber(value: string): number | null {
  if (!value || value === "NA") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadProviderPlayerIdCrosswalk(provider: FantasyProviderName): Promise<Map<string, PlayerIdCrosswalk>> {
  const response = await fetch(PLAYER_IDS_URL, {
    headers: { Accept: "text/csv", "User-Agent": "WAR-ROOM/0.8" },
    next: { revalidate: 86400 },
  });
  if (!response.ok) throw new Error(`Player identity source request failed (${response.status})`);
  const rows = parseCsv(await response.text());
  const map = new Map<string, PlayerIdCrosswalk>();

  for (const row of rows) {
    const providerId = provider === "espn" ? row.espn_id : row.sleeper_id;
    const gsisId = row.gsis_id;
    if (!providerId || providerId === "NA" || !gsisId || gsisId === "NA") continue;
    map.set(providerId, {
      // The analytics contract historically named this field sleeperId. The map key is
      // provider-native; consumers use gsisId/pfrId for canonical analytics joins.
      sleeperId: providerId,
      gsisId,
      pfrId: row.pfr_id && row.pfr_id !== "NA" ? row.pfr_id : null,
      name: row.name || "Unknown player",
      position: row.position || "",
      team: row.team || "",
      draftYear: nullableNumber(row.draft_year),
      draftRound: nullableNumber(row.draft_round),
      draftPick: nullableNumber(row.draft_pick),
    });
  }
  return map;
}
