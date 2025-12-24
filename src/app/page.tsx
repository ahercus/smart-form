import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Redirect authenticated users to document page
  if (user) {
    redirect("/document");
  }

  // Redirect to login for unauthenticated users
  redirect("/login");
}
