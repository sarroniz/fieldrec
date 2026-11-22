# Fieldrec

A web app for linguistic fieldwork. It shows the tasks (slides) of an elicitation protocol and records uncompressed WAV audio. Designed for iPad mini in portrait and landscape, hosted on GitHub Pages, and usable offline once added to the Home Screen.

- **No server and no external resources.** GitHub Pages only serves the code. Recordings stay on the device until you export them.
- **Recording modes per task:** per token, continuous, or continuous with per-slide cuts.
- **Audio:** mono WAV at the device's native sample rate or resampled (48,000, 44,100, 22,050 or 16,000 Hz), as 16-bit, 24-bit or 32-bit float.
- **Export:** a ZIP with the WAV files, Praat TextGrids for continuous tasks, `trials.csv` and `session.json`.
- **Protocol editor in the app:** build protocols step by step (task types, text, pictures, word lists) without writing any files.
- **Questions without audio:** short text, long text, number, single choice and multiple choice (optionally with “Other” and required), for background questionnaires. Answers are exported in `responses.csv`.
- **PowerPoint and PDF import:** slides from a `.pptx` are reproduced in the browser (navigation buttons hidden, images optimized); a PDF gives a pixel-exact copy.
- **Built-in Guide** (home screen → Guide): getting started, the editor, PowerPoint, Markdown for beginners, data safety and troubleshooting.

> **Prototype (v0.4.0).** Test it on your own iPad before using it with participants.

---

## Publish on GitHub Pages

1. Create a repository (e.g. `fieldrec`) and upload **everything in this folder** to its root, including the `.nojekyll` file.
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. About a minute later it is live at `https://YOUR-USERNAME.github.io/fieldrec/`.

To try it locally, run `python3 -m http.server 8000` inside the folder and open `http://localhost:8000`. The microphone only works over `https://` or on `localhost`.

## Install it on the iPad

1. Open the URL in **Safari**.
2. **Share → Add to Home Screen**.
3. Always open it from that icon. The first time, it asks for microphone access.

**Publishing updates:** upload the new files and change `CACHE` in `sw.js` (e.g. `fieldrec-v0.4.1`). When online, the app always loads the published version (GitHub Pages can take up to 10 minutes to serve it); offline, it uses the last version it saved. The version in use is shown at the bottom of the home screen.

---

## Creating protocols

There are three ways, from easiest to most technical:

1. **The editor** (Protocols → New protocol). Add tasks by type (word list, picture naming, reading passage, story from pictures, interview, text answers, multiple choice, information only), which sets the recording mode and order. Add slides as text, pictures, a pasted word list, or a PowerPoint/PDF. Select slides and move them between tasks. Saved protocols are stored as `protocol.json` plus media files; **Download .zip** exports them for backup or for another iPad.
2. **A PowerPoint presentation** (Protocols → From PowerPoint or PDF). Each slide is reproduced as positioned HTML: text boxes and placeholders (inheriting from layouts and masters), tables (including PowerPoint's default table style), pictures (cropping, transparency), preset and custom shapes, connectors, groups and backgrounds. Shapes with a "next/previous slide" action are hidden, hidden slides are skipped, PowerPoint sections can become tasks, and footer codes (if they identify the slides) become item IDs. Images are downscaled to about 2.2× the size they're shown at. Animations, transitions, video, charts and SmartArt are not reproduced; exporting the deck as **PDF** gives an exact copy (each page becomes a picture slide, rendered with pdf.js on the device).
3. **Markdown/CSV files**, described below. The in-app Guide has a beginner tutorial with templates to copy.

## Protocol format (Markdown)

### Markdown (`.md`)

Slides are separated by a line containing only `---`. A block made only of `key: value` lines is a **header**:

- The first header in the file, if it has no `task`, describes the protocol.
- Each header with `task:` starts a new task.

```markdown
---
title: /b d g/ lenition — Seville 2027
language: es
consent: consent.md
---
task: word_list
label: Word list
recording: per_token
randomize: true
repetitions: 3
carrier: Digo {text} otra vez.
instructions: Read the sentence aloud.
items: words.csv
---
task: reading
recording: continuous
---
<!-- id: paragraph1 -->
Text of the first paragraph…
---
task: story
recording: both
---
![](img/panel1.png)
---
![](img/panel1.png) ![](img/panel2.png) ![](img/panel3.png)

## How does the story end?
```

**Protocol keys**

| Key | Value |
|---|---|
| `title` | Title shown in the app and in the metadata |
| `consent` | Literal text, or the name of a `.md` file with the consent form |
| `language` | `en` (default) or `es`: language of the texts Fieldrec shows the participant (consent checkboxes, “Task 1 of 5”, break and thank-you screens). The rest of the interface is in English |
| `author` | Optional |

**Task keys**

| Key | Values | Default |
|---|---|---|
| `task` | Short name, used in file names (`word_list`) | — |
| `label` | Name shown to the participant | the `task` value |
| `recording` | `per_token`, `continuous`, `both`, `none` | `per_token` |
| `randomize` | `false`, `true` (shuffled within each repetition block), `full` (everything shuffled) | `false` |
| `repetitions` | How many times each slide is shown | 1 |
| `instructions` | Instructions screen shown before the task (not recorded) | — |
| `items` | A CSV file whose rows become slides | — |
| `carrier` | Carrier phrase; `{text}` is replaced by the item (in bold) | — |

Spanish key names (`tarea`, `grabacion`, `aleatorio`, `repeticiones`, `instrucciones`, `frase_marco`, `etiqueta`, `consentimiento`…) are accepted as aliases.

**Inside a slide**

- Basic Markdown: `#`, `##`, `###`, paragraphs, **bold**, *italics*, `==highlight==` and lists.
- Images with `![alt](img/photo.jpg)`. Several images on the same line are shown side by side.
- `<!-- id: name -->` sets the item ID used in file names and the TextGrid. Without it, the ID is generated from the text.
- `<!-- question: TYPE -->` turns the slide into a question answered on screen (no audio). TYPE is `short`, `long`, `number`, `single` or `multiple`, optionally followed by `; required` and/or `; other`. For `single` and `multiple`, each line starting with `-` is an option:

  ```markdown
  <!-- question: single; other -->
  <!-- id: first_language -->
  ## Which language did you learn first at home?
  - English
  - Spanish
  ```
- A slide containing only a heading (`# word`) is shown very large. Text always shrinks to fit the screen.

### CSV

In a `.csv` (comma, semicolon or tab separated), each row is a slide. Recognized columns: `text` (or `word`, `item`), `id`, `image`, `carrier`. A CSV can also be a whole protocol by adding `task`, `recording`, `randomize`, `repetitions` and `instructions`; each task's settings are taken from its first row.

```csv
task,text,recording,randomize
vowels,pipa,per_token,true
vowels,papa,,
vowels,pupa,,
```

### Adding protocols

- **Bundled with the website:** create a folder in `protocols/` and add it to `protocols/index.json`. For it to work offline from the start, also add its files to the `SHELL` list in `sw.js`.
- **Imported on the iPad or a computer:** Protocols → **Import files or .zip**. Three ways:
  1. **A .zip of the protocol folder (recommended).** In the Files app, long-press the folder and choose **Compress**. Subfolders such as `img/` are kept.
  2. **A folder** (the **Import folder** button, computers only).
  3. **Loose files:** the `.md` or `.csv` plus the files it uses. If anything is missing, the app says so and you can add it with **Add files or .zip**. Files are matched by name, so don't use two images with the same name.

  In any protocol's preview, **Download .zip** gives you a template you can edit and import again.

Images must be included in the protocol. For privacy, the app blocks anything loaded from other websites, including linked images.

### Accepted file types

| Use | Extensions |
|---|---|
| Presentations | `.pptx` · `.pdf` |
| Pictures | `.png` `.jpg` `.jpeg` `.gif` `.webp` `.svg` |
| Protocol files | `.zip` (from Fieldrec, with `protocol.json`; or a Markdown protocol folder) · `.md` `.markdown` · `.csv` `.tsv` `.txt` |
| Consent text | typed in the editor, or `.md` / `.txt` in Markdown protocols |
| Not supported | `.ppt` (save as .pptx), `.key` (export to PowerPoint or PDF), `.docx`, `.odp` |

---

## Recording modes

| Mode | What it does | Files |
|---|---|---|
| `per_token` | A record button on every slide. A take can be redone (saved as `_t2`, `_t3`…) | `P01_s1_task_03_cada_r2.wav` |
| `continuous` | Records the whole task from start to finish, marking each slide change | `P01_s1_task.wav` and `P01_s1_task.TextGrid` |
| `both` | Like `continuous`, plus one WAV cut per slide | the above plus `P01_s1_task_01_panel1.wav`… |
| `none` | Only shows the slides | — |

The TextGrid has two tiers: `slide` (item ID) and `texto` (slide text).

**Controls:** pressing *Next* while a per-token take is recording stops it, saves it and moves on. With a Bluetooth keyboard or presentation remote: → / Page Down (next), ← / Page Up (previous), Space (record/stop in per-token tasks) and Esc (menu).

## Audio

- The microphone is requested **without echo cancellation, noise suppression or automatic gain control**. The **Microphone** screen shows what the device actually accepted, and the same information is saved in `session.json`.
- Audio is captured at the hardware rate (usually 48,000 Hz on iPad). Any other rate is resampled with a Kaiser-windowed sinc filter (about 80 dB stopband attenuation, passband up to about 92% of Nyquist).
- **Pre-roll / post-roll:** the app always keeps the last second of audio, so a take can start 250 or 500 ms before the record button is tapped.
- The level meter turns red when the signal clips, and clipping is recorded for each take (`clipped` in `trials.csv`).

## Export

Sessions → **Export** → **Share / Save to Files** (AirDrop, OneDrive, the Files app…) or **Download ZIP**.

```
P01_s1_2026-11-22/
  audio/          WAV and TextGrid files
  trials.csv      one row per take or interval (onset, offset and duration in s, sample rate, bit depth, clipping)
  responses.csv   answers to questions, if any (id, type, answer, time; choices joined with " | ")
  session.json    participant code, consent, requested and obtained audio settings,
                  seed and presentation order, interruptions, device information
  protocol/       copy of the protocol text files used
  README.txt
```

The **Log** (in Sessions) records when each session was created, completed, exported or deleted, without any audio. It can be exported as CSV.

## Data safety

Recordings exist **only on the device**, in the browser's storage for this website. Exporting is the only backup.

- **Safari tabs:** Safari deletes all data a website has stored after 7 days of Safari use without visiting that site. Don't collect data from a Safari tab.
- **Home Screen app:** it has its own storage and its own usage counter, so the 7-day rule doesn't affect it in practice. But deleting the Home Screen icon deletes its data, the Safari tab and the Home Screen app don't share storage, and the system can evict website data when the device runs very low on space.
- **Private browsing** keeps nothing once the tab is closed.
- **During recording:** a continuous task is kept in memory until it ends, so a crash or closing the app mid-task loses that task. Per-token takes are saved one by one.
- **Good practice:** export after every session, check the ZIP on a computer before deleting the session from the iPad, and use Airplane mode or a Focus mode during sessions.

## Notes for an IRB protocol

- The app is a static website: it sends no data to any server, uses no analytics and loads no external code or resources (enforced by its Content Security Policy). PowerPoint and PDF files are processed on the device.
- Recordings are stored in Safari's local storage on the device, protected by iOS encryption when the device has a passcode.
- Files carry only the participant code.
- Consent records participation, recording and archiving for future use separately, with a timestamp. A verbal consent recording is optional.
- Deleting a session requires confirming that the export has been saved, and every deletion is logged.

## Known limitations (v0.4.0)

- Mono only.
- A continuous task stays in memory until it ends. Keep each continuous task under about 30–40 minutes.
- iOS stops the audio if the app goes to the background or the screen locks. The app tries to keep the screen on, logs the interruption and asks you to tap to resume.
- PowerPoint import approximates fonts the iPad doesn't have and doesn't reproduce animations, transitions, video, charts or SmartArt (use PDF for those slides).
- Exports are not password-protected.
- The iPhone layout is not adapted yet.

## Code structure

```
index.html              single page
css/app.css             styles (iPad mini portrait and landscape)
js/app.js               interface and session flow
js/guide.js             content of the Guide screen
js/editor.js            in-app protocol editor
js/pptx.js              PowerPoint reader (slides → positioned HTML) and image optimization
js/pdf-import.js        PDF import (pages → pictures), loads vendor/pdfjs on demand
js/audio.js             microphone, pre-roll and level meter
js/recorder-worklet.js  capture AudioWorklet
js/dsp.js               resampling and WAV encoding
js/wav-worker.js        worker that resamples and encodes without blocking the interface
js/protocol.js          Markdown and CSV reader, randomization
js/db.js                IndexedDB
js/zip.js               ZIP writer
js/unzip.js             ZIP reader (protocol import)
js/textgrid.js          Praat TextGrid
sw.js                   offline cache
protocols/              bundled protocols (index.json + folders)
vendor/pdfjs/           pdf.js 4.10.38 legacy build (Apache 2.0)
```
