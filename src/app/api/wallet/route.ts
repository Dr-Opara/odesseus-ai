import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWalletBalance } from "@/lib/wallet/service";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    const balance = await getWalletBalance(supabase, userId);
    return NextResponse.json(balance);
  } catch (error) {
    console.error("[ODESSEUS_WALLET] balance lookup failed", error);
    return NextResponse.json({ error: "Could not load wallet balance." }, { status: 500 });
  }
}