import { NextResponse } from "next/server";
import { espn, EspnApiError } from "@/lib/espn/client";
import { ESPN_S2_COOKIE, ESPN_SWID_COOKIE } from "@/lib/espn/session";

function redirectWithError(request: Request, message: string) {
  const url = new URL("/connect", request.url);
  url.searchParams.set("provider", "espn");
  url.searchParams.set("espnError", message);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const leagueId = String(form.get("leagueId") ?? "").trim();
  const season = Number(form.get("season") ?? new Date().getFullYear());
  const swid = String(form.get("swid") ?? "").trim();
  const espnS2 = String(form.get("espnS2") ?? "").trim();

  if (!leagueId || !/^\d+$/.test(leagueId)) return redirectWithError(request, "Enter a valid numeric ESPN league ID.");
  if (!Number.isInteger(season) || season < 2018 || season > 2100) return redirectWithError(request, "Enter a valid ESPN fantasy season.");
  if ((swid && !espnS2) || (!swid && espnS2)) return redirectWithError(request, "Private ESPN leagues require both SWID and espn_s2.");

  try {
    await espn.validateLeague(leagueId, season, { swid: swid || null, espnS2: espnS2 || null });
    const destination = new URL(`/espn/${leagueId}`, request.url);
    destination.searchParams.set("season", String(season));
    const response = NextResponse.redirect(destination, 303);

    if (swid && espnS2) {
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      };
      response.cookies.set(ESPN_SWID_COOKIE, swid, cookieOptions);
      response.cookies.set(ESPN_S2_COOKIE, espnS2, cookieOptions);
    }
    return response;
  } catch (error) {
    if (error instanceof EspnApiError) {
      if (error.code === "ACCESS_DENIED") return redirectWithError(request, "ESPN denied access. If this league is private, provide fresh SWID and espn_s2 browser cookies.");
      if (error.code === "NOT_FOUND") return redirectWithError(request, "That ESPN league was not found for the selected season.");
    }
    return redirectWithError(request, "ESPN league data is temporarily unavailable. WAR ROOM will not fabricate league data.");
  }
}
