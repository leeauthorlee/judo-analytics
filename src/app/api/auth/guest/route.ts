import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/access";

export const runtime = "nodejs";

/**
 * Issues a short-lived, server-managed session for visitors who only want to
 * analyse a video. The account is marked in user_metadata so diary/ranking
 * APIs can refuse it. Cookie flags are handled by @supabase/ssr.
 */
export async function POST() {
  const viewer = await getViewer();
  if (viewer) {
    return NextResponse.json({ guest: viewer.isGuest, userId: viewer.userId });
  }
  if (!isSupabaseConfigured() || !isAdminConfigured()) {
    return NextResponse.json({ error: "비회원 분석 설정이 필요합니다." }, { status: 503 });
  }

  const email = `guest-${crypto.randomUUID()}@judo.local`;
  // Supabase caps password length at 72 bytes; a UUID plus suffix is enough entropy.
  const password = `${crypto.randomUUID()}Aa1!`;
  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { is_guest: true, guest_session: true },
  });
  if (createError || !created.user) {
    console.error("GUEST_SESSION_CREATE_FAILED", createError?.message);
    return NextResponse.json({ error: "임시 세션을 만들지 못했습니다." }, { status: 503 });
  }

  try {
    const { url, key } = getSupabaseConfig();
    const cookieStore = await cookies();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        },
      },
    });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return NextResponse.json({ guest: true, userId: created.user.id }, { status: 201 });
  } catch (cause) {
    console.error("GUEST_SESSION_LOGIN_FAILED", cause);
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "임시 세션에 로그인하지 못했습니다." }, { status: 503 });
  }
}
