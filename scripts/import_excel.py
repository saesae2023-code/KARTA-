"""Import FULL MASTER LIST from the Canton Fair Excel into src/data/points.json.

Every row and every column is kept verbatim (`raw`), plus a few parsed helper
fields (booth list, halls). Hall/Booth from Excel are authoritative; nothing is
invented here (no coordinates).

Usage: python3 scripts/import_excel.py <xlsx> <phase> [out.json]
  e.g. python3 scripts/import_excel.py data/Canton_Fair_Phase2_....xlsx 2
  writes src/data/phase<phase>.json (the app picks every phaseN.json up automatically).
"""
import json
import os
import re
import sys

import openpyxl

SHEET = "FULL MASTER LIST"
FIELDS = {
    "ID / порядок": "id",
    "Приоритет": "priority",
    "Товарное направление": "category",
    "Компания / бренд": "company",
    "Hall": "hall",
    "Booth": "booth",
    "Что представлено": "products",
    "Почему точка релевантна": "why",
    "Что получить / проверить": "toCheck",
    "Телефон / WhatsApp": "phone",
    "WeChat / Email": "wechatEmail",
    "Сайт": "website",
    "Статус верификации": "verification",
    "Источник": "source",
    "Статус посещения": "visitStatus",
    "Контакт получен": "contactReceived",
    "Итог / заметки": "notes",
    "Группа для будущей карты": "mapGroup",
    "Тип точки": "pointType",
}
BOOTH_RE = re.compile(r"(\d{1,2}\.\d)\s*([A-Z]{1,2}\d.*)")


def text(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


ROUTE_SHEET = "PRIORITY ROUTE"
STRATEGY_SHEET = "ROUTE STRATEGY"
SUMMARY_SHEET = "FULL LIST SUMMARY"


def sheet_rows(wb, name):
    return list(wb[name].iter_rows(values_only=True)) if name in wb.sheetnames else []


def route_info(wb):
    """Optional PRIORITY ROUTE sheet: strategic priority (A+/A/B) and visit rule per master ID."""
    rows = sheet_rows(wb, ROUTE_SHEET)
    if not rows:
        return {}
    h = [text(x) for x in rows[0]]
    need = ["ID MASTER", "Стратегический приоритет", "Правило посещения"]
    if any(n not in h for n in need):
        sys.exit(f"{ROUTE_SHEET}: missing columns {[n for n in need if n not in h]}")
    out = {}
    for r in rows[1:]:
        rec = dict(zip(h, (text(v) for v in r)))
        if rec["ID MASTER"]:
            out[int(rec["ID MASTER"])] = {"strategic": rec["Стратегический приоритет"], "visitRule": rec["Правило посещения"]}
    return out


def default_area_order(wb):
    """Optional ROUTE STRATEGY row «Default-порядок без GPS»: «Зона B → Зона C → …» → ["B", "C", …]."""
    for r in sheet_rows(wb, STRATEGY_SHEET):
        if r and text(r[0]).startswith("Default-порядок"):
            return re.findall(r"Зона\s+([A-D])", text(r[1]))
    return []


def phase_dates(wb, phase):
    """Optional FULL LIST SUMMARY row «Phase N | 23–27 октября 2026»."""
    for r in sheet_rows(wb, SUMMARY_SHEET):
        if r and text(r[0]) == f"Phase {phase}" and len(r) > 1:
            return text(r[1])
    return ""


def main(src, phase, out):
    wb = openpyxl.load_workbook(src, data_only=True)
    ws = wb[SHEET]
    rows = list(ws.iter_rows(values_only=True))
    header = [text(h) for h in rows[0]]
    missing = [h for h in FIELDS if h not in header]
    if missing:
        sys.exit(f"Missing columns: {missing}")
    routes = route_info(wb)
    points = []
    for row in rows[1:]:
        if all(v is None for v in row):
            continue
        raw = {h: text(v) for h, v in zip(header, row)}
        p = {FIELDS[h]: raw[h] for h in FIELDS}
        p["id"] = int(p["id"])
        booths = []
        for token in re.split(r"[;,]", p["booth"]):
            token = token.strip()
            if not token:
                continue
            m = BOOTH_RE.search(token)
            booths.append({"label": token, "hall": m.group(1) if m else None})
        halls = [h.strip() for h in re.split(r"[+;]", p["hall"]) if h.strip()]
        for b in booths:
            if b["hall"] and b["hall"] not in halls:
                halls.append(b["hall"])
        p["booths"] = booths
        p["halls"] = halls
        p["raw"] = raw
        p.update(routes.get(p["id"], {}))
        points.append(p)
    if routes and set(routes) != {p["id"] for p in points}:
        sys.exit(f"{ROUTE_SHEET}: IDs do not match {SHEET}")
    meta = {"phase": phase, "source": os.path.basename(src), "sheet": SHEET}
    if phase_dates(wb, phase):
        meta["dates"] = phase_dates(wb, phase)
    if default_area_order(wb):
        meta["defaultAreaOrder"] = default_area_order(wb)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({**meta, "columns": header, "points": points}, f, ensure_ascii=False, indent=1)
    print(f"Imported {len(points)} points, {len(header)} columns -> {out}")


if __name__ == "__main__":
    phase = int(sys.argv[2])
    main(sys.argv[1], phase, sys.argv[3] if len(sys.argv) > 3 else f"src/data/phase{phase}.json")
