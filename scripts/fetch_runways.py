import csv
import json
import urllib.request
import os

if not os.path.exists("scripts"):
    os.makedirs("scripts")

print("Loading airports.json...")
with open("data/airports.json", "r", encoding="utf-8") as f:
    airports_data = json.load(f)

valid_icaos = {apt["i"] for apt in airports_data}
print(f"Loaded {len(valid_icaos)} valid airports.")

print("Downloading runways.csv...")
url = "https://davidmegginson.github.io/ourairports-data/runways.csv"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as response:
    lines = [line.decode('utf-8') for line in response.readlines()]

print("Parsing runways...")
reader = csv.DictReader(lines)
runway_coords = {}

for row in reader:
    icao = row.get("airport_ident", "")
    if icao in valid_icaos:
        le_id = row.get("le_ident", "")
        he_id = row.get("he_ident", "")
        
        le_lat = row.get("le_latitude_deg", "")
        le_lon = row.get("le_longitude_deg", "")
        he_lat = row.get("he_latitude_deg", "")
        he_lon = row.get("he_longitude_deg", "")
        
        # Only add if we have at least one coordinate
        if not (le_lat and le_lon) and not (he_lat and he_lon):
            continue
            
        rwy_obj = {}
        if le_id and le_lat and le_lon:
            rwy_obj["id1"] = le_id
            rwy_obj["lat1"] = float(le_lat)
            rwy_obj["lon1"] = float(le_lon)
            
        if he_id and he_lat and he_lon:
            rwy_obj["id2"] = he_id
            rwy_obj["lat2"] = float(he_lat)
            rwy_obj["lon2"] = float(he_lon)
            
        if rwy_obj:
            if icao not in runway_coords:
                runway_coords[icao] = []
            runway_coords[icao].append(rwy_obj)

output_path = "data/runway_coords.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(runway_coords, f, separators=(',', ':'))

print(f"Saved exact runway coordinates for {len(runway_coords)} airports to {output_path}.")
