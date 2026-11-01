import { BookOpen, Contrast, Leaf, Waves } from "lucide-react";
import Avatar from "./Avatar";
import type { ThemeFamily } from "../community/themes";

export default function ThemeEmblem({ family, className = "" }: { family: ThemeFamily; className?: string }) {
  const icon = { classic: Contrast, ocean: Waves, forest: Leaf, sepia: BookOpen }[family as "classic" | "ocean" | "forest" | "sepia"];
  if (!icon) return <Avatar id={family} className={className}/>;
  const Icon = icon;
  return <span className={`theme-classic-icon ${className}`} aria-hidden="true"><Icon size={23} strokeWidth={1.6}/></span>;
}
