"""Resume los reportes JSON de Trivy (imágenes y configuración)."""
import collections, json, os, sys

carpeta = sys.argv[1]
for nombre in sorted(os.listdir(carpeta)):
    if not (nombre.startswith("trivy_") and nombre.endswith(".json")):
        continue
    try:
        d = json.load(open(os.path.join(carpeta, nombre), encoding="utf-8"))
    except Exception as e:
        print(f"{nombre}: no se pudo leer ({e})")
        continue
    if "config" in nombre:
        c = collections.Counter()
        ejemplos = []
        for r in d.get("Results") or []:
            for m in r.get("Misconfigurations") or []:
                c[m["Severity"]] += 1
                if m["Severity"] in ("CRITICAL", "HIGH") and len(ejemplos) < 8:
                    ejemplos.append(f"{r['Target']}: {m['ID']} {m['Title']}")
        print(f"{nombre}: configuraciones inseguras {dict(c)}")
        for e in ejemplos:
            print("   -", e)
    else:
        c = collections.Counter()
        paquetes = set()
        for r in d.get("Results") or []:
            for v in r.get("Vulnerabilities") or []:
                c[v["Severity"]] += 1
                if v["Severity"] in ("CRITICAL", "HIGH"):
                    paquetes.add(v["PkgName"])
        so = (d.get("Metadata") or {}).get("OS") or {}
        print(f"{nombre}: SO {so.get('Family','?')} {so.get('Name','?')} · vulnerabilidades {dict(c)}")
        if paquetes:
            print("   paquetes con críticas/altas:", ", ".join(sorted(paquetes)[:15]))
