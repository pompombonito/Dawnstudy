import { ImageResponse } from "next/og";
import { ShareImage } from "./share-image";

export const alt = "Dawnstudy — make learning stick";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(ShareImage(), size);
}
