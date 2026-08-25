# MedusApp v1 — integración experimental

Investigación local de MedusApp como fuente de observaciones crowdsourced para las 20 playas de Playa Hoy.

## Integración Preview de Playa Hoy

La integración informativa de producto reutiliza las conclusiones de este experimento con una configuración centralizada de **5 km / 48 horas**. Vive exclusivamente en servidor, inicia una sesión normal visitando el mapa público, limita la concurrencia a cuatro playas, deduplica solicitudes simultáneas y usa la caché de datos de Next.js durante 30 minutos. Los errores no se cachean como observaciones válidas: se convierten fuera de la caché en el estado `unknown`.

Respecto del parser experimental de Python, el parser TypeScript conserva las mismas evidencias semánticas y filtros, pero reduce deliberadamente su salida. El HTML del popup solo se procesa de forma transitoria y se descartan nombre de playa, talla, evidencia textual, identificadores, geometrías individuales y otros campos que la UI no necesita. El cliente recibe únicamente el agregado por playa: estado, contadores, fecha más reciente, distancia mínima, abundancia normalizada cuando existe, radio, ventana y fecha de actualización.

MedusApp se mantiene separado de `jellyfishRisk`: no cambia el score, el ranking, la recomendación, la evolución ni el selector horario. La observación conserva `origin = observed` cuando el usuario consulta otra hora.

## Recomendación

**NO APTO** para integrar ahora en la UI, ranking o scoring.

El endpoint es técnicamente consumible y el provider funciona, pero la cobertura reciente encontrada no permite ofrecer un dato útil de forma consistente:

- radio estándar 5 km: 0/20 playas con reportes relevantes en 24 h;
- radio estándar 5 km: 0/20 en 48 h;
- radio estándar 5 km: 4/20 con positivos en 72 h;
- ningún `no_sighting`, pendiente o certificado en la muestra;
- 10 reportes únicos normalizados, de los que 4 eran ctenóforos/contaminantes u otros objetos y no se contaron como medusas;
- ampliar a 10 km/72 h produce coincidencias en 10 playas, pero reutiliza observaciones de playas vecinas y no demuestra condiciones locales.

La conclusión no invalida MedusApp: es una fuente valiosa de observaciones puntuales. Sí indica que no debe presentarse todavía como cobertura regular de las 20 playas.

## Alcance y aislamiento

- Todo está dentro de `research/medusapp/`.
- No se ha modificado `src/`, Home, fichas, ranking, scoring o providers productivos.
- No hay commit, push, merge ni despliegue.
- La caché y los resultados están ignorados por Git.
- No se descargan ni almacenan fotos o vídeos.
- No se conservan nombres de usuario, comentarios, nombres de fichero ni popup HTML.

## Fuente y licencia

- Fuente: [MedusApp](https://www.medusapp.net/).
- Endpoint observado en su mapa: `https://www.medusapp.net/php/consultaMedusas.php`.
- Condiciones oficiales: [Acerca de MedusApp — uso de datos](https://www.medusapp.net/acercade.html).
- Datos de avistamientos/ausencias, coordenadas, abundancia, tamaño y fecha-hora: **CC BY-NC-SA 4.0** para uso no comercial.
- Fotografías/vídeos tienen condiciones distintas y quedan expresamente fuera del experimento.
- El uso comercial requiere contactar con `info@medusapp.net`.

La página oficial añade condiciones específicas para publicación científica. Este análisis es local y no constituye una publicación científica. Antes de una integración pública conviene confirmar directamente con MedusApp el uso previsto, la atribución, el alcance de “NoComercial” y las obligaciones ShareAlike sobre datos derivados.

## Comportamiento técnico real

- Una llamada directa aislada respondió HTTP 200 con `acceso_no_autorizado`.
- Una sesión normal iniciada cargando el mapa oficial y reutilizando su cookie/Referer respondió GeoJSON correctamente.
- El HTML del mapa solo se usa para iniciar la sesión: no se analiza ni se almacena.
- El endpoint devuelve CORS `*`.
- No exige un User-Agent especial; funcionó con uno descriptivo de investigación.
- No apareció HTTP 429, `Retry-After`, 401, 403 ni error de servidor durante la adquisición final.
- No se intentó averiguar o eludir si la cookie, el Referer o ambos son la comprobación exacta.
- El endpoint no está documentado como API pública estable: su esquema o control de sesión pueden cambiar.

Durante el desarrollo se realizaron 47 consultas al endpoint: pruebas mínimas de autorización/esquema, una adquisición inicial, un diagnóstico de campos y una reconstrucción de caché tras corregir el parser. La operación normal es:

- caché fría: máximo 20 consultas para las 20 playas;
- caché caliente: 0 consultas;
- las nueve combinaciones de radio/ventana se calculan localmente.

## Estructura

- `provider.py`: sesión, timeout, retry moderado, detención ante 429 y caché normalizada de 30 minutos;
- `parser.py`: parser HTML mínimo y normalización sin información personal ni medios;
- `analyze.py`: consulta las 20 playas, calcula distancias/pesos/estados y genera resultados;
- `test_parser.py`: pruebas de positivos, negativos, pendientes, otros objetos, privacidad y rangos;
- `results/`: CSV, JSON, ejemplos anonimizados e informe generado;
- `cache/`: respuestas ya normalizadas; nunca GeoJSON/popup bruto.

## Interfaz del provider

El adaptador acepta el contrato solicitado:

```python
provider.query_area({
    "latitude": 36.752,
    "longitude": -3.867,
    "radiusKm": 5,
    "from": "2026-08-23T12:00:00+02:00",
    "to": "2026-08-25T12:00:00+02:00",
})
```

El resultado contiene exclusivamente metadatos normalizados:

```json
{
  "id": "...",
  "latitude": 36.715,
  "longitude": -4.196,
  "timestamp": "2026-08-23T15:50:00",
  "beachName": "Playa de Benajarafe",
  "species": "Cotylorhiza tuberculata",
  "abundanceRange": "2-5",
  "abundanceSeverity": 1.25,
  "sizeRange": "5-10",
  "validationStatus": "not_certified",
  "reportStatus": "published",
  "reportType": "sighting",
  "origin": "observed",
  "source": "MedusApp",
  "sourceType": "crowdsourced"
}
```

`observed` significa que un usuario reportó una observación; no implica confirmación oficial.

## Heurísticas de parseo

El GeoJSON presenta `fecha`, `icono`, `fichero`, `nomfich` y `popup`. Solo se usan:

- coordenadas GeoJSON;
- `fecha` estructurada;
- `data-codigo` como identificador técnico;
- `data-idmedusa` junto con el texto de `.infoMedusa` para un avistamiento positivo;
- párrafo identificado por el icono `zmdi-pin-drop` para playa;
- tarjetas `.stat`: `cm.` para tamaño y `# Num.` para abundancia;
- frases explícitas “playa libre de medusas”, “sin medusas”, “no avistamiento” o “ausencia de medusas” para `no_sighting`;
- “Validando…”/“pendiente de validación” para `pending`;
- una marca explícita `verified/certified/check` para `certified`.

`icono` se inspeccionó, pero sus códigos numéricos no tienen un mapeo público documentado; no se usan para inferir tipo o certificación y tampoco se almacenan. La certificación visual descrita por MedusApp no pudo verificarse inequívocamente en esta muestra, por lo que todos los positivos quedan conservadoramente `not_certified`.

Sin una marca inequívoca, el reporte queda `not_certified`, que **no significa falso**.

El mismo endpoint devuelve otros elementos. Ctenóforos, salpas, aceite, espuma, plástico, basura, residuos, troncos/madera y “otros objetos” se clasifican como `unknown` y no suman presencia de medusas. Esta lista debe evolucionar hacia un catálogo oficial de IDs/especies si MedusApp lo facilita.

El parser nunca conserva:

- el campo `fichero`;
- URL o nombre de foto/vídeo;
- usuario;
- comentarios libres;
- likes;
- popup HTML.

## Pesos experimentales

Antigüedad, centralizada en `recency_weight`:

- 0–12 h: 1,00;
- 12–24 h: 0,80;
- 24–48 h: 0,50;
- 48–72 h: 0,25;
- más de 72 h: 0.

Distancia, centralizada en `distance_weight`:

- 0–2 km: 1,00;
- 2–5 km: 0,70;
- 5–10 km: 0,30;
- más de 10 km: 0.

Abundancia:

- 1: 1,00;
- 2–5: 1,25;
- 6–10: 1,50;
- 11–99: 2,00;
- 100–1000: 3,00;
- más de 1000: 4,00;
- desconocida: 1,00, evitando inventar severidad.

Un certificado inequívoco multiplicaría por 1,20. No se encontró ninguno en esta muestra.

## Estados experimentales

- `NO_RECENT_REPORTS`: consulta válida sin positivos, negativos o pendientes. El texto siempre aclara que no demuestra ausencia.
- `RECENT_NO_SIGHTINGS`: existe `no_sighting` cercano/reciente con evidencia dominante.
- `RECENT_SIGHTING`: al menos un positivo dentro del radio/ventana, salvo conflicto negativo dominante.
- `MULTIPLE_RECENT_SIGHTINGS`: dos o más positivos y evidencia ponderada mínima 0,40.
- `STRONG_RECENT_PRESENCE`: evidencia positiva acumulada ≥4 y neta ≥2.
- `UNKNOWN`: fallo/insuficiencia, solo pendientes/otros, o conflicto no resoluble.

Evidencia positiva:

`recency × distance × abundance × validation`

Evidencia neta:

`positiveEvidence − 0.6 × negativeEvidence`

El factor 0,6 refleja que un usuario que no vio medusas no invalida automáticamente un positivo próximo. Es una decisión conservadora y experimental, no una regla biológica validada.

## Conflictos

No apareció ningún caso real con positivos y `no_sighting` simultáneos en las 20 playas/72 h. La lógica está preparada para:

- conservar al menos `RECENT_SIGHTING` cuando el positivo es próximo/reciente;
- permitir `RECENT_NO_SIGHTINGS` cuando la evidencia negativa domina y el positivo es más lejano/antiguo;
- marcar siempre `conflict: true` y explicarlo en el texto.

Debe validarse con casos reales antes de cualquier integración.

## Resultados

- `results/beach_radius_window_matrix.csv|json`: 180 filas, 20 playas × 3 radios × 3 ventanas;
- `results/radius_window_comparison.csv|json`: comparación agregada;
- `results/beaches_standard_5km_48h.csv`: vista estándar propuesta;
- `results/coverage.json`: cobertura 24/48/72 h;
- `results/conflict_cases.csv`: casos positivos/negativos simultáneos;
- `results/real_anonymized_examples.json`: ejemplos reales sin usuario, medios ni ID original;
- `results/diagnostics.json`: HTTP, caché y errores;
- `results/REPORT.md`: informe generado.

En la vista estándar 5 km/48 h, las 20 playas quedan `NO_RECENT_REPORTS`. El wording correcto sería “Sin avistamientos recientes reportados”, nunca “No hay medusas”.

## Caché futura y consultas

Propuesta para una fase posterior:

- server-side únicamente;
- caché compartida 15–30 minutos;
- stale-on-error para no multiplicar llamadas ante fallos;
- una actualización abastece a todos los usuarios;
- nunca consultar MedusApp desde cada navegador.

La estrategia actual de 20 consultas ofrece una referencia exacta por playa, pero tiene solapamiento elevado. Una fase siguiente debería comparar esa referencia con 4–5 consultas zonales (Axarquía oriental, Rincón/Málaga este, Málaga/Torremolinos y Mijas) y filtrado Haversine local. Solo adoptar zonas si devuelve exactamente los mismos reportes relevantes y MedusApp confirma que radios mayores son un uso aceptado.

## UI futura — no implementada

Ejemplos seguros:

> 🪼 Medusas<br>
> ⚪ Sin avistamientos recientes reportados<br>
> Últimas 48 h · radio 5 km

> 🪼 Medusas<br>
> 🟠 Presencia reciente reportada<br>
> Datos basados en observaciones de usuarios

Siempre mostrar:

> Fuente: MedusApp · CC BY-NC-SA 4.0<br>
> Datos basados en observaciones de usuarios.

No usar “playa libre”, “hay medusas confirmadas oficialmente” o equivalentes.

## Scoring futuro — no implementado

- `UNKNOWN`, `NO_RECENT_REPORTS`, `RECENT_NO_SIGHTINGS`: sin penalización;
- `RECENT_SIGHTING`: penalización ligera/moderada;
- `MULTIPLE_RECENT_SIGHTINGS`: penalización fuerte;
- `STRONG_RECENT_PRESENCE`: posible no recomendada.

Esto requiere antes cobertura suficiente, validación de conflictos, permiso/licencia clara y seguimiento de falsos positivos.

## Reproducción

```powershell
python -m pip install -r research/medusapp/requirements.txt
python -m unittest discover -s research/medusapp -p "test_*.py" -v
python research/medusapp/analyze.py
```

Con caché válida, repetir el análisis no genera llamadas al endpoint.

## Siguiente fase propuesta

1. Repetir mediciones diarias durante varias semanas, sin polling agresivo, para estimar cobertura estacional real.
2. Solicitar a MedusApp documentación/permiso para uso público, IDs oficiales de especies/tipos y significado inequívoco de certificación.
3. Comparar consultas zonales con la referencia de 20 playas.
4. Validar `no_sighting`, pendientes, certificados y conflictos cuando aparezcan ejemplos reales.
5. Solo entonces preparar un provider TypeScript server-side detrás de caché compartida, todavía sin scoring.
