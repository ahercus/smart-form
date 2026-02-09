import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout";

export default async function AppLayout({
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
    <SidebarProvider>
      <AppSidebar userEmail={user.email || "Guest Demo"} isAnonymous={user.is_anonymous ?? false} />
      <SidebarInset className="app-bg relative h-svh overflow-hidden">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-[8%] right-[5%] h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,oklch(0.7_0.15_300/40%),transparent_65%)] blur-[30px]" />
          <div className="absolute -bottom-[5%] -left-[3%] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,oklch(0.75_0.12_170/35%),transparent_65%)] blur-[30px]" />
          <div className="absolute left-[20%] top-[30%] h-[350px] w-[350px] rounded-full bg-[radial-gradient(circle,oklch(0.8_0.1_60/30%),transparent_65%)] blur-[30px]" />
          <div className="absolute right-[25%] top-[15%] h-[280px] w-[280px] rounded-full bg-[radial-gradient(circle,oklch(0.65_0.12_240/35%),transparent_60%)] blur-[25px]" />
        </div>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
