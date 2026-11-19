import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type Viewer = {
  userId: string;
  email: string | null;
  isGuest: boolean;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

/** Resolves the current actor. Guests are real, temporary Supabase users. */
export async function getViewer(): Promise<Viewer | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    isGuest: user.user_metadata?.is_guest === true,
    supabase,
  };
}

export function isGuestUser(user: { user_metadata?: Record<string, unknown> } | null | undefined) {
  return user?.user_metadata?.is_guest === true;
}
