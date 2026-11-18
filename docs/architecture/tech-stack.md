# Judo Analytics 기술 스택 및 동작

> 기술 스택 다이어그램: [`tech-stack.drawio`](./tech-stack.drawio) · Mermaid 파이프라인 상세: [`judo-video-analysis-pipeline.mmd`](./judo-video-analysis-pipeline.mmd)
>
> 확정된 선택과 검토 중인 후보를 구분합니다. 이 문서는 구현 가이드이며, TBD 표시는 아직 채택된 기술이 아닙니다.

## 단계별 스택

| 단계 | 스택 | 상태 | 역할 |
|---|---|---|---|
| 웹 UI | Next.js App Router, React, TypeScript | 현재 앱 골격 사용 중 | 회원/비회원 영상 업로드, 분석 상태, 타임라인, 하이라이트/일기 화면 |
| 배포/웹 API | Vercel, Next.js Route Handlers | Vercel 배포 목표 | 로그인 callback, 업로드 토큰, 분석 생성/상태 조회 등 제어 API |
| 인증 | Google, Kakao, Naver OAuth | 요구사항 확정, 구현 미시작 | 회원 로그인. 인증 라이브러리/공급자별 연결 방식은 TBD |
| 원본 영상 저장 | Vercel Blob private | 코드 연동 골격 있음 | MP4 및 썸네일 비공개 저장. 브라우저에서 직접 업로드 |
| 애플리케이션 DB | Supabase PostgreSQL | 사용처로 선택, 미연동 | 회원/비회원 Workspace, 영상 메타데이터, 작업 상태, 판정 이벤트, 하이라이트/일기, 데이터셋 기록 |
| 작업 큐 | TBD | 미선택 | Vercel 함수와 장시간 영상 분석을 분리하고 재시도/중복 방지 |
| 영상 검증/전처리 | FFprobe + FFmpeg | 후보 | 컨테이너/코덱/FPS/회전/길이 확인, 시간축 유지 프레임·클립 생성 |
| 사람/관절 추출 | Python + OpenCV 및 pose estimator 후보 | 미선택 | 프레임별 선수 검출/익명 트랙 연결, 관절 좌표·신뢰도 시계열 생성 |
| 동작/기술 모델 | Temporal video/action model | 미선택 | 동작 구간 검출, 기술 종류 분류. 사전학습 모델을 권리 확보 데이터로 미세조정하는 방향 검토 |
| 학습 프레임워크 | TBD (PyTorch 후보) | 미선택 | 학습 코드, 체크포인트, 재현 가능한 학습 실행 관리 |
| 판정 처리 | 버전 관리되는 규정 + 서버측 로직 | 설계 단계 | 모델의 시각적 근거와 규정 버전을 결합해 기술별 점수 후보/불확실 반환. 최종 경기 승패는 MVP 범위 밖 |
| 학습/추론 워커 | Vercel Daemon 검토, GPU 지원 확인 필요 | 미확정 | FFmpeg 및 모델 추론/학습. Vercel Daemon의 리소스가 부족하면 외부 GPU 컨테이너로 분리 |
| 후보 영상 검색 | YouTube Data API | 메타데이터만 계획 | 제목/채널/게시일/ID로 후보 탐색. 영상 파일/프레임 취득 또는 무허가 학습은 하지 않음 |
| 평가/관측 | 프로젝트 로컬 평가 harness, 운영 모니터링 TBD | 미구현 | 경기 단위 held-out set에서 기술별 성능, 점수 오탐, 구간 오차, 불확실 비율과 비용/지연 측정 |

## 런타임 동작

1. 사용자가 MP4를 고르면 브라우저에서 확장자/크기 1차 확인 후, 인증된 업로드 토큰을 받아 Vercel Blob private에 직접 업로드합니다. 목표 제한은 **500 MB / 10분**입니다.
2. Next.js API는 업로드 metadata와 Workspace 소유권을 DB에 기록하고 작업 ID를 만든 뒤 큐에 전달합니다. 큐/DB는 아직 구현 전입니다.
3. 분석 워커가 권한을 확인하고 FFprobe로 실제 파일 정보를 검사합니다. FFmpeg가 회전/FPS/시간축 정보를 보존해 필요한 프레임과 이벤트 주변 clip을 생성합니다.
4. Pose 단계에서 선수별 익명 track과 frame timestamp, joint coordinates, confidence를 추출합니다. 대용량 시계열은 DB row가 아니라 JSONL/Parquet 같은 객체 artifact로 저장하고 DB에는 URI·schema version·checksum을 둡니다.
5. Temporal model이 시간 순서가 있는 pose/video clip을 읽어 기술 이벤트 구간과 기술 후보를 출력합니다. 한 프레임 또는 해설 문구만으로 판정하지 않습니다.
6. 규정 적용 단계가 대상 규정 버전에 맞게 관찰 근거를 정리하고, 근거가 모자라거나 결과가 모순되면 `uncertain/review_required`로 반환합니다. 판정은 기술별 점수 후보이며 공식 판정이 아닙니다.
7. 결과·model version·ruleset version을 DB에 기록하고, UI는 상태를 조회해 타임라인/근거/하이라이트로 보여줍니다.

## 오프라인 학습 동작

`권리 확인된 영상 → 전문가 이벤트 구간/기술/점수 라벨 → 관절 추출 artifact → 경기/원본 단위 train/validation/test split → 사전학습 모델 fine-tuning → held-out 평가 → 운영자 승인 → versioned model artifact` 순서입니다.

YouTube Data API 결과는 후보 metadata로만 이용합니다. 공개 YouTube 링크는 영상 다운로드, 프레임 추출, 학습 사용 권리를 부여하지 않습니다. 제목·해설은 전문가가 검수하기 전까지 weak-label 후보로만 취급하며 정답/시험 라벨로 사용하지 않습니다.

## 아직 결정할 기술 선택

- Supabase Auth와 자체 OAuth callback 중 어느 쪽이 Google/Kakao/Naver를 모두 지원할지
- 분석 작업 큐와 영속 job 상태 저장 방식
- Vercel Daemon이 필요한 FFmpeg/GPU workload를 감당할 수 있는지, 아니면 외부 GPU worker가 필요한지
- pose estimator와 temporal action model, 학습 프레임워크 및 model registry
- 운영자 검수 도구, 지표 기준, 분석 SLA 및 GPU/저장소 비용 한도
