import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
          email: user.email,
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

    return NextResponse.json({ success: true, coreData: profile.core_data });
  } catch (error) {
    console.error("[AutoForm] Update profile error:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
