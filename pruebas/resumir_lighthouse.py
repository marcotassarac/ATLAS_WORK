"""Resume las corridas de Lighthouse: mediana de LCP y puntajes (CP-17, NFR-PERF-2)."""
import glob, json, os, statistics, sys

carpeta = sys.argv[1]
lcp, perf, acc, bp = [], [], [], []
for f in sorted(glob.glob(os.path.join(carpeta, "corrida_*.report.json"))):
    d = json.load(open(f, encoding="utf-8"))
    lcp.append(d["audits"]["largest-contentful-paint"]["numericValue"] / 1000)
    perf.append(d["categories"]["performance"]["score"] * 100)
    acc.append(d["categories"]["accessibility"]["score"] * 100)
    bp.append(d["categories"]["best-practices"]["score"] * 100)
    print(f"{os.path.basename(f)}: LCP {lcp[-1]:.2f} s · rendimiento {perf[-1]:.0f} · accesibilidad {acc[-1]:.0f} · buenas prácticas {bp[-1]:.0f}")
if lcp:
    m = statistics.median(lcp)
    print(f"Mediana LCP (perfil móvil, 4G simulado): {m:.2f} s · umbral < 2 s: {'CUMPLE' if m < 2 else 'NO CUMPLE'}")
    print(f"Mediana puntajes: rendimiento {statistics.median(perf):.0f} · accesibilidad {statistics.median(acc):.0f} · buenas prácticas {statistics.median(bp):.0f}")
