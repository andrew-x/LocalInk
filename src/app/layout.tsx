import type { Metadata } from "next";
import { DM_Mono, DM_Sans, DM_Serif_Display, Literata } from "next/font/google";
import { Toaster } from "@/components/common/sonner";
import "../styles/globals.scss";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const dmSerif = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  weight: "variable",
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "ui-serif", "serif"],
});

export const metadata: Metadata = {
  title: "LocalInk",
  description: "A local-first writing workspace for fiction and AI assistance.",
  icons: {
    icon: [{ url: "/Icon.svg", type: "image/svg+xml" }],
    shortcut: "/Icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full">
      <body
        className={`${dmSans.variable} ${dmSerif.variable} ${dmMono.variable} ${literata.variable} flex min-h-full flex-col bg-background antialiased`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
