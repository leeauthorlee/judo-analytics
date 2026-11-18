import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, getSupabaseConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.next({ request });

  const { url, key } = getSupabaseConfig();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        for (const name of ["cache-control", "expires", "pragma"]) {
          const value = headers[name];
          if (value) response.headers.set(name, value);
        }
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
