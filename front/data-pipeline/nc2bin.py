import os
import re
import json
import netCDF4 as nc
import numpy as np
from datetime import datetime, timezone

# ====================================================
# [설정 1] 변환 작업 목록 (JOBS)
#   input : 입력 .nc 경로 (이 스크립트 디렉터리 기준)
#   bin   : 출력 .bin 경로
#   json  : 출력 metadata.json 경로
#   bbox  : 크롭 영역 (빈 {} 이면 전체 영역)
# ====================================================
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

JOBS = [
    {
        # 3km 격자 (r030 동아시아) — 한반도 BBOX 크롭 (현행 데이터)
        "input": "raw/20260914/r030_v040_easia_prs.2byte.ft000.2026091412.nc",
        "bin":   "../front/temp_data/wind3d/wind_data_3d.bin",
        "json":  "../front/temp_data/wind3d/metadata.json",
        "bbox": {
            "min_lat": 32.0,   # 남단: 제주도 남쪽 해상
            "max_lat": 42.0,   # 북단: 백두산 및 함경북도 북단
            "min_lon": 123.5,  # 서단: 서해 안쪽
            "max_lon": 131.5,  # 동단: 울릉도/독도 및 동해 중앙
        },
    },
    {
        # 8km 격자 (g576 동아시아) — 전체 영역 (크롭 없음)
        "input": "raw/20260922/g576_v091_easia_prs.2byte.ft000.2026092118.nc",
        "bin":   "../front/temp_data/wind3d/wind_data_3d_8km.bin",
        "json":  "../front/temp_data/wind3d/metadata_8km.json",
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
    NC 파일 내부 Times 변수 또는 파일명(YYYYMMDDHH)에서 원본 UTC 일시 추출 (ISO8601 포맷)
    """
    file_name = os.path.basename(file_path)

    # 1. NC 파일 내부 Times 변수 확인
    if 'Times' in ds.variables:
        try:
            time_str = ds.variables['Times'][0].tobytes().decode('utf-8').strip()
            # 예: "2026-09-14_12:00:00" -> ISO UTC 포맷
            dt = datetime.strptime(time_str.replace('_', ' '), '%Y-%m-%d %H:%M:%S')
            return dt.strftime('%Y-%m-%dT%H:%M:%SZ')
        except Exception:
            pass

    # 2. 파일명 패턴 정규식 추출 (예: 2026091412)
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


def convert_nc_for_gpu_particle(nc_file_path, output_bin_path, output_json_path, bbox=None):
    print(f"--> NetCDF 파일 읽는 중: {nc_file_path}")
    ds = nc.Dataset(nc_file_path)

    file_name = os.path.basename(nc_file_path)
    utc_date = parse_utc_date_from_nc(ds, nc_file_path)

    # 1. 2D 경도/위도 좌표 그리드 추출 (2D/1D 자동 감지)
    lons, lats = extract_grid(ds)

    # 2. BBOX 슬라이싱 인덱스 계산
    j_start, j_end, i_start, i_end = compute_bbox_slice(lons, lats, bbox)

    # 3. 데이터 크롭 및 패킹 (변수명 자동 감지)
    u_name = pick_var(ds, "u")
    v_name = pick_var(ds, "v")
    w_name = pick_var(ds, "w")
    gph_name = pick_var(ds, "gph")

    u_data = ds.variables[u_name][0][:, j_start:j_end, i_start:i_end]
    v_data = ds.variables[v_name][0][:, j_start:j_end, i_start:i_end]
    w_data = ds.variables[w_name][0][:, j_start:j_end, i_start:i_end]
    gph_data = ds.variables[gph_name][0][:, j_start:j_end, i_start:i_end]

    cropped_lons = lons[j_start:j_end, i_start:i_end]
    cropped_lats = lats[j_start:j_end, i_start:i_end]

    actual_lon1 = float(np.min(cropped_lons))
    actual_lat1 = float(np.min(cropped_lats))
    actual_lon2 = float(np.max(cropped_lons))
    actual_lat2 = float(np.max(cropped_lats))

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

    levels, cropped_j, cropped_i = u_data.shape

    packed_array = np.column_stack((
        u_data.astype(np.float32).flatten(),
        v_data.astype(np.float32).flatten(),
        w_data.astype(np.float32).flatten(),
        gph_data.astype(np.float32).flatten()
    )).astype(np.float32)

    os.makedirs(os.path.dirname(os.path.abspath(output_bin_path)), exist_ok=True)
    with open(output_bin_path, 'wb') as f:
        f.write(packed_array.tobytes())

    # 5. UTC 일시 원본 정보를 포함한 metadata.json 작성
    metadata = {
        "metadata": {
            "file_name": file_name,
            "date_utc": utc_date,
            "iCount": cropped_i,
            "jCount": cropped_j,
            "levelCount": levels,
            "bounds": {
                "lon1": actual_lon1,
                "lat1": actual_lat1,
                "lon2": actual_lon2,
                "lat2": actual_lat2
            },
            "range": {
                "u": [float(np.min(u_data)), float(np.max(u_data))],
                "v": [float(np.min(v_data)), float(np.max(v_data))],
                "w": [float(np.min(w_data)), float(np.max(w_data))],
                "gph": [float(np.min(gph_data)), float(np.max(gph_data))]
            },
            "plev": [int(p) for p in plev_data]
        }
    }

    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=4, ensure_ascii=False)

    ds.close()

    print(f"--> [완료] 파일명: {file_name} | UTC 원본 일시: {utc_date}")
    print(f"--> [크롭] iCount={cropped_i}, jCount={cropped_j}, levelCount={levels}")
    print(f"--> [범위] lon {actual_lon1:.2f}~{actual_lon2:.2f}, lat {actual_lat1:.2f}~{actual_lat2:.2f}")
    print(f"--> [출력] {output_bin_path} ({os.path.getsize(output_bin_path) / 1024 / 1024:.1f} MB)")
    print(f"--> [출력] {output_json_path}")


if __name__ == "__main__":
    for job in JOBS:
        convert_nc_for_gpu_particle(
            _resolve(job["input"]),
            _resolve(job["bin"]),
            _resolve(job["json"]),
            job.get("bbox", {})
        )
        print()
