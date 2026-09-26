import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWalletTransactions } from "@/lib/wallet/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "25");
  const offset = Number(url.searchParams.get("offset") ?? "0");

  if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
    return NextResponse.json({ error: "Invalid pagination." }, { status: 400 });
  }

  try {
    const ledger = await getWalletTransactions(supabase, userId, { limit, offset });
    return NextResponse.json(ledger);
  } catch (error) {
    console.error("[ODESSEUS_WALLET] transaction lookup failed", error);
    return NextResponse.json({ error: "Could not load wallet transactions." }, { status: 500 });
  }
}