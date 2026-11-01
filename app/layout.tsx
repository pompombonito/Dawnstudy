import type { Metadata } from "next";
import "./dawn-ui.css";
import "./community/community.css";
import "./character-themes.css";
import "./classic-themes.css";
import { themeBootstrapScript } from "./community/themes";

export const metadata: Metadata = {
  metadataBase: new URL("https://dawnstudy.vercel.app"),
  title: "Dawnstudy — make learning stick",
  description: "Turn your class notes into a smarter way to study.",
  applicationName: "Dawnstudy",
  openGraph: {
    type: "website",
    url: "https://dawnstudy.vercel.app/",
    siteName: "Dawnstudy",
    title: "Dawnstudy — make learning stick",
    description: "Turn your learning materials into flashcards, quizzes, and a study rhythm that sticks.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dawnstudy — make learning stick",
    description: "Turn your learning materials into flashcards, quizzes, and a study rhythm that sticks.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="dark" data-character="kuromi" data-color-theme="kuromi-dark" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}/></head><body>{children}</body></html>;
}
