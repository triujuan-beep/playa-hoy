# Playa Hoy

Aplicación responsive que recomienda la mejor playa para bañarse hoy en la Costa del Sol. Combina meteorología, estado del mar, temperatura del agua, medusas, ocupación, estado sanitario y distancia, sin presentar como real ningún dato que no esté verificado.

## Ejecutar

```bash
pnpm install
pnpm dev
```

Abre `http://localhost:3000`. Validaciones:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

## Variables

Copia `.env.example` a `.env.local`:

```dotenv
AEMET_API_KEY=
USE_MOCK_DATA=false
SANITARY_DATA_URL=
```

- `AEMET_API_KEY` (**obligatoria en producción**): clave privada de AEMET OpenData. Solo se lee en el servidor y nunca se envía al navegador.
- `USE_MOCK_DATA=false` (**obligatoria en producción**): activa los providers reales. Usa `true` únicamente para desarrollo con datos de demostración.
- `SANITARY_DATA_URL`: URL opcional de un JSON estructurado, mantenido a partir de fuentes oficiales. Si no existe un estado sanitario vigente, la playa queda como `unknown`; esa ausencia no la excluye ni penaliza por sí sola.

En Vercel, configura estas variables en **Project → Settings → Environment Variables**. `.env.local` y los secretos están ignorados por Git.

## Arquitectura de datos

```text
src/lib/mock-beaches.ts               Catálogo v2 de 58 playas y datos demo
src/lib/providers/weatherProvider.ts  AEMET OpenData
src/lib/providers/seaProvider.ts      Open-Meteo Marine, batch y caché
src/lib/providers/sanitaryProvider.ts Feed sanitario/manual con vigencia
src/lib/providers/medusAppProvider.ts  Observaciones colaborativas de MedusApp
src/lib/providers/occupancyProvider.ts Sin fuente real por ahora
src/lib/services/beachDataService.ts   Carga, agrupa, fusiona y normaliza
src/lib/scoring.ts                     Score y completitud de datos
src/data/sanitary-status.json          Overrides sanitarios locales
```

La UI solo consume el modelo normalizado `Beach`. Nunca llama directamente a AEMET, Puertos del Estado o una fuente sanitaria.

### Meteorología

`weatherProvider` consulta la predicción horaria municipal de AEMET y normaliza temperatura ambiente, viento, rachas, dirección y probabilidad de lluvia. Las consultas se agrupan por los 14 municipios, no por playa ni usuario. Cada predicción sigue el flujo oficial de dos pasos: metadata con una URL temporal `datos` y descarga del JSON meteorológico.

El resultado normalizado completo se conserva 3600 segundos con la caché server-side de Next.js. La URL temporal nunca se cachea. Las solicitudes simultáneas se deduplican y los municipios se procesan secuencialmente con un segundo de separación dentro de cada instancia. El provider aplica timeout, reintentos exponenciales y `Retry-After` ante 429/5xx. El último resultado válido se conserva durante 48 horas en Vercel Runtime Cache (por región) y se etiqueta claramente como dato anterior cuando AEMET falla.

La deduplicación en memoria no coordina instancias o regiones distintas y Runtime Cache es regional. Un despliegue en frío o revalidaciones simultáneas en regiones diferentes pueden repetir alguna consulta. Con tráfico continuo, una región realiza como máximo 14 renovaciones horarias, equivalentes a 28 solicitudes HTTP por hora por el flujo de dos pasos. Conviene vigilar 429 en los logs antes de reducir la caché.

### Estado del mar

`seaProvider` consulta `https://marine-api.open-meteo.com/v1/marine` en tres lotes independientes de 20, 20 y 18 coordenadas. Solicita 2 días horarios en `Europe/Madrid`: temperatura superficial, altura/dirección/periodo de ola, swell y corriente oceánica. Si un lote falla, los otros dos siguen disponibles.

Cada petición usa la caché server-side de `fetch` con revalidación de 1800 segundos. Con tráfico continuo son como máximo 144 peticiones diarias por región para el catálogo completo. La temperatura y el oleaje son predicciones de modelo, no mediciones físicas en cada playa.

### MedusApp

Las 58 coordenadas se consultan individualmente en grupos pequeños porque el endpoint comunitario es radial. Cada resultado se conserva dos horas; el máximo teórico con tráfico continuo es 696 peticiones diarias por región. `no_recent_reports` no significa ausencia garantizada de medusas. A futuro puede evaluarse una malla zonal con agregación espacial, validando antes que no cambie la semántica del radio de 5 km.

Los datos se muestran como `Predicción · Open-Meteo` y se atribuyen a [Open-Meteo](https://open-meteo.com/) y DWD conforme a CC BY 4.0.

### Estado sanitario

El provider acepta estados `safe`, `warning`, `closed` y `unknown`. Cada registro puede incluir:

```json
{
  "20": {
    "status": "closed",
    "message": "Baño prohibido temporalmente por aviso oficial.",
    "updatedAt": "2026-08-24T10:00:00+02:00",
    "effectiveFrom": "2026-08-24T10:00:00+02:00",
    "effectiveUntil": "2026-08-25T10:00:00+02:00",
    "source": "Organismo oficial",
    "sourceUrl": "https://..."
  }
}
```

El JSON puede vivir en `src/data/sanitary-status.json` o en el feed configurado mediante `SANITARY_DATA_URL`. Los registros futuros o caducados no se consideran activos. La caché del feed sanitario revalida cada 3600 segundos.

El catálogo incluye 56 correspondencias oficiales: individuales, agrupadas o asociadas. Solo Misericordia y El Faro (Mijas) permanecen `unknown`; esa ausencia no implica incidencia y no las excluye. `closed` sí excluye y `warning` recibe una penalización fuerte.

El snapshot se actualiza localmente, nunca mediante scraping en runtime. Tras descargar y revisar el informe quincenal oficial:

```bash
python scripts/update-sanitary-status.py tmp/pdfs/informe.pdf --effective-until 2026-08-31 --source-url https://www.juntadeandalucia.es/.../informe.pdf
```

El script exige 56 asociaciones, toma el peor estado cuando una playa agrupa varios puntos y genera un diff revisable. Requiere `pip install -r scripts/requirements-sanitary.txt`.

## Score, faltantes y confianza

`calculateBeachScore` usa únicamente factores disponibles. Una métrica ausente no equivale a una mala condición y no recibe penalización. `dataCompleteness` cuenta seis familias: meteorología, temperatura del agua, oleaje, sanidad, medusas y ocupación. Predicción y observación cuentan por igual como dato disponible; su origen se conserva aparte en `metricMetadata`.

El estado sanitario es una condición previa al score meteorológico. Los pesos siguen siendo editables en `src/lib/scoring.ts`.

## Fuentes oficiales evaluadas

- **AEMET OpenData**: API REST documentada y reutilizable; requiere API key. Es la fuente recomendada para predicción horaria.
- **Open-Meteo Marine**: predicción horaria marina multi-coordenada, sin API key para evaluación/no comercial y con atribución obligatoria.
- **Puertos del Estado / Portus**: red oficial con observaciones horarias; candidata futura para contrastar el modelo con mediciones.
- **NÁYADE, Ministerio de Sanidad**: sistema nacional de zonas de baño y controles, con consulta ciudadana; no se ha localizado una API pública documentada.
- **Junta de Andalucía**: publica informes quincenales durante la temporada y avisos oficiales, pero el recurso abierto figura con frecuencia anual y sin API estructurada de alertas.

No se implementa scraping.

## Google Maps

`src/lib/maps.ts` genera URLs oficiales de Google Maps Directions con las coordenadas del destino. Google Maps decide el origen, la ruta, el tráfico y el tiempo de viaje. No se calcula ni se muestra un tiempo aproximado en Playa Hoy. Esta función no requiere API key.

## Limitaciones actuales

- La predicción de AEMET es municipal, no una observación en la arena.
- Open-Meteo representa celdas de modelo, no sensores en la orilla; puede diferir de boyas, banderas y observaciones de socorristas.
- Las corrientes modelizadas tienen menor precisión cerca de costa y no son aptas para navegación.
- Los controles sanitarios oficiales pueden publicarse con periodicidad quincenal; cierres extraordinarios requieren un canal de avisos más inmediato.
- MedusApp es una fuente colaborativa y ausencia de reportes no equivale a ausencia de medusas; la ocupación sigue sin fuente real.
- El último dato de AEMET es un fallback temporal regional, no un histórico durable global.

## Despliegue

El proyecto usa el runtime Node.js estándar de Next.js y no necesita adaptadores, `outputDirectory` ni configuración especial para Vercel. La geolocalización se ejecuta en el navegador y funciona en el dominio HTTPS que Vercel provisiona automáticamente. Los enlaces «Cómo llegar» usan Google Maps Directions mediante URL y no requieren una clave de Google.

Antes de desplegar, confirma que los estados de `src/data/sanitary-status.json` siguen vigentes. Al caducar, las playas afectadas pasan deliberadamente a estado `unknown`; para continuidad operativa se recomienda mantener ese fichero o configurar `SANITARY_DATA_URL` con un feed HTTPS fiable.

Primer despliegue:

1. Revisa `git status` y confirma que `.env.local`, `.next/` y `tmp/` no aparecen entre los archivos a subir.
2. Crea el primer commit y sube el repositorio a GitHub, GitLab o Bitbucket.
3. En Vercel, selecciona **Add New → Project** e importa el repositorio.
4. Conserva la detección automática de **Next.js** y los comandos predeterminados de instalación y build; no configures un directorio de salida.
5. En **Project → Settings → Environment Variables**, añade para **Production** `AEMET_API_KEY` y `USE_MOCK_DATA=false`. Añade `SANITARY_DATA_URL` solo si existe un feed mantenido. No uses el prefijo `NEXT_PUBLIC_` para estas variables.
6. Ejecuta el primer deployment desde Vercel.
7. Comprueba la portada, una ficha de playa, el permiso de ubicación y el enlace «Cómo llegar». Revisa en los logs de funciones los mensajes de AEMET y, en especial, posibles respuestas 429.
