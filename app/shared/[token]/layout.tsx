import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shared study set | Dawnstudy",
  robots: { index: false, follow: false },
};

export default function SharedSetLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
