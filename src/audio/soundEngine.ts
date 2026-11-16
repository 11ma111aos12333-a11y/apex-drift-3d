/**
 * Procedural Web Audio synthesizer for dynamic engine RPM, tire screech,
 * nitro thrust, collision impacts, horn, and countdown beeps.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private tireGain: GainNode | null = null;
  private nitroGain: GainNode | null = null;
  private muted = false;
  private started = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.35, this.ctx.currentTime, 0.05);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  unlock(): void {
    if (this.started) {
      if (this.ctx?.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.35;
    this.masterGain.connect(this.ctx.destination);

    // Engine dual-oscillator synth (fundamental + harmonic growl)
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 340;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 55;

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 110;

    this.engineOsc1.connect(engineFilter);
    this.engineOsc2.connect(engineFilter);
    engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc1.start();
    this.engineOsc2.start();

    // Shared white noise buffer for tire screech & nitro roar
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const tireNoise = this.ctx.createBufferSource();
    tireNoise.buffer = noiseBuffer;
    tireNoise.loop = true;

    this.tireFilter = this.ctx.createBiquadFilter();
    this.tireFilter.type = 'bandpass';
    this.tireFilter.frequency.value = 1350;
    this.tireFilter.Q.value = 6;

    this.tireGain = this.ctx.createGain();
    this.tireGain.gain.value = 0;

    tireNoise.connect(this.tireFilter);
    this.tireFilter.connect(this.tireGain);
    this.tireGain.connect(this.masterGain);
    tireNoise.start();

    const nitroNoise = this.ctx.createBufferSource();
    nitroNoise.buffer = noiseBuffer;
    nitroNoise.loop = true;

    const nitroFilter = this.ctx.createBiquadFilter();
    nitroFilter.type = 'bandpass';
    nitroFilter.frequency.value = 420;
    nitroFilter.Q.value = 1.2;

    this.nitroGain = this.ctx.createGain();
    this.nitroGain.gain.value = 0;

    nitroNoise.connect(nitroFilter);
    nitroFilter.connect(this.nitroGain);
    this.nitroGain.connect(this.masterGain);
    nitroNoise.start();

    this.started = true;
  }

  updateTelemetry(rpm: number, drifting: boolean, nitroActive: boolean, active: boolean): void {
    if (!this.started || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (!active || this.muted) {
      this.engineGain?.gain.setTargetAtTime(0, now, 0.08);
      this.tireGain?.gain.setTargetAtTime(0, now, 0.06);
      this.nitroGain?.gain.setTargetAtTime(0, now, 0.06);
      return;
    }

    const baseFreq = 42 + (rpm / 8500) * 145;
    this.engineOsc1?.frequency.setTargetAtTime(baseFreq, now, 0.04);
    this.engineOsc2?.frequency.setTargetAtTime(baseFreq * 1.98, now, 0.04);
    this.engineGain?.gain.setTargetAtTime(0.14 + (rpm / 8500) * 0.14, now, 0.05);

    this.tireGain?.gain.setTargetAtTime(drifting ? 0.16 : 0, now, 0.05);
    if (drifting && this.tireFilter) {
      this.tireFilter.frequency.setTargetAtTime(1250 + (rpm / 8500) * 450, now, 0.06);
    }

    this.nitroGain?.gain.setTargetAtTime(nitroActive ? 0.22 : 0, now, 0.04);
  }

  playCollision(intensity: number): void {
    if (!this.started || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.16);
    const vol = Math.min(0.45, 0.1 + intensity * 0.025);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playHorn(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    for (const freq of [349, 440]) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.12, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  }

  playCountdownBeep(isGo: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = isGo ? 880 : 440;
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.35 : 0.18));
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (isGo ? 0.36 : 0.19));
  }
}

export const soundEngine = new SoundEngine();
