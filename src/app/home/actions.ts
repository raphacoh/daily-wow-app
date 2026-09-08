"use server";
/**
 * Parent dashboard mutations (PRD §5.4). Every action starts from the signed-in parent — the kid id
 * always comes from the form, so every helper in `family.ts` re-checks ownership before it writes.
 * A signed-out parent is bounced to /signin instead of seeing an error page.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { NotSignedIn, requireParent } from "@/lib/auth";
import {
  addTopicIdea,
  assertOwnsKid,
  deleteFamily,
  removeContact,
  removeKid,
  rotateKidToken,
  setKidLevel,
  updateKid,
  updateParent,
  upsertContact,
} from "@/lib/family";
import { LEVELS_UI, type Level } from "@/lib/kids";
import { t } from "@/i18n";

/** `requireParent().catch(signedOut)` — the only way out of an action for a parent without a session. */
function signedOut(e: unknown): never {
  if (e instanceof NotSignedIn) redirect("/signin");
  throw e;
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? "").trim();
const on = (fd: FormData, k: string): boolean => fd.get(k) != null;

export async function saveLevel(fd: FormData): Promise<void> {
  const parent = await requireParent().catch(signedOut);
  const level = str(fd, "level");
  if (level in LEVELS_UI) await setKidLevel(parent.id, str(fd, "kid"), level as Level);
  revalidatePath("/home");
}

export async function saveKid(fd: FormData): Promise<void> {
  const parent = await requireParent().catch(signedOut);
  const age = Number(str(fd, "age"));
  await updateKid(parent.id, str(fd, "kid"), {
    name: str(fd, "name"),
    age: Number.isInteger(age) ? age : undefined,
    grade: str(fd, "grade"),
    feminine: str(fd, "feminine") === "1",
    email: str(fd, "email") || null,
  });
  revalidatePath("/home");
}

export async function addAdult(fd: FormData): Promise<void> {
  const parent = await requireParent().catch(signedOut);
  await upsertContact(parent.id, str(fd, "kid"), { name: str(fd, "name"), email: str(fd, "email") });
  revalidatePath("/home");
}

export async function dropAdult(fd: FormData): Promise<void> {
  const parent = await requireParent().catch(signedOut);
  await removeContact(parent.id, str(fd, "kid"), str(fd, "contact"));
  revalidatePath("/home");
}

/** A fresh personal link. The old one stops working the moment this returns — the UI says so. */
export async function newLink(fd: FormData): Promise<void> {
  const parent = await requireParent().catch(signedOut);
  const kidId = str(fd, "kid");
  await assertOwnsKid(parent.id, kidId);
  await rotateKidToken(kidId);
  revalidatePath("/home");
}

export async function setPaused(fd: FormData): Promise<void> {
  const parent = await requireParent().catch(signedOut);
  await updateKid(parent.id, str(fd, "kid"), { paused: str(fd, "paused") === "1" });
  revalidatePath("/home");
}

export async function dropKid(fd: FormData): Promise<void> {
  const parent = await requireParent().catch(signedOut);
  await removeKid(parent.id, str(fd, "kid"));
  revalidatePath("/home");
}

export async function saveAccount(fd: FormData): Promise<void> {
  const parent = await requireParent().catch(signedOut);
  await updateParent(parent.id, {
    name: str(fd, "name"),
    notify_completion: on(fd, "notify_completion"),
    notify_weekly: on(fd, "notify_weekly"),
    notify_streak_risk: on(fd, "notify_streak_risk"),
    keep_explanations: on(fd, "keep_explanations"),
  });
  revalidatePath("/home");
}

export async function suggestTopic(fd: FormData): Promise<void> {
  const parent = await requireParent().catch(signedOut);
  await addTopicIdea(parent.id, str(fd, "idea"));
  revalidatePath("/home");
}

/** Hard delete (PRD §10). Guarded by typing the confirmation word, not by a checkbox. */
export async function deleteAccount(fd: FormData): Promise<void> {
  const parent = await requireParent().catch(signedOut);
  if (str(fd, "confirm") !== t("home.deleteWord")) {
    revalidatePath("/home");
    return;
  }
  await deleteFamily(parent.id);
  revalidatePath("/home");
  redirect("/");
}
