import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VidiaForge — Professional Video Editing in Your Browser",
  description:
    "VidiaForge is a professional, browser-based video editing studio. Edit video on a real timeline with AI captions, effects, transitions, color grading, and one-click exports for TikTok, Reels, and YouTube.",
  keywords: [
    "video editor", "online video editor", "CapCut alternative", "Premiere alternative",
    "AI video editing", "browser video editor", "PWA video editor", "VidiaForge",
  ],
  authors: [{ name: "VidiaForge" }],
  manifest: "/manifest.webmanifest",
  applicationName: "VidiaForge",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VidiaForge",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
  openGraph: {
    title: "VidiaForge — Professional Video Editing in Your Browser",
    description:
      "A cinematic, AI-powered video editor that runs entirely in your browser. Installable as a PWA.",
    siteName: "VidiaForge",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VidiaForge",
    description: "Professional video editing in your browser.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground overflow-hidden`}
      >
        {children}
        <Toaster />
        <SonnerToaster position="bottom-right" theme="dark" />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
