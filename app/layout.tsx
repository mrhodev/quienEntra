import type { Metadata, Viewport } from "next";
import { InlineScript } from "@/components/inline-script";
import { THEME_SCRIPT } from "@/lib/app/theme";
import { ServiceWorker } from "./service-worker";
import "./globals.css";

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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1113" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-AR" className="h-full antialiased" suppressHydrationWarning>
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
