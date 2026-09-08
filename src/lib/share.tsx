/**
 * A quiet share row: Web Share where it exists (phones), otherwise WhatsApp + copy link. No third party.
 * Server component + one tiny inline handler; the same text everywhere so the pitch stays consistent.
 */
import { APP } from "./config";

export function ShareRow({ what = "site" }: { what?: "site" | "manifesto" }) {
  const url = what === "manifesto" ? `${APP.url}/manifesto` : `${APP.url}/`;
  const text = what === "manifesto" ? "למה אני בונה שיעור אחד ביום לילדים שלי, ומזמין הורים אחרים להצטרף:" : "שורשים וכנפיים: שיעור אחד ביום לילדים, מהורים, חינם. נסו את השיעור של היום:";
  const wa = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  const js = `(function(b){var u=${JSON.stringify(url)},t=${JSON.stringify(text)};if(navigator.share){navigator.share({title:${JSON.stringify(APP.name)},text:t,url:u}).catch(function(){});return;}try{navigator.clipboard&&navigator.clipboard.writeText(u);b.textContent='הקישור הועתק';}catch(e){}window.open(${JSON.stringify(wa)},'_blank','noopener');})(this)`;
  return (
    <p className="share">
      <button type="button" className="lnk" onClick={undefined} dangerouslySetInnerHTML={{ __html: "שיתוף ›" }} data-share="" ref={undefined} {...{ onclick: js } as Record<string, string>} />
      <span className="small"> · </span>
      <a className="small" href={wa} target="_blank" rel="noopener">וואטסאפ</a>
      <span className="small"> · </span>
      <a className="small" href={`mailto:?subject=${encodeURIComponent(APP.name)}&body=${encodeURIComponent(`${text}\n${url}`)}`}>מייל</a>
    </p>
  );
}
