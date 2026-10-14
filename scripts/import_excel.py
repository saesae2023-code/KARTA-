"""Import FULL MASTER LIST from the Canton Fair Excel into src/data/points.json.

Every row and every column is kept verbatim (`raw`), plus a few parsed helper
fields (booth list, halls). Hall/Booth from Excel are authoritative; nothing is
invented here (no coordinates).

Usage: python3 scripts/import_excel.py <xlsx> <out.json>
"""
import json
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


def main(src, out):
    ws = openpyxl.load_workbook(src, data_only=True)[SHEET]
    rows = list(ws.iter_rows(values_only=True))
    header = [text(h) for h in rows[0]]
    missing = [h for h in FIELDS if h not in header]
    if missing:
        sys.exit(f"Missing columns: {missing}")
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
        halls = [h.strip() for h in p["hall"].split("+") if h.strip()]
        for b in booths:
            if b["hall"] and b["hall"] not in halls:
                halls.append(b["hall"])
        p["booths"] = booths
        p["halls"] = halls
        p["raw"] = raw
        points.append(p)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"sheet": SHEET, "columns": header, "points": points}, f, ensure_ascii=False, indent=1)
    print(f"Imported {len(points)} points, {len(header)} columns -> {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
