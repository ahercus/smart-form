import { createClient } from "@/lib/supabase/client";

export async function signInAsGuest(): Promise<{ error: string | null }> {
  const guestEmail = process.env.NEXT_PUBLIC_GUEST_EMAIL;
  const guestPassword = process.env.NEXT_PUBLIC_GUEST_PASSWORD;

  if (!guestEmail || !guestPassword) {
    return { error: "Guest login is not configured" };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: guestEmail,
    password: guestPassword,
  });

  if (error) {
    console.error("[AutoForm] Guest login error:", error);
    return { error: "Guest login failed. Please try again." };
  }

  return { error: null };
}

export function isGuestEmail(email: string): boolean {
  return email === process.env.NEXT_PUBLIC_GUEST_EMAIL;
}
