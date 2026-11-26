"""Resume los resultados de JMeter (.jtl en CSV) por escalón de usuarios.
Uso: python resumir_jmeter.py resultados.jtl [salida.json]"""
import csv
import json
import re
import sys
from collections import defaultdict


def percentil(valores, p):
    v = sorted(valores)
    if not v:
        return 0
    k = max(0, min(len(v) - 1, int(round(p / 100 * len(v) + 0.5)) - 1))
    return v[k]


def main(ruta, salida=None):
    grupos = defaultdict(lambda: {"t": [], "err": 0, "ini": None, "fin": None, "codigos": defaultdict(int)})
    with open(ruta, encoding="utf-8", newline="") as f:
        for fila in csv.DictReader(f):
            m = re.match(r"Escalón (\d+) usuarios", fila["threadName"])
            if not m:
                continue
            g = grupos[int(m.group(1))]
            ts, el = int(fila["timeStamp"]), int(fila["elapsed"])
            g["t"].append(el)
            g["ini"] = ts if g["ini"] is None else min(g["ini"], ts)
            g["fin"] = ts + el if g["fin"] is None else max(g["fin"], ts + el)
            if fila["success"] != "true":
                g["err"] += 1
            g["codigos"][fila["responseCode"][:40]] += 1
    filas = []
    print(f"{'Usuarios':>8} {'Solicitudes':>11} {'req/s':>7} {'Media ms':>9} {'p95 ms':>7} {'Máx ms':>7} {'Error %':>8}")
    for n in sorted(grupos):
        g = grupos[n]
        dur = max(1, (g["fin"] - g["ini"]) / 1000)
        r = {"usuarios": n, "solicitudes": len(g["t"]), "rps": round(len(g["t"]) / dur, 1),
             "media": round(sum(g["t"]) / len(g["t"]), 1), "p95": percentil(g["t"], 95), "max": max(g["t"]),
             "error": round(100 * g["err"] / len(g["t"]), 2), "codigos": dict(g["codigos"])}
        filas.append(r)
        print(f"{n:>8} {r['solicitudes']:>11} {r['rps']:>7} {r['media']:>9} {r['p95']:>7} {r['max']:>7} {r['error']:>8}")
    # Punto de quiebre: primer escalón con error >= 1 % o p95 >= 1.000 ms
    quiebre = next((r["usuarios"] for r in filas if r["error"] >= 1 or r["p95"] >= 1000), None)
    capacidad = max((r["usuarios"] for r in filas if r["error"] < 1 and r["p95"] < 1000), default=None)
    print(f"Capacidad sostenida (error < 1 % y p95 < 1 s): {capacidad} usuarios · punto de quiebre: {quiebre or 'no alcanzado'}")
    if salida:
        json.dump({"escalones": filas, "capacidad": capacidad, "quiebre": quiebre}, open(salida, "w", encoding="utf-8"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main(*sys.argv[1:])
