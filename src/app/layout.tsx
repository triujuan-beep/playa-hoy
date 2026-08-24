import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Playa Hoy · La mejor playa para bañarte hoy",
  description: "Compara el estado del mar, el viento y la calidad del agua en las playas de la Costa del Sol.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es" data-scroll-behavior="smooth"><body>{children}</body></html>;
}
