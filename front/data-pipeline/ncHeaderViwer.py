import xarray as xr

# 지역모델 동아시아 3km 격자 데이터
# file_path = "./raw/20260914/r030_v040_easia_prs.2byte.ft000.2026091412.nc" 
# 지역모델 동아시아 8km 격자 데이터
file_path = "./raw/20260922/g576_v091_easia_prs.2byte.ft000.2026092118.nc"

ds = xr.open_dataset(file_path)

# 전체 46개 변수 목록 출력
print("=== 전체 변수 목록 ===")
print(list(ds.data_vars.keys()))

# 3D 차원(고도 축)을 가진 변수들만 찾아내기
print("\n=== 3D 이상 차원을 가진 변수 목록 ===")
for var_name in ds.data_vars:
    # dims에 south_north, west_east 외에 고도/층 차원이 포함되어 있는지 확인
    if len(ds[var_name].dims) >= 3:
        print(f"변수명: {var_name:<15} | 차원(Dims): {ds[var_name].dims}")

