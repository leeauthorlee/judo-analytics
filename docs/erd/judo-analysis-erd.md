# 유도 영상 분석 에이전트 ERD 설계

> 상태: **논리 설계 초안**. 현재 애플리케이션에는 DB와 학습 파이프라인이 연결되어 있지 않습니다. 실제 구현 전에 규정 범위, 데이터 보관 기간, 권리 정책을 확정하고 이 문서와 ERD를 함께 갱신하세요.

- 다이어그램 원본: [`judo-analysis-erd.mmd`](./judo-analysis-erd.mmd)
- 데이터베이스 가정: Supabase PostgreSQL (애플리케이션 연동은 미구현)
- 미디어 저장 가정: 비공개 객체 스토리지에 MP4 및 큰 파생 데이터 저장, DB에는 객체 키와 메타데이터 저장

## 1. 설계 원칙

1. 회원과 비회원 데이터 모두 `WORKSPACE`를 소유 경계로 사용합니다. 영상, 분석, 일기는 워크스페이스를 통해 소유자를 확인합니다.
2. AI 분석, 공식 경기 결과, 전문가 검토 결과를 덮어쓰지 않고 `EVENT_ASSESSMENT`에 출처별로 보존합니다.
3. 모든 분석·라벨은 적용 규정과 모델/데이터셋 버전을 추적할 수 있어야 합니다.
4. 학습 샘플은 권리가 확인된 영상만 사용합니다. 제목·해설에서 자동 추출한 라벨은 전문가 확인 전까지 정답 라벨로 취급하지 않습니다.
5. 선수의 실명을 식별하지 않습니다. 자세 데이터에는 영상 내 익명 트랙 키와 경기 역할만 저장합니다.

## 2. 객체 목록

### 계정 및 소유권

| 객체 | 주요 필드 | 목적 |
|---|---|---|
| `APP_USER` | `user_id`, `email`, `display_name`, `created_at` | 회원 계정 |
| `OAUTH_IDENTITY` | `identity_id`, `user_id`, `provider`, `provider_subject`, `linked_at` | Google/Kakao/Naver 로그인 연결 |
| `GUEST_SESSION` | `guest_session_id`, `session_token_hash`, `created_at`, `last_seen_at`, `expires_at` | 비회원 세션. 원본 토큰 대신 해시 저장 |
| `WORKSPACE` | `workspace_id`, `user_id`, `guest_session_id`, `created_at` | 회원 또는 비회원의 데이터 소유 단위 |

`WORKSPACE`에는 `user_id` 또는 `guest_session_id` 중 **정확히 하나만** 설정되도록 DB CHECK 제약을 둡니다. 비회원 세션이 한 워크스페이스를 소유하도록 `guest_session_id`에 UNIQUE 제약을 둡니다. 회원이 여러 워크스페이스를 가질 수 있는지는 제품 정책에 따라 결정합니다.

OAuth identity의 고유 조건은 `UNIQUE(provider, provider_subject)`입니다. 로그인 공급자의 access/refresh token을 보관해야 하는 별도 요구가 생기면 암호화·회전·삭제 정책을 추가 검토하세요.

### 영상 분석 및 경기 도메인

| 객체 | 주요 필드 | 목적 |
|---|---|---|
| `VIDEO_ASSET` | `video_id`, `workspace_id`, `storage_key`, `source_type`, `size_bytes`, `duration_ms`, `width`, `height`, `status`, `created_at`, `deleted_at` | 원본 영상의 소유권과 저장 메타데이터 |
| `VIDEO_RIGHTS` | `rights_id`, `video_id`, `rights_holder`, `license_reference`, `territory`, `allowed_training`, `allowed_cloud_processing`, `clearance_status`, `valid_until`, `checked_by_user_id` | 영상의 사용 허가 및 확인 이력 |
| `RULESET` | `ruleset_id`, `name`, `version`, `source_url`, `effective_from`, `effective_to` | 대회·연령·기간별 적용 규정 |
| `TECHNIQUE` | `technique_id`, `kodokan_code`, `name_ko`, `name_en`, `category`, `is_active` | 기술 사전 |
| `MODEL_VERSION` | `model_version_id`, `training_run_id`, `purpose`, `model_name`, `version`, `artifact_uri`, `status`, `created_at` | 추론/자세 모델과 배포 아티팩트의 버전 |
| `VIDEO_ANALYSIS` | `analysis_id`, `video_id`, `model_version_id`, `ruleset_id`, `status`, `started_at`, `completed_at` | 한 영상에 대한 특정 버전의 분석 실행 |
| `ANALYSIS_EVENT` | `event_id`, `analysis_id`, `technique_id`, `tori_track_id`, `uke_track_id`, `start_ms`, `end_ms`, `detection_confidence` | 기술 후보 구간 및 선수 트랙 |
| `EVENT_ASSESSMENT` | `assessment_id`, `event_id`, `ruleset_id`, `reviewer_user_id`, `assessment_source`, `score_label`, `confidence`, `evidence_json`, `review_status`, `created_at` | AI 추정·공식 기록·전문가 검토 등 출처별 판정 |

`score_label`은 규정에 맞춰 `ippon`, `waza_ari`, `yuko`, `no_score`, `uncertain` 등의 열거형으로 관리합니다. 모든 규정에서 같은 값이 유효하다고 가정하지 않습니다. `confidence`는 검증 전까지 모델 자체의 추정치로만 취급하며, 보정된 확률이라고 표시하지 않습니다.

### 자세 및 해설 파생 데이터

| 객체 | 주요 필드 | 목적 |
|---|---|---|
| `POSE_EXTRACTION` | `pose_extraction_id`, `video_id`, `model_version_id`, `status`, `keypoint_schema_version`, `extraction_fps`, `created_at` | 영상에서 관절/자세를 추출한 실행 기록 |
| `POSE_TRACK` | `pose_track_id`, `pose_extraction_id`, `anonymous_track_key`, `role_or_color`, `tracking_confidence` | 한 영상에서 추적한 익명 인물의 자세 트랙 |
| `POSE_ARTIFACT` | `pose_artifact_id`, `pose_track_id`, `storage_key`, `format`, `checksum`, `start_ms`, `end_ms` | 프레임별 관절 좌표·시간열이 저장된 파일 참조 |
| `TRANSCRIPT_SEGMENT` | `transcript_segment_id`, `video_id`, `start_ms`, `end_ms`, `speaker_role`, `text`, `language`, `extraction_source` | 해설/음성 인식 구간. 약한 라벨 근거로 사용 가능 |

프레임별 모든 관절을 DB 행으로 저장하는 대신, JSONL/Parquet 등 큰 시계열 artifact를 객체 스토리지에 두고 DB에는 경로, 스키마 버전, 시간 범위, 체크섬을 보관합니다. 해설은 `ANALYSIS_EVENT`의 시각적 근거를 대체하지 않습니다.

### 학습 데이터 및 모델 이력

| 객체 | 주요 필드 | 목적 |
|---|---|---|
| `TRAINING_DATASET` | `dataset_id`, `ruleset_id`, `name`, `version`, `status`, `created_at` | 고정·버전 관리되는 학습 데이터셋 |
| `DATASET_SAMPLE` | `sample_id`, `dataset_id`, `video_id`, `rights_id`, `pose_artifact_id`, `start_ms`, `end_ms`, `split`, `review_status` | 데이터셋에 포함된 영상 구간 및 학습/검증/시험 분할 |
| `TRAINING_LABEL` | `label_id`, `sample_id`, `technique_id`, `ruleset_id`, `transcript_segment_id`, `reviewer_user_id`, `event_start_ms`, `event_end_ms`, `target_type`, `score_label`, `label_source`, `review_status` | 기술/판정 정답과 출처·전문가 검토 상태 |
| `TRAINING_RUN` | `training_run_id`, `dataset_id`, `base_model_version_id`, `code_revision`, `parameters_json`, `metrics_json`, `status`, `started_at`, `completed_at` | 재현 가능한 모델 학습 실행 |

`label_source`는 예를 들어 `expert`, `official_record`, `commentary_candidate`, `title_candidate`로 관리합니다. 제목·해설에서 가져온 후보는 `review_status=pending`으로 두고 전문가 확인 전에는 검증 정답/최종 시험 라벨로 사용하지 않습니다. 데이터셋은 경기/원본 영상 단위로 분할해 동일 경기의 인접 프레임이 여러 split에 섞이지 않게 합니다.

`DATASET_SAMPLE`을 학습에 포함할 때는 연결된 권리 기록이 승인 상태이고, `allowed_training=true`, 사용 기간이 유효한지 서버에서 검사해야 합니다. 이는 앱 로직뿐 아니라 학습 데이터 생성 파이프라인에서도 강제해야 합니다.

### 하이라이트 일기

| 객체 | 주요 필드 | 목적 |
|---|---|---|
| `HIGHLIGHT` | `highlight_id`, `video_id`, `event_id`, `start_ms`, `end_ms`, `title`, `note`, `thumbnail_key`, `created_at` | 분석 이벤트 또는 사용자가 지정한 영상 구간 |
| `DIARY_ENTRY` | `diary_entry_id`, `workspace_id`, `entry_date`, `title`, `note`, `created_at` | 날짜별 기록 |
| `DIARY_ENTRY_HIGHLIGHT` | `highlight_id`, `diary_entry_id`, `sort_order` | 하이라이트를 최대 하나의 일기에 연결하고 표시 순서를 저장 |

요구사항 결정에 따라 하이라이트는 하나의 일기에만 연결합니다. `DIARY_ENTRY_HIGHLIGHT.highlight_id`를 기본 키/외래 키로 두어 일기 중복 연결을 방지합니다. 일기 없이 보관하는 하이라이트는 join row가 없으면 됩니다.

## 3. 관계 및 카디널리티

- `APP_USER` 1:N `OAUTH_IDENTITY`, `WORKSPACE`
- `GUEST_SESSION` 1:1 `WORKSPACE` (정책상 한 게스트 세션당 하나)
- `WORKSPACE` 1:N `VIDEO_ASSET`, `DIARY_ENTRY`
- `VIDEO_ASSET` 1:N `VIDEO_RIGHTS`, `VIDEO_ANALYSIS`, `POSE_EXTRACTION`, `TRANSCRIPT_SEGMENT`, `HIGHLIGHT`, `DATASET_SAMPLE`
- `VIDEO_ANALYSIS` 1:N `ANALYSIS_EVENT`; `ANALYSIS_EVENT` 1:N `EVENT_ASSESSMENT`
- `TECHNIQUE` 1:N `ANALYSIS_EVENT`, `TRAINING_LABEL`; 이벤트/라벨의 기술은 아직 모를 수 있어 nullable
- `POSE_EXTRACTION` 1:N `POSE_TRACK`; `POSE_TRACK` 1:N `POSE_ARTIFACT`
- `TRAINING_DATASET` 1:N `DATASET_SAMPLE`, `TRAINING_RUN`; `DATASET_SAMPLE` 1:N `TRAINING_LABEL`
- `DIARY_ENTRY` 1:N `DIARY_ENTRY_HIGHLIGHT`; `HIGHLIGHT`는 0:1 `DIARY_ENTRY_HIGHLIGHT`에 연결되어 하나의 일기에만 포함
- `TRAINING_RUN`은 기반 모델 버전을 선택적으로 참조하고, 산출한 `MODEL_VERSION`은 학습 실행을 선택적으로 참조

다이어그램은 주요 FK 관계를 표현합니다. `(provider, provider_subject)` 고유 조건, 워크스페이스 소유자 XOR, 시간 범위 `end_ms > start_ms`, 권리 검증 및 라벨 상태 전이는 별도 제약/서비스 검증으로 구현해야 합니다.

## 4. 비밀·보관·접근 제어

- 비회원 세션 쿠키에는 임의의 토큰을 발급하되 DB에는 토큰 해시만 저장하고, 만료 및 데이터 삭제 정책을 둡니다.
- 모든 사용자 데이터 조회/수정/삭제는 `workspace_id` 소유권을 확인합니다. UUID를 아는 것만으로 다른 사용자의 데이터에 접근할 수 없어야 합니다.
- MP4, 썸네일, 관절 시계열은 비공개 스토리지에 두고, 만료되는 권한 있는 URL로만 접근하게 합니다.
- 회원 탈퇴/게스트 만료 시 원본 영상, 분석 산출물, 하이라이트, 학습 사용 여부에 따른 보존 기록을 정의하고 파생 데이터까지 삭제/비식별 처리합니다.

## 5. 관련 파일

- Draw.io에서 열린 ERD: `docs/erd/judo-analysis-erd.mmd`를 기반으로 생성
- 편집 가능한 Mermaid 원본: [`judo-analysis-erd.mmd`](./judo-analysis-erd.mmd)
