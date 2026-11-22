# Fieldrec

Web app para trabajo de campo: muestra las tareas (slides) de un protocolo y graba en WAV sin comprimir. Está pensada para iPad mini (en vertical y en horizontal) y funciona sin conexión una vez instalada en la pantalla de inicio.

- Sin servidor y sin recursos externos: GitHub Pages solo sirve el código. Las grabaciones se quedan en el dispositivo hasta que las exportas.
- Grabación **por token**, **continua** o **continua con cortes** (configurable en cada tarea).
- WAV mono a la frecuencia nativa o remuestreado (48 000, 44 100, 22 050 o 16 000 Hz), a 16 bits, 24 bits o 32 bits float.
- Exportación en ZIP con los WAV, TextGrid de Praat para las tareas continuas, `trials.csv` y `session.json`.

> **Prototipo (v0.1.1).** Pruébalo en tu iPad antes de usarlo con participantes.

---

## Publicarlo en GitHub Pages

1. Crea un repositorio nuevo (por ejemplo `fieldrec`) y sube **todo el contenido de esta carpeta** a la raíz, incluido el archivo `.nojekyll`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. Al cabo de un minuto estará en `https://TU-USUARIO.github.io/fieldrec/`.

Para probarlo en local: `python3 -m http.server 8000` dentro de la carpeta y abre `http://localhost:8000`. El micrófono solo funciona en `https://` o en `localhost`.

## Instalarlo en el iPad

1. Abre la URL en **Safari**.
2. **Compartir → Añadir a pantalla de inicio**.
3. Ábrela desde el icono. La primera vez pedirá permiso para el micrófono.

Instalada así funciona sin conexión, y Safari es menos propenso a borrar sus datos.

**Para publicar cambios:** sube los archivos nuevos y cambia `CACHE` en `sw.js` (por ejemplo `fieldrec-v0.1.1`). La app instalada descarga la versión nueva en segundo plano y la muestra la siguiente vez que se abre.

---

## Formato de los protocolos

### Markdown (`.md`)

Las slides se separan con una línea que contiene solo `---`. Un bloque formado únicamente por líneas `clave: valor` es una **cabecera**:

- La primera cabecera del archivo, si no tiene `task`, describe el protocolo.
- Cada cabecera con `task:` empieza una tarea nueva.

```markdown
---
title: Variación de /b d g/ — Sevilla 2027
consent: consentimiento.md
---
task: lista_palabras
label: Lista de palabras
recording: per_token
randomize: true
repetitions: 3
carrier: Digo {text} otra vez.
instructions: Lee la frase en voz alta.
items: palabras.csv
---
task: lectura
recording: continuous
---
<!-- id: parrafo1 -->
Texto del primer párrafo…
---
task: narracion
recording: both
---
![](img/vineta1.png)
---
![](img/vineta1.png) ![](img/vineta2.png) ![](img/vineta3.png)

## ¿Cómo termina la historia?
```

**Claves del protocolo**

| Clave | Valor |
|---|---|
| `title` | Título que aparece en la app y en los metadatos |
| `consent` | Texto literal o nombre de un archivo `.md` con el consentimiento |
| `author` | Opcional |

**Claves de la tarea**

| Clave | Valores | Por defecto |
|---|---|---|
| `task` | Nombre corto, se usa en los archivos (`lista_palabras`) | — |
| `label` | Nombre visible para el participante | el de `task` |
| `recording` | `per_token`, `continuous`, `both`, `none` | `per_token` |
| `randomize` | `false`, `true` (aleatorio por bloques de repetición), `full` (todo mezclado) | `false` |
| `repetitions` | Número de repeticiones de cada slide | 1 |
| `instructions` | Pantalla de instrucciones antes de empezar (no se graba) | — |
| `items` | Un CSV cuyas filas se convierten en slides | — |
| `carrier` | Frase marco; `{text}` se sustituye por el ítem (en negrita) | — |

**Dentro de cada slide**

- Markdown básico: `#`, `##`, `###`, párrafos, **negrita**, *cursiva*, `==resaltado==` y listas.
- Imágenes con `![alt](img/foto.jpg)`. Varias imágenes en la misma línea se muestran en fila.
- `<!-- id: nombre -->` fija el identificador del ítem en archivos y TextGrid. Si no lo pones, se genera a partir del texto.
- Una slide con solo un titular (`# palabra`) se muestra a tamaño grande. El texto se ajusta solo para que quepa en pantalla.

### CSV

En un `.csv` (separado por comas, punto y coma o tabuladores), cada fila es una slide. Columnas reconocidas: `text` (o `palabra`, `item`), `id`, `image`, `carrier`. Para un CSV que sea el protocolo completo también se reconocen `task`, `recording`, `randomize`, `repetitions` e `instructions`; los ajustes de cada tarea se toman de su primera fila.

```csv
task,text,recording,randomize
vocales,pipa,per_token,true
vocales,papa,,
vocales,pupa,,
```

### Añadir protocolos

- **Incluidos en la web:** crea una carpeta en `protocols/` y añádela a `protocols/index.json`. Si quieres que funcione sin conexión desde el primer momento, añade también sus archivos a la lista `SHELL` de `sw.js`.
- **Importados en el iPad o el ordenador:** Protocolos → **Importar archivos o .zip**. Hay tres formas:
  1. **Un .zip con la carpeta del protocolo (recomendado).** En la app Archivos, mantén pulsada la carpeta y elige **Comprimir**. Se respetan las subcarpetas, como `img/`.
  2. **Una carpeta** (botón **Importar carpeta**, solo en ordenador).
  3. **Archivos sueltos:** el `.md` o `.csv` y los archivos que usa. Si falta alguno, la app lo indica y puedes añadirlo con **Añadir archivos o .zip**. Los archivos se emparejan por nombre, así que no puede haber dos imágenes que se llamen igual.

  En la vista previa de cualquier protocolo, **Descargar .zip** genera una plantilla lista para editar y volver a importar.

Las imágenes tienen que estar en el propio protocolo. Por seguridad, la app bloquea cualquier recurso externo, incluidas las imágenes enlazadas desde otra web.

---

## Modos de grabación

| Modo | Qué hace | Archivos |
|---|---|---|
| `per_token` | Botón de grabar en cada slide. Puedes repetir una toma (se guarda como `_t2`, `_t3`…) | `P01_s1_tarea_03_cada_r2.wav` |
| `continuous` | Graba toda la tarea de principio a fin y anota cuándo cambia cada slide | `P01_s1_tarea.wav` y `P01_s1_tarea.TextGrid` |
| `both` | Como `continuous`, más un corte WAV por slide | lo anterior y `P01_s1_tarea_01_vineta1.wav`… |
| `none` | Solo muestra las slides | — |

El TextGrid tiene dos tiers: `slide` (identificador) y `texto` (texto de la slide).

**Controles:** *Siguiente* durante una grabación por token la para, la guarda y avanza. Con teclado Bluetooth o mando de presentaciones: → / AvPág (siguiente), ← / RePág (anterior), espacio (grabar o parar en tareas por token) y Esc (menú).

## Audio

- El micrófono se pide **sin cancelación de eco, sin supresión de ruido y sin control automático de ganancia**. La pantalla **Micrófono** muestra lo que el dispositivo ha aceptado realmente, y esa misma información se guarda en `session.json`.
- La captura se hace a la frecuencia del hardware (normalmente 48 000 Hz en iPad). Si eliges otra, se remuestrea con un filtro sinc con ventana de Kaiser (unos 80 dB de atenuación, banda de paso hasta aproximadamente el 92 % del Nyquist).
- **Pre-roll / post-roll:** la app guarda siempre el último segundo de audio, así que una toma puede empezar 250 o 500 ms antes de tocar el botón.
- El medidor se pone rojo si hay saturación, y la saturación queda registrada en cada toma (`clipped` en `trials.csv`).

## Exportación

Sesiones → **Exportar** → **Compartir / Guardar en Archivos** (AirDrop, OneDrive, la app Archivos…) o **Descargar ZIP**.

```
P01_s1_2026-11-22/
  audio/          WAV y TextGrid
  trials.csv      una fila por toma o intervalo (inicio, fin y duración en s, frecuencia, bits, saturación)
  session.json    participante, consentimiento, ajustes de audio solicitados y obtenidos,
                  semilla y orden de presentación, incidencias, información del dispositivo
  protocolo/      copia de los archivos de texto del protocolo usados
  LEEME.txt
```

**Registro** (en Sesiones) guarda cuándo se creó, completó, exportó o borró cada sesión, sin audio. Se puede exportar como CSV.

## Notas para el protocolo IRB

- La app es un sitio estático: no envía datos a ningún servidor, no usa analítica y no carga código ni recursos externos (lo impone su Content Security Policy).
- Las grabaciones se guardan en el almacenamiento local de Safari en el dispositivo, protegido por el cifrado de iOS si el dispositivo tiene código de desbloqueo.
- Los archivos solo llevan el código de participante.
- El consentimiento registra por separado la participación, la grabación y el archivo para uso futuro, con fecha y hora. Opcionalmente se puede grabar el consentimiento verbal.
- Para borrar una sesión hay que confirmar antes que la exportación está guardada, y el borrado queda en el registro.

## Limitaciones conocidas (v0.1.1)

- Solo mono.
- Una tarea continua se mantiene en memoria hasta que termina. Conviene que cada tarea continua no pase de unos 30–40 minutos. Si Safari se cierra en mitad de una tarea continua, esa tarea se pierde; las tomas por token se guardan una a una.
- iOS detiene el audio si la app pasa a segundo plano o se bloquea la pantalla. La app intenta mantener la pantalla encendida, registra la interrupción y pide tocar para reanudar.
- Todavía no importa PDF ni PPTX, y no cifra la exportación con contraseña.
- La interfaz de iPhone está por adaptar.

## Estructura del código

```
index.html              página única
css/app.css             estilos (iPad mini en vertical y horizontal)
js/app.js               interfaz y flujo de la sesión
js/audio.js             micrófono, pre-roll y medidor
js/recorder-worklet.js  AudioWorklet de captura
js/dsp.js               remuestreo y codificación WAV
js/wav-worker.js        worker que remuestrea y codifica sin bloquear la interfaz
js/protocol.js          lector de Markdown y CSV y aleatorización
js/db.js                IndexedDB
js/zip.js               generador de ZIP
js/unzip.js             lector de ZIP (importación de protocolos)
js/textgrid.js          TextGrid de Praat
sw.js                   caché para usarla sin conexión
protocols/              protocolos incluidos (index.json + carpetas)
```
