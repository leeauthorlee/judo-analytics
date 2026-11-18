# 유도 영상 기술 추천 모델

상위 폴더의 `PRD-judo-analysis-mvp.md`에 따른 독립 Python 모델 프로젝트입니다.
이 폴더는 데이터 수집·검수,
학습·평가·영상 구간 추론·사용자 확인 기록을 제공합니다. 웹 앱에서는 `worker/analysis-provider.js`가
`predict.py --stdout`을 호출합니다. 연결 경로와 배포 조건은 `../docs/architecture/model-integration.md`를 참고하세요.

실제 학습 결과와 검증 범위는 [MODEL_CARD.md](MODEL_CARD.md), 데이터 구성은
[data/DATA_CARD.md](data/DATA_CARD.md)를 확인하세요. 첫 모델은 101개 실험 평가에서
1순위 정확도 67.33%, 상위 3개 포함률 92.08%이며 독립 경기 성능을 의미하지 않습니다.

## 지원 범위

- `ippon_seoi_nage`: 한팔업어치기
- `o_goshi`: 허리껴치기
- `osoto_gari`: 밭다리후리기
- `uchi_mata`: 허벅다리걸기
- 사용자가 지정한 30초 이내 단일 공격 구간에서 상위 3개 기술 후보 반환
- 사용자 착지 선택을 서비스 기준 득점으로 변환

기술 예측은 실험용이며 반드시 사람이 확인해야 합니다. 지원 외 동작에도 높은 점수가
나올 수 있습니다. 자동 착지 판정, 공격자 식별, 관절 추적, 공식 판정 기능은 없습니다.

## 구성

```text
analysis-model/
  data/
    source/           원본 저장소 메타데이터와 라이선스 표기
    raw/              내려받은 MP4 (Git 제외)
    downloads.json    원본 경로·SHA256·파일 크기
    manifest.json     재생 검증·중복 제외 후 실험 분할
    audit.json        제외 사례·데이터 제약
    preview_*.jpg     라벨별 표본 프레임
    cache/            영상 특징 벡터 (Git 제외)
    evaluation.json   실제 평가 결과
    test_predictions.json
  models/             사전 학습 및 학습 완료 가중치 (Git 제외)
  runs/               추론·사용자 검수 결과 (Git 제외)
  tests/
```

## 설치와 재현

Python 3.13, CPU 실행을 기준으로 작성했습니다. 프로젝트 루트에서 실행합니다.
다운로드 명령은 네트워크 접근이 필요합니다. CPU 패키지는 프로젝트 가상환경에 설치합니다.
실제 설치 버전은 `requirements-lock.txt`에 기록합니다. 동일 환경 재현 시 설치 명령의
`requirements.txt`를 `requirements-lock.txt`로 바꿔 사용할 수 있습니다.

```powershell
python -m venv analysis-model/.venv
python -m pip --python analysis-model/.venv/Scripts/python.exe install -r analysis-model/requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
python analysis-model/inspect_source.py
python analysis-model/download_data.py
analysis-model/.venv/Scripts/python.exe analysis-model/download_weights.py
analysis-model/.venv/Scripts/python.exe analysis-model/prepare_data.py
analysis-model/.venv/Scripts/python.exe analysis-model/train.py
analysis-model/.venv/Scripts/python.exe -m unittest discover -s analysis-model/tests -v
analysis-model/.venv/Scripts/python.exe analysis-model/smoke_check.py
```

`inspect_source.py`는 당시 저장소 리비전을 기록하고 `download_data.py`는 그 리비전을
사용합니다. 기존 결과를 정확히 재현하려면 저장된 `data/source/repository.json`을 유지하고
inspect 단계를 다시 실행하지 마세요. 다운로드는 이미 존재하는 파일을 재사용합니다.

## 추론

```powershell
analysis-model/.venv/Scripts/python.exe analysis-model/predict.py "C:/videos/attack.mp4" --start 2 --end 8 --output analysis-model/runs/prediction.json
```

최초 학습 완료 후에는 추론 시 네트워크가 필요하지 않습니다. 모델 묶음에 인코더와
분류기, 정규화 값이 함께 저장됩니다. `--start`, `--end`는 원본 영상의 초 단위 시각입니다.
전체 영상이 30초 이하면 생략할 수 있습니다. 결과의 `model_score`는 보정되지 않은
모델 점수이며 정답 확률이나 정확도가 아닙니다.

## 사용자 확인 기록

```powershell
analysis-model/.venv/Scripts/python.exe analysis-model/review.py analysis-model/runs/prediction.json --technique ippon_seoi_nage --landing partial --output analysis-model/runs/review.json
```

기술은 지원 4종 또는 `unsupported`, `unknown`을 선택합니다.

| 착지 입력 | 서비스 득점 |
|---|---|
| full | ippon (한판) |
| partial | waza_ari (절반) |
| none | no_score (무득점) |
| unknown | undetermined (판단 불가) |
| unreviewed | unreviewed (미확인) |

사용자 확인값과 원래 모델 예측은 별도 필드로 저장합니다. 수정할 때도 원본 prediction
파일을 입력으로 사용하고 review 파일을 갱신합니다. 미확인·판단 불가를 무득점으로 처리하지 않습니다.

## 모델과 평가 방법

Kinetics-400으로 사전 학습한 Torchvision R3D-18 인코더를 고정하고 512차원 특징을
추출합니다. 공격 구간에서 시간 순서대로 16프레임을 균등 샘플링합니다. 표준화는 학습
분할에서만 계산하고, 4개 정규화 강도의 선형 로지스틱 분류기를 검증 macro-F1로 선택합니다.
평가 분할은 모델 선택에 쓰지 않습니다. 결과는 top-1·top-3·macro-F1·클래스별 지표와
혼동 행렬, 최빈 클래스 기준 성능을 포함합니다.

원본 분할에는 중복 파일이 있습니다. 파일 해시·정규화 파일명·디코딩 프레임 해시로
중복을 제외한 후 seed 42, 클래스별 약 70/15/15로 다시 분할합니다. 원 경기·선수 ID가
없어 같은 경기의 다른 장면이나 유사 리플레이가 분할을 넘나들 수 있습니다.
따라서 지표는 **클립 수준 실험 결과이며 독립 경기 일반화 성능이 아닙니다.**
독립 경기 평가와 전문가 라벨 검수가 끝나기 전에는 배포 정확도를 주장하지 않습니다.

## 출처와 이용 조건

- 데이터: https://huggingface.co/datasets/adenhaus/judo_throws
- 제공자 표기 라이선스: MIT (`data/source/readme.md`)
- 원본 영상 출처와 권리 관계: 제공자 설명에 상세 정보 없음
- 모델: https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.video.r3d_18.html

이번 수집은 공개 저장소 파일의 로컬 실험용 확보입니다. 데이터 제공자의 MIT 표기를
원본 중계·시범 영상의 권리 확인으로 간주하지 않습니다. 원본과 학습 가중치는 Git에서
제외하며, 서비스 배포·영상 재배포 전 출처와 사용 범위를 별도로 확인해야 합니다.
