(function () {
  const PLAYER_COLOR_VARIANTS = {
    "#57ffa6": "player-variant-01",
    "#ffcf5a": "player-variant-02",
    "#5ab8ff": "player-variant-03",
    "#ff6b7a": "player-variant-04",
    "#8fffe0": "player-variant-05",
    "#c792ff": "player-variant-06",
    "#ff9f43": "player-variant-07",
    "#f06595": "player-variant-08"
  };

  class MatchScene extends Phaser.Scene {
    constructor() {
      super("MatchScene");
      this.players = new Map();
      this.seenEffects = new Set();
      this.effectSprites = new Map();
      this.snapshot = null;
      this.selfId = null;
      this.localInput = { up: false, down: false, left: false, right: false };
      this.isReady = false;
      this.cameraZoom = 1;
      this.cameraCenterX = 480;
      this.cameraCenterY = 270;
      this.lastCountdownCue = null;
      this.roundStartPlayed = false;
      this.fightTextUntil = 0;
      this.lastShakeAt = 0;
    }

    create() {
      this.snapshot = {
        arena: {
          width: 960,
          height: 540,
          centerX: 480,
          centerY: 270,
          radius: 185,
          startRadius: 185,
          hazardActive: false
        },
        roundLive: false,
        countdownValue: 3,
        players: [],
        effects: [],
        timeLeftMs: 0
      };
      this.hasArt = false;
      this.starLayer = this.add.graphics();
      this.arenaLayer = this.add.graphics();
      this.hazardLayer = this.add.graphics();
      this.effectLayer = this.add.graphics();
      this.spaceBg = null;
      this.platform = null;
      this.safeZoneFill = null;
      this.countdownText = this.add.text(0, 0, "", {
        fontFamily: "Arial",
        fontSize: "52px",
        fontStyle: "900",
        color: "#f4fff8",
        stroke: "#050814",
        strokeThickness: 8
      }).setOrigin(0.5).setDepth(20);
      this.drawArena(this.snapshot.arena);
      this.cameras.main.setZoom(this.cameraZoom);
      this.cameras.main.roundPixels = true;
      this.cameras.main.setBounds(0, 0, 960, 540);
      this.cameras.main.centerOn(this.cameraCenterX, this.cameraCenterY);
      this.isReady = true;
      this.events.emit("scene-ready");
    }

    preload() {
      this.load.image("bg-space", "/assets/backgrounds/space-background-final-v2.png");
      this.load.image("arena-platform", "/assets/arena/arena-platform-final-v3.png");
      this.load.spritesheet("player-sheet", "/assets/characters/player-sheet.png", { frameWidth: 512, frameHeight: 512 });
      this.load.image("bot-token", "/assets/bots/bot-token-final.png");
      this.load.image("shrink-ring-overlay", "/assets/effects/shrink-ring-overlay-v1.png");
      for (const key of Object.values(PLAYER_COLOR_VARIANTS)) {
        this.load.image(key, `/assets/characters/${key}.png`);
      }
      this.load.spritesheet("effects-sheet", "/assets/effects/effects-sheet.png", { frameWidth: 512, frameHeight: 512 });
    }

    setSelf(id) {
      this.selfId = id;
    }

    setLocalInput(input) {
      this.localInput = { ...input };
    }

    applySnapshot(snapshot) {
      this.snapshot = snapshot;
      this.updateAudioCues(snapshot);
      this.drawArena(snapshot.arena);
      const seen = new Set();
      for (const player of snapshot.players) {
        seen.add(player.id);
        this.upsertPlayer(player);
      }
      for (const [id, view] of this.players) {
        if (!seen.has(id)) {
          view.root.destroy();
          this.players.delete(id);
        }
      }
      this.drawEffects(snapshot.effects || []);
    }

    drawArena(arena) {
      this.arenaLayer.clear();
      this.starLayer.clear();
      this.starLayer.setDepth(-10);
      this.arenaLayer.setDepth(-5);
      this.hazardLayer.setDepth(2);
      this.effectLayer.setDepth(12);
      const hasPlatform = this.textures.exists("arena-platform");
      if (this.textures.exists("bg-space")) {
        if (!this.spaceBg) {
          this.spaceBg = this.add.image(arena.centerX, arena.centerY, "bg-space").setDepth(-20);
        }
        this.spaceBg.setPosition(arena.centerX, arena.centerY);
        this.spaceBg.setDisplaySize(arena.width, arena.height);
        this.spaceBg.setAlpha(0.92);
      } else {
        for (let i = 0; i < 80; i += 1) {
          const x = (i * 137.5) % arena.width;
          const y = (i * 71.3) % arena.height;
          this.starLayer.fillStyle(0x9eead0, i % 3 === 0 ? 0.22 : 0.1);
          this.starLayer.fillCircle(x, y + Math.sin(performance.now() / 1800 + i) * 1.5, i % 4 === 0 ? 1.4 : 0.8);
        }
      }
      if (hasPlatform) {
        if (!this.platform) {
          this.platform = this.add.image(arena.centerX, arena.centerY, "arena-platform").setDepth(-8);
        }
        this.platform.setPosition(arena.centerX, arena.centerY);
        const platformSize = Math.min(arena.height - 22, arena.width - 180);
        this.platform.setDisplaySize(platformSize, platformSize);
        this.platform.setAlpha(0.98);
        this.platformSize = platformSize;
      } else {
        this.arenaLayer.fillStyle(0x050814, 1);
        this.arenaLayer.fillRect(0, 0, arena.width, arena.height);
        this.arenaLayer.lineStyle(1, 0x57ffa6, 0.07);
        for (let x = 0; x <= arena.width; x += 48) this.arenaLayer.lineBetween(x, 0, x, arena.height);
        for (let y = 0; y <= arena.height; y += 48) this.arenaLayer.lineBetween(0, y, arena.width, y);
        this.arenaLayer.fillStyle(0x10243d, 1);
        this.arenaLayer.fillCircle(arena.centerX, arena.centerY, arena.radius + 48);
        this.arenaLayer.lineStyle(8, 0x20364f, 1);
        this.arenaLayer.strokeCircle(arena.centerX, arena.centerY, arena.radius + 48);
        this.arenaLayer.fillStyle(0x0b1e2e, 1);
        this.arenaLayer.fillCircle(arena.centerX, arena.centerY, arena.startRadius || arena.radius);
      }
      if (!this.safeZoneFill) {
        this.safeZoneFill = this.add.circle(arena.centerX, arena.centerY, arena.radius, 0x57ffa6, 0.05).setDepth(-6);
      }
      this.safeZoneFill.setPosition(arena.centerX, arena.centerY);
      this.safeZoneFill.setRadius(arena.radius);
      this.safeZoneFill.setFillStyle(0x57ffa6, arena.hazardActive ? 0.035 : 0.055);
      const hasShrinkOverlay = this.textures.exists("shrink-ring-overlay");
      this.arenaLayer.lineStyle(hasPlatform ? 0 : 2, 0x57ffa6, hasPlatform ? 0 : 0.22);
      if (!hasPlatform) this.arenaLayer.strokeCircle(arena.centerX, arena.centerY, arena.startRadius || arena.radius);
      if (!hasShrinkOverlay) {
        this.arenaLayer.lineStyle(1.5, 0xffffff, hasPlatform ? 0.16 : 0.2);
        this.arenaLayer.strokeCircle(arena.centerX, arena.centerY, arena.radius - 3);
        this.arenaLayer.lineStyle(hasPlatform ? 3 : 4, 0x57ffa6, hasPlatform ? 0.62 : 0.72);
        this.arenaLayer.strokeCircle(arena.centerX, arena.centerY, arena.radius);
      }
      this.hazardLayer.clear();
      const pulse = arena.hazardActive ? 0.18 + Math.sin(performance.now() / 220) * 0.05 : 0.05;
      if (hasShrinkOverlay) {
        if (!this.shrinkRingOverlay) {
          this.shrinkRingOverlay = this.add.image(arena.centerX, arena.centerY, "shrink-ring-overlay").setDepth(3);
          this.shrinkRingOverlay.setBlendMode(Phaser.BlendModes.SCREEN);
        }
        this.shrinkRingOverlay.setVisible(true);
        this.shrinkRingOverlay.setPosition(arena.centerX, arena.centerY);
        const platformInnerRatio = this.platformSize ? (this.platformSize / (arena.startRadius * 2)) : 1.48;
        const visualRadius = arena.radius + 10;
        const shrinkVisualSize = visualRadius * 2 * platformInnerRatio;
        this.shrinkRingOverlay.setDisplaySize(shrinkVisualSize, shrinkVisualSize);
        this.shrinkRingOverlay.setTint(arena.hazardActive ? 0xff5d6c : 0xff7a45);
        this.shrinkRingOverlay.setAlpha(arena.hazardActive ? 0.72 + pulse * 0.22 : 0.58 + pulse * 0.12);
      } else {
        this.hazardLayer.lineStyle(arena.hazardActive ? 2.5 : 1, arena.hazardActive ? 0xffb84d : 0x57ffa6, pulse);
        this.hazardLayer.strokeCircle(arena.centerX, arena.centerY, arena.radius + (arena.hazardActive ? 2 : 0));
      }
      this.countdownText.setPosition(arena.centerX, arena.centerY - 8);
      if (this.snapshot && !this.snapshot.roundLive && this.snapshot.countdownValue > 0) {
        const beat = this.snapshot.countdownValue;
        this.countdownText.setVisible(true);
        this.countdownText.setText(String(beat));
        this.countdownText.setAlpha(0.72 + Math.sin(performance.now() / 130) * 0.2);
      } else if (performance.now() < this.fightTextUntil) {
        this.countdownText.setVisible(true);
        this.countdownText.setText("FIGHT!");
        this.countdownText.setAlpha(0.9);
      } else {
        this.countdownText.setVisible(false);
        this.countdownText.setText("");
      }
    }

    updateAudioCues(snapshot) {
      if (!window.PanicAudio) return;
      if (!snapshot.roundLive && snapshot.countdownValue > 0) {
        const beat = snapshot.countdownValue;
        if (this.lastCountdownCue !== beat) {
          this.lastCountdownCue = beat;
          window.PanicAudio.play(`countdown-${beat}`);
        }
        this.roundStartPlayed = false;
      } else if (!this.roundStartPlayed && snapshot.roundLive) {
        this.roundStartPlayed = true;
        this.lastCountdownCue = null;
        this.fightTextUntil = performance.now() + 850;
        window.PanicAudio.play("round-start");
        window.PanicAudio.play("music-start");
      }
    }

    upsertPlayer(player) {
      let view = this.players.get(player.id);
      if (!view) {
        const root = this.add.container(player.x, player.y);
        root.name = player.id;
        const shadow = this.add.ellipse(0, 22, 36, 10, 0x000000, 0.3);
        const ring = this.add.circle(0, 2, 20, 0x57ffa6, 0.12);
        const textureKey = this.getPlayerTextureKey(player);
        const art = textureKey
          ? this.add.image(0, 0, textureKey).setScale(player.isBot ? 0.105 : 0.11)
          : this.textures.exists("player-sheet")
            ? this.add.sprite(0, 0, "player-sheet", 0).setScale(0.11)
            : this.add.circle(0, 0, 18, player.color, 1);
        const body = art;
        const visor = textureKey || this.textures.exists("player-sheet") || this.textures.exists("bot-token")
          ? this.add.circle(0, 0, 0, 0xffffff, 0)
          : this.add.rectangle(0, -2, 24, 8, player.isBot ? 0xffb84d : 0x7fd7ff, 1);
        const facing = this.add.triangle(0, -18, 0, 0, 7, 12, -7, 12, player.id === this.selfId ? 0xffffff : 0x57ffa6, 0.95);
        facing.setStrokeStyle(2, 0x050814, 0.95);
        const labelBg = this.add.rectangle(0, -36, 10, 18, 0x030810, 0.74).setStrokeStyle(1, 0x57ffa6, 0.24);
        const label = this.add.text(0, -36, player.nickname, {
          fontFamily: "Arial",
          fontSize: "13px",
          fontStyle: "bold",
          color: "#f4fff8",
          stroke: "#020806",
          strokeThickness: 4
        }).setOrigin(0.5);
        if (body.setStrokeStyle) {
          body.setStrokeStyle(player.id === this.selfId ? 5 : 4, player.id === this.selfId ? 0xffffff : 0x050814);
        }
        root.add([shadow, ring, body, visor, facing, labelBg, label]);
        view = { root, shadow, ring, body, facing, label, labelBg, baseScale: player.isBot ? 0.105 : 0.11, targetX: player.x, targetY: player.y };
        this.players.set(player.id, view);
      }
      view.targetX = player.x;
      view.targetY = player.y;
      view.root.visible = player.alive;
      view.root.setAlpha(player.alive ? 1 : 0);
      if (view.label) {
        view.label.setVisible(player.alive);
        view.label.x = 0;
        view.label.y = -36;
      }
      if (view.labelBg) {
        view.labelBg.setVisible(player.alive);
        const width = Math.max(30, view.label.width + 16);
        view.labelBg.setSize(width, 18);
        view.labelBg.x = 0;
        view.labelBg.y = -36;
      }
      if (view.shadow) view.shadow.setVisible(player.alive);
      if (view.ring) {
        view.ring.setVisible(player.alive);
        view.ring.setFillStyle(player.isBot ? 0xffcf5a : player.color, player.id === this.selfId ? 0.18 : 0.12);
        view.ring.setScale(player.dashing ? 1.12 : 1);
      }
      if (view.body.setFillStyle) view.body.setFillStyle(player.hitFlashLeftMs > 0 ? 0xffffff : player.color);
      if (view.body.texture && view.body.setTexture) {
        const nextTexture = this.getPlayerTextureKey(player);
        if (nextTexture && view.body.texture.key !== nextTexture) view.body.setTexture(nextTexture);
      }
      if (view.body.setFrame) {
        if (player.dashing) view.body.setFrame(2);
        else if (Math.hypot(player.vx, player.vy) > 20) view.body.setFrame(1);
        else view.body.setFrame(0);
      }
      if (view.facing) {
        view.facing.rotation = Math.atan2(player.facingY, player.facingX) + Math.PI / 2;
        view.facing.setAlpha(player.alive ? 0.95 : 0);
        view.facing.fillColor = player.id === this.selfId ? 0xffffff : (player.isBot ? 0xffcf5a : 0x57ffa6);
      }
      view.body.setScale(player.dashing ? view.baseScale * 1.08 : view.baseScale);
    }

    update(_time, deltaMs) {
      const lerp = 1 - Math.pow(0.001, deltaMs / 1000);
      for (const view of this.players.values()) {
        const selfPlayer = this.snapshot && this.snapshot.players.find((player) => player.id === this.selfId);
        if (view.root.name === this.selfId && selfPlayer && selfPlayer.alive && this.snapshot && this.snapshot.roundLive) {
          const dx = (this.localInput.right ? 1 : 0) - (this.localInput.left ? 1 : 0);
          const dy = (this.localInput.down ? 1 : 0) - (this.localInput.up ? 1 : 0);
          const length = Math.hypot(dx, dy);
          if (length) {
            view.root.x += (dx / length) * 240 * (deltaMs / 1000);
            view.root.y += (dy / length) * 240 * (deltaMs / 1000);
          }
        }
        const bob = this.snapshot && this.snapshot.roundLive ? Math.sin(performance.now() / 260 + view.targetX) * 1.1 : 0;
        view.root.x += (view.targetX - view.root.x) * lerp;
        view.root.y += (view.targetY + bob - view.root.y) * lerp;
      }
      this.layoutLabels();
    }

    layoutLabels() {
      const aliveViews = [];
      for (const player of this.snapshot.players || []) {
        if (!player.alive) continue;
        const view = this.players.get(player.id);
        if (!view || !view.label) continue;
        aliveViews.push(view);
      }
      aliveViews.sort((a, b) => (a.root.y - b.root.y) || (a.root.x - b.root.x));
      const placed = [];
      for (const view of aliveViews) {
        let offsetY = -36;
        let offsetX = 0;
        for (const other of placed) {
          const dx = Math.abs((view.root.x + offsetX) - (other.x));
          const dy = Math.abs((view.root.y + offsetY) - (other.y));
          if (dx < 72 && dy < 20) {
            offsetY -= 16;
            offsetX = offsetX === 0 ? (placed.length % 2 === 0 ? -14 : 14) : -offsetX;
          }
        }
        view.label.x = offsetX;
        view.label.y = offsetY;
        if (view.labelBg) {
          view.labelBg.x = offsetX;
          view.labelBg.y = offsetY;
        }
        placed.push({ x: view.root.x + offsetX, y: view.root.y + offsetY });
      }
    }

    getPlayerTextureKey(player) {
      if (player.isBot && this.textures.exists("bot-token")) return "bot-token";
      const key = PLAYER_COLOR_VARIANTS[String(player.color || "").toLowerCase()];
      if (key && this.textures.exists(key)) return key;
      return null;
    }

    triggerScreenShake(duration, intensity, cooldownMs = 140) {
      const now = performance.now();
      if (now - this.lastShakeAt < cooldownMs) return;
      this.lastShakeAt = now;
      this.cameras.main.shake(duration, intensity);
    }

    drawEffects(effects) {
      this.effectLayer.clear();
      const activeIds = new Set();
      for (const effect of effects) {
        activeIds.add(effect.id);
        const alpha = Phaser.Math.Clamp(effect.life || 0, 0, 1);
        if (!this.seenEffects.has(effect.id) && effect.type === "impact") {
          this.triggerScreenShake(55, 0.0018);
          if (window.PanicAudio) window.PanicAudio.play("push-impact");
          this.seenEffects.add(effect.id);
        } else if (!this.seenEffects.has(effect.id) && effect.type === "dash") {
          if (window.PanicAudio) window.PanicAudio.play("dash");
          this.seenEffects.add(effect.id);
        } else if (!this.seenEffects.has(effect.id) && effect.type === "elimination") {
          this.triggerScreenShake(85, 0.0026, 180);
          if (window.PanicAudio) window.PanicAudio.play("elimination");
          this.seenEffects.add(effect.id);
        } else if (!this.seenEffects.has(effect.id) && effect.type === "push") {
          if (window.PanicAudio) window.PanicAudio.play("push");
          this.seenEffects.add(effect.id);
        }
        if (this.textures.exists("effects-sheet")) {
          const frameMap = { dash: 0, push: 1, impact: 2, elimination: 2 };
          if (frameMap[effect.type] !== undefined) {
            let sprite = this.effectSprites.get(effect.id);
            if (!sprite) {
              sprite = this.add.sprite(effect.x, effect.y, "effects-sheet", frameMap[effect.type]).setDepth(15);
              sprite.setBlendMode(Phaser.BlendModes.ADD);
              this.effectSprites.set(effect.id, sprite);
            }
            sprite.setFrame(frameMap[effect.type]);
            sprite.setPosition(effect.x, effect.y);
            sprite.setAlpha(alpha);
            if (effect.type === "dash") sprite.setScale(0.2 + (1 - alpha) * 0.11);
            else if (effect.type === "push") sprite.setScale(0.17 + (1 - alpha) * 0.06);
            else if (effect.type === "impact") sprite.setScale(0.22 + (1 - alpha) * 0.12);
            else sprite.setScale(0.26 + (1 - alpha) * 0.16);
            continue;
          }
        }
        if (effect.type === "impact") {
            this.effectLayer.lineStyle(5, 0xffffff, alpha);
            this.effectLayer.strokeCircle(effect.x, effect.y, 26 + (1 - alpha) * 30);
            this.effectLayer.fillStyle(effect.color || 0x57ffa6, alpha * 0.5);
            for (let i = 0; i < 10; i += 1) {
              const angle = (Math.PI * 2 * i) / 10;
              this.effectLayer.fillCircle(effect.x + Math.cos(angle) * (1 - alpha) * 44, effect.y + Math.sin(angle) * (1 - alpha) * 44, 3);
            }
        } else if (effect.type === "push") {
          this.effectLayer.lineStyle(4, effect.color || 0x57ffa6, alpha * 0.78);
          this.effectLayer.strokeCircle(effect.x, effect.y, 18 + (1 - alpha) * 20);
          this.effectLayer.lineStyle(2, 0xffffff, alpha * 0.5);
          this.effectLayer.strokeCircle(effect.x, effect.y, 8 + (1 - alpha) * 10);
        } else if (effect.type === "dash") {
          this.effectLayer.lineStyle(6, effect.color || 0x7fd7ff, alpha * 0.42);
          this.effectLayer.strokeCircle(effect.x, effect.y, 14 + (1 - alpha) * 34);
          this.effectLayer.lineStyle(2, 0xffffff, alpha * 0.35);
          this.effectLayer.strokeCircle(effect.x, effect.y, 10 + (1 - alpha) * 22);
        } else if (effect.type === "elimination") {
          this.effectLayer.lineStyle(6, effect.color || 0xff5d6c, alpha);
          this.effectLayer.strokeCircle(effect.x, effect.y, 24 + (1 - alpha) * 70);
          this.effectLayer.lineStyle(3, 0xffffff, alpha * 0.75);
          this.effectLayer.strokeCircle(effect.x, effect.y, 12 + (1 - alpha) * 42);
        }
      }
      for (const [id, sprite] of this.effectSprites) {
        if (!activeIds.has(id)) {
          sprite.destroy();
          this.effectSprites.delete(id);
        }
      }
    }
  }

  window.PanicGame = {
    create(parent) {
      return new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        backgroundColor: "#050814",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 960, height: 540 },
        render: { pixelArt: true, antialias: false },
        scene: [MatchScene]
      });
    }
  };
})();
