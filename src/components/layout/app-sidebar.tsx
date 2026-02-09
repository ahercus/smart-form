"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, User, Brain, PenTool, LogOut, Eye, UserPlus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
                    Any Form. Perfect Fit.
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
            {isAnonymous ? (
              <Popover>
                <PopoverTrigger asChild>
                  <SidebarMenuButton tooltip="Guest Demo">
                    <Eye className="size-4" />
                    <span className="truncate text-xs">Guest Demo</span>
                    <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Guest
                    </span>
                  </SidebarMenuButton>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-72">
                  <div className="space-y-3">
                    <div>
                      <p className="font-medium text-sm">Guest account</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        You&apos;re exploring Fit Form as a guest. Your data is temporary and will not be saved.
                      </p>
                    </div>
                    <Button asChild className="w-full" size="sm">
                      <Link href="/signup">
                        <UserPlus className="size-4" />
                        Create your account
                      </Link>
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <SidebarMenuButton asChild tooltip={userEmail}>
                <div className="cursor-default">
                  <User className="size-4" />
                  <span className="truncate text-xs">{userEmail}</span>
                </div>
              </SidebarMenuButton>
            )}
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
