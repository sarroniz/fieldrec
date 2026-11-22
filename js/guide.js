// Content of the Guide screen (static HTML).

const code = (s) => `<code>${s}</code>`;

export function guideHTML({ version, storageLine, standalone }) {
  return `
  <nav class="toc">
    <a href="#g-start">Getting started</a>
    <a href="#g-data" class="warn">Data safety</a>
    <a href="#g-session">Running a session</a>
    <a href="#g-protocols">Protocols</a>
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
      <li><b>Write your own protocol.</b> <b>Protocols</b> → <b>View</b> the example → <b>Download .zip</b>. Unzip it, edit the ${code('.md')} file in any text editor, replace the images, zip the folder again and <b>Import</b> it.</li>
    </ol>
  </details>

  <details class="guide danger" id="g-data" open>
    <summary>⚠ Data safety: how recordings can be lost</summary>
    <p><b>Recordings exist only on this device</b>, inside the browser’s storage for this website. There is no cloud copy. <b>Exporting is the only backup.</b></p>
    <h4>Browser storage can be deleted</h4>
    <ul>
      <li><b>In a Safari tab, data expires.</b> Safari deletes all data stored by a website (recordings, protocols, settings) after <b>7 days of Safari use without visiting it</b>. Never collect data from a Safari tab.</li>
      <li><b>Use the Home Screen app.</b> Apps added to the Home Screen have their own storage and their own usage counter, so the 7-day rule doesn’t affect them in practice. But:
        <ul>
          <li><b>Deleting the Home Screen icon deletes all its data.</b></li>
          <li>The Safari tab and the Home Screen app <b>don’t share storage</b>: sessions recorded in one don’t appear in the other.</li>
          <li>If the iPad runs very low on storage, the system can <b>evict website data</b>. Keep free space and watch the usage shown at the bottom of the home screen.</li>
          <li>Clearing website data in Settings (<i>Safari → Clear History and Website Data</i>) can remove it.</li>
        </ul></li>
      <li><b>Private browsing</b> keeps nothing: everything is lost when the tab closes.</li>
      <li><b>“Persistent storage”</b> (bottom of the home screen) means the browser agreed to protect the data from automatic eviction. Safari often says no, and even “yes” is not a substitute for exporting.</li>
    </ul>
    <h4>Data can also be lost while recording</h4>
    <ul>
      <li><b>Continuous tasks are kept in memory until the task ends.</b> If the app crashes or is closed mid-task, that task’s recording is lost. Per-token takes are saved one by one as soon as you stop them.</li>
      <li>Keep each continuous task under about <b>30–40 minutes</b>.</li>
      <li>Switching apps, locking the screen or an incoming call <b>interrupts the audio</b>. The gap is logged, and a red banner asks you to tap to resume.</li>
    </ul>
    <h4>Good practice</h4>
    <ul class="checks">
      <li>Export after <b>every</b> session, before starting the next participant.</li>
      <li>Open the ZIP on a computer and check it before deleting the session from the iPad.</li>
      <li>Turn on <b>Airplane mode</b> or a <b>Focus</b> mode during sessions to avoid calls and notifications.</li>
      <li>Keep a passcode on the iPad (it encrypts the stored data).</li>
      <li>Fieldrec asks you to confirm before deleting a session, and logs every export and deletion (<b>Sessions → Log</b>).</li>
    </ul>
  </details>

  <details class="guide" id="g-session">
    <summary>Running a session</summary>
    <p><b>Flow:</b> New session (protocol, participant code, audio settings) → consent → for each task: instructions screen → slides → pause screen → next task → end screen with <b>Export now</b>.</p>
    <table class="kv">
      <tr><th>Recording mode</th><th>What happens</th></tr>
      <tr><td><b>Per token</b></td><td>A red record button on every slide. Tap to start, tap to stop; the take is saved immediately. Recording again on the same slide saves a new take (${code('_t2')}, ${code('_t3')}…).</td></tr>
      <tr><td><b>Continuous</b></td><td>Records the whole task from the first slide to the last, marking each slide change. You get one WAV and a Praat TextGrid.</td></tr>
      <tr><td><b>Continuous + cuts</b></td><td>Like continuous, plus one WAV per slide cut from the continuous recording.</td></tr>
      <tr><td><b>No recording</b></td><td>Only shows the slides.</td></tr>
    </table>
    <h4>Controls</h4>
    <ul>
      <li><b>Next</b> while a per-token take is recording stops it, saves it and moves on.</li>
      <li>The <b>☰</b> menu: skip to the end of the task, reopen the microphone (e.g. after plugging in an external mic), or end the session. Anything being recorded is saved.</li>
      <li>Top bar: red dot and timer while recording; the level meter turns <b>red when the signal clips</b>.</li>
      <li><b>Bluetooth keyboard or presentation remote:</b> → / Page Down = next, ← / Page Up = previous, Space = record/stop (per-token tasks), Esc = menu.</li>
    </ul>
  </details>

  <details class="guide" id="g-protocols">
    <summary>Writing protocols</summary>
    <p>A protocol is a Markdown file. Slides are separated by a line containing only ${code('---')}. A block made only of ${code('key: value')} lines is a <b>header</b>: the first one (without ${code('task')}) describes the protocol, and each one with ${code('task:')} starts a new task.</p>
<pre>---
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
&lt;!-- id: paragraph1 --&gt;
Text of the first paragraph…
---
task: story
recording: both
---
![](img/panel1.png)
---
![](img/panel1.png) ![](img/panel2.png) ![](img/panel3.png)

## How does the story end?</pre>
    <table class="kv">
      <tr><th>Key</th><th>Values</th></tr>
      <tr><td>${code('title')}, ${code('consent')}</td><td>Protocol title; consent as literal text or a ${code('.md')} file.</td></tr>
      <tr><td>${code('language')}</td><td>${code('en')} (default) or ${code('es')}: the language of the texts Fieldrec shows the participant (consent checkboxes, “Task 1 of 5”, break and thank-you screens). Everything else in the app stays in English.</td></tr>
      <tr><td>${code('task')}</td><td>Short name used in file names (${code('word_list')}).</td></tr>
      <tr><td>${code('label')}</td><td>Name shown to the participant.</td></tr>
      <tr><td>${code('recording')}</td><td>${code('per_token')} (default), ${code('continuous')}, ${code('both')}, ${code('none')}.</td></tr>
      <tr><td>${code('randomize')}</td><td>${code('false')} (default), ${code('true')} (shuffled within each repetition block), ${code('full')} (everything shuffled). The random seed is saved, so the order can be reproduced.</td></tr>
      <tr><td>${code('repetitions')}</td><td>How many times each slide is shown (default 1).</td></tr>
      <tr><td>${code('instructions')}</td><td>Screen shown before the task (not recorded).</td></tr>
      <tr><td>${code('items')}</td><td>A CSV file whose rows become slides.</td></tr>
      <tr><td>${code('carrier')}</td><td>Carrier phrase; ${code('{text}')} is replaced by the item, in bold.</td></tr>
    </table>
    <h4>Inside a slide</h4>
    <ul>
      <li>Headings (${code('#')}, ${code('##')}), paragraphs, ${code('**bold**')}, ${code('*italics*')}, ${code('==highlight==')}, lists.</li>
      <li>Images: ${code('![](img/photo.jpg)')}. Several images on one line are shown side by side.</li>
      <li>${code('&lt;!-- id: name --&gt;')} sets the item ID used in file names and the TextGrid; otherwise it is generated from the text.</li>
      <li>A slide with only a heading is shown very large. Text always shrinks to fit the screen.</li>
    </ul>
    <h4>CSV word lists</h4>
    <p>One row per slide. Columns: ${code('text')}, ${code('id')}, ${code('image')}, ${code('carrier')}. A CSV can also be a whole protocol by adding ${code('task')}, ${code('recording')}, ${code('randomize')}, ${code('repetitions')} and ${code('instructions')} (taken from each task’s first row). Commas, semicolons and tabs all work as separators.</p>
    <h4>Importing</h4>
    <ul>
      <li><b>Best: a .zip of the protocol folder.</b> In the Files app, long-press the folder → <b>Compress</b>. Subfolders such as ${code('img/')} are kept.</li>
      <li>On a computer you can also import a whole <b>folder</b>.</li>
      <li>Or select the ${code('.md')} or ${code('.csv')} together with its files. If anything is missing, Fieldrec lists it and lets you add it later. Files are matched by name, so don’t use two images with the same name.</li>
    </ul>
  </details>

  <details class="guide" id="g-files">
    <summary>Accepted file types</summary>
    <table class="kv">
      <tr><th>Use</th><th>Extensions</th></tr>
      <tr><td>Protocol</td><td>${code('.md')} ${code('.markdown')} · ${code('.csv')} ${code('.tsv')} ${code('.txt')}</td></tr>
      <tr><td>Protocol bundle</td><td>${code('.zip')} (normal or compressed, e.g. from Files → Compress or Finder)</td></tr>
      <tr><td>Images</td><td>${code('.png')} ${code('.jpg')} ${code('.jpeg')} ${code('.gif')} ${code('.webp')} ${code('.svg')}</td></tr>
      <tr><td>Consent text</td><td>${code('.md')} ${code('.txt')}, or written directly in the protocol header</td></tr>
      <tr><td>Not supported yet</td><td>${code('.pptx')} ${code('.ppt')} ${code('.key')} ${code('.pdf')} ${code('.docx')}: export the slides as images and reference them from the ${code('.md')}.</td></tr>
    </table>
    <p>Images must be inside the protocol. For privacy, Fieldrec blocks anything loaded from other websites, including linked images.</p>
    <h4>What Fieldrec exports</h4>
    <table class="kv">
      <tr><td>${code('audio/*.wav')}</td><td>Mono WAV: 16-bit or 24-bit PCM, or 32-bit float.</td></tr>
      <tr><td>${code('audio/*.TextGrid')}</td><td>Praat TextGrid for continuous tasks, with ${code('slide')} and ${code('texto')} tiers.</td></tr>
      <tr><td>${code('trials.csv')}</td><td>One row per take or interval: times in seconds, sample rate, bit depth, clipping.</td></tr>
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
      <li>Fieldrec is a static website: it sends no data to any server, uses no analytics and loads nothing from other sites (enforced by its Content Security Policy).</li>
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
      <li><b>Missing images or files after importing.</b> Open the protocol in <b>Protocols</b>: it lists what is missing and lets you add it.</li>
      <li><b>Red “audio interrupted” banner.</b> Tap it to resume. The gap is logged in ${code('session.json')}.</li>
      <li><b>“Share” doesn’t appear when exporting.</b> Use <b>Download ZIP</b>; it goes to the Downloads folder in Files.</li>
      <li><b>Recording sounds processed or quiet.</b> Check the Microphone screen for voice processing, try an external microphone, and watch the level meter for clipping.</li>
    </ul>
  </details>

  <p class="foot">Fieldrec v${version} · ${storageLine}</p>`;
}
