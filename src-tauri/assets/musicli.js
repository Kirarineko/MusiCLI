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
    this._lyrics = [];
    this._lyricIdx = -1;
    this._connected = false;
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
      // Chunk-calibrated: estimate current chunk from elapsed time,
      // then position = basePos + chunk_delta × 0.1s.
      // On each state event the server recalibrates (_basePos, _baseChunk).
      if (!this._playing) return this._basePos;
      var elapsed = Date.now() - this._baseTime;
      var estChunks = elapsed / 100;          // each chunk = 100ms
      var pos = this._basePos + estChunks * 0.1;
      if (pos < 0) pos = 0;
      if (this._duration > 0 && pos > this._duration) pos = this._duration;
      return pos;
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

  // ── Public methods ─────────────────────────────────────────────────

  MusiCLIPlayer.prototype.start = function() {
    if (this._destroyed) return;
    this._startStream();
  };

  MusiCLIPlayer.prototype.resume = function() {
    if (!this._audio) return;
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
        self._playing = d.playing;
        if (d.duration > 0) self._duration = d.duration;
        if (d.position != null) {
          self._basePos = d.position;
          self._baseTime = Date.now();
        }
        if (d.chunk != null) {
          self._baseChunk = d.chunk;
        }

        if (!self._connected) {
          self._connected = true;
          self._emit('connect');
        }
        self._emit('state', {
          playing: self._playing,
          position: d.position,
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
