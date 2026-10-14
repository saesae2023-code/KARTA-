"""Build src/data/hallGeo.json from OpenStreetMap data.

Inputs:
  data/osm/canton_fair_osm.json — raw Overpass output (scripts/fetch_osm.py)
  data/osm/hall_osm_map.json    — Hall ↔ OSM element mapping {"15": "way/123", ...}. The official Phase 1 floor map is
                                  used ONLY to decide which physical building is which hall; coordinates always come
                                  from the OSM geometry.
Every hall gets: hall, area, lat, lng (polygon centroid), polygon [[lng, lat], ...], accuracy, source.
Usage: python3 scripts/build_hall_geo.py
"""
import json

AREA = {**{str(h): "A" for h in range(1, 9)}, **{str(h): "B" for h in range(9, 14)},
        **{str(h): "C" for h in range(14, 17)}, **{str(h): "D" for h in range(17, 22)}}

osm = json.load(open("data/osm/canton_fair_osm.json", encoding="utf-8"))
mapping = json.load(open("data/osm/hall_osm_map.json", encoding="utf-8"))
by_ref = {f"{e['type']}/{e['id']}": e for e in osm["elements"]}


def ring(e):
    if e["type"] == "way":
        return [[p["lon"], p["lat"]] for p in e["geometry"]]
    outer = [m for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
    return [[p["lon"], p["lat"]] for m in outer for p in m["geometry"]]


def centroid(poly):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-15:
        return sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
    return cx / (3 * a), cy / (3 * a)


out = []
for hall, ref in mapping.items():
    if hall.startswith("_"):
        continue
    e = by_ref.get(ref)
    if not e:
        raise SystemExit(f"Hall {hall}: {ref} not found in OSM data")
    poly = ring(e)
    lng, lat = centroid(poly)
    name = e.get("tags", {}).get("name", "")
    out.append({"hall": hall, "area": AREA.get(hall, "?"), "lat": round(lat, 7), "lng": round(lng, 7),
                "polygon": [[round(x, 7), round(y, 7)] for x, y in poly], "accuracy": "building_polygon",
                "source": f"OpenStreetMap {ref}" + (f" ({name})" if name else "") + ", © OpenStreetMap contributors, ODbL"})
json.dump(sorted(out, key=lambda r: int(r["hall"])), open("src/data/hallGeo.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(out)} halls -> src/data/hallGeo.json")
