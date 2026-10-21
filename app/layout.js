import { Geist, Geist_Mono } from "next/font/google";
import AppShell from "@/components/AppShell";
import Logo from "@/components/Logo";
import { themeBootScript } from "@/lib/theme-boot";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Puneet Studios",
  description: "Puneet Studios creator workspace: media library on the studio PC",
  icons: { icon: "/icon-192.png?v=3", apple: "/apple-touch-icon.png?v=3" },
  appleWebApp: { capable: true, title: "Puneet Studios", statusBarStyle: "black-translucent" },
};

// Status-bar colour follows the phone’s light/dark setting until the app’s own choice loads.
export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-950">
        {/* Opening animation: carries on from Android's launch screen, then fades away.
            Pure CSS so it plays before any JavaScript loads; it never blocks taps. */}
        <div aria-hidden="true" className="launch">
          <div className="launch-glow" />
          <div className="launch-logo">
            <Logo size={92} />
          </div>
          <p className="launch-name">Puneet Studios</p>
          <p className="launch-tag">Creator workspace</p>
        </div>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
