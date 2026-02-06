// Background memory reconciliation endpoint
// Called after a user updates their profile (fire-and-forget)
// Re-evaluates existing memories against the new profile data

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reconcileMemoriesWithProfile } from "@/lib/memory/reconciliation";
import { ProfileCoreData } from "@/app/api/profile/route";

interface ReconcileRequest {
  coreData: ProfileCoreData;
}

/**
 * POST /api/memories/reconcile
 *
 * Background endpoint for reconciling memories with profile updates.
 * Called without await from the profile update flow for non-blocking processing.
 *
 * The endpoint returns immediately with 202 Accepted while reconciliation runs.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: ReconcileRequest = await request.json();
    const { coreData } = body;

    if (!coreData) {
      return NextResponse.json(
        { error: "coreData is required" },
        { status: 400 }
      );
    }

    // Skip reconciliation if profile is essentially empty
    const hasData = Object.values(coreData).some(
      (v) => v && String(v).trim().length > 0
    );
    if (!hasData) {
      return NextResponse.json({ status: "skipped", reason: "empty profile" });
    }

    console.log("[AutoForm] Starting background memory reconciliation:", {
      userId: user.id,
      hasFirstName: !!coreData.firstName,
      hasLastName: !!coreData.lastName,
      hasEmail: !!coreData.email,
      hasDOB: !!coreData.dateOfBirth,
    });

    // Run reconciliation - don't await, let it run in the background
    // Next.js will keep the serverless function alive until it completes
    reconcileMemoriesWithProfile(user.id, coreData)
      .then((result) => {
        console.log("[AutoForm] Background reconciliation completed:", {
          success: result.success,
          actionsApplied: result.actionsApplied,
        });
      })
      .catch((error) => {
        console.error("[AutoForm] Background reconciliation failed:", error);
      });

    // Return immediately with 202 Accepted
    return NextResponse.json(
      { status: "accepted", message: "Reconciliation started" },
      { status: 202 }
    );
  } catch (error) {
    console.error("[AutoForm] Reconcile endpoint error:", error);
    return NextResponse.json(
      { error: "Failed to start reconciliation" },
      { status: 500 }
    );
  }
}
