import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Order Suggestion System",
  description: "AI-powered purchase order quantity suggestions based on sales trends and stock levels",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-neutral-950 text-neutral-100`}>
        <header className="border-b border-neutral-800 bg-neutral-950">
          <div className="max-w-7xl mx-auto flex items-center gap-3 px-4 py-3">
            {/* Place pantera-logo.png in /public at the repo root */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pantera-logo.png" alt="Pantera" className="h-8 w-8 object-contain" />
            <div className="text-sm sm:text-base">
              <span className="font-semibold">Pantera</span> · Order Suggestion System
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
