export const animals = [
  ["cat", "Cat"],
  ["fox", "Fox"],
  ["bunny", "Bunny"],
  ["bear", "Bear"],
  ["dog", "Dog"],
  ["owl", "Owl"],
  ["panda", "Panda"],
  ["capybara", "Capybara"],
  ["penguin", "Penguin"],
  ["duck", "Duck"],
  ["pompompurin", "Pompompurin"],
  ["cinnamoroll", "Cinnamoroll"],
  ["kuromi", "Kuromi"],
  ["hello-kitty", "Hello Kitty"],
  ["my-melody", "My Melody"],
  ["keroppi", "Keroppi"],
  ["pochacco", "Pochacco"],
  ["tuxedosam", "Tuxedosam"],
  ["badtz-maru", "Badtz-Maru"],
] as const;
export const outfits = [
  ["daily", "Pink & white"],
  ["clinical", "Clinical whites"],
  ["lab", "Lab coat"],
  ["scrubs", "Scrubs"],
  ["sport", "PE"],
  ["formal", "Formal"],
] as const;
export const portraits = ["female", "male"].flatMap((gender) =>
  outfits.flatMap(([outfit, title]) =>
    Array.from({ length: 8 }, (_, i) => ({
      id: `portrait-${gender}-${outfit}-${i}`,
      label: `${gender === "female" ? "Feminine" : "Masculine"} · ${title} · ${i + 1}`,
    })),
  ),
);
export const themes = [
  {
    id: "light",
    title: "Morning",
    label: "Light",
    description: "Soft paper, warm cream and forest green.",
  },
  {
    id: "dark",
    title: "Midnight",
    label: "Dark",
    description: "Quiet charcoal, sage and a little amber.",
  },
  {
    id: "rose",
    title: "Rose Dawn",
    label: "Rose Dawn",
    description: "Blush skies, plum ink and berry accents.",
  },
] as const;
