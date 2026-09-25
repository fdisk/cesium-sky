# Cesium Wind — 프로젝트 구조 문서

> Cesium.js 기반 지구본 위 **기상 데이터 3D 시각화** 프로젝트.
> 기상청 수치모델 NetCDF(.nc) 파일을 바이너리(.bin)로 변환해 GPU 파티클(바람 흐름) + 단면도(슬라이스)로 렌더링하는 웹 뷰어.
>
> 이 문서는 향후 코딩/설계 시 기준(reference)으로 계속 사용한다. 코드 변경 시 이 문서도 함께 갱신할 것.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 목적 | Cesium.js 지구본 위에 바람(U, V, W) 데이터를 파티클 애니메이션 + 3D 단면도로 시각화 |
| 데이터 원천 | 기상청 수치모델 NetCDF — **3km** `r030_v040_easia_prs.2byte.ftXXX.nc` (Lambert conformal) + **8km** `g576_v091_easia_prs.2byte.ftXXX.nc` (regular lat-lon), 동아시아 전체 영역, 3시간 간격 예보 ft000~ft087 |
| 렌더링 | Cesium.js 1.119 (CDN 로드) + 커스텀 `Cesium.Primitive` / `DrawCommand` + 인라인 GLSL 셰이더 (WebGL2) |
| 지형/위성 | 한국 지형 `/terrain/korea/v3/` (코드 구현, 현재 비활성), Mapbox Satellite / OpenStreetMap Streets (OSM) |
| 영역 | 3km: 동아시아 전체 (103.97~148.03°E, 25.26~49.70°N, 1050×840×24) / 8km: 동아시아 전체 (77.75~174.17°E, 11.79~61.54°N, 1158×598×24), 24개 등압면(1000~50 hPa) |
| 고도 표현 | GPH(geopotential height, m) × `heightScale`(기본 20배, 10~70x) 과장. 레벨별 실제 고도는 `gphByLevel` 메타데이터에서 참조 |

### 데이터 파이프라인 흐름

```
기상청 .nc (NetCDF)  [3km r030 / 8km g576]
   │  data-pipeline/nc2bin.py  (변수명 자동감지 + 4단계 UTC 일시 추출 + U,V,W,GPH 패킹)
   ▼
temp_data/wind3d/<model>/<date>/
   ├── metadata.json          (bounds, range, plev, gphByLevel)
   └── wind_data_3d.bin       (Float32 [U,V,W,GPH] 인터리브)
   │  fetch() → Float32Array  (DATASETS 레지스트리 + datasetCache 캐싱)
   ▼
front/view.html (Cesium Viewer)
   ├─ GpuParticleEngine  → 파티클 GPU 애니메이션 (바람장 레이어 / 풍속 필터)
   ├─ WindLegendBox      → 3D 범위 박스(와이어프레임) + 고도 레벨 라벨 (gphByLevel 기반)
   ├─ GridVisualizer     → 격자 시각화 (지면 단면 격자 / 24레벨 직육면체)
   └─ 슬라이스 단면도    → Z(수평)/X(경도)/Y(위도) 평면 + CPU 생성 RGBA 텍스처
```

---

## 2. 디렉토리 구조

```
cesium-sky/
├── front/                      ★ 현행 앱 (뷰어) — 웹 서버 루트
│   ├── view.html               ← 메인 진입점 (DATASETS 드롭다운, UI 패널)
│   ├── serve.py                ← 로컬 테스트 서버 (port 8765, {{ MAPBOX_TOKEN }} 치환)
│   ├── .mapbox_token           ← (gitignore) 로컬 Mapbox 토큰 파일
│   ├── VIEWER_REFERENCE.md     ← 이 문서
│   ├── requirements.txt        ← Python 의존성 (netCDF4, numpy, xarray 등)
│   │
│   ├── data-pipeline/          ★ .nc → .bin 변환 파이프라인 (Python)
│   │   ├── nc2bin.py           ← 변환 스크립트 (JOBS 배치, 4단계 일시 추출)
│   │   ├── ncHeaderViwer.py    ← NC 헤더/변수 구조 검사 (xarray)
│   │   ├── getNcTxtApi.py      ← NC 데이터 API 조회 스크립트
│   │   ├── raw/20260922/       ← 원본 .nc 파일 (r030 + g576)
│   │   └── .venv/              ← Python 가상환경
│   │
│   └── temp_data/wind3d/       ← 데이터 + 엔진 모듈 (view.html 절대 경로 매핑)
│       ├── GpuParticleEngine.js    ← 핵심: GPU 파티클 엔진 (인라인 셰이더)
│       ├── WindLegendBox.js        ← 3D 범위 박스 + 고도 레벨 라벨
│       ├── GridVisualizer.js       ← 격자 시각화 (지면/24레벨)
│       ├── WindDataLoader.js       ← .bin/.json 로더 + WebGL2 3D 텍스처
│       ├── CesiumWindEngine3D.js   ← (레거시) 3D 텍스처 방식 — 미사용
│       │
│       ├── r030/2026-09-21/        ← 3km 데이터 (동아시아 전체, 1050×840×24)
│       │   ├── metadata.json
│       │   └── wind_data_3d.bin
│       │
│       └── g576/2026-09-21/        ← 8km 데이터 (동아시아 전체, 1158×598×24)
│           ├── metadata.json
│           └── wind_data_3d.bin
│
└── plans/
    └── view-analysis.md
```

> **출력 경로 규칙**: `nc2bin.py`는 `WIND3D_ROOT = ../temp_data/wind3d` 아래 `<model>/<date>/` 디렉토리에 `metadata.json` + `wind_data_3d.bin`을 생성.
> 예: `temp_data/wind3d/r030/2026-09-21/`, `temp_data/wind3d/g576/2026-09-21/`

---

## 3. front/ — 뷰어 앱 상세

### 3.1 `view.html` — 메인 진입점

Cesium Viewer 생성 + UI 패널 + 엔진 부팅을 담당.

- **Cesium 1.119 CDN** 로드 (`window.CESIUM_BASE_URL` = CDN 경로)
- **Viewer 옵션**: animation/timeline/geocoder/infoBox/selectionIndicator/baseLayerPicker 비활성, homeButton/sceneModePicker/fullscreenButton 활성, `imageryProvider: false`
- **베이스맵**:
  - `mapbox-satellite` (디폴트): Mapbox Satellite, 토큰 `{{ MAPBOX_TOKEN }}` → serve.py가 치환
  - `mapbox-streets`: OpenStreetMap 래스터 타일(`tile.openstreetmap.org`)로 대체
- **환경 설정**: `skyAtmosphere.show = false` (UI 토글), `depthTestAgainstTerrain = true`, `enableLighting = true`
- **시계 동기화**: `viewer.clock.currentTime` = `metadata.date_utc`, `shouldAnimate = false`
- **카메라**:
  - 초기: (127°E, 26°N, 1e8m, heading 357.6, pitch -54.5)
  - `loadDataset()` 시 데이터셋별 `camera`로 `flyTo` (2초):
    - `3km`: (126.0°E, 36.5°N, **15Mm**, heading 357.6, pitch -90) — 동아시아 직하방
    - `8km` (디폴트): (126.0°E, 36.5°N, **15Mm**, heading 357.6, pitch -90) — 동아시아 직하방
  - **Home 버튼 인터셉트**: `DATASETS[currentDatasetKey].camera`로 `flyTo`
- **DATASETS 레지스트리** (view.html 내 상수):
  ```js
  const DATASETS = {
    '3km': {
      json: '/temp_data/wind3d/r030/2026-09-21/metadata.json',
      bin:  '/temp_data/wind3d/r030/2026-09-21/wind_data_3d.bin',
      label: '3km 격자 (r030 동아시아)',
      camera: { lon: 126.0, lat: 36.5, height: 15000000 },
      orientation: { heading: 357.6, pitch: -90, roll: 0 }
    },
    '8km': {
      json: '/temp_data/wind3d/g576/2026-09-21/metadata.json',
      bin:  '/temp_data/wind3d/g576/2026-09-21/wind_data_3d.bin',
      label: '8km 격자 (g576 동아시아)',
      camera: { lon: 126.0, lat: 36.5, height: 15000000 },
      orientation: { heading: 357.6, pitch: -90, roll: 0 }
    }
  };
  ```
- **데이터 캐시 (`datasetCache`)**: `{ metadata, binaryData }` 메모리 캐싱 → 3km ↔ 8km 전환 시 재다운로드 없음
- **UI 패널** (`#slider-panel`): 데이터셋 드롭다운, 고도 과장 슬라이더(10~70x, 기본 20x), 베이스맵, 3D 박스/레벨 텍스트 토글, 격자 시각화, 바람장 레이어(하/중/상층), 풍속 필터(듀얼 슬라이더 + 등급 프리셋), 단면도(X/Y/Z), 환경 조명
- **8km 특별 처리**: 3D 범위 박스 + 단면도 UI 자동 숨김 (`display: none`)
- **엔진 부팅** (`loadDataset(key)`): destroy → cache/fetch → info panel → clock sync → UI 가시성 → new Engine/Legend/Grid → legend update → camera flyTo
- **전역 핸들**: `window.particleEngine`, `window.legendBoxInstance`, `window.gridVisualizer`

### 3.2 `GpuParticleEngine.js` — 핵심 파티클 엔진

GPU 파티클 애니메이션 (인라인 GLSL ES 3.00 셰이더, WebGL2).

#### 정적 설정
```js
CONFIG = {
  DEFAULT_SPEED_FACTOR: 5.0,
  DEFAULT_HEIGHT_SCALE: 30.0,
  PARTICLE_POINT_SIZE: 2.5,
  TAIL_LENGTH: 0.6,
  SHOW_LIMIT_SPEED: 15.0,
  TAIL_SEGMENTS: 15
}
WIND_COLOR_MAP = [ {0: 회색}, {5: 시안}, {12: 파랑}, {20: 초록}, {30: 노랑}, {40: 주황}, {50: 빨강} ]
```

#### parseMetadata()
- `iCount/jCount/levelCount`, `bounds`(lon1/lat1/lon2/lat2), `range.gph`(gphMin/gphMax) 파싱
- **`gphByLevel`**: Float32Array로 저장 (레벨별 평균 고도 m). 미존재 시 `gphMin→gphMax` 선형 보간 폴백
- 키명 폴백: `iCount|width`, `bounds` 배열/객체 양식

#### 파티클 버퍼
- 파티클당: `(randI, randJ, randK)` → `dataIdx = (k*jCount + j*iCount + i) * 4` → u, v, w 샘플링
- 속성: `position`(Float64×3, 도메인 중심), `normCoord`(Float32×3), `velocity`(Float32×3), `randTime`(Float32)
- 꼬리: `TAIL_SEGMENTS`개 선분 × 2 정점 (LINES) / 머리: POINTS

#### 렌더링 (커스텀 DrawCommand)
- `primitive.update(frameState)` 오버라이드 → `DrawCommand` + `uniformMap` 갱신
- `boundingSphere`: `computeDomainBoundingSphere()` — 도메인 4모서리 최대 거리 × 1.2
- **버텍스 셰이더**:
  - `baseProgress = fract(u_time * 0.1 * u_speedFactor + randTime)`
  - `currentPos = normCoord + velocity * (progress * 0.0005 * u_speedFactor)` (직선 평류)
  - `gph = sampleGph(currentPos.z)` — **`u_gphByLevel[32]` uniform 배열 + `u_levelCount`로 레벨별 실제 고도 참조**
  - 정규화 → `mix(lonRange/latRange)` + gph → `geodeticToCartesian()` → `czm_modelViewProjection`
  - 컬러: `getShaderColor(speed)` (WIND_COLOR_MAP 기반 GLSL if/else + mix)
- **uniformMap**: `u_time`, `u_speedFactor`, `u_heightScale`, `u_pointSize`, `u_lonRange`, `u_latRange`, `u_gphRange`, `u_gphByLevel[32]`, `u_levelCount` 등

#### 단면도 (슬라이스)
- Z(수평) / X(경도) / Y(위도) 3개 평면, CPU 생성 RGBA 텍스처 (NEAREST)
- 픽셀: `dataIdx = (k*jCount + j*iCount + i) * 4`
- ⚠️ 슬라이더 입력마다 전체 프리미티브 재생성

#### 공개 API
| 메서드 | 역할 |
|---|---|
| `setSpeedFactor(f)` | 파티클 속도 배율 |
| `setHeightScale(s)` | 고도 과장 (프리미티브 재생성) |
| `setClipBox(box)` | 단면 클립 박스 (0~1) |
| `setSliceVisibility(axis, bool)` | 단면 토글 ('x'/'y'/'z') |
| `setLayerVisibility(layer, bool)` | 바람장 레이어 ('low'/'mid'/'high') |
| `setSpeedFilter(min, max)` | 풍속 필터 (m/s) |
| `setLegendVisibility(box, labels)` | DOM 범례 표시 |
| `destroy()` | 프리미티브/DOM 제거 (데이터셋 전환 시) |

### 3.3 `WindLegendBox.js` — 3D 범위 박스 + 레벨 라벨

- `renderBoundingBox()`: 8개 꼭짓점 + 12개 모서리 와이어프레임 (gphByLevel min/max 기반 상/하단 고도)
- `renderVerticalLabels()`: 레벨별 hPa 라벨 — **`gphByLevel[i]`** (미존재 시 선형 폴백)
- `updateHeightScale(newScale)`: 박스/라벨 고도 재계산
- `heightScale = 30.0` (기본)

### 3.4 `GridVisualizer.js` — 격자 시각화

- `levelHeight(k)`: **`gphByLevel[k] * heightScale`** (미존재 시 선형 폴백)
- 모드: `ground` (지면 단면 격자) / `levels` (24레벨 직육면체)
- `heightScale = 20.0` (기본)

### 3.5 `WindDataLoader.js` — 데이터 로더

- `load(jsonUrl, binUrl)` → `{ metadata, windDataArray }`
- `create3DDataTexture(gl)`: WebGL2 `TEXTURE_3D` (RGBA32F) — 레거시 전용, 현행 미사용

### 3.6 `serve.py` — 로컬 테스트 서버

- Port 8765, bind 127.0.0.1
- `{{ MAPBOX_TOKEN }}` 플레이스홀더 치환 (env var 또는 `.mapbox_token` 파일)
- `python front/serve.py`로 실행 (`python -m http.server` 사용 금지)

---

## 4. data-pipeline/ — .nc → .bin 변환

### 4.1 `nc2bin.py`

- **JOBS 배치** (상단 리스트):
  ```python
  JOBS = [
    { "model": "r030", "date": "2026-09-21", "bbox": {},
      "input": "raw/20260922/r030_v040_easia_prs.2byte.ft003.2026092118.nc" },
    { "model": "g576", "date": "2026-09-21", "bbox": {},
      "input": "raw/20260922/g576_v091_easia_prs.2byte.ft003.2026092118.nc" },
  ]
  ```
  - `bbox: {}` = 전체 영역 (크롭 없음)
  - 출력: `WIND3D_ROOT/<model>/<date>/wind_data_3d.bin` + `metadata.json`

- **변수명 자동 감지** (`VAR_CANDIDATES` + `pick_var()`):
  - `u: U|u`, `v: V|v`, `w: W|w`, `gph: GPH|hgt`
  - `lon: XLONG|lon|lons|west_east`, `lat: XLAT|lat|lats|south_north`
  - `plev: PLEV|levs`
  - **`hgt` → `GPH` 매핑**: 원본 NC의 고도 변수명은 모델마다 다름 — 3km r030은 `GPH`, 8km g576은 `hgt` (geopotential height, m). 물리량은 동일(등고전위 고도, m)이므로 `pick_var()`가 후보 순서(`GPH` → `hgt`)로 감지해 둘 다 4채널의 `GPH` 슬롯으로 통일. 이렇게 하면 .bin 포맷이 `[U,V,W,GPH]`로 모델 무관하게 동일해져 프론트엔드(GpuParticleEngine/WindLegendBox/GridVisualizer)가 3km·8km를 별도 분기 없이 동일하게 처리 가능. metadata의 `range.gph`도 이 통일된 4채널의 min/max이므로 8km 원본에 `gph` 변수가 없어도 `range.gph`가 존재함.

- **4단계 UTC 일시 추출** (`parse_utc_date_from_nc`):
  1. `Times` 변수 (r030: 문자열 `"2026-09-21 21:00:00"`)
  2. `time` 변수 + `units` (g576: CF-1.7 `"hours since 2026-09-21 18:00:00"`) → base + timedelta
  3. `current_time` global attribute (`%a %b %d %H:%M:%S %Y` 포맷)
  4. 파일명 `\d{10}` 정규식 (예: `2026092118` → 2026-09-21T18:00:00Z)
  - 폴백: `"2026-09-14T12:00:00Z"`

- **좌표 처리** (`extract_grid()`):
  - 2D 좌표 (r030 `XLONG/XLAT`): `[0]` 슬라이스
  - 1D 좌표 (g576 `lons/lats`): `np.meshgrid(indexing='ij')` + `.T` → (j, i)

- **gphByLevel 계산**: `gph_by_level = [float(np.mean(gph_data[k])) for k in range(levels)]` → metadata에 `gphByLevel` 배열로 저장

- **패킹**: `np.column_stack((u, v, w, gph)).astype(np.float32)` → `.bin`

### 4.2 바이너리 포맷 (중요 계약)

```
wind_data_3d.bin = Float32 인터리브 스트림
  각 그리드 포인트 (level k, j, i)마다 4개 float: [U, V, W, GPH]
  인덱스: dataIdx = (k * jCount + j * iCount + i) * 4
  총 바이트 = levelCount * jCount * iCount * 16
```
- `i` = 경도 방향 (lon1→lon2), `j` = 위도 방향 (lat1→lat2), `k` = 레벨 (plev[0]=1000hPa → plev[-1]=50hPa)
- U, V, W: m/s / GPH: m

### 4.3 `metadata.json` 스키마

```json
{
  "metadata": {
    "file_name": "r030_v040_easia_prs.2byte.ft003.2026092118.nc",
    "date_utc": "2026-09-21T21:00:00Z",
    "iCount": 1050,
    "jCount": 840,
    "levelCount": 24,
    "bounds": { "lon1": 103.971, "lat1": 25.255, "lon2": 148.029, "lat2": 49.697 },
    "range": {
      "u":   [-28.34, 54.36],
      "v":   [-28.46, 52.39],
      "w":   [-4.843, 4.029],
      "gph": [-124, 20637]
    },
    "plev": [1000, 975, 950, 925, 900, 875, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 70, 50],
    "gphByLevel": [114.31, 332.90, 556.12, 783.94, 1016.87, 1255.46, 1499.90, 2008.37, 2544.88, 3113.35, 3717.55, 4362.27, 5053.61, 5798.89, 6607.74, 7495.09, 8470.04, 9559.32, 10812.56, 12294.92, 14142.28, 16627.59, 18777.95, 20520.46]
  }
}
```

- **`gphByLevel`** (신규): 레벨별 평균 고도(m) 배열. 프론트엔드에서 `sampleGph(z)`로 레벨별 실제 고도 참조 (선형 보간 대신)
- `GpuParticleEngine.parseMetadata()`는 `iCount|width`, `bounds` 배열/객체, `range.gph|height` 등 키명 폴백 지원

### 4.4 현재 데이터 요약

| 모델 | 격자 | 영역 | date_utc | gphByLevel[0]→[-1] |
|---|---|---|---|---|
| r030 (3km) | 1050×840×24 | 103.97~148.03°E, 25.26~49.70°N | 2026-09-21T21:00:00Z | 114m → 20520m |
| g576 (8km) | 1158×598×24 | 77.75~174.17°E, 11.79~61.54°N | 2026-09-21T21:00:00Z | 121m → 20796m |

---

## 5. 주요 설계 결정 & 컨벤션

1. **파티클 애니메이션 = 직선 평류 근사**: 스폰 지점 (u,v,w)를 progress 동안 직선 이동. `0.0005 * speedFactor`가 progress→정규화좌표 스케일.
2. **정규화 좌표(0~1) 기반**: 클립 박스, 파티클 위치, 슬라이스 모두 정규화. 셰이더에서 `mix(range)`로 실제 좌표 변환.
3. **고도 과장**: `gph * heightScale` (기본 20~30x). 레벨별 실제 고도는 `gphByLevel` 참조 (선형 보간 아님).
4. **컬러맵 단일 소스**: `WIND_COLOR_MAP`이 JS(단면 픽셀, DOM 범례) + GLSL(자동 생성) 양쪽 기준.
5. **커스텀 DrawCommand 패턴**: `primitive.update()` 오버라이드 → 매 프레임 uniform 갱신 + commandList push.
6. **데이터-코드 분리**: .bin/.json은 `/temp_data/wind3d/<model>/<date>/`에서 로드. 데이터 교체 = 파일 교체.
7. **다중 데이터셋**: `DATASETS` 레지스트리 + `loadDataset(key)` 런타임 전환. `[U,V,W,GPH]` 계약은 모델 무관 — 8km의 `hgt`가 `GPH` 슬롯으로 매핑됨 (물리량 동일: geopotential height, m).
8. **격자 구조 자동 감지**: `nc2bin.py`가 변수명 + 좌표 차원(2D/1D) 자동 감지 → 3km(Lambert)·8km(lat-lon) 동일 파이프라인.
9. **gphByLevel**: 레벨별 평균 고도를 metadata에 저장 → 프론트엔드 셰이더/라벨/격자가 실제 고도 사용 (선형 보간 오류 제거).
10. **4단계 일시 추출**: NC 내부 `Times`/`time`/`current_time`/파일명 순으로 UTC 일시 추출 → 출력 디렉토리명(`<date>`) 결정.
11. **메모리 캐싱**: `datasetCache`로 바이너리+메타 보관 → 전환 시 재요청 없음.
12. **Cesium 시계 동기화**: `clock.currentTime = metadata.date_utc`, `shouldAnimate = false` → 해당 시각 태양광 재현.
13. **독립 시각화 모듈**: 파티클(`GpuParticleEngine`) / 박스+라벨(`WindLegendBox`) / 격자(`GridVisualizer`) 분리.

---

## 6. 알려진 이슈 / 주의사항

| # | 이슈 | 위치 |
|---|---|---|
| 1 | `view.html`이 `/temp_data/wind3d/...` 절대 경로 fetch → `front/`를 웹 루트로 서빙해야 함 | `view.html` |
| 2 | `{{ MAPBOX_TOKEN }}` 플레이스홀더 — serve.py가 치환 (배포 시 별도 처리 필요) | `view.html` |
| 3 | 슬라이더 입력마다 슬라이스 프리미티브 전체 재생성 (CPU 비용) | `updateSlicePlanes()` |
| 4 | 기압면 라벨 DOM(24개 hPa) 하드코딩 — metadata `plev`와 동기화 안 됨 | `createLegendOverlay()` |
| 5 | `CesiumWindEngine3D.js`는 미사용 레거시 | `front/temp_data/wind3d/` |
| 6 | 새 ftXXX 시간 스텝 추가 시 `JOBS` 리스트에 항목 추가 필요 | `nc2bin.py` |
| 7 | 8km 광역 데이터는 3D 박스/단면도 UI 자동 숨김 | `view.html` |
| 8 | `ncHeaderViwer.py` 파일명 오타 (Viewer → Viwer) | `data-pipeline/` |

---

## 7. 향후 코딩 시 체크리스트

- [ ] 데이터 포맷 계약 유지: `[U,V,W,GPH]` float32 인터리브, `dataIdx = (k*jCount + j*iCount + i) * 4`
- [ ] metadata 스키마 변경 시 `parseMetadata()` 폴백 로직 + `gphByLevel` 처리 함께 갱신
- [ ] 컬러맵 변경은 `WIND_COLOR_MAP` 한 곳만 수정 (JS + GLSL 자동 반영)
- [ ] 새 프리미티브 추가 시 `primitive.update(frameState)` + `DrawCommand` + `commandList.push` 패턴
- [ ] 좌표 변환: 정규화(0~1) → `mix(range)` → `geodeticToCartesian` 순서 유지
- [ ] 고도 렌더링은 항상 `* heightScale` 적용, 레벨별 고도는 `gphByLevel` 참조
- [ ] UI 컨트롤은 `window.particleEngine` / `window.legendBoxInstance` / `window.gridVisualizer` 경유
- [ ] 데이터 파일 교체 후 `metadata.json` + `wind_data_3d.bin` 짝 갱신 (`temp_data/wind3d/<model>/<date>/`)
- [ ] 새 데이터셋 추가 시 `DATASETS` 레지스트리 + 드롭다운 `<option>` + `nc2bin.py` `JOBS` 3곳 갱신
- [ ] 데이터셋 전환 시 `destroy()` → 신규 생성 패턴 유지
- [ ] 코드 변경 시 이 문서(`VIEWER_REFERENCE.md`)도 함께 갱신
- [ ] 앱 테스트: `python front/serve.py` (port 8765, 토큰 치환 적용)
