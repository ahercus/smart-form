"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInAsGuest } from "@/lib/auth/guest-login";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FileText,
  Brain,
  Zap,
  Download,
  Mic,
  Shield,
  Upload,
  ScanSearch,
  PenTool,
  ArrowRight,
  Github,
  UserRound,
  Sparkles,
} from "lucide-react";

const features = [
  {
    icon: ScanSearch,
    title: "AI Field Detection",
    description:
      "Automatically identifies every form field — text inputs, checkboxes, dates, signatures — with pixel-perfect accuracy.",
  },
  {
    icon: Zap,
    title: "Smart Auto-Fill",
    description:
      "Gemini AI matches your saved profile to form fields, filling out entire documents in seconds.",
  },
  {
    icon: Brain,
    title: "Memory System",
    description:
      "Learns about you and your family over time. The more forms you fill, the smarter it gets.",
  },
  {
    icon: Download,
    title: "One-Click Export",
    description:
      "Download perfectly filled PDFs ready to print or submit. Your data, precisely placed.",
  },
  {
    icon: Mic,
    title: "Voice Input",
    description:
      "Speak your answers naturally. AI transcribes and places them in the right fields.",
  },
  {
    icon: Shield,
    title: "Secure & Private",
    description:
      "Your data stays yours. Row-level security ensures only you can access your information.",
  },
];

const steps = [
  {
    icon: Upload,
    title: "Upload",
    description: "Drop any PDF form",
  },
  {
    icon: ScanSearch,
    title: "AI Extracts",
    description: "Fields detected automatically",
  },
  {
    icon: Zap,
    title: "Auto-Fill",
    description: "Answers populated instantly",
  },
  {
    icon: PenTool,
    title: "Export",
    description: "Download the finished PDF",
  },
];

const techStack = [
  { name: "Gemini 3", highlight: true },
  { name: "Next.js" },
  { name: "Supabase" },
  { name: "Azure Doc Intelligence" },
  { name: "Tailwind CSS" },
  { name: "Vercel" },
];

export function LandingPage({ isAuthenticated }: { isAuthenticated: boolean }) {
  const router = useRouter();
  const [guestLoading, setGuestLoading] = useState(false);

  async function handleGuestLogin() {
    setGuestLoading(true);
    const { error } = await signInAsGuest();
    if (error) {
      toast.error(error);
      setGuestLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="app-bg relative min-h-screen">
      {/* Background orbs */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -top-[8%] right-[5%] h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,oklch(0.7_0.15_300/40%),transparent_65%)] blur-[30px]" />
        <div className="absolute -bottom-[5%] -left-[3%] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,oklch(0.75_0.12_170/35%),transparent_65%)] blur-[30px]" />
        <div className="absolute left-[20%] top-[30%] h-[350px] w-[350px] rounded-full bg-[radial-gradient(circle,oklch(0.8_0.1_60/30%),transparent_65%)] blur-[30px]" />
        <div className="absolute right-[25%] top-[15%] h-[280px] w-[280px] rounded-full bg-[radial-gradient(circle,oklch(0.65_0.12_240/35%),transparent_60%)] blur-[25px]" />
      </div>

      <div className="relative">
        {/* Nav */}
        <nav className="sticky top-0 z-50 glass">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FileText className="size-4" />
              </div>
              <span className="text-lg font-semibold">Fit Form</span>
            </Link>
            <div className="flex items-center gap-2">
              {isAuthenticated ? (
                <Button asChild size="sm">
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/login">Sign In</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link href="/signup">Sign Up</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </nav>

        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28 sm:pb-24">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full glass-light px-4 py-1.5 text-sm font-medium">
              <Sparkles className="size-4 text-primary" />
              Powered by Gemini 3
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              PDF Forms, Filled by{" "}
              <span className="text-primary">AI</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
              Upload any PDF form. AI detects fields, auto-fills your answers,
              and exports a ready-to-submit document — in seconds.
            </p>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button
                size="lg"
                onClick={handleGuestLogin}
                disabled={guestLoading}
                className="w-full sm:w-auto"
              >
                <UserRound className="size-4" />
                {guestLoading ? "Loading demo..." : "Try as Guest"}
              </Button>
              {!isAuthenticated && (
                <>
                  <Button
                    size="lg"
                    variant="outline"
                    asChild
                    className="w-full sm:w-auto"
                  >
                    <Link href="/signup">
                      Create Account
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">
            Everything You Need
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            From detection to export, Fit Form handles the entire form-filling
            workflow.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="glass rounded-2xl p-6 transition-shadow hover:shadow-lg"
              >
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary/10">
                  <feature.icon className="size-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">
            How It Works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            Four simple steps from PDF to done.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <div key={step.title} className="text-center">
                <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl glass">
                  <step.icon className="size-6 text-primary" />
                </div>
                <div className="mb-2 text-sm font-medium text-primary">
                  Step {i + 1}
                </div>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Video */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">
            See It In Action
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            Watch Fit Form turn a blank PDF into a completed form.
          </p>
          <div className="mt-10 mx-auto max-w-3xl">
            <div className="glass rounded-2xl aspect-video flex items-center justify-center">
              <p className="text-muted-foreground text-sm">
                Demo video coming soon
              </p>
            </div>
          </div>
        </section>

        {/* Built With */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">
            Built With
          </h2>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {techStack.map((tech) => (
              <span
                key={tech.name}
                className={`rounded-full px-5 py-2 text-sm font-medium ${
                  tech.highlight
                    ? "bg-primary text-primary-foreground"
                    : "glass-light"
                }`}
              >
                {tech.name}
              </span>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border/40 py-10">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 sm:flex-row sm:justify-between sm:px-6">
            <p className="text-sm text-muted-foreground">
              Built for the{" "}
              <span className="font-medium text-foreground">
                Gemini 3 Hackathon
              </span>
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/ahercus/smart-form"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="size-4" />
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
