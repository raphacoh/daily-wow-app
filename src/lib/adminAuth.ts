/**
 * The one gate in front of every /api/admin route (PRD §6.6): either the pipeline's bearer key, or a
 * signed-in editor (so the admin UI can call the same endpoints without a key in the browser).
 *
 * Kept out of `admin.ts` on purpose: this module reaches for cookies through `auth.ts`, and `admin.ts`
 * must stay importable from plain Node (tests, scripts).
 */
import { NextResponse } from "next/server";
import { isEditorApiKey, requireEditor } from "./auth";

export async function isAdminRequest(req: Request): Promise<boolean> {
  if (isEditorApiKey(req.headers.get("authorization"))) return true;
  try {
    await requireEditor();
    return true;
  } catch {
    return false;
  }
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
}

/** `null` when the caller is allowed; the 401 response when they are not. */
export async function guard(req: Request): Promise<NextResponse | null> {
  return (await isAdminRequest(req)) ? null : unauthorized();
}

/** Parse a JSON body without throwing on an empty or malformed one. */
export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function editionNumber(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}
