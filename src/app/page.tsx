import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          AutoForm AI
        </h1>
        <p className="text-xl text-muted-foreground">
          Transform PDF forms into intelligent, interactive experiences. Upload
          any PDF form and fill it out in seconds with AI-powered auto-fill.
        </p>
        <div className="flex gap-4 justify-center">
          <Button asChild size="lg">
            <Link href="/login">Get Started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/signup">Create Account</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
