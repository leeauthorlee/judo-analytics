"use server";

import type { Provider } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const providers = new Set<Provider>(["google", "kakao"]);

function getSiteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function signInWithProvider(formData: FormData) {
  const provider = formData.get("provider");
  if (typeof provider !== "string" || !providers.has(provider as Provider)) {
    redirect("/login?error=provider");
  }
  if (!isSupabaseConfigured()) redirect("/login?error=configuration");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as Provider,
    options: { redirectTo: `${getSiteUrl()}/auth/callback` },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
