"""Resume los reportes JSON de OWASP ZAP por nivel de riesgo."""
import collections, json, os, sys

carpeta = sys.argv[1]
riesgo = {"3": "Alto", "2": "Medio", "1": "Bajo", "0": "Informativo"}
for nombre in ("zap_frontend.json", "zap_api.json", "zap_api_autenticado.json"):
    f = os.path.join(carpeta, nombre)
    if not os.path.exists(f):
        print(f"{nombre}: no generado")
        continue
    d = json.load(open(f, encoding="utf-8"))
    c = collections.Counter()
    alertas = []
    for s in d.get("site", []):
        for a in s.get("alerts", []):
            c[riesgo.get(a["riskcode"], a["riskcode"])] += 1
            alertas.append((a["riskcode"], a["alert"], a.get("count", len(a.get("instances", [])))))
    print(f"{nombre}: {sum(c.values())} tipos de alerta {dict(c)}")
    for rc, nom, n in sorted(alertas, key=lambda x: -int(x[0])):
        print(f"   [{riesgo.get(rc, rc)}] {nom} ({n} instancias)")
