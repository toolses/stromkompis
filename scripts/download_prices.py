import os
import json
import time
import requests
from datetime import date
import calendar

# --- KONFIGURASJON ---
# Henter automatisk år fra 2024 til og med inneværende år.
START_YEAR = 2024
CURRENT_YEAR = date.today().year
YEARS_TO_CHECK = list(range(START_YEAR, CURRENT_YEAR + 1))

ZONES = ["NO1", "NO2", "NO3", "NO4", "NO5"]
BASE_URL = "https://www.hvakosterstrommen.no/api/v1/prices"

# Vi lagrer data i en mappe 'data_cache' i roten for å holde det ryddig
BASE_DIR = "data_cache"

# Innstillinger for retry/feilhåndtering
MAX_RETRIES = 5
RETRY_DELAY_SECONDS = 5
RATE_LIMIT_SLEEP = 0.1

def fetch_url(url):
    attempt = 0
    while attempt < MAX_RETRIES:
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                return response.json()
            if response.status_code == 404:
                return None
            if response.status_code == 429 or 500 <= response.status_code < 600:
                time.sleep(RETRY_DELAY_SECONDS)
                attempt += 1
                continue
            return None
        except requests.exceptions.RequestException:
            time.sleep(RETRY_DELAY_SECONDS)
            attempt += 1
    return None

def save_json(filepath, data):
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_json(filepath):
    if not os.path.exists(filepath):
        return None
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None

def main():
    today = date.today()
    
    if not os.path.exists(BASE_DIR):
        os.makedirs(BASE_DIR)

    for year in YEARS_TO_CHECK:
        print(f"Starter nedlasting for {year}...")
        year_dir = os.path.join(BASE_DIR, f"strømpriser_{year}")
        if not os.path.exists(year_dir):
            os.makedirs(year_dir)

        # Gå igjennom alle måneder (1-12)
        for month in range(1, 13):
            month_str = f"{month:02d}"
            
            # Grov sjekk: Er hele måneden i fremtiden?
            first_day_of_month = date(year, month, 1)
            if first_day_of_month > today:
                continue # Hopp over fremtidige måneder

            month_dir = os.path.join(year_dir, month_str)
            if not os.path.exists(month_dir):
                os.makedirs(month_dir)

            monthly_aggregated_data = {zone: [] for zone in ZONES}
            num_days = calendar.monthrange(year, month)[1]
            reached_future = False

            print(f"\nBehandler {year}-{month_str}...")

            for day in range(1, num_days + 1):
                current_date_obj = date(year, month, day)

                if current_date_obj > today:
                    reached_future = True
                    break

                day_str = f"{day:02d}"
                date_str = f"{year}-{month_str}-{day_str}"
                
                for zone in ZONES:
                    filename = f"{date_str}_{zone}.json"
                    filepath = os.path.join(month_dir, filename)
                    
                    data = load_json(filepath)
                    if not data:
                        url = f"{BASE_URL}/{year}/{month_str}-{day_str}_{zone}.json"
                        # print(f"Laster ned {date_str} [{zone}]...") # Uncomment for debug
                        data = fetch_url(url)
                        if data:
                            save_json(filepath, data)
                            time.sleep(RATE_LIMIT_SLEEP)
                    
                    if data:
                        monthly_aggregated_data[zone].extend(data)

            # Lagre oppsummering hvis vi har data
            for zone in ZONES:
                if monthly_aggregated_data[zone]:
                    summary_filename = f"MAANED_{year}-{month_str}_{zone}_TOTAL.json"
                    summary_path = os.path.join(month_dir, summary_filename)
                    save_json(summary_path, monthly_aggregated_data[zone])

    print("\nNedlasting ferdig.")

if __name__ == "__main__":
    main()