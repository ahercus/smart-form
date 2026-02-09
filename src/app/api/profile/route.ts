import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Base URL for internal API calls
const getBaseUrl = () => {
  // In production, use the deployment URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  // In development, use localhost
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
};

export interface ProfileCoreData {
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

// GET /api/profile - Get user's profile
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, email, core_data")
      .eq("user_id", user.id)
      .single();

    if (error) {
      // Profile might not exist yet
      if (error.code === "PGRST116") {
        return NextResponse.json({ coreData: null });
      }
      throw error;
    }

    return NextResponse.json({
      coreData: profile?.core_data || null,
    });
  } catch (error) {
    console.error("[AutoForm] Get profile error:", error);
    return NextResponse.json(
      { error: "Failed to get profile" },
      { status: 500 }
    );
  }
}

// PATCH /api/profile - Update user's profile
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { coreData } = body as { coreData: ProfileCoreData };

    if (!coreData) {
      return NextResponse.json(
        { error: "coreData is required" },
        { status: 400 }
      );
    }

    // Upsert profile
    const { data: profile, error } = await supabase
      .from("profiles")
      .upsert(
        {
          user_id: user.id,
          email: user.email || `anonymous-${user.id.slice(0, 8)}@guest.local`,
          core_data: coreData,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
        }
      )
      .select()
      .single();

    if (error) {
      throw error;
    }

    console.log("[AutoForm] Profile updated:", {
      userId: user.id,
      hasFirstName: !!coreData.firstName,
      hasLastName: !!coreData.lastName,
    });

    // Trigger memory reconciliation in the background (fire-and-forget)
    // This re-evaluates existing memories against the new profile data
    triggerMemoryReconciliation(coreData);

    return NextResponse.json({ success: true, coreData: profile.core_data });
  } catch (error) {
    console.error("[AutoForm] Update profile error:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}

/**
 * Trigger memory reconciliation in the background
 * This calls the reconcile endpoint without waiting for it to complete
 */
function triggerMemoryReconciliation(coreData: ProfileCoreData) {
  // Fire-and-forget - don't await
  fetch(`${getBaseUrl()}/api/memories/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coreData }),
  }).catch((error) => {
    // Log but don't throw - reconciliation failure shouldn't affect profile update
    console.error("[AutoForm] Failed to trigger memory reconciliation:", error);
  });
}
