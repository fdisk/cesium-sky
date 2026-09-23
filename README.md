# cesium-sky 🌤️

> CesiumJS 기반 3D 기상 데이터 시각화 프로젝트.
> 기상청 수치모델(NetCDF) 데이터를 GPU 파티클 애니메이션 + 3D 단면도로 렌더링하는 웹 뷰어.

---

## 📌 Overview (개요)

**cesium-sky**는 CesiumJS를 활용하여 기상청 수치모델(G576, r030)의 바람(U, V, W) 및 지위고도(GPH) 데이터를 3D 공간에 시각화하는 프로젝트입니다.

- **GPU 파티클 엔진**: 인라인 GLSL 셰이더 기반 바람 흐름 애니메이션 (직선 평류 근사)
- **3D 단면도**: Z(수평) / X(경도) / Y(위도) 평면 슬라이스 + CPU 생성 RGBA 텍스처
- **격자 시각화**: 지면 단면 격자 / 24레벨 직육면체 와이어프레임
- **다중 데이터셋**: 3km (Lambert conformal, 한반도 BBOX) / 8km (regular lat-lon, 동아시아 전체) 런타임 전환
- **고도 과장**: GPH × `heightScale` (10~70x)로 20km 상층 표현

---

## 📁 Directory Structure (디렉토리 구조)

```
cesium-sky/
├── README.md                   ← 이 문서
├── .gitignore                  ← Git 무시 규칙
│
├── front/                      ★ 메인 웹 뷰어 앱 (웹 서버 루트)
│   ├── view.html               ← 메인 진입점 (Cesium Viewer + UI 패널)
│   ├── serve.py                ← 로컬 테스트 서버 ({{ MAPBOX_TOKEN }} 치환)
│   ├── .mapbox_token           ← (gitignore) Mapbox API 토큰 — serve.py가 읽어 토큰 치환
│   ├── requirements.txt        ← Python 의존성 (netCDF4, numpy, xarray 등)
│   ├── VIEWER_REFERENCE.md     ← front 뷰어 상세 구조/설계 문서
│   │
│   ├── data-pipeline/          ← .nc → .bin 변환 스크립트
│   │   ├── nc2bin.py           ← 변환 스크립트 (3km/8km 범용, BBOX 크롭)
│   │   ├── ncHeaderViwer.py    ← NC 헤더/변수 구조 검사 (xarray)
│   │   ├── getNcTxtApi.py      ← 기상청 NC 파일 다운로드 API
│   │   └── getNcTxtApi-retry.py← 재시도 로직 포함 다운로드
│   │
│   └── temp_data/wind3d/       ← 데이터 + 엔진 모듈
│       ├── GpuParticleEngine.js    ← GPU 파티클 엔진 (인라인 셰이더)
│       ├── WindLegendBox.js        ← 3D 범위 박스 + 고도 레벨 라벨
│       ├── GridVisualizer.js       ← 격자 시각화 (지면/24레벨)
│       ├── WindDataLoader.js       ← .bin/.json 로더 + 3D 텍스처
│       ├── CesiumWindEngine3D.js   ← (레거시) 3D 텍스처 방식 엔진
│       ├── metadata.json           ← 3km 메타 (249×367×24)
│       ├── metadata_8km.json       ← 8km 메타 (1158×598×24, 디폴트)
│       ├── wind_data_3d.bin        ← 3km 바이너리 (gitignore: *.bin)
│       └── wind_data_3d_8km.bin    ← 8km 바이너리 (gitignore: *.bin)
│
├── verify-script/              ← (gitignore) 테스트/검증 스크립트
│   ├── package.json            ← Node.js (playwright 의존성)
│   ├── package-lock.json       ← playwright 버전 잠금
│   ├── test-grid-browser.js
│   ├── test-grid-visualizer.js
│   ├── analyze-shot.js
│   └── shots/                  ← (gitignore) 스크린샷 산출물
│
└── demo/                       ← (비어있음) 데모용 디렉토리
```

---

## 🛠️ Tech Stack (기술 스택)

| 레이어 | 기술 |
|--------|------|
| 3D 엔진 | [CesiumJS 1.119](https://cesium.com/platform/cesiumjs/) (CDN) |
| 렌더링 | 커스텀 `Cesium.Primitive` / `DrawCommand` + 인라인 GLSL 셰이더 |
| 프론트엔드 | HTML5, JavaScript (ES6+) |
| 데이터 변환 | Python (netCDF4, numpy, xarray) |
| 데이터 원천 | 기상청 수치모델 NetCDF — 3km `r030_v040` / 8km `g576_v091` |
| 베이스맵 | Mapbox Satellite / OpenStreetMap |
| 테스트 | Playwright (Node.js) |

---

## 🚀 Getting Started (실행 방법)

### 1. 로컬 서버 실행

```bash
python front/serve.py
```

> `serve.py`는 `front/`를 웹 루트로 서빙하고 `view.html` 내 `{{ MAPBOX_TOKEN }}` 플레이스홀더를
> `front/.mapbox_token` 파일의 실제 토큰으로 치환합니다.
> `python -m http.server`는 사용 금지 (토큰 치환 미적용).
>
> **⚠️ `.mapbox_token` 파일이 필수입니다.**
> `front/.mapbox_token`에 Mapbox API 토큰을 1줄로 저장하세요.
> 이 파일은 `serve.py`가 읽어 Mapbox Satellite/Streets 베이스맵을 활성화하는 데 사용됩니다.
> 보안상 Git에 커밋하면 안 되므로 `.gitignore`에 포함되어 있습니다.

### 2. 데이터 변환 (.nc → .bin)

```bash
cd front/data-pipeline
python nc2bin.py
```

- 입력: `raw/YYYYMMDD/*.nc` (기상청 NetCDF)
- 출력: `../temp_data/wind3d/wind_data_3d*.bin` + `metadata*.json`

### 3. Python 환경

```bash
# front/ (뷰어 + data-pipeline)
cd front
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# Linux / macOS:
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 🔒 Gitignore (무시 대상)

아래 항목들은 `.gitignore`에 의해 Git에서 제외됩니다.

| 패턴 | 설명 |
|------|------|
| `*.bin` | 바이너리 데이터 파일 (대용량, 로컬 생성) |
| `verify-script/` | 테스트/검증 스크립트 (로컬 전용) |
| `verify-script/shots/` | 스크린샷 산출물 |
| `kim_data/`, `raw/` | 원시 기상 데이터 (대용량) |
| `.mapbox_token` | Mapbox API 토큰 (시크릿) — **필수 파일**, `serve.py`가 읽어 토큰 치환에 사용. Git에 커밋 금지 |
| `.env`, `.env.*` | 환경 변수 파일 (시크릿) |
| `*.pem`, `*.key` | 인증 키 파일 |
| `node_modules/` | Node.js 의존성 |
| `dist/`, `build/`, `out/` | 빌드 산출물 |
| `__pycache__/`, `*.pyc` | Python 캐시 |
| `venv/`, `.venv/`, `env/` | Python 가상환경 |
| `.roo/` | Roo AI 설정 |
| `*.log`, `logs/` | 로그 파일 |
| `.DS_Store`, `Thumbs.db` | OS 파일 |
| `*.swp`, `*.swo`, `*.bak` | 에디터 백업 |

> **참고**: `front/.mapbox_token`은 `serve.py`가 Mapbox 베이스맵 토큰을 치환하는 데 **필수**입니다.
> 로컬에 직접 생성하여 사용하세요 (Git 커밋 금지).

---

## 📄 License

This project is open-sourced under the MIT License.
