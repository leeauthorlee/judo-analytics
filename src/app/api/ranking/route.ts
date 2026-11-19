import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isGuestUser } from "@/lib/access";
import { isPendingDiary } from "@/lib/diary";
import { aiPointsFromResult, maskDisplayName, POINTS_PER_DIARY } from "@/lib/scoring/policy";

export const runtime = "nodejs";

export async function GET() {
  if (!isSupabaseConfigured() || !isAdminConfigured()) {
    return NextResponse.json({ error: "랭킹 설정이 필요합니다." }, { status: 503 });
  }
  const viewer = await createClient();
  const { data: { user } } = await viewer.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (isGuestUser(user)) return NextResponse.json({ error: "랭킹을 보려면 로그인이 필요합니다." }, { status: 403 });

  const admin = createAdminClient();
  const [{ data: diaryRows, error: diaryError }, { data: workspaceRows, error: workspaceError }, { data: profileRows }] =
    await Promise.all([
      admin.from("diary_entries").select("workspace_id,note,source_analysis_id"),
      admin.from("workspaces").select("id,user_id"),
      admin.from("profiles").select("id,display_name"),
    ]);
  if (diaryError || workspaceError) {
    console.error("RANKING_QUERY_FAILED", diaryError?.message, workspaceError?.message);
    return NextResponse.json({ error: "랭킹을 불러오지 못했습니다." }, { status: 500 });
  }

  const names = new Map((profileRows ?? []).map((p) => [p.id, p.display_name]));
  const owners = new Map((workspaceRows ?? []).map((w) => [w.id, w.user_id]));

  const registered = (diaryRows ?? []).filter((diary) => !isPendingDiary(diary.note));
  const sourceIds = registered.map((diary) => diary.source_analysis_id).filter((id): id is string => Boolean(id));
  const aiPoints = new Map<string, number>();
  if (sourceIds.length) {
    const { data: analyses } = await admin.from("video_analyses").select("id,result_json").in("id", sourceIds);
    for (const analysis of analyses ?? []) aiPoints.set(analysis.id, aiPointsFromResult(analysis.result_json));
  }
  const totals = new Map<string, { points: number; diaryCount: number }>();
  for (const diary of registered) {
    const entry = totals.get(diary.workspace_id) ?? { points: 0, diaryCount: 0 };
    entry.points += diary.source_analysis_id ? aiPoints.get(diary.source_analysis_id) ?? 0 : POINTS_PER_DIARY;
    entry.diaryCount += 1;
    totals.set(diary.workspace_id, entry);
  }

  const aggregated = [...totals.entries()].map(([workspaceId, total]) => {
    const userId = owners.get(workspaceId) ?? "";
    return { userId, workspaceId, ...total };
  });
  aggregated.sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));

  const selfWorkspace = (workspaceRows ?? []).find((w) => w.user_id === user.id)?.id;
  const selfIndex = aggregated.findIndex((row) => row.workspaceId === selfWorkspace);
  const rankOf = (index: number) =>
    index < 0 ? 0 : 1 + aggregated.filter((row) => row.points > aggregated[index].points).length;

  const rows = aggregated.map((row, index) => ({
    rank: rankOf(index),
    label: maskDisplayName(names.get(row.userId)),
    points: row.points,
    diaryCount: row.diaryCount,
    isSelf: row.workspaceId === selfWorkspace,
  }));
  const self = selfIndex < 0
    ? { rank: 0, points: 0, diaryCount: 0 }
    : { rank: rankOf(selfIndex), points: aggregated[selfIndex].points, diaryCount: aggregated[selfIndex].diaryCount };

  return NextResponse.json({ rows, self });
}
