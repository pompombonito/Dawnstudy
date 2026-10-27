import { createElement } from "react";

export function ShareImage() {
  return createElement(
    "div",
    {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        padding: 58,
        background: "linear-gradient(130deg, #f7f5ec 0%, #e8f0e8 58%, #f5e5d9 100%)",
        color: "#123e47",
        fontFamily: "Arial, sans-serif",
        position: "relative",
        overflow: "hidden",
      },
      children: [
        createElement("div", { key: "orb", style: { display: "flex", position: "absolute", right: -72, top: -108, width: 660, height: 660, borderRadius: 330, background: "linear-gradient(180deg, #aad2cb 0%, #f8b8a4 61%, #f6ca84 100%)", opacity: 0.65 } }),
        createElement("div", { key: "horizon", style: { display: "flex", position: "absolute", right: -60, bottom: 88, width: 700, height: 112, borderRadius: "50%", background: "#78b8aa", transform: "rotate(-5deg)" } }),
        createElement("div", { key: "sunset", style: { display: "flex", position: "absolute", right: -70, bottom: 35, width: 720, height: 110, borderRadius: "50%", background: "#e89a82", transform: "rotate(4deg)" } }),
        createElement("div", { key: "sun", style: { display: "flex", position: "absolute", right: 210, top: 212, width: 108, height: 108, borderRadius: 54, background: "#ffd18d", boxShadow: "0 0 60px #ffd18d99" } }),
        createElement("div", { key: "content", style: { display: "flex", flexDirection: "column", position: "relative", zIndex: 2, width: "100%" }, children: [
          createElement("div", { key: "brand", style: { display: "flex", alignItems: "center", gap: 16 }, children: [
            createElement("div", { key: "mark", style: { display: "flex", alignItems: "center", justifyContent: "center", width: 62, height: 62, borderRadius: 19, background: "#dcece2", border: "1px solid #c9dfd2" }, children: createElement("svg", { width: 36, height: 36, viewBox: "0 0 24 24", fill: "none", stroke: "#176f70", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", children: [
              createElement("path", { key: "p1", d: "m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" }),
              createElement("path", { key: "p2", d: "m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" }),
            ] }) }),
            createElement("div", { key: "name", style: { display: "flex", flexDirection: "column", fontSize: 38, fontWeight: 700, letterSpacing: -1.8 }, children: ["dawnstudy", createElement("span", { key: "by", style: { fontSize: 15, fontWeight: 500, letterSpacing: 1, color: "#68827c", marginTop: 2 }, children: "by Devon" })] }),
          ] }),
          createElement("div", { key: "copy", style: { display: "flex", flexDirection: "column", marginTop: 93, width: 605 }, children: [
            createElement("div", { key: "eyebrow", style: { display: "flex", fontSize: 14, fontWeight: 700, letterSpacing: 3, color: "#567f78" }, children: "A LITTLE MORE FOCUS" }),
            createElement("div", { key: "headline", style: { display: "flex", flexDirection: "column", marginTop: 16, fontSize: 61, lineHeight: 1.08, fontWeight: 700, letterSpacing: -3.5, color: "#123e47" }, children: ["Make learning", createElement("span", { key: "second", style: { color: "#c86e63" }, children: "stick." })] }),
            createElement("div", { key: "desc", style: { display: "flex", marginTop: 19, fontSize: 20, lineHeight: 1.4, color: "#52747a" }, children: "Turn your notes into a brighter way to study." }),
          ] }),
          createElement("div", { key: "formats", style: { display: "flex", gap: 12, marginTop: 32 }, children: ["Flashcards", "Multiple choice", "Select all", "Identification"].map((label) => createElement("div", { key: label, style: { display: "flex", borderRadius: 18, border: "1px solid #ffffffb0", background: "#ffffff99", color: "#285760", padding: "10px 15px", fontSize: 14, fontWeight: 600 }, children: label })) }),
        ] }),
        createElement("div", { key: "foot", style: { display: "flex", position: "absolute", right: 50, bottom: 31, fontSize: 14, color: "#577b77", fontStyle: "italic" }, children: "one page at a time  ✳" }),
      ],
    },
  );
}
