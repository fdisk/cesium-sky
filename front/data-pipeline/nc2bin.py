import os
import re
import json
import gzip
import netCDF4 as nc
import numpy as np
from datetime import datetime, timezone, timedelta

# ====================================================
# [설정 1] 변환 작업 목록 (JOBS)
#   model    : 모델명 (r030 / g576)
#   initTime : 초기화 시각 YYYYMMDDHH (동일 묶음의 기준)
#   inputs   : (선택) 명시적 .nc 경로 리스트 (스크립트 디렉터리 기준)
#              미지정 시 raw/ 디렉터리 자동 스캔 → (model, initTime) 그룹핑
#   bbox     : 크롭 영역 (빈 {} 이면 전체 영역)
#
# 출력: 단일 번들 파일 wind_bundle_<model>_<initTime>.bin.gz
#   = JSON 헤더(1라인) + '\n' + 프레임별 gzip 멤버 N개 (multi-member gzip)
# ====================================================
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(SCRIPT_DIR, "raw")

JOBS = [
    {
        # 3km 격자 (r030 동아시아) — 전체 영역 (크롭 없음)
        "model": "r030",
        "initTime": "2026092118",
        "bbox": {},
    },
    {
        # 8km 격자 (g576 동아시아) — 전체 영역 (크롭 없음)
        "model": "g576",
        "initTime": "2026092118",
        "bbox": {},
    },
]

# ====================================================
# [설정 2] 변수명 후보 (순서대로 자동 감지)
#   3km(r030): U/V/W/GPH, XLONG/XLAT(2D), PLEV
#   8km(g576): u/v/w/hgt, lons/lats(1D), levs
# ====================================================
VAR_CANDIDATES = {
    "u":    ("U", "u"),
    "v":    ("V", "v"),
    "w":    ("W", "w"),
    "gph":  ("GPH", "hgt"),
    "lon":  ("XLONG", "lon", "lons", "west_east"),
    "lat":  ("XLAT", "lat", "lats", "south_north"),
    "plev": ("PLEV", "levs"),
}

DEFAULT_PLEV = [1000, 975, 950, 925, 900, 850, 800, 750, 700,
                650, 600, 550, 500, 450, 400, 350, 300, 250,
                200, 150, 100, 70, 50, 30]

# 프레임 채널 순서 (인터리브 레이아웃: [u, v, w, gph] × N 포인트)
CHANNELS = ("u", "v", "w", "gph")

# raw/ 파일명 패턴: <model>_v<ver>_...ft<XXX>.<YYYYMMDDHH>.nc
NC_FILE_PATTERN = re.compile(
    r'^(?P<model>[a-z]+\d+)_v\d+_.+\.ft(?P<ft>\d{3})\.(?P<init>\d{10})\.nc$'
)


def _resolve(path):
    """스크립트 디렉터리 기준 상대경로를 절대경로로 변환"""
    return path if os.path.isabs(path) else os.path.join(SCRIPT_DIR, path)


def pick_var(ds, key):
    """VAR_CANDIDATES[key] 후보 중 NC 파일에 존재하는 변수명 반환"""
    for name in VAR_CANDIDATES[key]:
        if name in ds.variables:
            return name
    raise KeyError(f"'{key}' 후보 변수 {VAR_CANDIDATES[key]} 중 NC 파일에 존재하는 변수 없음")


def parse_utc_date_from_nc(ds, file_path):
    """
    NC 파일 내부의 유효 시각(valid time)을 ISO8601 UTC 포맷으로 추출
    우선순위:
      1. Times 변수 (r030 스타일, 예: "2026-09-21_21:00:00")
      2. time 변수 + units (g576/CF-1.7 스타일, 예: 3.0 "hours since 2026-09-21 18:00:00")
      3. current_time 전역 속성 (g576, 예: "MON SEP 21 21:00:00 2026")
      4. 파일명 패턴 (예: 2026092118) — 주의: 파일명은 초기화 시각일 수 있음
    """
    file_name = os.path.basename(file_path)

    # 1. Times 변수 (문자열 유효 시각)
    if 'Times' in ds.variables:
        try:
            time_str = ds.variables['Times'][0].tobytes().decode('utf-8').strip()
            # 예: "2026-09-14_12:00:00" -> ISO UTC 포맷
            dt = datetime.strptime(time_str.replace('_', ' '), '%Y-%m-%d %H:%M:%S')
            return dt.strftime('%Y-%m-%dT%H:%M:%SZ')
        except Exception:
            pass

    # 2. time 변수 + units (CF-1.7: "hours/minutes/seconds since <base>")
    if 'time' in ds.variables:
        try:
            units = ds.variables['time'].getncattr('units')
            m = re.match(r'(\w+)\s+since\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})', units)
            if m:
                base = datetime.fromisoformat(m.group(2))
                value = float(ds.variables['time'][0])
                unit = m.group(1)
                if unit.startswith('hour'):
                    delta = timedelta(hours=value)
                elif unit.startswith('minute'):
                    delta = timedelta(minutes=value)
                else:  # seconds
                    delta = timedelta(seconds=value)
                return (base + delta).strftime('%Y-%m-%dT%H:%M:%SZ')
        except Exception:
            pass

    # 3. current_time 전역 속성 (g576, 예: "MON SEP 21 21:00:00 2026")
    if 'current_time' in ds.ncattrs():
        try:
            dt = datetime.strptime(ds.getncattr('current_time'), '%a %b %d %H:%M:%S %Y')
            return dt.strftime('%Y-%m-%dT%H:%M:%SZ')
        except Exception:
            pass

    # 4. 파일명 패턴 정규식 추출 (예: 2026091412)
    match = re.search(r'(\d{10})', file_name)
    if match:
        date_digits = match.group(1)
        dt = datetime.strptime(date_digits, '%Y%m%d%H')
        return dt.strftime('%Y-%m-%dT%H:%M:%SZ')

    return "2026-09-14T12:00:00Z"


def extract_grid(ds):
    """
    경도/위도 좌표 2D 그리드 추출.
    - 2D 좌표 (3km: XLONG/XLAT): [0] 슬라이스
    - 1D 좌표 (8km: lons/lats): meshgrid로 2D 변환
    반환: (lons2d, lats2d)  shape = (j_count, i_count)
    """
    lon_var = pick_var(ds, "lon")
    lat_var = pick_var(ds, "lat")

    lons = ds.variables[lon_var][:]
    lats = ds.variables[lat_var][:]

    if lons.ndim == 3:
        lons = lons[0]
    if lats.ndim == 3:
        lats = lats[0]

    if lons.ndim == 1 and lats.ndim == 1:
        # 1D 좌표 (8km g576): meshgrid로 2D 변환 (indexing='ij' → [j, i])
        lons, lats = np.meshgrid(lons, lats, indexing='ij')
        lons = lons.T  # (lats_n, lons_n) = (j, i)
        lats = lats.T
    elif lons.ndim != 2 or lats.ndim != 2:
        raise ValueError(f"좌표 변수 차원 오류: lons.ndim={lons.ndim}, lats.ndim={lats.ndim}")

    return lons, lats


def compute_bbox_slice(lons, lats, bbox):
    """
    TARGET_BBOX 슬라이싱 인덱스 계산.
    bbox가 비어있으면 전체 영역 (0, j_count, 0, i_count) 반환.
    """
    j_count, i_count = lons.shape

    if bbox and len(bbox) == 4:
        lat_mask = (lats >= bbox["min_lat"]) & (lats <= bbox["max_lat"])
        lon_mask = (lons >= bbox["min_lon"]) & (lons <= bbox["max_lon"])
        bbox_mask = lat_mask & lon_mask

        j_indices = np.where(np.any(bbox_mask, axis=1))[0]
        i_indices = np.where(np.any(bbox_mask, axis=0))[0]

        j_start, j_end = j_indices[0], j_indices[-1] + 1
        i_start, i_end = i_indices[0], i_indices[-1] + 1
    else:
        j_start, j_end = 0, j_count
        i_start, i_end = 0, i_count

    return j_start, j_end, i_start, i_end


# ====================================================
# [자동 스캔] raw/ 디렉터리 → (model, initTime) 그룹핑
# ====================================================
def scan_raw_groups(raw_dir=RAW_DIR, model=None, init_time=None):
    """
    raw/ 하위 디렉터리(backup 제외)의 .nc 파일을 파일명 패턴으로 스캔해
    (model, initTime) → [(ft, path), ...] (ft 오름차순) 그룹으로 반환.
    model / init_time 필터 지정 시 해당 그룹만 반환.
    """
    groups = {}
    if not os.path.isdir(raw_dir):
        return groups

    for entry in sorted(os.listdir(raw_dir)):
        sub = os.path.join(raw_dir, entry)
        if not os.path.isdir(sub) or entry == "backup":
            continue
        for fname in sorted(os.listdir(sub)):
            m = NC_FILE_PATTERN.match(fname)
            if not m:
                continue
            g_model = m.group("model")
            g_init = m.group("init")
            if model and g_model != model:
                continue
            if init_time and g_init != init_time:
                continue
            path = os.path.join(sub, fname)
            groups.setdefault((g_model, g_init), []).append((int(m.group("ft")), path))

    for key in groups:
        groups[key].sort(key=lambda x: x[0])
    return groups


# ====================================================
# [프레임 변환] NC → float32 채널 + 메타데이터
# ====================================================
def read_frame_from_nc(nc_file_path, bbox=None):
    """
    NC 파일 1개(=프레임 1개)를 읽어 float32 채널 데이터와 메타데이터를 반환.
    반환 dict:
      file_name, valid_time, iCount, jCount, levelCount,
      bounds{lon1,lat1,lon2,lat2}, plev, gphByLevel,
      channels: {u,v,w,gph} → float32 (level, j, i) 배열
    """
    print(f"--> NetCDF 파일 읽는 중: {nc_file_path}")
    ds = nc.Dataset(nc_file_path)

    file_name = os.path.basename(nc_file_path)
    valid_time = parse_utc_date_from_nc(ds, nc_file_path)

    # 1. 2D 경도/위도 좌표 그리드 추출 (2D/1D 자동 감지)
    lons, lats = extract_grid(ds)

    # 2. BBOX 슬라이싱 인덱스 계산
    j_start, j_end, i_start, i_end = compute_bbox_slice(lons, lats, bbox)

    # 3. 데이터 크롭 (변수명 자동 감지)
    channels = {}
    for ch in CHANNELS:
        var_name = pick_var(ds, ch)
        channels[ch] = ds.variables[var_name][0][:, j_start:j_end, i_start:i_end].astype(np.float32)

    cropped_lons = lons[j_start:j_end, i_start:i_end]
    cropped_lats = lats[j_start:j_end, i_start:i_end]

    levels, j_count, i_count = channels["u"].shape

    # 4. 등압면 추출 (PLEV → levs → 기본 리스트)
    plev_var = None
    for name in VAR_CANDIDATES["plev"]:
        if name in ds.variables:
            plev_var = name
            break
    if plev_var is not None:
        plev_data = ds.variables[plev_var][:]
    else:
        plev_data = DEFAULT_PLEV

    # 5. 레벨별 평균 기압고도 (m)
    gph_by_level = [float(np.mean(channels["gph"][k])) for k in range(levels)]

    ds.close()

    return {
        "file_name": file_name,
        "valid_time": valid_time,
        "iCount": i_count,
        "jCount": j_count,
        "levelCount": levels,
        "bounds": {
            "lon1": float(np.min(cropped_lons)),
            "lat1": float(np.min(cropped_lats)),
            "lon2": float(np.max(cropped_lons)),
            "lat2": float(np.max(cropped_lats)),
        },
        "plev": [int(p) for p in plev_data],
        "gphByLevel": gph_by_level,
        "channels": channels,
    }


# ====================================================
# [uint16 스케일링] 프레임별 min/max → uint16 인터리브 배열
# ====================================================
def pack_uint16_frame(channels):
    """
    float32 채널 dict → (uint16 인터리브 배열, 스케일 파라미터 dict)
    - 레이아웃: 포인트 단위 [u, v, w, gph] 인터리브 (Float32 .bin과 동일 구조)
    - 채널별: uint16 = round((x - min) / step), step = (max - min) / 65534
    - 복원: x = min + uint16 * step
    - 주의: 양자화 값 0~65534는 uint16 범위 — int16(최대 32767)이면 상단 절반이 랩어라운드
    """
    n_points = channels["u"].size
    packed = np.empty((n_points, len(CHANNELS)), dtype=np.uint16)
    scale = {}

    for ci, ch in enumerate(CHANNELS):
        arr = channels[ch]
        mn = float(arr.min())
        mx = float(arr.max())
        if mx - mn < 1e-9:
            mx = mn + 1e-9
        step = (mx - mn) / 65534.0
        scale[ch] = {"min": mn, "max": mx, "step": step}
        q = np.clip(np.round((arr - mn) / step), 0, 65534).astype(np.uint16)
        packed[:, ci] = q.flatten()

    return np.ascontiguousarray(packed), scale


def restore_float32_frame(uint16_bytes, scale):
    """uint16 바이트 + 스케일 파라미터 → Float32 인터리브 배열 (정밀도 검증용)"""
    arr = np.frombuffer(uint16_bytes, dtype=np.uint16).reshape(-1, len(CHANNELS))
    out = np.empty(arr.shape, dtype=np.float32)
    for ci, ch in enumerate(CHANNELS):
        s = scale[ch]
        out[:, ci] = (arr[:, ci].astype(np.float32) * s["step"]) + s["min"]
    return out


# ====================================================
# [번들 변환] N개 NC → 단일 파일 (JSON 헤더 + multi-member gzip)
# ====================================================
def convert_bundle(job, out_dir):
    """
    job = {model, initTime, inputs?, bbox?}
    출력: <out_dir>/wind_bundle_<model>_<initTime>.bin.gz (단일 파일)
      = 1라인 JSON 헤더 + b'\\n' + 프레임별 gzip 멤버 N개 (multi-member gzip)
      - 헤더: {model, initTime, dtype, layout, channels, iCount, jCount,
               levelCount, bounds, plev, frames:[{ft, validTime, gzOffset,
               gzSize, scale, gphByLevel}]}
      - gzOffset/gzSize: 멤버 영역(헤더+\\n 이후) 기준 상대 오프셋/크기
        → 헤더 크기와 무관하게 오프셋이 유효 (순환 의존 회피)
    """
    model = job["model"]
    init_time = job["initTime"]
    bbox = job.get("bbox", {})

    # 입력 파일 결정: 명시적 inputs 또는 raw/ 자동 스캔
    inputs = job.get("inputs")
    if inputs:
        frame_paths = [(None, _resolve(p)) for p in inputs]
    else:
        groups = scan_raw_groups(model=model, init_time=init_time)
        key = (model, init_time)
        if key not in groups or not groups[key]:
            print(f"[에러] raw/ 에서 {model}/{init_time} 묶음 파일 없음 — 스킵")
            return
        frame_paths = groups[key]

    # ft 추출 (inputs 명시 시 파일명에서)
    frames = []
    for ft, path in frame_paths:
        if ft is None:
            m = NC_FILE_PATTERN.match(os.path.basename(path))
            ft = int(m.group("ft")) if m else 0
        frames.append((ft, path))
    frames.sort(key=lambda x: x[0])

    print(f"== {model} {init_time} 번들 변환 ({len(frames)}프레임) ==")
    os.makedirs(out_dir, exist_ok=True)

    frame_metas = []
    members = []
    common = None
    offset = 0

    for idx, (ft, path) in enumerate(frames):
        frame = read_frame_from_nc(path, bbox)

        # 공통 격자 정보 검증 (첫 프레임 기준)
        if common is None:
            common = {
                "iCount": frame["iCount"],
                "jCount": frame["jCount"],
                "levelCount": frame["levelCount"],
                "bounds": frame["bounds"],
                "plev": frame["plev"],
            }
        else:
            for k in ("iCount", "jCount", "levelCount"):
                if common[k] != frame[k]:
                    print(f"[경고] {os.path.basename(path)} 격자 크기 불일치: "
                          f"{k} {common[k]} != {frame[k]}")

        # uint16 스케일링 + gzip 멤버 압축 (메모리 버퍼링)
        uint16_arr, scale = pack_uint16_frame(frame["channels"])
        raw_bytes = uint16_arr.tobytes()
        member = gzip.compress(raw_bytes)

        # 정밀도 검증 (첫 프레임만 샘플링)
        if idx == 0:
            restored = restore_float32_frame(raw_bytes, scale)
            for ci, ch in enumerate(CHANNELS):
                orig = frame["channels"][ch].flatten()
                err = float(np.max(np.abs(restored[:, ci] - orig)))
                print(f"    [정밀도] {ch} max|Δ| = {err:.6f}")

        frame_metas.append({
            "ft": ft,
            "validTime": frame["valid_time"],
            "gzOffset": offset,
            "gzSize": len(member),
            "scale": scale,
            "gphByLevel": frame["gphByLevel"],
        })
        members.append(member)
        offset += len(member)
        print(f"    ft{ft:03d} {frame['valid_time']} → gzip 멤버 "
              f"({len(member) / 1024 / 1024:.1f} MB, offset={offset - len(member)})")

    # 단일 번들 파일: 1라인 JSON 헤더 + b'\n' + gzip 멤버 N개
    header = {
        "model": model,
        "initTime": init_time,
        "dtype": "uint16",
        "layout": "interleaved_uvwgph",
        "channels": list(CHANNELS),
        **common,
        "frames": frame_metas,
    }
    header_bytes = json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    bundle_path = os.path.join(out_dir, f"wind_bundle_{model}_{init_time}.bin.gz")
    with open(bundle_path, "wb") as f:
        f.write(header_bytes)
        f.write(b"\n")
        for member in members:
            f.write(member)

    total_size = os.path.getsize(bundle_path)
    print(f"--> [완료] {model}/{init_time}: {len(frames)}프레임, "
          f"단일 파일 {total_size / 1024 / 1024:.1f} MB")
    print(f"--> [출력] {bundle_path}")
    print()


if __name__ == "__main__":
    # 출력 경로: front/temp_data/wind3d/<model>/<initTime>/  (스크립트 기준 ../temp_data/...)
    WIND3D_ROOT = os.path.join(SCRIPT_DIR, "..", "temp_data", "wind3d")

    for job in JOBS:
        model = job.get("model", "wind")
        init_time = job.get("initTime", "latest")
        out_dir = os.path.join(WIND3D_ROOT, model, init_time)

        convert_bundle(job, out_dir)
