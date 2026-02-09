import { createClient } from "@/lib/supabase/client";

export async function signInAsGuest(): Promise<{ error: string | null }> {
  const supabase = createClient();

  const { error } = await supabase.auth.signInAnonymously();

  if (error) {
    console.error("[AutoForm] Anonymous sign-in error:", error);
    return { error: "Guest login failed. Please try again." };
  }

  // Seed the new anonymous user with demo data
  const seedResponse = await fetch("/api/auth/seed-guest", {
    method: "POST",
  });

  if (!seedResponse.ok) {
    console.error("[AutoForm] Guest seed error:", await seedResponse.text());
    // Don't fail the login — user is signed in, just without demo data
  }

  return { error: null };
}

export function isGuestUser(user: { is_anonymous?: boolean } | null): boolean {
  return user?.is_anonymous === true;
}
