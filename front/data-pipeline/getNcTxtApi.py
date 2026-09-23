import os
import time
import logging
import requests

# ---------------------------------------------------------
# 1. 설정 항목
# ---------------------------------------------------------
AUTH_KEY = "U6GB6EMjTa2hgehDI92tqA"  # 실제 발급받은 인증키 입력
SAVE_DIR = "./kim_data"     # 저장된 디렉토리 경로

TMFC = "2026092300"         # 예측 발표 시각 (YYYYMMDDHH)
HF = "0"                    # 예측 시간 (+hour)

# 대상 변수 및 고도 레이어
NAMES = ["u", "v", "w", "hgt"]
LEVELS = [
    1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 
    500, 450, 400, 350, 300, 250, 200, 150, 100, 70, 50, 30
]

SUB_GRID = "1200,1320,1800,1680" 

MAX_RETRIES = 3             # 항목당 최대 재시도 횟수
DELAY_SECONDS = 3.5         # 일반 대기 시간 (초)
BASE_URL = "https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-kim_nc_xy_txt2"

# ---------------------------------------------------------
# 2. 로깅 설정
# ---------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(SAVE_DIR, "retry.log")),
        logging.StreamHandler()
    ]
)

# ---------------------------------------------------------
# 3. 실패 항목 재수집 실행
# ---------------------------------------------------------
def retry_failed_downloads():
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0 (KMA-API-Automation-Script)"})
    
    # 누락되었거나 크기가 0인 파일 목록 탐색
    target_tasks = []
    for name in NAMES:
        for level in LEVELS:
            filename = f"KIM_NE57_{TMFC}_hf{HF}_{name}_lev{level}.txt"
            filepath = os.path.join(SAVE_DIR, filename)
            
            # 파일이 없거나 크기가 0인 경우 타겟에 추가
            if not os.path.exists(filepath) or os.path.getsize(filepath) == 0:
                target_tasks.append((name, level, filename, filepath))

    if not target_tasks:
        logging.info("누락되거나 실패한 파일이 없습니다. 모든 데이터가 정상 수집된 상태입니다.")
        return

    logging.info(f"총 {len(target_tasks)}개의 누락/실패 파일 재수집을 시작합니다.")

    for idx, (name, level, filename, filepath) in enumerate(target_tasks, 1):
        params = {
            "group": "KIMG",
            "nwp": "NE57",
            "data": "P",
            "name": name,
            "map": "S",
            "sub": SUB_GRID,
            "tmfc": TMFC,
            "hf": HF,
            "disp": "A",
            "level": str(level),
            "help": "1",
            "authKey": AUTH_KEY
        }

        success = False
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                logging.info(f"[{idx}/{len(target_tasks)}] 재시도 중 ({attempt}/{MAX_RETRIES}): var={name}, level={level}")
                response = session.get(BASE_URL, params=params, timeout=60)
                
                if response.status_code == 200 and ("# fname:" in response.text or "-1." in response.text or "0." in response.text):
                    with open(filepath, "w", encoding="utf-8") as f:
                        f.write(response.text)
                    logging.info(f"   -> 저장 성공 ({len(response.content) / 1024:.1f} KB)")
                    success = True
                    break
                else:
                    logging.warning(f"   -> HTTP {response.status_code} 실패. (시도 {attempt}/{MAX_RETRIES})")

            except Exception as e:
                logging.error(f"   -> 요청 중 예외 발생: {e} (시도 {attempt}/{MAX_RETRIES})")

            # 재시도 전 대기 시간 (시도할수록 대기 시간이 늘어남: 5초, 10초, 15초...)
            time.sleep(attempt * 5)

        if not success:
            logging.error(f"   -> 최종 실패: {filename} (최대 재시도 횟수 초과)")

        time.sleep(DELAY_SECONDS)

    logging.info("재수집 작업 완료.")

if __name__ == "__main__":
    retry_failed_downloads()

