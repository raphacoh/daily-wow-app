import type { MetadataRoute } from "next";
import { APP } from "@/lib/config";
import { listEditions } from "@/lib/editions";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = ["", "/manifesto", "/faq", "/open", "/open-books", "/library", "/join"].map((p) => ({ url: `${APP.url}${p}`, changeFrequency: "daily" as const }));
  const editions = (await listEditions({ limit: 500 }).catch(() => [])).map((e) => ({ url: `${APP.url}/l/${e.n}`, lastModified: e.released_at ?? undefined }));
  return [...pages, ...editions];
}
