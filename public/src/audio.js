(function () {
  class PanicAudioEngine {
    constructor() {
      this.storageKey = "panic-audio-settings-v3";
      this.context = null;
      this.master = null;
      this.enabled = true;
      this.sfxBaseGain = 0.18;
      this.musicBaseVolume = 0.18;
      this.lobbyMusicBaseVolume = 0.14;
      this.voiceBaseVolume = 0.62;
      this.masterVolume = 1;
      this.sfxVolume = 1;
      this.musicVolume = 1;
      this.uiVolume = 1;
      this.muteAll = false;
      this.lastNonZeroUiVolume = 1;
      this.lastNonZeroSfxVolume = 1;
      this.lastNonZeroMusicVolume = 1;
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
      this.loadSettings();
      this.preloadVoiceClips();
      this.preloadLobbyMusicTrack();
      this.preloadMusicTrack();
      this.applyVolumeSettings();
      this.initDomHooks();
      this.initAudioPanel();
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
      this.master.gain.value = this.effectiveSfxOutput();
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
        audio.volume = this.effectiveSfxVoiceOutput();
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
      music.volume = this.effectiveMusicOutput(this.musicBaseVolume);
      music.addEventListener("error", () => {
        this.musicTrack = null;
      });
      this.musicTrack = music;
    }

    preloadLobbyMusicTrack() {
      const music = new Audio("/assets/audio/voice/Lobby Music.wav");
      music.preload = "auto";
      music.loop = true;
      music.volume = this.effectiveMusicOutput(this.lobbyMusicBaseVolume);
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
        instance.volume = this.effectiveSfxVoiceOutput();
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
        const volume = this.effectiveMusicOutput(this.musicBaseVolume);
        this.musicTrack.volume = volume;
        this.musicTrack.muted = volume <= 0;
        if (volume <= 0) return;
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
        const volume = this.effectiveMusicOutput(this.lobbyMusicBaseVolume);
        this.lobbyMusicTrack.volume = volume;
        this.lobbyMusicTrack.muted = volume <= 0;
        if (volume <= 0) return;
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

    initAudioPanel() {
      const setup = () => {
        this.widget = document.querySelector("#soundWidget");
        this.panel = document.querySelector("#soundPanel");
        this.toggle = document.querySelector("#soundWidgetToggle");
        this.masterInput = document.querySelector("#masterVolumeInput");
        this.sfxInput = document.querySelector("#sfxVolumeInput");
        this.musicInput = document.querySelector("#musicVolumeInput");
        this.uiInput = document.querySelector("#uiVolumeInput");
        this.masterValue = document.querySelector("#masterVolumeValue");
        this.sfxValue = document.querySelector("#sfxVolumeValue");
        this.musicValue = document.querySelector("#musicVolumeValue");
        this.uiValue = document.querySelector("#uiVolumeValue");
        this.muteAllButton = document.querySelector("#muteAllButton");
        this.sfxMuteButton = document.querySelector("#sfxMuteButton");
        this.musicMuteButton = document.querySelector("#musicMuteButton");
        this.syncAudioPanel();
        if (this.toggle && !this.toggle.dataset.bound) {
          this.toggle.dataset.bound = "true";
          this.toggle.addEventListener("click", () => this.toggleWidget());
        }
        if (this.masterInput && !this.masterInput.dataset.bound) {
          this.masterInput.dataset.bound = "true";
          this.masterInput.addEventListener("input", () => this.setMasterVolume(Number(this.masterInput.value) / 100));
        }
        if (this.sfxInput && !this.sfxInput.dataset.bound) {
          this.sfxInput.dataset.bound = "true";
          this.sfxInput.addEventListener("input", () => this.setSfxVolume(Number(this.sfxInput.value) / 100));
        }
        if (this.musicInput && !this.musicInput.dataset.bound) {
          this.musicInput.dataset.bound = "true";
          this.musicInput.addEventListener("input", () => this.setMusicVolume(Number(this.musicInput.value) / 100));
        }
        if (this.uiInput && !this.uiInput.dataset.bound) {
          this.uiInput.dataset.bound = "true";
          this.uiInput.addEventListener("input", () => this.setUiVolume(Number(this.uiInput.value) / 100));
        }
        if (this.muteAllButton && !this.muteAllButton.dataset.bound) {
          this.muteAllButton.dataset.bound = "true";
          this.muteAllButton.addEventListener("click", () => this.toggleMuteAll());
        }
        if (this.sfxMuteButton && !this.sfxMuteButton.dataset.bound) {
          this.sfxMuteButton.dataset.bound = "true";
          this.sfxMuteButton.addEventListener("click", () => this.toggleSfxMute());
        }
        if (this.musicMuteButton && !this.musicMuteButton.dataset.bound) {
          this.musicMuteButton.dataset.bound = "true";
          this.musicMuteButton.addEventListener("click", () => this.toggleMusicMute());
        }
        if (!this.widgetDismissBound) {
          this.widgetDismissBound = true;
          document.addEventListener("pointerdown", (event) => {
            if (!this.widget || !this.widget.classList.contains("open")) return;
            if (this.widget.contains(event.target)) return;
            this.closeWidget();
          });
          document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") this.closeWidget();
          });
        }
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", setup, { once: true });
      } else {
        setup();
      }
    }

    loadSettings() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (typeof data.masterVolume === "number") {
          this.masterVolume = clamp01(data.masterVolume);
        }
        if (typeof data.sfxVolume === "number") {
          this.sfxVolume = clamp01(data.sfxVolume);
          if (this.sfxVolume > 0) this.lastNonZeroSfxVolume = this.sfxVolume;
        }
        if (typeof data.musicVolume === "number") {
          this.musicVolume = clamp01(data.musicVolume);
          if (this.musicVolume > 0) this.lastNonZeroMusicVolume = this.musicVolume;
        }
        if (typeof data.uiVolume === "number") {
          this.uiVolume = clamp01(data.uiVolume);
          if (this.uiVolume > 0) this.lastNonZeroUiVolume = this.uiVolume;
        }
        if (typeof data.muteAll === "boolean") {
          this.muteAll = data.muteAll;
        }
        this.normalizeSettings();
      } catch {}
    }

    saveSettings() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify({
          masterVolume: this.masterVolume,
          sfxVolume: this.sfxVolume,
          musicVolume: this.musicVolume,
          uiVolume: this.uiVolume,
          muteAll: this.muteAll
        }));
      } catch {}
    }

    setMasterVolume(value) {
      this.masterVolume = clamp01(value);
      this.applyVolumeSettings();
    }

    setSfxVolume(value) {
      this.sfxVolume = clamp01(value);
      if (this.sfxVolume > 0) this.lastNonZeroSfxVolume = this.sfxVolume;
      this.applyVolumeSettings();
    }

    setMusicVolume(value) {
      this.musicVolume = clamp01(value);
      if (this.musicVolume > 0) this.lastNonZeroMusicVolume = this.musicVolume;
      this.applyVolumeSettings();
    }

    setUiVolume(value) {
      this.uiVolume = clamp01(value);
      if (this.uiVolume > 0) this.lastNonZeroUiVolume = this.uiVolume;
      this.applyVolumeSettings();
    }

    toggleMuteAll() {
      this.muteAll = !this.muteAll;
      this.applyVolumeSettings();
    }

    toggleSfxMute() {
      this.setSfxVolume(this.sfxVolume > 0 ? 0 : this.lastNonZeroSfxVolume || 1);
    }

    toggleMusicMute() {
      this.setMusicVolume(this.musicVolume > 0 ? 0 : this.lastNonZeroMusicVolume || 1);
    }

    toggleWidget() {
      if (!this.widget || !this.panel || !this.toggle) return;
      const nextOpen = !this.widget.classList.contains("open");
      this.widget.classList.toggle("open", nextOpen);
      this.panel.hidden = !nextOpen;
      this.toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    }

    closeWidget() {
      if (!this.widget || !this.panel || !this.toggle) return;
      this.widget.classList.remove("open");
      this.panel.hidden = true;
      this.toggle.setAttribute("aria-expanded", "false");
    }

    applyVolumeSettings() {
      this.normalizeSettings();
      if (this.master) this.master.gain.value = this.effectiveSfxOutput();
      for (const clip of this.voiceClips.values()) {
        clip.volume = this.effectiveSfxVoiceOutput();
      }
      if (this.activeVoiceInstance) this.activeVoiceInstance.volume = this.effectiveSfxVoiceOutput();
      if (this.musicTrack) {
        const volume = this.effectiveMusicOutput(this.musicBaseVolume);
        this.musicTrack.volume = volume;
        this.musicTrack.muted = volume <= 0;
      }
      if (this.lobbyMusicTrack) {
        const volume = this.effectiveMusicOutput(this.lobbyMusicBaseVolume);
        this.lobbyMusicTrack.volume = volume;
        this.lobbyMusicTrack.muted = volume <= 0;
      }
      this.saveSettings();
      this.syncAudioPanel();
      this.syncAmbientToScreen();
    }

    syncAudioPanel() {
      if (this.masterInput) this.masterInput.value = String(Math.round(this.masterVolume * 100));
      if (this.sfxInput) this.sfxInput.value = String(Math.round(this.sfxVolume * 100));
      if (this.musicInput) this.musicInput.value = String(Math.round(this.musicVolume * 100));
      if (this.uiInput) this.uiInput.value = String(Math.round(this.uiVolume * 100));
      if (this.masterValue) this.masterValue.textContent = `${Math.round(this.masterVolume * 100)}%`;
      if (this.sfxValue) this.sfxValue.textContent = `${Math.round(this.sfxVolume * 100)}%`;
      if (this.musicValue) this.musicValue.textContent = `${Math.round(this.musicVolume * 100)}%`;
      if (this.uiValue) this.uiValue.textContent = `${Math.round(this.uiVolume * 100)}%`;
      if (this.muteAllButton) {
        this.muteAllButton.classList.toggle("active", this.muteAll);
        this.muteAllButton.textContent = this.muteAll ? "Muted" : "Mute All";
        this.muteAllButton.setAttribute("aria-pressed", this.muteAll ? "true" : "false");
      }
      if (this.sfxMuteButton) {
        const muted = this.sfxVolume === 0;
        this.sfxMuteButton.classList.toggle("active", !muted);
        this.sfxMuteButton.textContent = muted ? "SFX Off" : "SFX On";
        this.sfxMuteButton.setAttribute("aria-pressed", muted ? "true" : "false");
      }
      if (this.musicMuteButton) {
        const muted = this.musicVolume === 0;
        this.musicMuteButton.classList.toggle("active", !muted);
        this.musicMuteButton.textContent = muted ? "Music Off" : "Music On";
        this.musicMuteButton.setAttribute("aria-pressed", muted ? "true" : "false");
      }
    }

    effectiveMasterOutput() {
      return this.muteAll ? 0 : this.masterVolume;
    }

    effectiveSfxOutput() {
      return this.sfxBaseGain * this.effectiveMasterOutput() * this.sfxVolume;
    }

    effectiveSfxVoiceOutput() {
      return this.voiceBaseVolume * this.effectiveMasterOutput() * this.sfxVolume;
    }

    effectiveUiOutput(level) {
      return level * this.effectiveMasterOutput() * this.uiVolume;
    }

    effectiveMusicOutput(base) {
      return base * this.effectiveMasterOutput() * this.musicVolume;
    }

    normalizeSettings() {
      this.masterVolume = clamp01(this.masterVolume);
      this.sfxVolume = clamp01(this.sfxVolume);
      this.musicVolume = clamp01(this.musicVolume);
      this.uiVolume = clamp01(this.uiVolume);
      if (this.sfxVolume > 0) this.lastNonZeroSfxVolume = this.sfxVolume;
      if (this.musicVolume > 0) this.lastNonZeroMusicVolume = this.musicVolume;
      if (this.uiVolume > 0) this.lastNonZeroUiVolume = this.uiVolume;
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
      this.createOsc("triangle", 720, now, 0.05, this.effectiveUiOutput(0.018), 860);
    }

    playClick(now) {
      this.createOsc("square", 420, now, 0.07, this.effectiveUiOutput(0.032), 310);
      this.createOsc("triangle", 620, now + 0.012, 0.06, this.effectiveUiOutput(0.022), 510);
    }

    playError(now) {
      this.createOsc("sawtooth", 220, now, 0.09, this.effectiveUiOutput(0.05), 160);
      this.createOsc("square", 180, now + 0.04, 0.1, this.effectiveUiOutput(0.04), 120);
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

  function clamp01(value) {
    return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  }

  window.PanicAudio = new PanicAudioEngine();
})();
