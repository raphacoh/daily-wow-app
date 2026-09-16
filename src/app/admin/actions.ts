"use server";

/**
 * Server actions behind /admin. Every one of them re-checks `requireEditor()` — a form post is a
 * request like any other, and the page having rendered proves nothing about who is posting.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { NotSignedIn, requireEditor } from "@/lib/auth";
import {
  approveEdition,
  deleteFamilyByAdmin,
  grantFreeAssistant,
  holdEdition,
  releaseEdition,
  republish,
  requestChanges,
  saveSkill,
  sendTestDaily,
  setConfig,
  setRootAlias,
  StageError,
  updateFamilyContact,
} from "@/lib/admin";
import { rebuildAllProgress } from "@/lib/gamification";

/** The settings the /admin form may write. Anything else needs a code change — on purpose. */
const CONFIG_KEYS = ["assistant_daily_cap", "free_messages_per_day", "demo_pool_per_day", "model", "send_time", "resend_daily_limit"] as const;

async function editor() {
  try {
    return await requireEditor();
  } catch (e) {
    if (e instanceof NotSignedIn) redirect("/signin?next=/admin");
    throw e;
  }
}

/** Every action lands back on /admin with one Hebrew line in `?msg=` (or `?err=`); `q` keeps a family panel open. */
function back(msg: string, ok = true, q?: string): never {
  revalidatePath("/admin");
  redirect(`/admin?${ok ? "msg" : "err"}=${encodeURIComponent(msg)}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
}

function num(fd: FormData, key: string): number {
  return Number(fd.get(key));
}

export async function holdAction(fd: FormData): Promise<void> {
  await editor();
  const n = num(fd, "n");
  try {
    await holdEdition(n);
  } catch (e) {
    back(e instanceof StageError ? e.message : "משהו נכשל", false);
  }
  back(`גיליון #${n} מוחזק — לא נשלח לאף אחד.`);
}

/** The editor said yes. It joins the queue and goes out on its turn — not necessarily today. */
export async function approveAction(fd: FormData): Promise<void> {
  await editor();
  const n = num(fd, "n");
  try {
    await approveEdition(n);
  } catch (e) {
    back(e instanceof StageError ? e.message : "האישור נכשל", false);
  }
  back(`גיליון #${n} אושר ונכנס לתור.`);
}

/** Sent back to the builder with a note. It leaves the queue until it is rebuilt and approved. */
export async function requestChangesAction(fd: FormData): Promise<void> {
  await editor();
  const n = num(fd, "n");
  const note = String(fd.get("revision_note") ?? "").trim();
  try {
    await requestChanges(n, note);
  } catch (e) {
    back(e instanceof StageError ? e.message : "לא הצלחתי לשמור את ההערה", false);
  }
  back(`גיליון #${n} הוחזר לתיקון. ההערה נשמרה לבנייה הבאה.`);
}

export async function releaseAction(fd: FormData): Promise<void> {
  await editor();
  const n = num(fd, "n");
  const note = String(fd.get("editor_note") ?? "").trim();
  // `back()` redirects by throwing, so it must never sit inside a try that swallows errors.
  let done: Awaited<ReturnType<typeof releaseEdition>>;
  try {
    done = await releaseEdition(n, {
      editor_note: note || null,
      edited_by_editor: fd.get("edited_by_editor") !== null,
      send: fd.get("send") !== null,
    });
  } catch (e) {
    back(e instanceof StageError ? e.message : "השחרור נכשל", false);
  }
  back(
    done.send
      ? `גיליון #${n} שוחרר. נשלח ל-${done.send.sent} משפחות (${done.send.skipped} דילוגים${done.send.errors.length ? `, ${done.send.errors.length} שגיאות` : ""}).`
      : `גיליון #${n} שוחרר בלי שליחה.`,
  );
}

export async function republishAction(fd: FormData): Promise<void> {
  await editor();
  const n = num(fd, "n");
  const r = await republish(n);
  back(`נשלח שוב: ${r.sent} משפחות, ${r.skipped} דילוגים${r.errors.length ? `, ${r.errors.length} שגיאות` : ""}.`);
}

export async function testMailAction(fd: FormData): Promise<void> {
  const me = await editor();
  const n = num(fd, "n");
  const r = await sendTestDaily(n, me.email);
  if (r.error) back(`מייל הבדיקה נכשל: ${r.error}`, false);
  if (r.skipped) back(`מייל הבדיקה לא נשלח (${r.skipped}) — Resend לא מוגדר בשרת הזה.`, false);
  back(`מייל הבדיקה של #${n} נשלח ל-${r.to}.`);
}

export async function saveConfigAction(fd: FormData): Promise<void> {
  await editor();
  const changed: string[] = [];
  for (const key of CONFIG_KEYS) {
    const raw = fd.get(key);
    if (raw === null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    await setConfig(key, value);
    changed.push(key);
  }
  back(changed.length ? `נשמר: ${changed.join(", ")}.` : "לא השתנה כלום.");
}

export async function grantAssistantAction(fd: FormData): Promise<void> {
  await editor();
  const kidId = String(fd.get("kid_id") ?? "").trim();
  const until = String(fd.get("until") ?? "").trim();
  try {
    await grantFreeAssistant(kidId, until);
  } catch (e) {
    back(e instanceof StageError ? e.message : "לא הצלחתי", false);
  }
  back(`ארטו פתוח לילד/ה הזה/הזאת עד ${until}.`);
}

export async function editFamilyAction(fd: FormData): Promise<void> {
  await editor();
  const parentId = String(fd.get("parent_id") ?? "").trim();
  const q = String(fd.get("q") ?? "").trim();
  let r: { email: string };
  try {
    r = await updateFamilyContact(parentId, { name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? "") });
  } catch (e) {
    back(e instanceof StageError ? e.message : "לא הצלחתי לשמור", false, q);
  }
  back("פרטי המשפחה נשמרו.", true, r.email);
}

export async function deleteFamilyAction(fd: FormData): Promise<void> {
  await editor();
  const parentId = String(fd.get("parent_id") ?? "").trim();
  const q = String(fd.get("q") ?? "").trim();
  let r: { email: string };
  try {
    r = await deleteFamilyByAdmin(parentId, String(fd.get("confirm_email") ?? ""));
  } catch (e) {
    back(e instanceof StageError ? e.message : "המחיקה נכשלה", false, q);
  }
  back(`המשפחה ${r.email} נמחקה לגמרי.`);
}

/* ---------- gamification registries (spec §9) ---------- */

export async function aliasTopicAction(fd: FormData): Promise<void> {
  await editor();
  try {
    await setRootAlias(String(fd.get("topic") ?? ""), String(fd.get("root") ?? ""));
  } catch (e) {
    back(e instanceof StageError ? e.message : "לא הצלחנו לשמור", false);
  }
  back("נשמר. השורשים יחושבו מחדש ב\"לחשב מחדש\".");
}

export async function saveSkillAction(fd: FormData): Promise<void> {
  await editor();
  try {
    await saveSkill(String(fd.get("slug") ?? ""), String(fd.get("name_he") ?? ""), String(fd.get("canonical") ?? "").trim());
  } catch (e) {
    back(e instanceof StageError ? e.message : "לא הצלחנו לשמור", false);
  }
  back("הכישור נשמר.");
}

export async function rebuildProgressAction(): Promise<void> {
  await editor();
  const kids = await rebuildAllProgress();
  back(`חושב מחדש עבור ${kids} ילדים.`);
}
