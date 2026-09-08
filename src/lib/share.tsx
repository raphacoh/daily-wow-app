"use client";
/**
 * A quiet share row: Web Share where it exists (phones), otherwise copy the link and open WhatsApp.
 * No third-party script; the same sentence everywhere so the pitch stays consistent.
 */
import { useState } from "react";

const NAME = "שורשים וכנפיים";

export function ShareRow({ url, text }: { url: string; text: string }) {
  const [done, setDone] = useState(false);
  const wa = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  const share = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: NAME, text, url });
      } catch {
        /* dismissed */
      }
      return;
    }
    try {
      await navigator.clipboard?.writeText(url);
      setDone(true);
    } catch {
      /* no clipboard */
    }
    window.open(wa, "_blank", "noopener");
  };
  return (
    <p className="share">
      <button type="button" className="lnk" onClick={share}>{done ? "הקישור הועתק ›" : "שיתוף ›"}</button>
      <span className="small"> · </span>
      <a className="small" href={wa} target="_blank" rel="noopener">וואטסאפ</a>
      <span className="small"> · </span>
      <a className="small" href={`mailto:?subject=${encodeURIComponent(NAME)}&body=${encodeURIComponent(`${text}\n${url}`)}`}>מייל</a>
    </p>
  );
}
