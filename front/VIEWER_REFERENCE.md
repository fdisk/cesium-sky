# Cesium Wind — 프로젝트 구조 문서

> Cesium.js 기반 지구본 위 **기상 데이터 3D 시각화** 프로젝트.
> 기상청 G576 모델 NetCDF(.nc) 파일을 바이너리(.bin)로 변환해 GPU 파티클(바람 흐름) + 단면도(슬라이스)로 렌더링하는 웹 뷰어.
>
> 이 문서는 향후 코딩/설계 시 기준(reference)으로 계속 사용한다. 코드 변경 시 이 문서도 함께 갱신할 것.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|---|---|
| 목적 | Cesium.js 지구본 위에 바람(U, V, W) 데이터를 파티클 애니메이션 + 3D 단면도로 시각화 |
| 데이터 원천 | 기상청 수치모델 NetCDF — **3km** `r030_v040_easia_prs.2byte.ftXXX.nc` (Lambert conformal) + **8km** `g576_v091_easia_prs.2byte.ftXXX.nc` (regular lat-lon), 동아시아 영역, 3시간 간격 예보 ft000~ft087 |
| 렌더링 | Cesium.js 1.119 (CDN 로드) + 커스텀 `Cesium.Primitive` / `DrawCommand` + 인라인 GLSL 셰이더 |
| 지형/위성 | 한국 지형 `/terrain/korea/v3/` (코드 구현, 현재 비활성), Mapbox Satellite / OpenStreetMap Streets (OSM) |
| 영역 | 3km: 한반도 BBOX 크롭 (123.1~132.4°E, 31.9~42.1°N) / 8km (디폴트): 전체 동아시아 (77.75~174.17°E, 11.79~61.54°N), 24개 등압면(1000~50 hPa) |
| 고도 표현 | GPH(geopotential height, m) × `heightScale`(기본 20배, 10~70x) 과장 |

### 데이터 파이프라인 흐름

```
기상청 .nc (NetCDF)  [3km r030 / 8km g576]
   │  data-pipeline/nc2bin.py  (변수명 자동감지 + BBOX 크롭 + U,V,W,GPH 패킹)
   ▼
wind_data_3d.bin + metadata.json          (3km)
wind_data_3d_8km.bin + metadata_8km.json  (8km, 디폴트)
   │  fetch() → Float32Array  (데이터셋 드롭다운으로 선택, datasetCache 캐싱)
   ▼
front/view.html (Cesium Viewer)
   ├─ GpuParticleEngine  → 파티클 GPU 애니메이션 (바람장 레이어 / 풍속 필터)
   ├─ WindLegendBox      → 3D 범위 박스(와이어프레임) + 고도 레벨 라벨
   ├─ GridVisualizer     → 격자 시각화 (지면 단면 격자 / 24레벨 직육면체)
   └─ 슬라이스 단면도    → Z(수평)/X(경도)/Y(위도) 평면 + CPU 생성 RGBA 텍스처
```

---

## 2. 디렉토리 구조

```
cesium-wind/
├── VIEWER_REFERENCE.md         ← 이 문서
│
├── front/                      ★ 현행 앱 (뷰어) — 웹 서버 루트
│   ├── view.html               ← 메인 진입점 (index.html 역할, 데이터셋 드롭다운 포함)
│   ├── serve.py                ← 로컬 테스트 서버 ({{ MAPBOX_TOKEN }} 치환, §3.7)
│   └── .mapbox_token           ← (gitignore) 로컬 Mapbox 토큰 파일 — serve.py가 읽음
│   └── temp_data/wind3d/       ← 데이터 + 엔진 모듈 (view.html의 절대 경로 `/temp_data/wind3d/` 매핑)
│       ├── GpuParticleEngine.js    ← 핵심: GPU 파티클 엔진 (인라인 셰이더, 레이어/풍속필터 지원)
│       ├── WindLegendBox.js        ← 3D 범위 박스 + 고도(기압) 레벨 라벨
│       ├── GridVisualizer.js       ← 격자 시각화 모듈 (지면 단면 / 24레벨 직육면체)
│       ├── WindDataLoader.js       ← .bin/.json 로더 + WebGL2 3D 텍스처 생성기
│       ├── CesiumWindEngine3D.js   ← (레거시/스텁) 3D 텍스처 방식 엔진 — view.html에서 미사용
│       ├── metadata.json           ← 3km 데이터 메타 (249×367×24)
│       ├── wind_data_3d.bin        ← 3km 데이터 바이너리
│       ├── metadata_8km.json       ← 8km 데이터 메타 (1158×598×24, 전체 영역, 디폴트)
│       └── wind_data_3d_8km.bin    ← 8km 데이터 바이너리 (전체 영역, 디폴트)
│
├── data/                       ← (대안 데이터) 고해상도 1050×840×24
│   ├── metadata.json
│   └── wind_data_3d.bin
│
├── data-pipeline/              ★ .nc → .bin 변환 파이프라인 (Python)
│   ├── nc2bin.py               ← 변환 스크립트 (3km/8km 범용, JOBS 배치 + BBOX)
│   ├── ncHeaderViwer.py        ← NC 헤더/변수 구조 검사 스크립트 (xarray)
│   ├── requirements.txt        ← netCDF4, numpy, xarray 등
│   ├── raw/20260914/           ← 3km 원본 .nc (r030_v040)
│   ├── raw/20260922/           ← 8km 원본 .nc (g576_v091, ft000~ft087, 30개)
│   └── .venv/                  ← Python 가상환경
│
└── backup/front/v1..v3/        ← 과거 버전 스냅샷 (동일 파일 구성)
```

---

## 3. front/ — 뷰어 앱 상세

### 3.1 `view.html` — 메인 진입점

Cesium Viewer 생성 + UI 패널 + 엔진 부팅을 담당.

- **Cesium 1.119 CDN** 로드 (`window.CESIUM_BASE_URL` = CDN 경로)
- **Viewer 옵션**: animation/timeline/geocoder/infoBox/selectionIndicator/baseLayerPicker 비활성, homeButton/sceneModePicker/fullscreenButton 활성, `imageryProvider: false` (수동 추가)
- **지형**: `CesiumTerrainProvider.fromUrl("/terrain/korea/v3/")` 함수 구현되어 있으나 현재 `// initTerrain();` 주석 처리로 비활성화 (기본 Ellipsoid 타원체 사용)
- **베이스맵**:
  - `mapbox-satellite` (디폴트): Mapbox Satellite `UrlTemplateImageryProvider`, 토큰은 `{{ MAPBOX_TOKEN }}` 플레이스홀더 → **배포/서빙 시 치환 필요**
  - `mapbox-streets`: Mapbox Static Images API의 vector 미지원(410 에러) 문제로 인해 OpenStreetMap 래스터 타일(`tile.openstreetmap.org`)로 자동 대체
- **환경 설정**:
  - `viewer.scene.skyAtmosphere.show = false` (기본 꺼짐, UI 토글 가능)
  - `viewer.scene.globe.depthTestAgainstTerrain = true`
  - `viewer.scene.globe.enableLighting = true` (기본 켜짐, UI 토글 가능)
  - **시계(태양광) 동기화**: `viewer.clock.currentTime`을 데이터셋의 `metadata.date_utc`로 설정하고 `viewer.clock.shouldAnimate = false` (예보 시각의 태양 위치와 일조/하늘 색상을 정지 프레임으로 재현)
- **카메라 및 Home 버튼**:
  - 초기 카메라 시점: (127°E, 26°N, 1e8m, heading 357.6, pitch -54.5)
  - `loadDataset()` 시 데이터셋별 `camera` 설정으로 `flyTo` (duration 2초):
    - `8km` (디폴트): (126.0°E, 36.5°N, 15Mm, heading 357.6 / pitch -90) — 전체 동아시아 직하방 뷰
    - `3km`: (128.67°E, 23.08°N, 1.62Mm, heading 357.6 / pitch -54.5) — 한반도 영역
  - **Home 버튼 인터셉트**: Cesium 기본 `flyHome`(지구 전체 뷰) 대신 현재 선택된 데이터셋의 기본 카메라 위치(`DATASETS[currentDatasetKey].camera`)로 `flyTo`
- **데이터 로드 및 캐시 (`datasetCache`)**:
  - 데이터 로드 경로: `/temp_data/wind3d/` 아래 데이터셋별 파일 쌍
  - `datasetCache` 객체를 통해 이미 fetch된 `{ metadata, binaryData }`를 메모리에 캐싱하여 3km ↔ 8km 전환 시 재다운로드 없이 즉시 전환
- **로딩 오버레이 (`#loading-overlay`)**:
  - 데이터셋 로딩 중 화면 전체에 Dimmed 배경(`rgba(0,0,0,0.55)`) + 스피너 + 상태 텍스트(`데이터셋 로딩 중...`) 표시
  - 대용량 데이터 파싱 시 UI 블로킹 및 스피너 멈춤 현상을 방지하기 위해 `requestAnimationFrame` 2회 후 안전하게 오버레이 해제
- **중앙 하단 정보 패널 (`#dataset-info-panel`)**:
  - 현재 로드된 데이터셋의 파일명(`metadata.file_name`)과 UTC 일시(`metadata.date_utc`) 실시간 표시
- **우측 상단 세로 범례 (`#wind-legend-panel`)**:
  - 세로형 풍속 컬러바(160px 높이 그라데이션 바) + 상단(최대)부터 하단(0)까지의 풍속 눈금(m/s)
  - `updateHtmlLegendFromEngine()` 함수가 `GpuParticleEngine.WIND_COLOR_MAP`을 읽어 눈금 및 CSS 그라데이션을 동적으로 갱신
  - Cesium 기본 우측 하단 범례 DOM(`.wind-legend-container`)은 CSS로 강제 숨김 처리
- **좌측 제어 패널 (`#slider-panel`) 구조**:
  - 패널 접기/펴기 책갈피 버튼 (`#toggle-panel-btn`, `◀` / `▶` 토글)
  - 스크롤 영역 (`#slider-panel-scroll`, `max-height: calc(100vh - 60px)`)
  - 아코디언 형태의 접기/펴기 섹션 (`.panel-section`): 헤더 클릭 시 `.open` 토글 (기본값: 접힘)
  - **패널 내 컨트롤 항목**:
    1. **데이터셋 선택 드롭다운** (`#dataset-select`, 3km / 8km — **기본값: 8km**) + 상태 표시 (`#dataset-status`)
    2. **고도 과장 배율 슬라이더** (`#height-scale`, 10~70x, step 1, **기본값: 20x**)
    3. **베이스맵 선택 드롭다운** (`#base-map-select`, Mapbox Satellite / Mapbox Streets)
    4. **3D 범위 박스 표시 체크박스** (`#toggle-box-frame`)
    5. **고도(기압) 레벨 텍스트 표시 체크박** (`#toggle-legend-text`, 기본 체크)
    6. [섹션] **격자 시각화** (`#section-grid-wrap`): 표시 체크박스(`toggle-grid`), 모드 라디오(`grid-mode`: 지면 단면 격자 `ground` / 24레벨 직육면체 `levels`), 격자 묶음 슬라이더(`grid-step-slider`, step 1~50, 기본 50)
    7. [섹션] **바람장 레이어** (`#section-wind-layers-wrap`): 하층(1000–700 hPa), 중층(650–300 hPa), 상층(250–50 hPa) 가시성 체크박스 (기본 모두 체크)
    8. [섹션] **풍속 필터 (m/s)** (`#section-speed-filter-wrap`): 겹쳐진 듀얼 레인지 슬라이더(`speed-filter-min`, `speed-filter-max`, 0~70 m/s) + 하이라이트 트랙 + 풍속 등급 라디오 프리셋 (전체 0–70, 미풍 0–5, 약풍 6–19, 중풍 20–39, 강풍 40–69, 폭풍 70+ m/s) 양방향 연동
    9. [섹션] **단면도 레이어 그룹** (`#section-slice-group`): 전체 토글(`toggle-all-slices`) + X(경도)/Y(위도)/Z(고도) 슬라이더(0~100%) 및 표시 체크박스
    10. [섹션] **환경 조명** (`#section-env-lighting-wrap`): 하늘 대기(`toggle-sky-atmosphere`, 기본 끔) 및 태양 조명(`toggle-enable-lighting`, 기본 켬) 토글
- **8km 데이터셋 특별 UI 처리**:
  - 8km 데이터셋은 광역이므로 3D 범위 박스 및 단면도 레이어 그룹이 자동으로 체크 해제되고 UI에서 숨김(`display: none`), 단면도 전체 토글은 비활성화 처리됨
- **엔진 부팅/전환** (`loadDataset(key)`):
  1. 기존 `windEngine.destroy()`, `legendBox.destroy()`, `gridVisualizer.destroy()` 호출 (프리미티브/DOM 정리)
  2. `datasetCache` 확인 후 미캐싱 시 bin+json 병렬 fetch 및 캐싱
  3. 중앙 하단 정보 패널 갱신 (`updateDatasetInfoPanel`)
  4. Cesium 시계를 `metadata.date_utc`로 동기화 (`viewer.clock.currentTime`)
  5. 8km 격자 여부에 맞춰 범위 박스/단면도 UI 가시성 및 체크 상태 제어
  6. `new GpuParticleEngine` → `new WindLegendBox` → `new GridVisualizer` 인스턴스 생성 및 슬라이더/체크박스 현재 UI 상태 동기화
  7. HTML 풍속 범례 업데이트 (`updateHtmlLegendFromEngine`)
  8. `DATASETS[key].camera`로 카메라 `flyTo`
  - 최초 부팅: `loadDataset('8km')` (디폴트)
  - `scene.postRender` 리스너는 **1회만** 등록 (클로저가 `windEngine` 변수를 참조하므로 전환 시 자동 반영)
- **전역 핸들**: `window.particleEngine`, `window.legendBoxInstance`, `window.gridVisualizer`

### 3.2 `GpuParticleEngine.js` — 핵심 파티클 엔진

GPU에서 파티클 애니메이션을 수행하는 커스텀 Cesium Primitive 엔진. **인라인 셰이더**를 사용.

#### 정적 설정
```js
CONFIG = {
  DEFAULT_SPEED_FACTOR: 5.0,   // 속도 배율
  DEFAULT_HEIGHT_SCALE: 20.0,  // 고도 과장 배율
  PARTICLE_POINT_SIZE: 2.5,    // 머리 점 크기
  TAIL_LENGTH: 0.6,            // 꼬리 길이 (progress 단위)
  SHOW_LIMIT_SPEED: 15.0,      // 미만 풍속 투명 처리 (생성자에서 CONFIG 값 사용)
  TAIL_SEGMENTS: 15            // 꼬리 선 세그먼트 수
}
WIND_COLOR_MAP = [  // 풍속(m/s) → RGB (0~255)
  {0: 회색(240,240,240)}, {5: 시안}, {12: 파랑}, {20: 초록},
  {30: 노랑}, {40: 주황}, {50: 빨강}
]
```

#### 생성자 / 초기화 / 파기
- `new GpuParticleEngine(viewer, metadata, binaryData, particleCount = 20000)`
- `init()`: `parseMetadata()` → `createParticlePrimitives()` → `createLegendOverlay()` → `updateSlicePlanes()`
- `parseMetadata()`: `iCount/jCount/levelCount`, `bounds`(lon1/lat1/lon2/lat2), `range.gph`(gphMin/gphMax) 파싱. 키명 폴백: `iCount|width`, `bounds` 배열/객체 양식 모두 지원
- `destroy()`: `tailPrimitive`/`headPrimitive`/`slicePrimitives`을 `scene.primitives`에서 제거 + `#custom-weather-legend` DOM 컨테이너 제거 + `isReady=false` — **데이터셋 전환 시 호출**

#### 파티클 버퍼 (CPU에서 1회 생성, GPU에서 애니메이션)
- 파티클 1개당: 랜덤 그리드 위치 `(randI, randJ, randK)` → `dataIdx = (randK*jCount + randJ*iCount + randI) * 4` 에서 **u, v, w** 샘플링
- 버퍼 속성:
  - `position` (Float64×3): 전부 도메인 중심 좌표로 초기화 (실제 위치는 셰이더에서 계산)
  - `normCoord` (Float32×3): 정규화 좌표 (0~1)
  - `velocity` (Float32×3): u, v, w
  - `randTime` (Float32): 0~100 랜덤 (애니메이션 위상)
  - 꼬리 전용: `segmentRatio` (0~1, 세그먼트 위치)
- 꼬리: 파티클당 `TAIL_SEGMENTS`개 선분 × 2 정점 (LINES)
- 머리: POINTS

#### 렌더링 방식 (커스텀 DrawCommand)
- `Cesium.Primitive` 생성 후 `primitive.update(frameState)` 오버라이드:
  - `boundingSphere`: `computeDomainBoundingSphere()` — 도메인 4모서리(상단 고도)까지의 최대 거리 × 1.2 (고정 3000km 대신 도메인 크기에 맞춤, 전체 영역 8km 데이터 시 가장자리 파티클 컬링 방지)
  - 매 프레임 `DrawCommand`에 `uniformMap` 갱신: `u_time = performance.now()/1000`, `u_speedFactor`, `u_heightScale`, `u_pointSize`, `u_lonRange`, `u_latRange`, `u_gphRange` 등
  - `ShaderProgram.fromCache` + `VertexArray.fromGeometry` (STATIC_DRAW) 캐싱
  - `frameState.commandList.push(command)` — TRANSLUCENT 패스, ALPHA_BLEND, depthMask=false
- **버텍스 셰이더 로직** (인라인):
  - `baseProgress = fract(u_time * 0.1 * u_speedFactor + randTime)` — 파티클 수명 주기 (0~1)
  - `currentPos = normCoord + velocity * (progress * 0.0005 * u_speedFactor)` — **직선 평류 근사**
  - 정규화 좌표 → `mix(lonRange) / mix(latRange) / mix(gphRange)` → `geodeticToCartesian()` (WGS84, GLSL 구현) → `czm_modelViewProjection`
  - 컬러: `getShaderColor(speed)` — **WIND_COLOR_MAP에서 JS가 자동 생성한 GLSL if/else + mix 코드**
  - 알파: `smoothstep` 페이드인/아웃 (0~0.1, 0.9~1.0)
- **머리 프래그먼트**: `gl_PointCoord` 원형 마스크 (반경 0.5 초과 discard)

#### 단면도 (슬라이스)
- `setClipBox({minX..maxZ})` / `setSliceVisibility('x'|'y'|'z', bool)` → `updateSlicePlanes()`
- 3개 평면 (모두 2삼각형 쿼드 + CPU 생성 RGBA 텍스처, NEAREST 필터):
  - **Z (수평)**: `gphMax*heightScale*zRatio` 고도의 수평면. 픽셀 = 해당 레벨의 `sqrt(u²+v²)` 풍속 → 컬러맵, `speed < showLimitSpeed`면 투명
  - **X (수직, 경도)**: `mix(lon1, lon2, xRatio)` 경도 수직면 (위도×고도)
  - **Y (수직, 위도)**: `mix(lat1, lat2, yRatio)` 위도 수직면 (경도×고도)
- 픽셀 데이터 인덱싱: `dataIdx = (k*jCount + j*iCount + i) * 4` (k=레벨, j=위도, i=경도)
- ⚠️ 슬라이더 입력마다 전체 프리미티브 재생성 (CPU 비용)

#### 공개 API
| 메서드 / 프로퍼티 | 역할 |
|---|---|
| `setSpeedFactor(f)` | 파티클 이동 속도 배율 |
| `setHeightScale(s)` | 고도 과장 배율 (프리미티브 재생성 + 슬라이스 갱신) |
| `setPointSize(s)` | 머리 점 크기 |
| `setClipBox(box)` | 단면 클립 박스 (정규화 0~1) |
| `setSliceVisibility(axis, bool)` | 단면 표시 토글 ('x', 'y', 'z') |
| `setLayerVisibility(layer, bool)` | 바람장 레이어 가시성 토글 ('low', 'mid', 'high') |
| `setSpeedFilter(min, max)` | 풍속 필터 범위 (min~max m/s 파티클만 렌더링) |
| `setLegendVisibility(box, labels)` | DOM 범례 표시 |
| `updateUniforms()` | 매 프레임 uniform 갱신 트리거 |
| `getColorFromSpeed(speed)` | 컬러맵 선형 보간 (단면 픽셀용) |
| `destroy()` | 프리미티브/DOM 전체 제거 (데이터셋 전환 시) |

### 3.3 `WindDataLoader.js` — 데이터 로더

- `load(jsonUrl, binUrl)` → `{ metadata, windDataArray }`
  - metadata: `metaJson.metadata` (내부 `metadata` 키 unwrap)
  - windDataArray: `new Float32Array(arrayBuffer)` — `[U, V, W, GPH, U, V, W, GPH, ...]` 인터리브
- `create3DDataTexture(gl)`: WebGL2 `TEXTURE_3D` (RGBA32F, trilinear) 생성 — **3D 텍스처 방식(레거시 엔진) 전용**, 현행 GpuParticleEngine은 미사용

###- `front/temp_data/wind3d/metadata.json`: 249×367×24 (3km)
- `front/temp_data/wind3d/metadata_8km.json`: 1158×598×24 (8km, 전체 동아시아 영역, 디폴트)
- `data/metadata.json`: 1050×840×24 (고해상도 대안)
- `GpuParticleEngine.parseMetadata()`는 `iCount|width`, `bounds` 배열/객체, `range.gph|height` 등 키명 폴백 지원

### 4.5 `requirements.txt`
`netCDF4, numpy, xarray, pandas, cftime` 등 (`.venv/` 가상환경 사용)

---

## 5. 주요 설계 결정 & 컨벤션

1. **파티클 애니메이션 = 직선 평류 근사**: 파티클은 스폰 지점의 (u,v,w)를 일정 시간(progress) 동안 직선 이동. 흐름장 적분(advection)은 아님. `0.0005 * speedFactor`가 progress→정규화좌표 이동 스케일.
2. **정규화 좌표(0~1) 기반**: 클립 박스, 파티클 위치, 슬라이스 위치 모두 정규화 값. 셰이더에서 `mix(range)`로 실제 좌표 변환.
3. **고도 과장**: `gph * heightScale` (기본 20배, 10~70x) — 20km 상층이 지구 반경 대비 보이도록.
4. **컬러맵 단일 소스**: `GpuParticleEngine.WIND_COLOR_MAP`이 JS(단면 픽셀, DOM 범례)와 GLSL(자동 생성 셰이더) 양쪽의 기준. 수정 시 양쪽 모두 자동 반영.
5. **커스텀 DrawCommand 패턴**: `primitive.update()` 오버라이드로 매 프레임 uniform 갱신 + commandList push. Cesium 표준 Appearance는 셰이더 인라인 제한 때문에 직접 제어.
6. **데이터-코드 분리**: .bin/.json은 서버 경로(`/temp_data/wind3d/`)에서 로드. 데이터 교체 = 파일 교체만.
7. **다중 데이터셋 지원**: `DATASETS` 레지스트리(key → json/bin/label) + `loadDataset(key)`로 런타임 전환. 전환 시 `destroy()`로 기존 프리미티브/DOM 정리 후 신규 생성. 4채널 `[U,V,W,GPH]` 계약은 격자(3km/8km)와 무관하게 동일 — 8km의 `hgt`가 `GPH` 슬롯에 매핑됨.
8. **격자 구조 자동 감지**: `nc2bin.py`가 변수명(`U|u`, `GPH|hgt`)과 좌표 차원(2D `XLONG/XLAT` / 1D `lons/lats`)을 자동 감지해 3km(Lambert)·8km(lat-lon) 양쪽 NC를 동일 파이프라인으로 변환.
9. **8km 기본 로드 및 뷰 최적화 컨벤션**: 앱 부팅 시 8km g576 모델을 기본(`loadDataset('8km')`)으로 로드하고 카메라를 동아시아 광역 뷰로 배치. 광역 렌더링 시각 방해를 줄이기 위해 8km에서는 3D 범위 박스와 슬라이스 단면도 UI를 자동으로 숨김(`display: none`) 처리함.
10. **메모리 캐싱 (`datasetCache`)**: 한 번 로드된 데이터셋 바이너리(`binaryData`) 및 메타데이터(`metadata`)를 메모리에 보관하여 3km ↔ 8km 전환 시 네트워크 재요청 없이 즉시 전환.
11. **예보 일시(`date_utc`) 기반 Cesium 시계 동기화**: `viewer.clock.currentTime`을 데이터셋의 `metadata.date_utc`로 설정하고 시간 정지(`shouldAnimate = false`)하여 해당 시각의 태양광 위치와 일조 환경을 사실적으로 재현.
12. **독립된 시각화 모듈 구성**: 파티클 흐름(`GpuParticleEngine`), 3D 범위 박스/레벨 텍스트(`WindLegendBox`), 격자 와이어프레임(`GridVisualizer`)의 세부 책임을 분리하여 개별 토글 및 제어.
13. **고도층 분할 및 풍속 필터링**: 하층(1000–700 hPa)·중층(650–300 hPa)·상층(250–50 hPa) 레이어별 가시성 토글과 듀얼 레인지 슬라이더를 통한 풍속(0~70+ m/s) 필터링 지원.

---

## 6. 알려진 이슈 / 주의사항 (향후 개선 포인트)

| # | 이슈 | 위치 |
|---|---|---|
| 1 | `view.html`이 `/temp_data/wind3d/...` 절대 경로 fetch → `front/`를 웹 루트로 서빙해야 함 (file:// 직접 실행 불가) | `view.html` |
| 2 | `{{ MAPBOX_TOKEN }}` 플레이스홀더 — 배포 시 실제 토큰 치환 필요 | `view.html` |
| 3 | 슬라이더 입력마다 슬라이스 프리미티브 전체 재생성 (CPU 비용, 고해상도 데이터 시 느림) | `updateSlicePlanes()` |
| 4 | 기압면 라벨 DOM(24개 hPa) 하드코딩 — metadata `plev`와 동기화 안 됨 | `createLegendOverlay()` |
| 5 | `CesiumWindEngine3D.js`는 미사용 레거시 (3D 텍스처 방식 이전 설계) | `front/` |
| 6 | 30개 ftXXX 시간 스텝 배치 변환 시 `JOBS` 리스트에 항목 추가 필요 (현재 ft000 1개만) | `nc2bin.py` |
| 7 | 파티클 꼬리/머리 모두 도메인 중심에 초기화 후 셰이더에서 위치 계산 — boundingSphere는 `computeDomainBoundingSphere()`로 도메인 크기에 맞춤 (고정 3000km 제거) | `createParticlePrimitives()` |
| 8 | 8km 전체 영역(77~174°E) 데이터는 광역이므로 3D 박스/단면도는 기본 숨김 처리되며, 데이터셋별 전용 카메라 flyTo(8km: pitch -90° 직하방)로 리포지셔닝됨 | `view.html` |

---

## 7. 향후 코딩 시 체크리스트

- [ ] 데이터 포맷 계약 유지: `[U,V,W,GPH]` float32 인터리브, `dataIdx = (k*jCount + j*iCount + i) * 4`
- [ ] metadata 스키마 변경 시 `parseMetadata()` 폴백 로직과 함께 갱신
- [ ] 컬러맵 변경은 `WIND_COLOR_MAP` 한 곳만 수정 (JS + GLSL 자동 반영)
- [ ] 새 프리미티브 추가 시 `primitive.update(frameState)` + `DrawCommand` + `frameState.commandList.push` 패턴 따를 것
- [ ] 좌표 변환은 정규화(0~1) → `mix(range)` → `geodeticToCartesian` 순서 유지
- [ ] 고도 관련 렌더링은 항상 `* heightScale` 적용
- [ ] UI 컨트롤은 `window.particleEngine` / `window.legendBoxInstance` / `window.gridVisualizer` 핸들 경유
- [ ] 데이터 파일 교체 후 해당 데이터셋의 `metadata*.json` + `wind_data_3d*.bin` 둘 다 갱신 (서로 짝, `front/temp_data/wind3d/` 하위)
- [ ] 새 데이터셋 추가 시 `DATASETS` 레지스트리 + 드롭다운 `<option>` + `nc2bin.py` `JOBS` 3곳 모두 갱신
- [ ] 데이터셋 전환 시 `destroy()`로 기존 프리미티브/DOM 정리 후 신규 생성 패턴 유지
- [ ] 코드 변경 시 이 문서(`VIEWER_REFERENCE.md`)도 함께 갱신
- [ ] 앱 테스트 시 `python front/serve.py`로 실행 (토큰 치환 적용, `python -m http.server` 사용 금지)��이 적용된 상태로 테스트하기 위함)

---

## 4. data-pipeline/ — .nc → .bin 변환

### 4.1 `nc2bin.py` (3km/8km 범용)

- **JOBS 배치**: 상단 `JOBS` 리스트에 `{input, bin, json, bbox}` 정의 → `__main__`에서 순서대로 변환
  - 3km: `raw/20260914/r030_v040_...ft000.2026091412.nc` → `../front/temp_data/wind3d/wind_data_3d.bin` + `metadata.json` (BBOX: 32~42°N, 123.5~131.5°E)
  - 8km: `raw/20260922/g576_v091_...ft000.2026092118.nc` → `../front/temp_data/wind3d/wind_data_3d_8km.bin` + `metadata_8km.json` (bbox `{}` = 전체 영역)
- **변수명 자동 감지** (`VAR_CANDIDATES` + `pick_var()`):
  - `u: U|u`, `v: V|v`, `w: W|w`, `gph: GPH|hgt` (8km은 `hgt` = geopotential height, m)
  - `lon: XLONG|lon|lons|west_east`, `lat: XLAT|lat|lats|south_north`
  - `plev: PLEV|levs`
- **좌표 처리** (`extract_grid()`):
  - 2D 좌표 (3km `XLONG/XLAT`): 3D면 `[0]` 슬라이스
  - 1D 좌표 (8km `lons/lats`): `np.meshgrid(indexing='ij')` + `.T`로 2D `(j, i)` 변환
- **처리 순서**:
  1. UTC 일시 추출: NC 내부 `Times` 변수 → 실패 시 파일명 `\d{10}` 정규식 → 실패 시 기본값
  2. 좌표 그리드 추출 (2D/1D 자동 감지)
  3. BBOX 마스크로 `j_start:j_end, i_start:i_end` 인덱스 계산 (bbox 빈 `{}`면 전체)
  4. `u, v, w, gph` 변수 `[0]` (첫 시간 스텝) 크롭
  5. 등압면 추출: `PLEV` → `levs` → 24개 기본 리스트
  6. **패킹**: `column_stack(u.flatten(), v.flatten(), w.flatten(), gph.flatten())` → float32 → `.bin`
  7. `metadata.json` 생성

### 4.2 `ncHeaderViwer.py` — NC 헤더/변수 구조 검사

변환 전 원본 .nc 파일의 변수 구조를 확인하는 진단 스크립트 (xarray 기반).

- **입력**: `raw/YYYYMMDD/*.nc` (파일 상단 `file_path` 변수에 하드코딩)
  - 현행: `g576_v091_easia_prs.2byte.ft000.2026092118.nc` (동아시아 8km 격자)
  - 주석 처리: `r030_v040_easia_prs.2byte.ft000.2026091412.nc` (동아시아 3km 격자)
- **출력**:
  1. `=== 전체 변수 목록 ===` — `ds.data_vars` 전체 (46개 변수)
  2. `=== 3D 이상 차원을 가진 변수 목록 ===` — `len(dims) >= 3`인 변수 (즉 `south_north`/`west_east` 외에 고도/층 차원을 가진 변수)를 변수명 + dims 형태로 출력
- **용도**: `nc2bin.py` 실행 전 `U, V, W, GPH` 등 3D(고도) 구조 변수의 존재와 dims 확인
- ⚠️ 파일명 `ncHeaderViwer.py`는 `ncHeaderViewer.py`의 오타

### 4.3 바이너리 포맷 (중요 계약)

```
wind_data_3d.bin = Float32 인터리브 스트림
  각 그리드 포인트 (level k, j, i)마다 4개 float: [U, V, W, GPH]
  인덱스: dataIdx = (k * jCount + j * iCount + i) * 4
  총 바이트 = levelCount * jCount * iCount * 16
```
- 좌표계: `i` = 경도 방향 (lon1→lon2), `j` = 위도 방향 (lat1→lat2), `k` = 레벨 (plev[0]=1000hPa 지면 → plev[-1]=50hPa 상층)
- U, V, W: m/s (GPH: m)

### 4.4 `metadata.json` 스키마

```json
{
  "metadata": {
    "file_name": "g576_v091_easia_prs.2byte.ft003.2026092118.nc",
    "date_utc": "2026-09-14T12:00:00Z",
    "iCount": 249,
    "jCount": 367,
    "levelCount": 24,
    "bounds": { "lon1": 123.09, "lat1": 31.87, "lon2": 132.40, "lat2": 42.13 },
    "range": {
      "u":   [min, max],
      "v":   [min, max],
      "w":   [min, max],
      "gph": [min, max]
    },
    "plev": [1000, 975, 950, 925, 900, 875, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 70, 50]
  }
}
```
- `front/temp_data/wind3d/metadata.json`: 249×367×24 (3km, 디폴트)
- `front/temp_data/wind3d/metadata_8km.json`: 1158×598×24 (8km, 전체 동아시아 영역)
- `data/metadata.json`: 1050×840×24 (고해상도 대안)
- `GpuParticleEngine.parseMetadata()`는 `iCount|width`, `bounds` 배열/객체, `range.gph|height` 등 키명 폴백 지원

### 4.5 `requirements.txt`
`netCDF4, numpy, xarray, pandas, cftime` 등 (`.venv/` 가상환경 사용)

---

## 5. 주요 설계 결정 & 컨벤션

1. **파티클 애니메이션 = 직선 평류 근사**: 파티클은 스폰 지점의 (u,v,w)를 일정 시간(progress) 동안 직선 이동. 흐름장 적분(advection)은 아님. `0.0005 * speedFactor`가 progress→정규화좌표 이동 스케일.
2. **정규화 좌표(0~1) 기반**: 클립 박스, 파티클 위치, 슬라이스 위치 모두 정규화 값. 셰이더에서 `mix(range)`로 실제 좌표 변환.
3. **고도 과장**: `gph * heightScale` (기본 20x) — 20km 상층이 지구 반경 대비 보이도록.
4. **컬러맵 단일 소스**: `GpuParticleEngine.WIND_COLOR_MAP`이 JS(단면 픽셀, DOM 범례)와 GLSL(자동 생성 셰이더) 양쪽의 기준. 수정 시 양쪽 모두 자동 반영.
5. **커스텀 DrawCommand 패턴**: `primitive.update()` 오버라이드로 매 프레임 uniform 갱신 + commandList push. Cesium 표준 Appearance는 셰이더 인라인 제한 때문에 직접 제어.
6. **데이터-코드 분리**: .bin/.json은 서버 경로(`/temp_data/wind3d/`)에서 로드. 데이터 교체 = 파일 교체만.
7. **다중 데이터셋 지원**: `DATASETS` 레지스트리(key → json/bin/label) + `loadDataset(key)`로 런타임 전환. 전환 시 `destroy()`로 기존 프리미티브/DOM 정리 후 신규 생성. 4채널 `[U,V,W,GPH]` 계약은 격자(3km/8km)와 무관하게 동일 — 8km의 `hgt`가 `GPH` 슬롯에 매핑됨.
8. **격자 구조 자동 감지**: `nc2bin.py`가 변수명(`U|u`, `GPH|hgt`)과 좌표 차원(2D `XLONG/XLAT` / 1D `lons/lats`)을 자동 감지해 3km(Lambert)·8km(lat-lon) 양쪽 NC를 동일 파이프라인으로 변환.

---

## 6. 알려진 이슈 / 주의사항 (향후 개선 포인트)

| # | 이슈 | 위치 |
|---|---|---|
| 1 | `view.html`이 `/temp_data/wind3d/...` 절대 경로 fetch → `front/`를 웹 루트로 서빙해야 함 (file:// 직접 실행 불가) | `view.html` |
| 2 | `{{ MAPBOX_TOKEN }}` 플레이스홀더 — 배포 시 실제 토큰 치환 필요 | `view.html` |
| 3 | 슬라이더 입력마다 슬라이스 프리미티브 전체 재생성 (CPU 비용, 고해상도 데이터 시 느림) | `updateSlicePlanes()` |
| 4 | 기압면 라벨 DOM(24개 hPa) 하드코딩 — metadata `plev`와 동기화 안 됨 | `createLegendOverlay()` |
| 5 | `CesiumWindEngine3D.js`는 미사용 레거시 (3D 텍스처 방식 이전 설계) | `front/` |
| 6 | 30개 ftXXX 시간 스텝 배치 변환 시 `JOBS` 리스트에 항목 추가 필요 (현재 ft000 1개만) | `nc2bin.py` |
| 7 | 파티클 꼬리/머리 모두 도메인 중심에 초기화 후 셰이더에서 위치 계산 — boundingSphere는 `computeDomainBoundingSphere()`로 도메인 크기에 맞춤 (고정 3000km 제거) | `createParticlePrimitives()` |
| 8 | 8km 전체 영역(77~174°E) 데이터는 한반도 카메라 뷰에서 대부분 화면 밖 — `loadDataset()` 시 데이터셋별 카메라 flyTo로 자동 리포지셔닝 | `view.html` |

---

## 7. 향후 코딩 시 체크리스트

- [ ] 데이터 포맷 계약 유지: `[U,V,W,GPH]` float32 인터리브, `dataIdx = (k*jCount + j*iCount + i) * 4`
- [ ] metadata 스키마 변경 시 `parseMetadata()` 폴백 로직과 함께 갱신
- [ ] 컬러맵 변경은 `WIND_COLOR_MAP` 한 곳만 수정 (JS + GLSL 자동 반영)
- [ ] 새 프리미티브 추가 시 `primitive.update(frameState)` + `DrawCommand` + `frameState.commandList.push` 패턴 따를 것
- [ ] 좌표 변환은 정규화(0~1) → `mix(range)` → `geodeticToCartesian` 순서 유지
- [ ] 고도 관련 렌더링은 항상 `* heightScale` 적용
- [ ] UI 컨트롤은 `window.particleEngine` / `window.legendBoxInstance` 핸들 경유
- [ ] 데이터 파일 교체 후 해당 데이터셋의 `metadata*.json` + `wind_data_3d*.bin` 둘 다 갱신 (서로 짝, `front/temp_data/wind3d/` 하위)
- [ ] 새 데이터셋 추가 시 `DATASETS` 레지스트리 + 드롭다운 `<option>` + `nc2bin.py` `JOBS` 3곳 모두 갱신
- [ ] 데이터셋 전환 시 `destroy()`로 기존 프리미티브/DOM 정리 후 신규 생성 패턴 유지
- [ ] 코드 변경 시 이 문서(`VIEWER_REFERENCE.md`)도 함께 갱신
- [ ] 앱 테스트 시 `python front/serve.py`로 실행 (토큰 치환 적용, `python -m http.server` 사용 금지)
