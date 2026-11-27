import type { Metadata } from "next";
import "./globals.css";
import "./legacy.css";

export const metadata: Metadata = {
  title: "NeracaKita Accounting — Sistem Akuntansi Dagang, Jasa & Manufaktur",
  description: "Software akuntansi bisnis double-entry multi-sektor (Dagang, Jasa, Manufaktur) berbasis SAK EMKM.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
