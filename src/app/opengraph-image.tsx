import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "שורשים וכנפיים — שיעור אחד ביום, מהורים לילדים";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The share card: paper, one dot, the name. Hebrew needs a font with Hebrew glyphs, fetched from Google Fonts. */
export default async function Image() {
  let fontData: ArrayBuffer | null = null;
  try {
    const css = await fetch("https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500&display=swap", { headers: { "user-agent": "Mozilla/5.0" } }).then((r) => r.text());
    const url = /src: url\(([^)]+)\) format\('(?:truetype|opentype)'\)/.exec(css)?.[1] ?? /url\(([^)]+\.(?:ttf|otf))\)/.exec(css)?.[1];
    if (url) fontData = await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    fontData = null;
  }
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#FAF8F3", color: "#1B1B1B", fontFamily: fontData ? "Frank" : "serif" }}>
        <div style={{ width: 28, height: 28, borderRadius: 999, background: "#1B1B1B", marginBottom: 36 }} />
        <div style={{ fontSize: 96, direction: "rtl" }}>{fontData ? "שורשים וכנפיים" : "Roots and Wings"}</div>
        <div style={{ fontSize: 40, marginTop: 24, color: "#6B6B66", direction: "rtl" }}>{fontData ? "שיעור אחד ביום, מהורים לילדים. חינם." : "One lesson a day, from parents to kids. Free."}</div>
      </div>
    ),
    { ...size, fonts: fontData ? [{ name: "Frank", data: fontData, weight: 500, style: "normal" }] : [] },
  );
}
