# 분석 모델 연결 — 현재 구현과 적용 방법

## 확인한 기존 상태

기능명세서·요구사항 명세서는 초기 설계로, 실제 코드보다 오래된 상태였다.
코드에는 Supabase Google/Kakao 로그인, 회원 Workspace/RLS, Blob 업로드,
영상 삭제, Cloud Tasks/Cloud Run 워커, 하이라이트·일기 API가 이미 있었다.
별도 자연어 채팅창/LLM 대화 API는 없으며, 영상 분석 웹 화면이 사용자 접점이다.

미연결 원인은 `worker/analysis-provider.js`의 상시 false/예외 반환이었다.
또한 요청 API가 추론 전부터 모델 미연결 임시 결과와 일기를 저장하고,
워커도 실제 모델 대신 임시 결과를 저장하는 경로를 가지고 있었다.

## 이번 연결의 범위

최신 [축소 PRD](../../PRD-judo-analysis-mvp.md)를 적용한다.
관절 추출, 자동 공격 탐지, 공격자 식별, 자동 착지·득점은 포함하지 않는다.
실험 모델을 전문가 검증된 운영 모델로 승격하지 않고 `candidate` 상태로 등록한다.

```text
로그인 → MP4 업로드 → 사용자가 30초 이내 단일 공격 구간 지정
  → POST /api/analyses (input_json 저장, Cloud Tasks 등록)
  → 비공개 Cloud Run /tasks
  → Blob 다운로드 / FFprobe 검사 / Python R3D-18 추론
  → 모델 응답 검증 (기술 4종 중 상위 3개, 구간·버전 확인)
  → complete_judo_analysis RPC
  → 이벤트·미확인 득점·실제 하이라이트·일기·완료 상태를 하나의 트랜잭션으로 저장
  → 화면 폴링 → 후보 및 구간 재생 → 사용자가 기술·착지 확인
  → PATCH /api/analyses/:id → analysis_reviews 저장 / 일기에 사용자 확인 결과 반영
```

모델 결과 JSON은 사용자 검토로 덮어쓰지 않는다. AI 득점은 항상 미확인이다.
사용자 선택은 전체→한판, 일부→절반, 접촉 없음→무득점, 확인 불가→판단 불가로
DB에서 변환한다. 이 점수는 공식 IJF 판정이 아닌 서비스 기준 기록이다.

## 명세 대비 구현 상태

| 영역 | 현재 코드 | 남은 조건 또는 범위 |
|---|---|---|
| Google/Kakao 로그인·회원 데이터 격리 | 기존 구현 | 공급자 설정과 실환경 검증 |
| Naver·게스트 세션 | 미구현 | 이번 연결 범위 밖 |
| 영상 업로드·구간 선택 | 구현 | Blob 설정 필요, 원본 10분/500MB, 분석 구간 30초 |
| 분석 작업·상태 | 실제 워커 호출 경로 구현 | Cloud Tasks/Cloud Run 설정 필요 |
| 기술 추천 | 학습된 4종 모델 연결 | 실험 정확도와 한계는 모델 카드 참고 |
| 자동 관절·득점·역할 판별 | 제외 | 정답 데이터 미확보 |
| 사용자 기술·착지 확인 | 폼/API/RLS/계산 컬럼 구현 | DB 마이그레이션 필요 |
| 하이라이트·일기 | 실제 추론 완료 후 원자적 자동 저장 | 미연결 임시 결과 자동 저장 제거 |
| 모델 버전 | 결과 JSON 및 model_versions FK 기록 | 공개 배포 전 독립 평가 필요 |
| 자연어 챗봇 | 별도 구현 없음 | 기존 영상 분석 화면에 연결 |

## 적용 순서

1. Supabase에 기존 초기 스키마와 `supabase/migrations/202611180002_model_integration.sql`을 순서대로 적용한다.
2. `analysis-model/models/judo_r3d18.pt`가 준비된 프로젝트 루트를 Docker 빌드 컨텍스트로 사용한다.
3. `docker build -f worker/Dockerfile -t judo-analysis-worker .`로 모델·Python·FFmpeg가 포함된 워커 이미지를 만든다.
4. 이미지를 인증이 필요한 Cloud Run에 배포한다. 초기 설정은 CPU 2개 이상, 메모리 2GiB 이상,
   동시 요청 1개, 요청 제한 시간 600초로 시작하여 실제 부하로 조정한다.
5. 워커에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BLOB_READ_WRITE_TOKEN`을 비밀 환경변수로 설정한다.
6. Next.js에 `.env.example`의 Supabase·Blob·Cloud Tasks 설정을 적용한다.
7. Cloud Tasks OIDC 서비스 계정에 워커 호출 권한을 부여하고, 인증 없는 워커 공개 접근은 비활성화한다.
8. 마이그레이션과 워커 배포가 끝난 후 웹 앱을 배포한다.

워커 Dockerfile은 이제 `worker/`만으로 빌드하지 않는다. 로컬 가중치는 Git에서 제외되므로
CI/원격 빌드에서는 승인된 모델 아티팩트를 같은 경로에 먼저 배치해야 한다.
`.dockerignore`는 원본 학습 영상·가상환경·비밀 파일을 빌드 컨텍스트에서 제외한다.

## 로컬 검증

```powershell
npm run typecheck
npm run lint
npm run build
npm --prefix worker ci
npm --prefix worker test
$env:RUN_MODEL_TEST='1'
npm --prefix worker test
```

실모델 테스트는 `analysis-model/.venv`와 학습 가중치·표본 영상을 사용한다.
다른 Python 경로가 필요하면 워커의 `JUDO_PYTHON_PATH`에 실행 파일 경로를 지정한다.
DB 테스트는 PGlite의 로컬 PostgreSQL로 두 마이그레이션을 적용하고 완료 트랜잭션,
중복 호출, 사용자 리뷰, RLS 소유권, 실패 롤백을 검증한다. 실제 Supabase 설정 검증을 대체하지 않는다.

## 이번 환경에서 확인하지 못한 항목

타입 검사, ESLint, 프로덕션 빌드, 실모델 호출을 포함한 워커 테스트 5개가 통과했다.
빌드는 로컬 네이티브 SWC 로딩 경고 후 WASM으로 완료됐다.
브라우저 화면 점검은 로컬 서버 접속 실패로 완료하지 못했다.

로컬 `.env.local`에는 Supabase 공개 설정만 있고 Blob 토큰, Cloud Tasks 설정,
워커용 서비스 역할 키가 없다. 실제 클라우드 업로드→작업 큐→DB 전체 경로는
이 설정 및 마이그레이션 적용 후 검증해야 한다. 운영 DB나 클라우드 배포를 임의로 변경하지 않았다.

## 실패 처리

- 큐 미설정: 작업 생성 전 503, 임시 분석/일기 생성 없음.
- 전송 실패: 작업을 DISPATCH_FAILED로 기록, 사용자에게 실패 응답.
- 모델 미설치: MODEL_NOT_CONFIGURED, 결과 생성 없음.
- 구간 오류: INVALID_ANALYSIS_INTERVAL, 자동으로 영상을 임의 분할하지 않음.
- 추론/저장 실패: WORKER_FAILED, Cloud Tasks 재시도 대상.
- 완료 저장: 단일 트랜잭션 및 완료 상태 검사로 중복 이벤트·일기 방지.
- 처리 중 중복 작업: 503 재시도. 15분 만료 작업만 재획득하고 시도 번호로 오래된 완료 요청 차단.

Cloud Tasks 재시도 횟수와 사용자 사용량 제한은 운영 환경에서 별도로 설정해야 한다.
