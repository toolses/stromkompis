import os
import json
import glob
import re

# --- KONFIGURASJON ---
# Finn prosjektroten basert på hvor scriptet ligger (scripts/process_prices.py -> prosjektrot)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)  # Gå opp ett nivå fra scripts/ til prosjektrot

OUTPUT_FILE = os.path.join(PROJECT_ROOT, "src", "historicalRates.ts")
BASE_DATA_DIR = os.path.join(PROJECT_ROOT, "data_cache")  # Må matche det som er satt i download_prices.py

# Strømstøtte-regler (2026 nivå)
STROMSTOTTE_GRUNNLAG_EKS_MVA = 77.00 
DEKNINGSGRAD = 0.90

MONTH_NAMES = {
    "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", 
    "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aug", 
    "09": "Sep", "10": "Okt", "11": "Nov", "12": "Des"
}

def calculate_monthly_stats(json_file_path, zone):
    with open(json_file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    if not data:
        return 0, 0, None

    total_spot_ore = 0
    total_subsidy_ore = 0
    count = 0
    latest_timestamp = None

    # VIKTIG: NO4 har ikke MVA. Andre soner har 25% MVA.
    # Taket for strømstøtte er 77 øre eks mva.
    # For NO4 sammenligner vi: pris (eks mva) > 77
    # For andre sammenligner vi: pris (inkl mva) > 77 * 1.25 (96.25)
    
    mva_faktor = 1.0 if zone == "NO4" else 1.25
    effektivt_tak = STROMSTOTTE_GRUNNLAG_EKS_MVA * mva_faktor

    for hour in data:
        raw_price_nok = hour['NOK_per_kWh']
        spot_price_ore = raw_price_nok * 100 * mva_faktor
        
        # Beregn strømstøtte
        if spot_price_ore > effektivt_tak:
            subsidy = (spot_price_ore - effektivt_tak) * DEKNINGSGRAD
        else:
            subsidy = 0
        
        total_spot_ore += spot_price_ore
        total_subsidy_ore += subsidy
        count += 1
        
        if 'time_end' in hour:
            latest_timestamp = hour['time_end']

    if count == 0:
        return 0, 0, None

    return (total_spot_ore / count), (total_subsidy_ore / count), latest_timestamp

def process_year_directory(year_dir):
    results = {}
    latest_timestamp = None
    
    # Endret search_pattern for å matche ny mappestruktur
    search_pattern = os.path.join(year_dir, "**", "*_TOTAL.json")
    files = glob.glob(search_pattern, recursive=True)

    if not files:
        return results, None

    for file_path in files:
        filename = os.path.basename(file_path)
        parts = filename.split('_')
        
        try:
            date_part = parts[1] # 2025-01
            zone = parts[2]      # NO1
            month_num = date_part.split('-')[1]
        except IndexError:
            continue
        
        month_name = MONTH_NAMES.get(month_num)
        if not month_name:
            continue

        avg_spot, avg_subsidy, file_latest = calculate_monthly_stats(file_path, zone)
        
        if file_latest:
            if latest_timestamp is None or file_latest > latest_timestamp:
                latest_timestamp = file_latest

        if zone not in results:
            results[zone] = {}
        
        results[zone][month_name] = {
            "spotAvg": round(avg_spot, 2),
            "subsidyAvg": round(avg_subsidy, 2)
        }
    
    return {k: results[k] for k in sorted(results)}, latest_timestamp

def main():
    print("Starter prosessering...")
    print(f"PROJECT_ROOT: {PROJECT_ROOT}")
    print(f"BASE_DATA_DIR: {BASE_DATA_DIR}")
    print(f"BASE_DATA_DIR exists: {os.path.exists(BASE_DATA_DIR)}")
    
    # Søk i data_cache mappen
    # Prøv både med glob og manuell søk for å håndtere Unicode-tegn på Windows
    search_pattern = "strømpriser_*"
    search_path = os.path.join(BASE_DATA_DIR, search_pattern)
    print(f"Searching for: {search_path}")
    
    # Prøv glob først
    all_dirs = glob.glob(search_path)
    
    # Hvis glob ikke fant noe, prøv manuell søk
    if not all_dirs and os.path.exists(BASE_DATA_DIR):
        try:
            all_items = os.listdir(BASE_DATA_DIR)
            print(f"  Manuell søk - fant {len(all_items)} elementer i data_cache")
            for item in all_items:
                item_path = os.path.join(BASE_DATA_DIR, item)
                if os.path.isdir(item_path) and item.startswith("strømpriser_"):
                    all_dirs.append(item_path)
                    print(f"    Funnet: {item_path}")
        except Exception as e:
            print(f"  Kunne ikke lese mappe: {e}")
    
    print(f"Found directories: {all_dirs}")
    
    years_found = []
    ts_content_parts = []
    
    if not all_dirs:
        print(f"WARNING: Ingen strømpriser_* mapper funnet i {BASE_DATA_DIR}")
        print(f"Prøver å liste innhold i {BASE_DATA_DIR}:")
        if os.path.exists(BASE_DATA_DIR):
            try:
                contents = os.listdir(BASE_DATA_DIR)
                print(f"  Innhold ({len(contents)} elementer): {contents}")
                if contents:
                    print(f"  Detaljer:")
                    for item in contents:
                        item_path = os.path.join(BASE_DATA_DIR, item)
                        is_dir = os.path.isdir(item_path)
                        print(f"    - {item} ({'mappe' if is_dir else 'fil'})")
            except Exception as e:
                print(f"  Kunne ikke lese mappe: {e}")
        else:
            print(f"  Mappen eksisterer ikke!")
    
    ts_header = """// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated by scripts/process_prices.py

export interface MonthlyRate {
  spotAvg: number;
  subsidyAvg: number;
}
"""
    ts_content_parts.append(ts_header)

    overall_latest_timestamp = None
    rates_by_year = {}
    
    for d in all_dirs:
        match = re.search(r"strømpriser_(\d{4})", os.path.basename(d))
        if not match:
            continue
            
        year = int(match.group(1))
        years_found.append(year)
        
        year_data, latest_timestamp = process_year_directory(d)
        
        if year_data:
            json_str = json.dumps(year_data, indent=2)
            ts_part = f"export const HISTORICAL_RATES_{year}: Record<string, Record<string, MonthlyRate>> = {json_str};\n"
            ts_content_parts.append(ts_part)
            
            # Lagre for HISTORICAL_RATES_BY_YEAR
            rates_by_year[year] = year_data
            
            if latest_timestamp:
                if overall_latest_timestamp is None or latest_timestamp > overall_latest_timestamp:
                    overall_latest_timestamp = latest_timestamp

    years_found.sort()
    
    if not years_found:
        print("FEIL: Ingen år med data funnet! Sjekk at data_cache mappen eksisterer og inneholder strømpriser_* mapper.")
        print(f"Prøv å kjøre scripts/download_prices.py først for å laste ned data.")
        # Skriv en minimal gyldig fil for å unngå kompileringsfeil
        print("Skriver minimal gyldig fil for å unngå kompileringsfeil...")
        ts_content_parts.append("export const AVAILABLE_YEARS: number[] = [];")
        ts_content_parts.append("\nexport const HISTORICAL_RATES_BY_YEAR: Record<number, Record<string, Record<string, MonthlyRate>>> = {};")
        ts_content_parts.append("\nexport const LATEST_TIMESTAMP = \"\";")
        
        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            f.write("\n".join(ts_content_parts))
        
        print(f"Skrev minimal fil til {OUTPUT_FILE}")
        return
    
    years_json = json.dumps(years_found)
    ts_content_parts.append(f"export const AVAILABLE_YEARS = {years_json};")
    
    # Eksporter HISTORICAL_RATES_BY_YEAR for dynamisk tilgang
    if rates_by_year:
        rates_by_year_json = json.dumps(rates_by_year, indent=2)
        ts_content_parts.append(f"\nexport const HISTORICAL_RATES_BY_YEAR: Record<number, Record<string, Record<string, MonthlyRate>>> = {rates_by_year_json};")
    else:
        print("ADVARSEL: Ingen rates_by_year data, men fortsetter med tom objekt...")
        ts_content_parts.append(f"\nexport const HISTORICAL_RATES_BY_YEAR: Record<number, Record<string, Record<string, MonthlyRate>>> = {{}};")
    
    if overall_latest_timestamp:
        ts_content_parts.append(f"\nexport const LATEST_TIMESTAMP = {json.dumps(overall_latest_timestamp)};")
    else:
        print("ADVARSEL: Ingen latest_timestamp funnet...")

    # Sørg for at src katalogen finnes
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write("\n".join(ts_content_parts))

    print(f"Ferdig! Oppdaterte {OUTPUT_FILE}")
    print(f"  - Funnet {len(years_found)} år: {years_found}")
    print(f"  - Antall rates_by_year entries: {len(rates_by_year)}")

if __name__ == "__main__":
    main()