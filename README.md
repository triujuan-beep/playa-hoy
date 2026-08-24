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
- `SANITARY_DATA_URL`: URL opcional de un JSON estructurado, mantenido a partir de fuentes oficiales. Si no existe un estado sanitario vigente, la playa queda como `unknown` y no se recomienda.

En Vercel, configura estas variables en **Project → Settings → Environment Variables**. `.env.local` y los secretos están ignorados por Git.

## Arquitectura de datos

```text
src/lib/mock-beaches.ts               Catálogo de 20 playas y datos demo
src/lib/providers/weatherProvider.ts  AEMET OpenData
src/lib/providers/seaProvider.ts      Open-Meteo Marine, batch y caché
src/lib/providers/sanitaryProvider.ts Feed sanitario/manual con vigencia
src/lib/providers/jellyfishProvider.ts Sin fuente real por ahora
src/lib/providers/occupancyProvider.ts Sin fuente real por ahora
src/lib/services/beachDataService.ts   Carga, agrupa, fusiona y normaliza
src/lib/scoring.ts                     Score y completitud de datos
src/data/sanitary-status.json          Overrides sanitarios locales
```

La UI solo consume el modelo normalizado `Beach`. Nunca llama directamente a AEMET, Puertos del Estado o una fuente sanitaria.

### Meteorología

`weatherProvider` consulta la predicción horaria municipal de AEMET y normaliza temperatura ambiente, viento, rachas, dirección y probabilidad de lluvia. Las consultas se agrupan por municipio: las 20 playas actuales generan seis predicciones municipales, no una por playa y usuario. Cada predicción sigue el flujo oficial de dos pasos: metadata con una URL temporal `datos` y descarga del JSON meteorológico.

El resultado normalizado completo se conserva 900 segundos con la caché server-side de Next.js; en Vercel, esa Data Cache se comparte entre usuarios del mismo proyecto. La URL temporal nunca se cachea. Las solicitudes simultáneas se deduplican y los municipios se procesan en cola dentro de cada instancia para reducir errores 429. Los fallos no se guardan en caché. Si falta la clave o AEMET falla, las métricas quedan ausentes y el error se registra únicamente en servidor sin exponer la API key.

La deduplicación en memoria no coordina instancias o regiones distintas. Un despliegue en frío o revalidaciones simultáneas pueden repetir alguna consulta y provocar un 429 de AEMET. El provider respeta `Retry-After`, reintenta con espera y degrada sin romper la página, pero no mantiene un último valor válido fuera de la caché. Conviene vigilar los logs de funciones durante el primer despliegue antes de reducir el intervalo de 900 segundos.

### Estado del mar

`seaProvider` consulta `https://marine-api.open-meteo.com/v1/marine` con las 20 coordenadas en un único batch. Solicita 2 días horarios en `Europe/Madrid`: temperatura superficial, altura/dirección/periodo de ola, swell y corriente oceánica. Selecciona el valor más próximo a la hora local actual y conserva la estructura horaria para facilitar un selector futuro.

La petición usa la caché server-side de `fetch` con revalidación de 1800 segundos. Así, el tráfico normal genera como máximo unas 48 consultas al día para el conjunto completo, no una por usuario ni por playa. La temperatura y el oleaje son predicciones de modelo, no mediciones físicas en cada playa. Open-Meteo Marine publica oleaje con resolución aproximada de 5 km y advierte que corrientes y mareas rondan 8 km y tienen precisión costera limitada.

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

Ante ausencia de datos, se devuelve `unknown`: nunca se asume que una playa está abierta. `closed` y `unknown` tienen score 0 y quedan fuera de la recomendación; `warning` recibe una penalización fuerte.

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
- Medusas y ocupación solo existen en modo demo. En modo real se muestran como no disponibles.
- No existe almacenamiento persistente del último dato válido; la caché de Vercel reduce llamadas y conserva respuestas entre revalidaciones, pero un almacén durable sería una mejora posterior.

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
