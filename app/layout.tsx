import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dawnstudy — make learning stick",
  description: "Turn your class notes into a smarter way to study.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
