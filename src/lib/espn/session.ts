import "server-only";
import { cookies } from "next/headers";
import type { EspnCredentials } from "@/lib/espn/client";

export const ESPN_SWID_COOKIE = "war_room_espn_swid";
export const ESPN_S2_COOKIE = "war_room_espn_s2";

export async function readEspnCredentials(): Promise<EspnCredentials> {
  const store = await cookies();
  return {
    swid: store.get(ESPN_SWID_COOKIE)?.value ?? null,
    espnS2: store.get(ESPN_S2_COOKIE)?.value ?? null,
  };
}
