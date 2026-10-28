import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import "./account.css";
import "./theme.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://dawnstudy.vercel.app"),
  other: {
    "google-adsense-account": "ca-pub-4982782720760429",
  },
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
  return <html lang="en" data-theme="dark" suppressHydrationWarning><body>{children}<Script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4982782720760429" crossOrigin="anonymous" strategy="afterInteractive" /></body></html>;
}
