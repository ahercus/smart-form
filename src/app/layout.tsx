import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono, Sora } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: "800",
});

export const metadata: Metadata = {
  title: "Fit Form — Any Form, Perfect Fit",
  description:
    "Drop a PDF or snap a photo. Brain dump what you know. AI finds every field, fills the answers, and remembers it all for next time. Powered by Gemini 3.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} ${sora.variable} antialiased`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
