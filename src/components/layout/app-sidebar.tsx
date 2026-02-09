"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, User, Brain, PenTool, LogOut, Eye } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

interface AppSidebarProps {
  userEmail: string;
  isAnonymous: boolean;
}

const navItems = [
  {
    title: "Documents",
    href: "/dashboard",
    icon: FileText,
  },
  {
    title: "Profile",
    href: "/profile",
    icon: User,
  },
  {
    title: "Memory",
    href: "/memory",
    icon: Brain,
  },
  {
    title: "Signatures",
    href: "/signatures",
    icon: PenTool,
  },
];

export function AppSidebar({ userEmail, isAnonymous }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <FileText className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Fit Form</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Smart PDF Forms
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href === "/dashboard" &&
                    pathname.startsWith("/document"));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={userEmail}>
              <div className="cursor-default">
                {isAnonymous ? (
                  <Eye className="size-4" />
                ) : (
                  <User className="size-4" />
                )}
                <span className="truncate text-xs">
                  {isAnonymous ? "Guest Demo" : userEmail}
                </span>
                {isAnonymous && (
                  <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                    Guest
                  </span>
                )}
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action="/api/auth/signout" method="POST" className="w-full">
              <SidebarMenuButton asChild tooltip="Sign out">
                <Button
                  type="submit"
                  variant="ghost"
                  className="w-full justify-start gap-2 h-8 px-2"
                >
                  <LogOut className="size-4" />
                  <span>Sign out</span>
                </Button>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
