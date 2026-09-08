import type { MetadataRoute } from "next";
import { APP } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/manifesto", "/faq", "/open", "/open-books", "/library", "/join", "/privacy", "/terms"], disallow: ["/api/", "/home", "/admin", "/billing", "/auth/"] }],
    sitemap: `${APP.url}/sitemap.xml`,
  };
}
