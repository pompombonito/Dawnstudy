import type { Metadata } from "next";
import "./dawn-ui.css";
import "./community/community.css";

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
  return <html lang="en" data-theme="dark" suppressHydrationWarning><body>{children}</body></html>;
}
