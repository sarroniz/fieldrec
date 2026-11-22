// Capture engine: microphone → AudioWorklet → Float32 blocks in memory.
// Keeps the microphone open for the whole session (no start-up lag or repeated permission prompts)
// and always keeps the last second in a ring buffer for pre-roll.

export const REQUESTED_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.track = null;
    this.node = null;
    this.source = null;
    this.ring = [];
    this.ringLen = 0;
    this.recording = false;
    this.chunks = [];
    this.startFrame = 0;
    this.lastEndFrame = 0;
    this.peakHold = 0;
    this.clipped = false;
    this.levelListeners = new Set();
    this.stateListeners = new Set();
    this.worker = null;
    this.jobs = new Map();
    this.jobId = 0;
    this.deviceId = null;
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : null; }
  get isLive() { return !!(this.track && this.track.readyState === 'live' && this.ctx && this.ctx.state === 'running'); }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
      (window.AudioContext || window.webkitAudioContext) && window.AudioWorkletNode);
  }

  async open() {
    if (this.ctx && this.track && this.track.readyState === 'live') {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    await this._openStream();
  }

  async _openStream() {
    const audio = { ...REQUESTED_CONSTRAINTS };
    if (this.deviceId) audio.deviceId = { exact: this.deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    this.track = this.stream.getAudioTracks()[0];
    this.track.addEventListener('ended', () => this._emitState('track-ended'));

    // The context is created AFTER getting the microphone so it adopts the hardware sample rate.
    if (!this.ctx || this.ctx.state === 'closed') {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      ctx.addEventListener('statechange', () => { if (this.ctx === ctx) this._emitState(ctx.state); });
      await this.ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));
    }
    if (this.source) { try { this.source.disconnect(); } catch (_) {} }
    if (!this.node) {
      this.node = new AudioWorkletNode(this.ctx, 'capture-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      });
      this.node.port.onmessage = (e) => this._onBlock(e.data);
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      this.node.connect(mute).connect(this.ctx.destination);
    }
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.node);
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this._emitState('open');
  }

  // Call before recording: reopens the microphone if iOS closed it (e.g. after going to the background).
  async ensureRunning() {
    if (!this.track || this.track.readyState !== 'live') await this._openStream();
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  async listInputs() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'audioinput');
    } catch (_) { return []; }
  }

  async useDevice(deviceId) {
    this.deviceId = deviceId || null;
    if (this.track) this.track.stop();
    await this._openStream();
  }

  info() {
    let trackSettings = {};
    try { trackSettings = this.track ? this.track.getSettings() : {}; } catch (_) {}
    return {
      requested: REQUESTED_CONSTRAINTS,
      obtained: trackSettings,
      inputLabel: this.track ? this.track.label : '',
      contextSampleRate: this.sampleRate,
      baseLatency: this.ctx ? this.ctx.baseLatency : null,
    };
  }

  onLevel(fn) { this.levelListeners.add(fn); return () => this.levelListeners.delete(fn); }
  onState(fn) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); }
  _emitState(s) { for (const fn of this.stateListeners) { try { fn(s); } catch (_) {} } }

  _onBlock({ samples, peak, clipped, endFrame }) {
    this.lastEndFrame = endFrame;
    // ~1 s ring buffer for pre-roll
    this.ring.push(samples);
    this.ringLen += samples.length;
    const maxRing = (this.sampleRate || 48000) * 1.0;
    while (this.ring.length > 1 && this.ringLen - this.ring[0].length >= maxRing) {
      this.ringLen -= this.ring.shift().length;
    }
    if (this.recording) {
      this.chunks.push(samples);
      if (clipped) this.clipped = true;
    }
    for (const fn of this.levelListeners) { try { fn(peak, clipped); } catch (_) {} }
  }

  start(prerollMs = 0) {
    if (!this.ctx) throw new Error('The microphone is not open');
    const sr = this.sampleRate;
    let need = Math.round((prerollMs / 1000) * sr);
    const pre = [];
    for (let i = this.ring.length - 1; i >= 0 && need > 0; i--) {
      const c = this.ring[i];
      if (c.length <= need) { pre.unshift(c); need -= c.length; }
      else { pre.unshift(c.subarray(c.length - need)); need = 0; }
    }
    const preLen = pre.reduce((a, c) => a + c.length, 0);
    this.chunks = pre;
    this.startFrame = this.lastEndFrame - preLen;
    this.clipped = false;
    this.recording = true;
    this.startedAt = new Date();
  }

  // Current position (in native-rate samples) relative to the start of the current recording.
  offset() {
    if (!this.ctx) return 0;
    return Math.max(0, Math.round(this.ctx.currentTime * this.sampleRate) - this.startFrame);
  }

  async stop(postrollMs = 0) {
    if (!this.recording) return null;
    // wait for the post-roll plus one block to flush whatever is still in the worklet
    const blockMs = (2048 / this.sampleRate) * 1000;
    await new Promise((r) => setTimeout(r, postrollMs + blockMs + 10));
    this.recording = false;
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const out = new Float32Array(total);
    let p = 0;
    for (const c of this.chunks) { out.set(c, p); p += c.length; }
    this.chunks = [];
    return { samples: out, sampleRate: this.sampleRate, clipped: this.clipped, startedAt: this.startedAt };
  }

  cancel() { this.recording = false; this.chunks = []; }

  // Resample + encode in the worker. slices: [[start, end], ...] in native samples.
  encode(samples, inRate, outRate, bitDepth, slices) {
    if (!this.worker) {
      this.worker = new Worker(new URL('./wav-worker.js', import.meta.url));
      this.worker.onmessage = (e) => {
        const job = this.jobs.get(e.data.id);
        if (!job) return;
        this.jobs.delete(e.data.id);
        if (e.data.ok) job.resolve(e.data); else job.reject(new Error(e.data.error));
      };
    }
    const id = ++this.jobId;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ id, samples, inRate, outRate: outRate || inRate, bitDepth, slices }, [samples.buffer]);
    });
  }

  close() {
    this.recording = false;
    if (this.track) this.track.stop();
    if (this.ctx) this.ctx.close();
    this.ctx = null; this.node = null; this.source = null; this.track = null; this.stream = null;
    this.ring = []; this.ringLen = 0;
  }
}
