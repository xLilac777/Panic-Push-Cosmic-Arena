(function () {
  class PanicAudioEngine {
    constructor() {
      this.context = null;
      this.master = null;
      this.enabled = true;
      this.lastHoverAt = 0;
      this.hoverTarget = null;
      this.voiceClips = new Map();
      this.activeVoiceInstance = null;
      this.lobbyMusicTrack = null;
      this.musicTrack = null;
      this.voiceClipUrls = {
        "countdown-3": "/assets/audio/voice/countdown-3.wav",
        "countdown-2": "/assets/audio/voice/countdown-2.wav",
        "countdown-1": "/assets/audio/voice/countdown-1.wav",
        loser: "/assets/audio/voice/loser.wav",
        "round-start": "/assets/audio/voice/round-start.wav",
        victory: "/assets/audio/voice/victory.wav"
      };
      this.preloadVoiceClips();
      this.preloadLobbyMusicTrack();
      this.preloadMusicTrack();
      this.initDomHooks();
      window.addEventListener("panic-audio-hook", (event) => this.playNow(event.detail && event.detail.name));
    }

    ensureContext() {
      if (this.context) return this.context;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        this.enabled = false;
        return null;
      }
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.context.destination);
      return this.context;
    }

    unlock() {
      const context = this.ensureContext();
      if (context && context.state === "suspended") context.resume();
      this.syncAmbientToScreen();
    }

    play(name) {
      window.dispatchEvent(new CustomEvent("panic-audio-hook", { detail: { name } }));
    }

    playNow(name) {
      if (!this.enabled || !name) return;
      if (this.playVoiceClip(name)) return;
      const context = this.ensureContext();
      if (!context || !this.master) return;
      if (context.state === "suspended") return;
      const now = context.currentTime;
      if (name === "ui-hover") return this.playHover(now);
      if (name === "ui-click") return this.playClick(now);
      if (name === "ui-error") return this.playError(now);
      if (name === "push") return this.playPush(now);
      if (name === "push-impact") return this.playImpact(now);
      if (name === "dash") return this.playDash(now);
      if (name === "elimination") return this.playElimination(now);
      if (name === "countdown-3") return this.playCountdown(now, 392);
      if (name === "countdown-2") return this.playCountdown(now, 349);
      if (name === "countdown-1") return this.playCountdown(now, 330);
      if (name === "lobby-music-start") return this.startLobbyMusic();
      if (name === "lobby-music-stop") return this.stopLobbyMusic();
      if (name === "music-start") return this.startMusic();
      if (name === "music-stop") return this.stopMusic();
      if (name === "loser") return this.playError(now);
      if (name === "round-start") return this.playRoundStart(now);
      if (name === "victory") return this.playVictory(now);
    }

    preloadVoiceClips() {
      for (const [name, url] of Object.entries(this.voiceClipUrls)) {
        const audio = new Audio(url);
        audio.preload = "auto";
        audio.volume = 0.62;
        audio.addEventListener("error", () => {
          this.voiceClips.delete(name);
        });
        this.voiceClips.set(name, audio);
      }
    }

    preloadMusicTrack() {
      const music = new Audio("/assets/audio/voice/Music In Game.wav");
      music.preload = "auto";
      music.loop = true;
      music.volume = 0.18;
      music.addEventListener("error", () => {
        this.musicTrack = null;
      });
      this.musicTrack = music;
    }

    preloadLobbyMusicTrack() {
      const music = new Audio("/assets/audio/voice/Lobby Music.wav");
      music.preload = "auto";
      music.loop = true;
      music.volume = 0.14;
      music.addEventListener("error", () => {
        this.lobbyMusicTrack = null;
      });
      this.lobbyMusicTrack = music;
    }

    playVoiceClip(name) {
      const clip = this.voiceClips.get(name);
      if (!clip) return false;
      try {
        this.stopActiveVoice();
        const instance = clip.cloneNode();
        instance.volume = clip.volume;
        instance.addEventListener("ended", () => {
          if (this.activeVoiceInstance === instance) this.activeVoiceInstance = null;
        }, { once: true });
        instance.addEventListener("error", () => {
          if (this.activeVoiceInstance === instance) this.activeVoiceInstance = null;
        }, { once: true });
        this.activeVoiceInstance = instance;
        instance.play().catch(() => {});
        return true;
      } catch {
        return false;
      }
    }

    stopActiveVoice() {
      if (!this.activeVoiceInstance) return;
      try {
        this.activeVoiceInstance.pause();
        this.activeVoiceInstance.currentTime = 0;
      } catch {}
      this.activeVoiceInstance = null;
    }

    startMusic() {
      if (!this.musicTrack) return;
      try {
        this.stopLobbyMusic();
        this.musicTrack.volume = 0.18;
        this.musicTrack.play().catch(() => {});
      } catch {}
    }

    stopMusic() {
      if (!this.musicTrack) return;
      try {
        this.musicTrack.pause();
        this.musicTrack.currentTime = 0;
      } catch {}
    }

    startLobbyMusic() {
      if (!this.lobbyMusicTrack) return;
      try {
        this.stopMusic();
        this.lobbyMusicTrack.volume = 0.14;
        this.lobbyMusicTrack.play().catch(() => {});
      } catch {}
    }

    stopLobbyMusic() {
      if (!this.lobbyMusicTrack) return;
      try {
        this.lobbyMusicTrack.pause();
        this.lobbyMusicTrack.currentTime = 0;
      } catch {}
    }

    syncAmbientToScreen() {
      const screen = document.body.dataset.screen || "menu";
      if (screen === "game") return;
      this.startLobbyMusic();
    }

    initDomHooks() {
      const unlock = () => this.unlock();
      window.addEventListener("pointerdown", unlock, { passive: true });
      window.addEventListener("keydown", unlock, { passive: true });
      document.addEventListener("mouseover", (event) => {
        const button = event.target.closest("button");
        if (!button || button === this.hoverTarget) return;
        const now = performance.now();
        this.hoverTarget = button;
        if (now - this.lastHoverAt < 70) return;
        this.lastHoverAt = now;
        this.play("ui-hover");
      });
      document.addEventListener("click", (event) => {
        if (event.target.closest("button")) this.play("ui-click");
      });
    }

    createGain(value, when, output = this.master) {
      const gain = this.context.createGain();
      gain.gain.setValueAtTime(value, when);
      gain.connect(output);
      return gain;
    }

    createOsc(type, frequency, when, duration, volume, sweepTo = null, output = this.master) {
      const osc = this.context.createOscillator();
      const gain = this.createGain(0.0001, when, output);
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, when);
      if (sweepTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), when + duration);
      gain.gain.exponentialRampToValueAtTime(volume, when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      osc.connect(gain);
      osc.start(when);
      osc.stop(when + duration + 0.02);
      return osc;
    }

    createNoise(when, duration, volume, output = this.master, highpass = 700) {
      const buffer = this.context.createBuffer(1, Math.max(1, Math.floor(this.context.sampleRate * duration)), this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(highpass, when);
      const gain = this.createGain(0.0001, when, output);
      gain.gain.exponentialRampToValueAtTime(volume, when + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(gain);
      source.start(when);
      source.stop(when + duration + 0.02);
    }

    playHover(now) {
      this.createOsc("triangle", 720, now, 0.05, 0.018, 860);
    }

    playClick(now) {
      this.createOsc("square", 420, now, 0.07, 0.032, 310);
      this.createOsc("triangle", 620, now + 0.012, 0.06, 0.022, 510);
    }

    playError(now) {
      this.createOsc("sawtooth", 220, now, 0.09, 0.05, 160);
      this.createOsc("square", 180, now + 0.04, 0.1, 0.04, 120);
    }

    playPush(now) {
      this.createOsc("square", 190, now, 0.08, 0.05, 120);
      this.createNoise(now + 0.01, 0.06, 0.03, this.master, 900);
    }

    playImpact(now) {
      this.createOsc("triangle", 160, now, 0.14, 0.075, 70);
      this.createOsc("square", 310, now, 0.08, 0.05, 160);
      this.createNoise(now, 0.09, 0.05, this.master, 500);
    }

    playDash(now) {
      this.createOsc("sawtooth", 280, now, 0.12, 0.045, 720);
      this.createNoise(now + 0.015, 0.08, 0.025, this.master, 1200);
    }

    playElimination(now) {
      this.createOsc("sawtooth", 420, now, 0.18, 0.06, 90);
      this.createOsc("triangle", 180, now + 0.02, 0.22, 0.05, 60);
      this.createNoise(now, 0.18, 0.045, this.master, 650);
    }

    playCountdown(now, frequency) {
      this.createOsc("triangle", frequency, now, 0.12, 0.045, frequency * 0.9);
      this.createOsc("sine", frequency * 2, now + 0.01, 0.08, 0.018, frequency * 1.5);
    }

    playRoundStart(now) {
      this.createOsc("sawtooth", 360, now, 0.12, 0.05, 680);
      this.createOsc("triangle", 520, now + 0.05, 0.18, 0.045, 820);
    }

    playVictory(now) {
      this.createOsc("triangle", 392, now, 0.16, 0.05, 523);
      this.createOsc("triangle", 523, now + 0.12, 0.18, 0.055, 659);
      this.createOsc("triangle", 659, now + 0.24, 0.22, 0.06, 784);
    }
  }

  window.PanicAudio = new PanicAudioEngine();
})();
