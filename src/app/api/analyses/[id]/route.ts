import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "서비스 설정이 필요합니다." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "잘못된 분석 ID입니다." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { data, error } = await supabase
    .from("video_analyses")
    .select("id,status,error_code,result_json,created_at,completed_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "분석 작업을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ analysis: data });
}
