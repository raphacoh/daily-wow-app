/**
 * GET /api/open-books — the same numbers the /open-books page shows, as public JSON, so anyone can
 * check the arithmetic (or plot it) without scraping HTML. Cached for an hour.
 */
import { NextResponse } from "next/server";
import { monthlyRows, usdIls } from "@/lib/openbooks";
import { APP } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const months = await monthlyRows();
  return NextResponse.json(
    { currency: "ILS", usd_ils: usdIls(), price_per_kid_month: APP.priceIls, generated_at: new Date().toISOString(), months },
    { headers: { "cache-control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
