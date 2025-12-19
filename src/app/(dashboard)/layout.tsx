import Link from "next/link";
import { FileText, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/dashboard" className="font-semibold text-lg">
            AutoForm AI
          </Link>
          <nav className="flex items-center gap-4">
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">
                <FileText className="h-4 w-4 mr-2" />
                Documents
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/profile">
                <User className="h-4 w-4 mr-2" />
                Profile
              </Link>
            </Button>
            <form action="/api/auth/signout" method="POST">
              <Button variant="ghost" size="sm" type="submit">
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </Button>
            </form>
          </nav>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
