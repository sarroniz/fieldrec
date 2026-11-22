// Content of the Guide screen (static HTML). Snippets with a Copy button use <div class="snippet">.

const code = (s) => `<code>${s}</code>`;
const snippet = (title, text) => `<div class="snippet"><div class="snippet-head"><span>${title}</span><button class="btn" data-copy>Copy</button></div><pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></div>`;

const MD_FULL = `---
title: My first protocol
language: es
consent: consent.md
---
task: word_list
label: Lista de palabras
recording: per_token
randomize: true
repetitions: 2
carrier: Digo {text} otra vez.
instructions: Lee en voz alta la frase que aparece en la pantalla.
items: words.csv
---
task: reading
label: Lectura
recording: continuous
instructions: Lee el texto en voz alta, a tu ritmo habitual.
---
El sábado por la tarde, Begoña bajó al mercado del barrio.

Por el camino se encontró con Diego, un amigo de la infancia.
---
task: pictures
label: Imágenes
recording: per_token
randomize: true
instructions: Di en voz alta el nombre de lo que ves.
---
![sun](img/sun.png)
---
![house](img/house.png)`;

const MD_TASKS = {
  words: `---
task: word_list
label: Word list
recording: per_token
randomize: true
carrier: Digo {text} otra vez.
items: words.csv`,
  wordsInline: `---
task: word_list
label: Word list
recording: per_token
randomize: true
---
# cada
---
# lado
---
# todo`,
  pictures: `---
task: picture_naming
label: Picture naming
recording: per_token
randomize: true
instructions: Say the name of what you see.
---
![sun](img/sun.png)
---
![house](img/house.png)`,
  reading: `---
task: reading
label: Reading
recording: continuous
instructions: Read the text aloud at your usual pace.
---
First paragraph of the text…

Second paragraph…`,
  story: `---
task: story
label: Story
recording: both
instructions: Look at the pictures and tell what happens.
---
![](img/panel1.png)
---
![](img/panel2.png)
---
![](img/panel1.png) ![](img/panel2.png) ![](img/panel3.png)

## How does the story end?`,
  interview: `---
task: interview
label: Conversation
recording: continuous
---
## Where did you grow up?
---
## What languages were spoken at home?`,
  questions: `---
task: background
label: Background
recording: none
---
<!-- question: number; required -->
<!-- id: age -->
## How old are you?
---
<!-- question: short -->
<!-- id: birthplace -->
## Where were you born?
---
<!-- question: single; other -->
<!-- id: first_language -->
## Which language did you learn first at home?
- English
- Spanish
- Both
---
<!-- question: multiple; required -->
<!-- id: languages -->
## Which languages do you speak?
- English
- Spanish
- French
---
<!-- question: long -->
## Anything else you would like to tell us?`,
  info: `---
task: intro
label: Introduction
recording: none
---
# Welcome!

Thank you for helping us with this study.`,
};
const CSV_EXAMPLE = `id,text
cada,cada
lado,lado
todo,todo`;

export function guideHTML({ version, storageLine, standalone }) {
  return `
  <nav class="toc">
    <a href="#g-start">Getting started</a>
    <a href="#g-data" class="warn">Data safety</a>
    <a href="#g-editor">Create a protocol</a>
    <a href="#g-pptx">From PowerPoint</a>
    <a href="#g-markdown">Markdown files</a>
    <a href="#g-session">Running a session</a>
    <a href="#g-files">File types</a>
    <a href="#g-audio">Audio</a>
    <a href="#g-privacy">Privacy &amp; IRB</a>
    <a href="#g-trouble">Troubleshooting</a>
  </nav>

  <details class="guide" id="g-start" open>
    <summary>Getting started</summary>
    <ol class="steps">
      <li><b>Install it.</b> Open the app’s address in <b>Safari</b>, tap <b>Share → Add to Home Screen</b>, and from then on always open it from that icon.
        ${standalone ? '<span class="pill ok">You are using the Home Screen app ✓</span>' : '<span class="pill warn">You are in a browser tab right now</span>'}</li>
      <li><b>Check the microphone.</b> Go to <b>Microphone</b>, tap <b>Turn on microphone</b>, allow access, and check the settings the device accepted. Record a 5-second test and listen to it.</li>
      <li><b>Try the example.</b> <b>New session</b> → choose <i>Example protocol (Spanish)</i> → participant code (e.g. ${code('TEST01')}) → consent → run through the tasks.</li>
      <li><b>Export.</b> At the end, tap <b>Export now → Share / Save to Files</b> (or AirDrop it to your computer). Open the ZIP and check the WAV files and the TextGrid in Praat.</li>
      <li><b>Make your own protocol.</b> Go to <b>Protocols → New protocol</b> to build one step by step, or <b>From PowerPoint or PDF</b> to start from a presentation. You don’t need to write any files: see <a href="#g-editor" data-jump>Create a protocol</a>.</li>
    </ol>
  </details>

  <details class="guide danger" id="g-data">
    <summary>⚠ Data safety: how recordings can be lost</summary>
    <p><b>Recordings exist only on this device</b>, inside the browser’s storage for this website. There is no cloud copy. <b>Exporting is the only backup.</b></p>
    <h4>Browser storage can be deleted</h4>
    <ul>
      <li><b>In a Safari tab, data expires.</b> Safari deletes all data stored by a website (recordings, protocols, settings) after <b>7 days of Safari use without visiting it</b>. Never collect data from a Safari tab.</li>
      <li><b>Use the Home Screen app.</b> Apps added to the Home Screen have their own storage and their own usage counter, so the 7-day rule doesn’t affect them in practice. But:
        <ul>
          <li><b>Deleting the Home Screen icon deletes all its data.</b></li>
          <li>The Safari tab and the Home Screen app <b>don’t share storage</b>: sessions and protocols created in one don’t appear in the other.</li>
          <li>If the iPad runs very low on storage, the system can <b>evict website data</b>. Keep free space and watch the usage shown at the bottom of the home screen.</li>
          <li>Clearing website data in Settings (<i>Safari → Clear History and Website Data</i>) can remove it.</li>
        </ul></li>
      <li><b>Private browsing</b> keeps nothing: everything is lost when the tab closes.</li>
      <li><b>“Persistent storage”</b> (bottom of the home screen) means the browser agreed to protect the data from automatic eviction. Safari often says no, and even “yes” is not a substitute for exporting.</li>
    </ul>
    <h4>Data can also be lost while recording</h4>
    <ul>
      <li><b>Continuous tasks are kept in memory until the task ends.</b> If the app crashes or is closed mid-task, that task’s recording is lost. Per-slide takes are saved one by one as soon as you stop them.</li>
      <li>Keep each continuous task under about <b>30–40 minutes</b>.</li>
      <li>Switching apps, locking the screen or an incoming call <b>interrupts the audio</b>. The gap is logged, and a red banner asks you to tap to resume.</li>
    </ul>
    <h4>Good practice</h4>
    <ul class="checks">
      <li>Export after <b>every</b> session, before starting the next participant.</li>
      <li>Open the ZIP on a computer and check it before deleting the session from the iPad.</li>
      <li>Keep a copy of your protocols too: <b>Protocols → View → Download .zip</b>.</li>
      <li>Turn on <b>Airplane mode</b> or a <b>Focus</b> mode during sessions to avoid calls and notifications.</li>
      <li>Keep a passcode on the iPad (it encrypts the stored data).</li>
    </ul>
  </details>

  <details class="guide" id="g-editor">
    <summary>Create a protocol in the app (step by step)</summary>
    <p>A <b>protocol</b> is everything a session needs: a consent text and a list of <b>tasks</b>. Each task is a group of <b>slides</b> recorded the same way: a word list, a reading passage, a set of pictures to name… Participants go through the tasks in order.</p>
    <ol class="steps">
      <li><b>Open the editor.</b> Go to <b>Protocols → New protocol</b>. (To change an existing protocol, open it with <b>View</b> and tap <b>Edit</b>.)</li>
      <li><b>Fill in “About this protocol”.</b>
        <ul>
          <li><b>Title:</b> the name you’ll see in New session.</li>
          <li><b>Language shown to participants:</b> English or Español. It changes the consent checkboxes, “Task 1 of 3” and the break and thank-you screens. Everything else stays in English.</li>
          <li><b>Consent text:</b> paste the text approved by your IRB. <i>Insert a template</i> gives you a starting point to replace.</li>
        </ul></li>
      <li><b>Add a task.</b> Tap <b>+ Add a task</b> and choose what kind it is. The type sets the recording mode and the slide order for you:
        <table class="kv">
          <tr><th>Type</th><th>Recording</th><th>Order</th></tr>
          <tr><td>Word or sentence list</td><td>Each slide separately</td><td>Random</td></tr>
          <tr><td>Picture naming</td><td>Each slide separately</td><td>Random</td></tr>
          <tr><td>Reading passage</td><td>One continuous recording</td><td>Fixed</td></tr>
          <tr><td>Story from pictures</td><td>Continuous + one file per slide</td><td>Fixed</td></tr>
          <tr><td>Interview or open questions</td><td>One continuous recording</td><td>Fixed</td></tr>
          <tr><td>Text answers (questionnaire)</td><td>No recording: typed answers</td><td>Fixed</td></tr>
          <tr><td>Multiple choice</td><td>No recording: chosen answers</td><td>Fixed</td></tr>
          <tr><td>Information only</td><td>No recording</td><td>Fixed</td></tr>
        </table>
        Then give the task a name (participants see it on the instructions screen).</li>
      <li><b>Add slides</b> with the buttons at the bottom of the task:
        <ul>
          <li><b>Text:</b> type what should appear. A line starting with ${code('#')} becomes big text (ideal for single words); ${code('**word**')} makes a word bold; a blank line starts a new paragraph. The preview shows the result.</li>
          <li><b>Pictures:</b> choose one or more images; each becomes one slide. You can add a caption afterwards with <b>Edit</b>.</li>
          <li><b>Word list:</b> paste your items, one per line. Optionally add a carrier phrase such as ${code('Digo {text} otra vez.')}: ${code('{text}')} is replaced by each item, in bold.</li>
          <li><b>PowerPoint or PDF:</b> brings in every slide of a presentation. See <a href="#g-pptx" data-jump>From PowerPoint</a>.</li>
          <li><b>Question:</b> a question the participant answers on the iPad, with no audio. Choose the type of answer: <i>short text</i>, <i>long text</i>, <i>number</i>, <i>one answer</i> (single choice) or <i>several answers</i> (multiple choice). For choices, write the options one per line and, if you want, add “Other” with a box to type in. Mark it <b>required</b> if the participant must answer before continuing.</li>
          <li><b>Sample background questions</b> (in “Text answers” tasks): adds typical questions (age, place of birth, where they grew up, languages, education…) in the protocol’s language, ready to edit or delete.</li>
        </ul></li>
      <li><b>Optional settings for each task:</b> an <b>instructions screen</b> shown before the task starts (nothing is recorded on it), how many <b>repetitions</b> of each slide, and the <b>slide order</b> (fixed, random, or fully random across repetitions). The random order changes for every participant and is saved with each session.</li>
      <li><b>Organize the slides.</b> Tap a slide to edit it. Use <b>‹ ›</b> to move it earlier or later, and <b>✕</b> to delete it. To move several slides to another task, tap the circle in their corner to select them, then use <b>Move to</b> in the bar at the bottom of the screen. Choose “New task…” there to create the task as you move them.</li>
      <li><b>Check the item IDs.</b> Each slide has a short ID (shown under it) that goes into the file names, for example ${code('P01_s1_word_list_03_cada.wav')}. Change it with <b>Edit</b> if you want clearer names.</li>
      <li><b>Save.</b> The protocol now appears in <b>New session</b>. <b>Save and start a session</b> takes you straight there.</li>
      <li><b>Back it up or share it.</b> <b>Download .zip</b> saves a file you can keep, or import on another iPad with <b>Protocols → Import files or .zip</b>.</li>
    </ol>
    <h4>Tips</h4>
    <ul>
      <li>Put practice items in their own task, so they don’t mix with the real items when the order is random.</li>
      <li>For intro or explanation slides that shouldn’t be recorded, use an <b>Information only</b> task.</li>
      <li>Answers to questions are exported in <b>responses.csv</b>, one row per question, with the item ID as identifier: give questions short, clear IDs (${code('age')}, ${code('birthplace')}…).</li>
      <li>In tasks recorded “each slide separately”, recording is optional on every slide: slides you don’t record (examples, answers) simply produce no file.</li>
      <li>Try the protocol yourself with a test code such as ${code('TEST01')} before your first participant, and check the exported files.</li>
    </ul>
  </details>

  <details class="guide" id="g-pptx">
    <summary>Use a PowerPoint presentation</summary>
    <p>If you already have your stimuli in PowerPoint, Fieldrec can use the slides directly.</p>
    <ol class="steps">
      <li><b>Prepare the presentation</b> (optional, but it saves time later):
        <ul>
          <li>One slide per item, in the order you want.</li>
          <li>Group the slides with PowerPoint <b>sections</b> (<i>Home → Section → Add Section</i>), one section per task, such as “Introduction”, “Practice” and “Test”. Fieldrec offers to turn each section into a task.</li>
          <li>To control the file names, put an item code in each slide’s <b>footer</b> (<i>Insert → Header &amp; Footer → Footer</i>). If the footers identify the slides (44, 41, 50…), Fieldrec uses them as item IDs.</li>
          <li>Navigation buttons like “next” can stay: they’re hidden automatically, because Fieldrec has its own Next button.</li>
        </ul></li>
      <li><b>Get the file onto the iPad:</b> AirDrop, iCloud Drive, OneDrive, Google Drive or email. Anything that puts the ${code('.pptx')} in the Files app works.</li>
      <li><b>Import it.</b> <b>Protocols → From PowerPoint or PDF</b> and choose the file. Fieldrec reads every slide, reproduces it (text, tables, pictures and shapes in place), hides navigation buttons and slides hidden in PowerPoint, and shrinks heavy images to the size they’re shown at. A large presentation can take a minute.</li>
      <li><b>Split the slides into tasks.</b> All slides arrive in one task, unless you chose to use the sections. Select the slides of each part and use <b>Move to → New task…</b>, choosing the right type (for example: introduction = Information only; practice and test = Each slide separately).</li>
      <li><b>Check, save and test-run it</b> as in <a href="#g-editor" data-jump>Create a protocol</a>.</li>
    </ol>
    <h4>What isn’t reproduced</h4>
    <ul>
      <li><b>Animations and transitions:</b> every element appears at once.</li>
      <li><b>Video and audio</b> embedded in slides don’t play (the poster image is shown).</li>
      <li><b>Charts, SmartArt and embedded objects</b> show as an empty box.</li>
      <li><b>Fonts</b> the iPad doesn’t have are replaced by similar ones, so line breaks can differ slightly.</li>
    </ul>
    <h4>If a slide doesn’t look right: use a PDF</h4>
    <p>A PDF keeps the exact look of every slide. Each page becomes a picture slide (navigation buttons stay visible and item IDs are ${code('p01')}, ${code('p02')}…).</p>
    <ul>
      <li><b>PowerPoint for Mac:</b> <i>File → Export… → File Format: PDF</i>.</li>
      <li><b>PowerPoint for Windows:</b> <i>File → Export → Create PDF/XPS</i>.</li>
      <li><b>PowerPoint on iPad:</b> <i>File (…) → Export → PDF</i>.</li>
      <li><b>Keynote:</b> <i>File → Export To → PDF</i>. <b>Google Slides:</b> <i>File → Download → PDF document</i>.</li>
    </ul>
    <p>Old ${code('.ppt')} files must be saved as ${code('.pptx')} first (<i>File → Save As</i>). Keynote files must be exported to PowerPoint or PDF.</p>
  </details>

  <details class="guide" id="g-markdown">
    <summary>Write a protocol as a Markdown file (advanced)</summary>
    <p>Most people never need this: the editor does the same without files. Markdown is useful if you want to keep protocols as plain text (for example in a GitHub repository), generate them with a script, or copy long lists quickly.</p>
    <h4>What is a Markdown file?</h4>
    <p>A <b>plain text</b> file whose name ends in ${code('.md')}. You can write it in any text editor. A few symbols add formatting: ${code('#')} at the start of a line makes a heading, ${code('**…**')} makes bold, and ${code('![](picture.png)')} inserts a picture.</p>
    <h4>Step 1 · Create the file</h4>
    <ul>
      <li><b>Mac:</b> open <b>TextEdit</b>, choose <i>Format → Make Plain Text</i> (important), write the protocol, then <i>File → Save</i> with the name ${code('protocol.md')}. If TextEdit asks, choose “Use .md”. Code editors like BBEdit or Visual Studio Code work too.</li>
      <li><b>Windows:</b> open <b>Notepad</b>, write the protocol, then <i>File → Save As</i>: name ${code('protocol.md')}, <i>Save as type: All files</i>, <i>Encoding: UTF-8</i>. Otherwise you get ${code('protocol.md.txt')}.</li>
      <li><b>iPad:</b> the Files app can’t create text files. Use a text editor app, or write the file on a computer.</li>
    </ul>
    <h4>Step 2 · Write the protocol</h4>
    <p>The file is a list of blocks separated by a line containing only three dashes (${code('---')}). A block made only of ${code('key: value')} lines is a <b>header</b>. The first header describes the protocol; each header with ${code('task:')} starts a new task. Every other block is one slide. A complete example:</p>
    ${snippet('protocol.md', MD_FULL)}
    <h4>Step 3 · Put the files in a folder and compress it</h4>
    <pre class="tree">my-protocol/
  protocol.md
  consent.md        ← the consent text (also Markdown)
  words.csv         ← optional word list
  img/
    sun.png
    house.png</pre>
    <p>In the Files app or Finder, compress the folder (<i>long-press or right-click → Compress</i>) and import the ${code('.zip')} with <b>Protocols → Import files or .zip</b>. Fieldrec lists any file the protocol uses but can’t find.</p>
    <h4>Templates for each type of task</h4>
    <p>Copy the ones you need and paste them under the protocol header.</p>
    ${snippet('Word list from a CSV file', MD_TASKS.words)}
    ${snippet('words.csv (one row per item)', CSV_EXAMPLE)}
    ${snippet('Word list written directly', MD_TASKS.wordsInline)}
    ${snippet('Picture naming', MD_TASKS.pictures)}
    ${snippet('Reading passage', MD_TASKS.reading)}
    ${snippet('Story from pictures', MD_TASKS.story)}
    ${snippet('Interview questions', MD_TASKS.interview)}
    ${snippet('Questionnaire: text and multiple-choice questions', MD_TASKS.questions)}
    ${snippet('Information only (no recording)', MD_TASKS.info)}
    <h4>All the keys</h4>
    <table class="kv">
      <tr><th>Key</th><th>Values</th></tr>
      <tr><td>${code('title')}</td><td>Protocol title.</td></tr>
      <tr><td>${code('language')}</td><td>${code('en')} (default) or ${code('es')}: language of the texts Fieldrec shows the participant.</td></tr>
      <tr><td>${code('consent')}</td><td>Consent as literal text, or the name of a ${code('.md')} file.</td></tr>
      <tr><td>${code('task')}</td><td>Short name used in file names (${code('word_list')}).</td></tr>
      <tr><td>${code('label')}</td><td>Name shown to the participant.</td></tr>
      <tr><td>${code('recording')}</td><td>${code('per_token')} (default), ${code('continuous')}, ${code('both')}, ${code('none')}.</td></tr>
      <tr><td>${code('randomize')}</td><td>${code('false')} (default), ${code('true')} (shuffled within each repetition), ${code('full')} (everything shuffled).</td></tr>
      <tr><td>${code('repetitions')}</td><td>How many times each slide is shown (default 1).</td></tr>
      <tr><td>${code('instructions')}</td><td>Screen shown before the task (not recorded).</td></tr>
      <tr><td>${code('items')}</td><td>A CSV file whose rows become slides (columns ${code('text')}, ${code('id')}, ${code('image')}, ${code('carrier')}).</td></tr>
      <tr><td>${code('carrier')}</td><td>Carrier phrase for the CSV items; ${code('{text}')} is replaced by the item.</td></tr>
    </table>
    <p><b>Questions:</b> a slide with ${code('&lt;!-- question: TYPE --&gt;')} becomes a question. TYPE is ${code('short')}, ${code('long')}, ${code('number')}, ${code('single')} or ${code('multiple')}; add ${code('; required')} and/or ${code('; other')}. For choices, each line starting with ${code('-')} is an option.</p>
    <p>Inside a slide: ${code('&lt;!-- id: name --&gt;')} sets the item ID, ${code('==text==')} highlights, and several pictures on one line are shown side by side. Spanish key names (${code('tarea')}, ${code('grabacion')}, ${code('aleatorio')}…) also work.</p>
    <h4>Common mistakes</h4>
    <ul>
      <li>A missing ${code('---')} line, so two slides (or a header and a slide) become one.</li>
      <li>Saving as rich text (${code('.rtf')}) or as ${code('protocol.md.txt')}.</li>
      <li>Picture names that don’t match the files exactly (for example ${code('Sun.PNG')} vs ${code('sun.png')} is fine, but ${code('sun.png')} vs ${code('sol.png')} isn’t).</li>
      <li>A CSV exported from Excel in another encoding: use <i>CSV UTF-8</i>.</li>
    </ul>
  </details>

  <details class="guide" id="g-session">
    <summary>Running a session</summary>
    <p><b>Flow:</b> New session (protocol, participant code, audio settings) → consent → for each task: instructions screen (if any) → slides → break screen → next task → end screen with <b>Export now</b>.</p>
    <table class="kv">
      <tr><th>Recording</th><th>What happens</th></tr>
      <tr><td><b>Each slide separately</b></td><td>A red record button on every slide. Tap to start, tap to stop; the take is saved immediately. Recording again on the same slide saves a new take (${code('_t2')}, ${code('_t3')}…).</td></tr>
      <tr><td><b>One continuous recording</b></td><td>Records the whole task from the first slide to the last, marking each slide change. You get one WAV and a Praat TextGrid.</td></tr>
      <tr><td><b>Continuous + one file per slide</b></td><td>Like continuous, plus one WAV per slide cut from the continuous recording.</td></tr>
      <tr><td><b>No recording</b></td><td>Only shows the slides.</td></tr>
    </table>
    <p><b>Questions</b> show a text box or options to tap. The participant (or you) types or chooses the answer and taps <b>Next</b>; Enter also moves on after a short answer. A required question can’t be skipped. Going back shows the answer given, which can be changed.</p>
    <h4>Controls</h4>
    <ul>
      <li><b>Next</b> while a take is recording stops it, saves it and moves on.</li>
      <li>The <b>☰</b> menu: skip to the end of the task, reopen the microphone (e.g. after plugging in an external mic), or end the session. Anything being recorded is saved.</li>
      <li>Top bar: red dot and timer while recording; the level meter turns <b>red when the signal clips</b>.</li>
      <li><b>Bluetooth keyboard or presentation remote:</b> → / Page Down = next, ← / Page Up = previous, Space = record/stop, Esc = menu.</li>
    </ul>
  </details>

  <details class="guide" id="g-files">
    <summary>Accepted file types</summary>
    <table class="kv">
      <tr><th>Use</th><th>Extensions</th></tr>
      <tr><td>Presentations</td><td>${code('.pptx')} (PowerPoint 2007 or later) · ${code('.pdf')}</td></tr>
      <tr><td>Pictures</td><td>${code('.png')} ${code('.jpg')} ${code('.jpeg')} ${code('.gif')} ${code('.webp')} ${code('.svg')}</td></tr>
      <tr><td>Protocol files</td><td>${code('.zip')} downloaded from Fieldrec (${code('protocol.json')} inside) · ${code('.md')} ${code('.markdown')} · ${code('.csv')} ${code('.tsv')} ${code('.txt')}</td></tr>
      <tr><td>Consent text</td><td>Typed in the editor, or a ${code('.md')} / ${code('.txt')} file in Markdown protocols</td></tr>
      <tr><td>Not supported</td><td>${code('.ppt')} (save as .pptx), ${code('.key')} (export to PowerPoint or PDF), ${code('.docx')}, ${code('.odp')}</td></tr>
    </table>
    <p>Pictures must be inside the protocol. For privacy, Fieldrec blocks anything loaded from other websites, including linked images.</p>
    <h4>What Fieldrec exports</h4>
    <table class="kv">
      <tr><td>${code('audio/*.wav')}</td><td>Mono WAV: 16-bit or 24-bit PCM, or 32-bit float.</td></tr>
      <tr><td>${code('audio/*.TextGrid')}</td><td>Praat TextGrid for continuous tasks, with ${code('slide')} and ${code('texto')} tiers.</td></tr>
      <tr><td>${code('trials.csv')}</td><td>One row per take or interval: times in seconds, sample rate, bit depth, clipping.</td></tr>
      <tr><td>${code('responses.csv')}</td><td>Answers to questions: one row per question, with its ID, type, the answer (choices joined with “ | ”) and the time.</td></tr>
      <tr><td>${code('session.json')}</td><td>Participant code, consent, requested and obtained audio settings, presentation order and seed, interruptions, device.</td></tr>
      <tr><td>${code('protocol/')}</td><td>Copy of the protocol text files used.</td></tr>
    </table>
  </details>

  <details class="guide" id="g-audio">
    <summary>Audio settings</summary>
    <ul>
      <li><b>Sample rate.</b> The iPad captures at its hardware rate (usually 48,000 Hz). <i>Native</i> keeps it; 44,100, 22,050 or 16,000 Hz are resampled with a high-quality filter. Choosing a rate above the hardware rate adds no information.</li>
      <li><b>Bit depth.</b> 16-bit is enough for most phonetic work; 24-bit or 32-bit float give more headroom.</li>
      <li><b>Pre-roll / post-roll.</b> Fieldrec always keeps the last second of audio, so a take can start 250–500 ms before you tap record, and continue for a moment after you stop.</li>
      <li><b>Voice processing.</b> Fieldrec asks iPadOS to turn off echo cancellation, noise suppression and automatic gain control. Safari doesn’t always comply, so check what was obtained on the <b>Microphone</b> screen. The same information is saved in each session’s ${code('session.json')}.</li>
      <li><b>External microphones</b> (USB-C or Lightning) work and greatly improve quality. Connect them before turning on the microphone, or use <b>☰ → Reopen microphone</b>.</li>
    </ul>
  </details>

  <details class="guide" id="g-privacy">
    <summary>Privacy &amp; IRB notes</summary>
    <ul>
      <li>Fieldrec is a static website: it sends no data to any server, uses no analytics and loads nothing from other sites (enforced by its Content Security Policy). PowerPoint and PDF files are processed on the iPad itself.</li>
      <li>Recordings stay in this device’s local storage, which iPadOS encrypts when a passcode is set.</li>
      <li>Files are named only with the participant code. Never type names.</li>
      <li>Consent records participation, recording and archiving separately, with a timestamp. A verbal consent recording is optional.</li>
      <li>A recorded voice is identifiable data even without a name. Describe its storage, access and retention in your protocol.</li>
    </ul>
  </details>

  <details class="guide" id="g-trouble">
    <summary>Troubleshooting</summary>
    <ul>
      <li><b>No microphone access.</b> In iPad Settings, open Safari (<i>Settings → Apps → Safari</i> on recent iPadOS) → <b>Microphone</b> → Ask or Allow. Then reopen Fieldrec.</li>
      <li><b>A new version isn’t showing.</b> Reload, or close and reopen the app. The version number is at the bottom of the home screen. GitHub Pages can take about 10 minutes to publish changes.</li>
      <li><b>A PowerPoint slide looks different.</b> Export the presentation as PDF and import the PDF instead (see <a href="#g-pptx" data-jump>From PowerPoint</a>).</li>
      <li><b>Importing a large presentation is slow.</b> Big images are being optimized; it can take a minute. Keep the app open.</li>
      <li><b>Missing images or files after importing a Markdown protocol.</b> Open the protocol in <b>Protocols</b>: it lists what is missing and lets you add it.</li>
      <li><b>Red “audio interrupted” banner.</b> Tap it to resume. The gap is logged in ${code('session.json')}.</li>
      <li><b>“Share” doesn’t appear when exporting.</b> Use <b>Download ZIP</b>; it goes to the Downloads folder in Files.</li>
      <li><b>Recording sounds processed or quiet.</b> Check the Microphone screen for voice processing, try an external microphone, and watch the level meter for clipping.</li>
    </ul>
  </details>

  <p class="foot">Fieldrec v${version} · ${storageLine}</p>`;
}
