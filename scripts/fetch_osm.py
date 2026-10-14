"""Download OpenStreetMap features around the Canton Fair Complex (Pazhou) via the Overpass API.

Output: data/osm/canton_fair_osm.json (raw Overpass JSON with geometry). Nothing is edited by hand.
Usage: python3 scripts/fetch_osm.py [overpass_url]
"""
import json
import sys
import urllib.parse
import urllib.request

BBOX = (23.094, 113.338, 23.112, 113.372)  # south, west, north, east
URL = sys.argv[1] if len(sys.argv) > 1 else "https://overpass-api.de/api/interpreter"
QUERY = f"""
[out:json][timeout:90];
(
  way["building"]{BBOX};
  relation["building"]{BBOX};
  way["name"~"广交会|Canton Fair|展馆|号馆|Hall|Exhibition",i]{BBOX};
  relation["name"~"广交会|Canton Fair|展馆|号馆|Hall|Exhibition",i]{BBOX};
  node["entrance"]{BBOX};
  node["railway"="station"]{BBOX};
  node["public_transport"="station"]{BBOX};
  node["railway"="subway_entrance"]{BBOX};
  way["highway"="footway"]["bridge"]{BBOX};
);
out body geom;
"""

req = urllib.request.Request(URL, data=urllib.parse.urlencode({"data": QUERY}).encode(), headers={"User-Agent": "altiora-canton-fair-map/1.0"})
with urllib.request.urlopen(req, timeout=180) as r:
    data = json.load(r)
with open("data/osm/canton_fair_osm.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False)
print(f"{len(data.get('elements', []))} elements -> data/osm/canton_fair_osm.json")
