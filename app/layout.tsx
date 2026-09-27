import type { Metadata, Viewport } from "next";
import { Saira, Saira_Condensed } from "next/font/google";
import { InlineScript } from "@/components/inline-script";
import { THEME_SCRIPT } from "@/lib/app/theme";
import { ServiceWorker } from "./service-worker";
import "./globals.css";

/** Tipografías del estilo Fantasy, autoalojadas (sin pedidos a Google; funcionan sin conexión). */
const saira = Saira({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-saira", display: "swap" });
const sairaCondensed = Saira_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-saira-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: "quienEntra",
  description: "Rotaciones equitativas y estadísticas de minutos para tu equipo de fútbol.",
  applicationName: "quienEntra",
  appleWebApp: { capable: true, title: "quienEntra", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f0a26",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-AR" className={`h-full antialiased ${saira.variable} ${sairaCondensed.variable}`} suppressHydrationWarning>
      <head>
        <InlineScript html={THEME_SCRIPT} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
