/* MusiCLIPlayer — abstraction layer for MusiCLI listen-together webui
 *
 * Usage:
 *   var player = new MusiCLIPlayer();
 *   player.on('track', function(track) { ... });
 *   player.on('state',  function(s)   { ... });
 *   player.on('tick',   function(pos) { ... });
 *   player.on('lyric',  function(idx) { ... });
 *   player.on('connect',  function() { ... });
 *   player.on('disconnect', function() { ... });
 *   player.on('play',              function() {});
 *   player.on('autoplay-blocked',  function() {});
 *   player.start();
 *
 * Modes (auto-detected in start()):
 *   live  — default; syncs to the host's real-time playback via
 *           /stream?current=true + /stream/info SSE.
 *   file  — when the page URL carries ?path=<audio>, plays that single
 *           shared file via the Range-capable /stream?path= endpoint.
 *           Same events are emitted, so any webui works unchanged.
 *   player.live — boolean, true in live mode, false in file-share mode.
 */
(function(global) {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────

  function formatTime(s) {
    if (s == null || isNaN(s) || s < 0) return '0:00';
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function lastLyricIdx(lyrics, t) {
    for (var i = lyrics.length - 1; i >= 0; i--) {
      if (lyrics[i].time <= t) return i;
    }
    return -1;
  }

  // The server's position estimate assumes the listener hears audio exactly
  // PREBUFFER_SECS (25 × 0.1s) behind the send frontier.  The client's real
  // lag is its own media-buffer depth, which can differ (element start-up
  // delay, burst off-by-one, residual pacing drift).  Measure it via the
  // buffered ranges and compensate so lyrics lock to the *audible* playback
  // instead of a fixed assumption.  Must match the server's
  // PREBUFFER_CHUNKS × CHUNK_DURATION_SECS.
  var PREBUFFER_SECS = 2.5;
  function correctForBuffer(audio, serverPos) {
    if (!audio || !audio.buffered || audio.buffered.length === 0) return serverPos;
    var lag = audio.buffered.end(audio.buffered.length - 1) - audio.currentTime;
    if (lag < 0 || lag > 10) return serverPos;   // implausible — trust server
    var corrected = serverPos + (PREBUFFER_SECS - lag);
    return corrected < 0 ? 0 : corrected;
  }

  // ── Tiny event emitter ─────────────────────────────────────────────

  function Emitter() { this._ls = {}; }
  Emitter.prototype.on = function(ev, cb) {
    var self = this;
    (self._ls[ev] || (self._ls[ev] = [])).push(cb);
    return function() {
      var arr = self._ls[ev];
      if (arr) { var i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1); }
    };
  };
  Emitter.prototype._emit = function(ev) {
    var args = Array.prototype.slice.call(arguments, 1);
    var arr = this._ls[ev];
    if (arr) for (var i = 0; i < arr.length; i++) arr[i].apply(null, args);
  };

  // ── Player class ───────────────────────────────────────────────────

  function MusiCLIPlayer() {
    Emitter.call(this);
    this._audio = null;
    this._es = null;
    this._rafId = 0;
    this._lastTick = 0;
    this._reconnectTimer = null;
    this._destroyed = false;

    this._track = null;
    this._playing = false;
    this._duration = 0;
    this._basePos = 0;
    this._baseChunk = 0;
    this._baseTime = 0;
    this._calibAudioTime = 0;
    this._trackJustChanged = false;
    this._lyrics = [];
    this._lyricIdx = -1;
    this._connected = false;
    this._live = true;
  }
  MusiCLIPlayer.prototype = Object.create(Emitter.prototype);
  MusiCLIPlayer.prototype.constructor = MusiCLIPlayer;

  MusiCLIPlayer.formatTime = formatTime;

  // ── Public getters ─────────────────────────────────────────────────

  Object.defineProperty(MusiCLIPlayer.prototype, 'track', {
    get: function() { return this._track; }
  });
  Object.defineProperty(MusiCLIPlayer.prototype, 'playing', {
    get: function() { return this._playing; }
  });
  Object.defineProperty(MusiCLIPlayer.prototype, 'position', {
    get: function() {
      if (this._destroyed) return 0;
      // File-share mode: the audio element's own timeline IS the position.
      if (!this._live) return this._audio ? this._audio.currentTime : 0;
      if (!this._playing) return this._basePos;
      // Chunk-calibrated via the audio element's own timeline.
      // audio.currentTime advances by exactly 0.1 s per consumed PCM chunk
      // and freezes when the stream carries silence (host paused), so it
      // stays sample-accurate with what the listener actually hears —
      // unlike Date.now() which drifts after pause/resume cycles.
      if (this._audio) {
        var pos = this._basePos + (this._audio.currentTime - this._calibAudioTime);
        if (pos < 0) pos = 0;
        if (this._duration > 0 && pos > this._duration) pos = this._duration;
        return pos;
      }
      // Fallback: wall-clock estimate (audio element unavailable).
      var elapsed = Date.now() - this._baseTime;
      var estPos = this._basePos + elapsed / 1000;
      if (estPos < 0) estPos = 0;
      if (this._duration > 0 && estPos > this._duration) estPos = this._duration;
      return estPos;
    }
  });
  Object.defineProperty(MusiCLIPlayer.prototype, 'chunk', {
    get: function() { return this._baseChunk; }
  });
  Object.defineProperty(MusiCLIPlayer.prototype, 'duration', {
    get: function() { return this._duration; }
  });
  Object.defineProperty(MusiCLIPlayer.prototype, 'lyrics', {
    get: function() { return this._lyrics; }
  });
  Object.defineProperty(MusiCLIPlayer.prototype, 'currentLyricIndex', {
    get: function() { return lastLyricIdx(this._lyrics, this.position); }
  });
  Object.defineProperty(MusiCLIPlayer.prototype, 'connected', {
    get: function() { return this._connected; }
  });
  // true = live listen-together, false = single-file share (?path=).
  Object.defineProperty(MusiCLIPlayer.prototype, 'live', {
    get: function() { return this._live; }
  });

  // ── Public methods ─────────────────────────────────────────────────

  MusiCLIPlayer.prototype.start = function() {
    if (this._destroyed) return;
    // File-share mode: /listen?path=<audio> plays one shared track.
    var m = /[?&]path=([^&]+)/.exec(global.location.search || '');
    if (m) {
      this._live = false;
      var p = m[1];
      try { p = decodeURIComponent(p); } catch (_) {}
      this._startFile(p);
      return;
    }
    this._startStream();
  };

  MusiCLIPlayer.prototype.resume = function() {
    if (!this._audio) return;
    if (!this._live) {
      // File-share mode: the src is a static Range stream — just retry play.
      this._audio.play().catch(function() {});
      return;
    }
    this._audio.src = '/stream?current=true&_t=' + Date.now();
    this._audio.play().catch(function() {});
  };

  MusiCLIPlayer.prototype.setVolume = function(vol) {
    if (this._audio) this._audio.volume = Math.max(0, Math.min(1, vol));
  };

  MusiCLIPlayer.prototype.destroy = function() {
    this._destroyed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._es) this._es.close();
    if (this._audio) {
      this._audio.pause();
      this._audio.src = '';
      this._audio = null;
    }
    this._ls = {};
  };

  // ── Internal: file-share mode (?path=) ──────────────────────────

  MusiCLIPlayer.prototype._startFile = function(path) {
    var self = this;
    var enc = encodeURIComponent(path);

    self._audio = new Audio('/stream?path=' + enc);
    self._audio.volume = 1.0;
    self._audio.play().then(function() {
      self._emit('play');
    }).catch(function() {
      self._emit('autoplay-blocked');
    });

    var emitState = function() {
      self._emit('state', {
        playing: self._playing,
        position: self.position,
        duration: self._duration,
        chunk: 0
      });
    };

    // Mirror the element's play/pause state so `playing` and the webui's
    // status line behave exactly like live mode.
    self._audio.addEventListener('play', function() {
      self._playing = true;
      emitState();
    });
    self._audio.addEventListener('pause', function() {
      self._playing = false;
      emitState();
    });
    self._audio.addEventListener('ended', function() {
      self._playing = false;
      emitState();
    });
    self._audio.addEventListener('loadedmetadata', function() {
      if (!self._duration && isFinite(self._audio.duration)) {
        self._duration = self._audio.duration;
        emitState();
      }
    });

    // rAF loop — same tick cadence as live mode
    var loop = function(now) {
      if (self._destroyed) return;
      self._rafId = requestAnimationFrame(loop);
      if (now - self._lastTick >= 50) {
        self._lastTick = now;
        self._tick();
      }
    };
    self._rafId = requestAnimationFrame(loop);

    // Fetch metadata + lyrics in parallel, then announce the track with
    // the same event shape live mode uses.
    var metaP = fetch('/metadata?path=' + enc)
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
    var lrcP = fetch('/lyrics/parse?audio_path=' + enc)
      .then(function(r) { return r.ok ? r.json() : []; })
      .catch(function() { return []; });

    Promise.all([metaP, lrcP]).then(function(rs) {
      if (self._destroyed) return;
      var d = rs[0] || {};
      var lyrics = Array.isArray(rs[1]) ? rs[1] : [];
      var fallbackTitle = path.split(/[/\\]/).pop() || 'Shared Track';

      self._lyrics = lyrics;
      self._lyricIdx = -1;
      self._track = {
        path: path,
        title: d.title || fallbackTitle,
        artist: d.artist || '',
        album: d.album || '',
        duration: d.duration || self._duration || 0,
        year: d.year != null ? d.year : null,
        genre: d.genre || null,
        bitrate: d.bitrate || null,
        sample_rate: d.sample_rate != null ? d.sample_rate : (d.sampleRate != null ? d.sampleRate : null),
        codec: d.codec || '',
        lyrics: lyrics
      };
      if (self._track.duration) self._duration = self._track.duration;

      if (!self._connected) {
        self._connected = true;
        self._emit('connect');
      }
      self._emit('track', self._track);
      emitState();
    });
  };

  // ── Internal: stream setup ─────────────────────────────────────────

  MusiCLIPlayer.prototype._startStream = function() {
    var self = this;
    var ts = Date.now();

    // Audio element
    self._audio = new Audio('/stream?current=true&_t=' + ts);
    self._audio.volume = 1.0;
    self._audio.play().then(function() {
      self._emit('play');
    }).catch(function() {
      self._emit('autoplay-blocked');
    });

    // rAF loop — display-synced smooth progress, throttled to ≤50ms
    var loop = function(now) {
      if (self._destroyed) return;
      self._rafId = requestAnimationFrame(loop);
      if (now - self._lastTick >= 50) {
        self._lastTick = now;
        self._tick();
      }
    };
    self._rafId = requestAnimationFrame(loop);

    // Reconnect audio on error
    self._audio.addEventListener('error', function() {
      if (self._destroyed) return;
      self._reconnectTimer = setTimeout(function() {
        if (self._destroyed || !self._audio) return;
        self._audio.src = '/stream?current=true&_t=' + Date.now();
        self._audio.play().catch(function() {});
      }, 3000);
    });

    // SSE info stream
    self._es = new EventSource('/stream/info');

    self._es.addEventListener('track', function(e) {
      try {
        var d = JSON.parse(e.data);
        self._track = d;
        self._duration = d.duration || 0;
        self._lyrics = d.lyrics || [];
        self._lyricIdx = -1;
        self._basePos = 0;
        self._baseTime = Date.now();
        self._calibAudioTime = self._audio ? self._audio.currentTime : 0;
        self._trackJustChanged = true;

        if (!self._connected) {
          self._connected = true;
          self._emit('connect');
        }
        self._emit('track', d);
      } catch (_) {}
    });

    self._es.addEventListener('state', function(e) {
      try {
        var d = JSON.parse(e.data);
        var wasPlaying = self._playing;
        self._playing = d.playing;
        var skipDrift = self._trackJustChanged;
        self._trackJustChanged = false;
        if (d.duration > 0) self._duration = d.duration;
        if (d.chunk != null) {
          self._baseChunk = d.chunk;
        }

        if (d.position != null) {
          if (d.playing) {
            // Playing: accept server calibration, corrected for the client's
            // actual buffer depth (the server assumes a fixed PREBUFFER_SECS
            // lag; correctForBuffer replaces it with the measured lag).
            var pos = correctForBuffer(self._audio, d.position);
            // Guard against missed-pause: if the server position is far
            // behind the client estimate the host is actually paused and
            // we missed the transition event — snap to paused state.
            // Skip right after a track change: the position legitimately
            // resets toward 0 and must not be mistaken for a pause.
            if (wasPlaying && !skipDrift) {
              var elapsed = Date.now() - self._baseTime;
              var expected = self._basePos + elapsed / 1000;
              if (expected - pos > 3) {
                self._playing = false;
              }
            }
            self._basePos = pos;
            self._baseTime = Date.now();
            self._calibAudioTime = self._audio ? self._audio.currentTime : 0;
          } else {
            // Paused: freeze position.  The server's audio_position() keeps
            // advancing during pause (silence chunks still increment the
            // chunk counter), so periodic syncs carry ever-growing positions.
            // Only capture the position on the play→pause transition; ignore
            // subsequent advances while paused.
            if (wasPlaying) {
              self._basePos = d.position;
            }
            self._baseTime = Date.now();
            self._calibAudioTime = self._audio ? self._audio.currentTime : 0;
          }
        }

        if (!self._connected) {
          self._connected = true;
          self._emit('connect');
        }
        self._emit('state', {
          playing: self._playing,
          position: self._basePos,
          duration: self._duration,
          chunk: self._baseChunk
        });
      } catch (_) {}
    });

    self._es.onerror = function() {
      if (self._connected) {
        self._connected = false;
        self._emit('disconnect');
      }
    };
  };

  // ── Internal: tick (100ms) ─────────────────────────────────────────

  MusiCLIPlayer.prototype._tick = function() {
    if (this._destroyed) return;
    var pos = this.position;
    this._emit('tick', pos);

    var idx = lastLyricIdx(this._lyrics, pos);
    if (idx !== this._lyricIdx) {
      this._lyricIdx = idx;
      this._emit('lyric', idx);
    }
  };

  // ── Export ─────────────────────────────────────────────────────────

  global.MusiCLIPlayer = MusiCLIPlayer;

})(window);
