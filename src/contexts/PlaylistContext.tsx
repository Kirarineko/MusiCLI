import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { Playlist, PlaylistInfo } from '../types';
import { t } from '../i18n';

const PL_STORAGE_KEY = 'musiccli-playlists';
const PL_CURRENT_KEY = 'musiccli-current-pl';

// Callbacks that PlaylistContext needs from PlayerContext
export interface PlayerSync {
  addToPlaylist: (paths: string[]) => void;
  clearPlaylist: () => void;
  getPlaylist: () => string[];
}

interface PlaylistContextValue {
  playlists: Record<string, Playlist>;
  currentPlName: string;
  /** Register player functions so we can sync playlist -> player */
  registerPlayerSync: (sync: PlayerSync) => void;
  createPlaylist: (name: string, desc?: string) => { success: boolean; error?: string };
  deletePlaylist: (name: string) => { success: boolean; error?: string };
  switchPlaylist: (name: string) => Playlist | { candidates: string[] } | null;
  /** Add tracks to current playlist AND sync to player */
  addTracksToCurrent: (tracks: string[]) => void;
  /** Replace all tracks in current playlist AND sync to player */
  replaceCurrentTracks: (tracks: string[]) => void;
  editPlaylist: (name: string, field: string, value: string) => { success: boolean; error?: string };
  getCurrentPlaylist: () => Playlist | null;
  getCurrentPlName: () => string;
  listAllPlaylists: () => PlaylistInfo[];
  getPlaylistData: (name: string) => Playlist | null;
  getPlaylistsForTrack: (trackPath: string) => string[];
  syncTrackToPlaylists: (trackPath: string, names: string[]) => void;
  savePlaylists: () => void;
  ensureDefault: () => void;
}

const PlaylistContext = createContext<PlaylistContextValue | null>(null);

function defaultPlaylistName(): string {
  return t('defaultPlName') || 'Default';
}

function loadPlaylistsFromStorage(): { pls: Record<string, Playlist>; cur: string } {
  let pls: Record<string, Playlist> = {};
  try {
    const raw = localStorage.getItem(PL_STORAGE_KEY);
    if (raw) pls = JSON.parse(raw);
  } catch { pls = {}; }
  let cur = '';
  try {
    cur = localStorage.getItem(PL_CURRENT_KEY) || '';
  } catch { cur = ''; }

  if (Object.keys(pls).length === 0) {
    const name = defaultPlaylistName();
    pls[name] = { name, desc: '', createdAt: new Date().toISOString(), tracks: [] };
    cur = name;
    localStorage.setItem(PL_STORAGE_KEY, JSON.stringify(pls));
    localStorage.setItem(PL_CURRENT_KEY, cur);
  } else if (!pls[cur]) {
    cur = Object.keys(pls)[0];
    localStorage.setItem(PL_CURRENT_KEY, cur);
  }
  return { pls, cur };
}

export function PlaylistProvider({ children }: { children: ReactNode }) {
  // Load synchronously so data is ready before any child useEffect runs
  const [playlists, setPlaylists] = useState<Record<string, Playlist>>(() => loadPlaylistsFromStorage().pls);
  const [currentPlName, setCurrentPlName] = useState(() => loadPlaylistsFromStorage().cur);
  const playerSyncRef = useRef<PlayerSync | null>(null);

  const registerPlayerSync = useCallback((sync: PlayerSync) => {
    playerSyncRef.current = sync;
  }, []);

  const persist = useCallback((pls: Record<string, Playlist>, cur: string) => {
    setPlaylists({ ...pls });
    setCurrentPlName(cur);
    localStorage.setItem(PL_STORAGE_KEY, JSON.stringify(pls));
    localStorage.setItem(PL_CURRENT_KEY, cur);
  }, []);

  const savePlaylistsFn = useCallback(() => {
    localStorage.setItem(PL_STORAGE_KEY, JSON.stringify(playlists));
    localStorage.setItem(PL_CURRENT_KEY, currentPlName);
  }, [playlists, currentPlName]);

  const ensureDefault = useCallback(() => {
    const pls = { ...playlists };
    let cur = currentPlName;
    if (Object.keys(pls).length === 0) {
      const name = defaultPlaylistName();
      pls[name] = { name, desc: '', createdAt: new Date().toISOString(), tracks: [] };
      cur = name;
    } else if (!pls[cur]) {
      cur = Object.keys(pls)[0];
    }
    persist(pls, cur);
  }, [playlists, currentPlName, persist]);

  const createPlaylist = useCallback((name: string, desc?: string) => {
    const pls = { ...playlists };
    if (pls[name]) return { success: false, error: 'duplicate' };
    pls[name] = { name, desc: desc || '', createdAt: new Date().toISOString(), tracks: [] };
    persist(pls, currentPlName);
    return { success: true };
  }, [playlists, currentPlName, persist]);

  const deletePlaylist = useCallback((name: string) => {
    const pls = { ...playlists };
    if (!pls[name]) return { success: false, error: 'notFound' };
    if (Object.keys(pls).length <= 1) return { success: false, error: 'lastOne' };
    delete pls[name];
    let cur = currentPlName;
    if (cur === name) cur = Object.keys(pls)[0];
    // Sync player when switching away
    if (playerSyncRef.current) {
      playerSyncRef.current.clearPlaylist();
      const newPl = pls[cur];
      if (newPl && newPl.tracks) {
        playerSyncRef.current.addToPlaylist(newPl.tracks);
      }
    }
    persist(pls, cur);
    return { success: true };
  }, [playlists, currentPlName, persist]);

  const switchPlaylist = useCallback((name: string) => {
    const pls = { ...playlists };
    if (pls[name]) {
      persist(pls, name);
      // Sync to player: clear current, load new
      if (playerSyncRef.current) {
        playerSyncRef.current.clearPlaylist();
        playerSyncRef.current.addToPlaylist(pls[name].tracks);
      }
      return pls[name];
    }
    const lower = name.toLowerCase();
    const matches = Object.keys(pls).filter(n => n.toLowerCase().includes(lower));
    if (matches.length === 0) return null;
    if (matches.length === 1) {
      persist(pls, matches[0]);
      if (playerSyncRef.current) {
        playerSyncRef.current.clearPlaylist();
        playerSyncRef.current.addToPlaylist(pls[matches[0]].tracks);
      }
      return pls[matches[0]];
    }
    return { candidates: matches };
  }, [playlists, persist]);

  const addTracksToCurrent = useCallback((tracks: string[]) => {
    const pls = { ...playlists };
    const pl = pls[currentPlName];
    if (!pl) return;
    const sync = playerSyncRef.current;
    for (const t of tracks) {
      if (!pl.tracks.includes(t)) pl.tracks.push(t);
      // Also add to player's live playlist
      if (sync) {
        const playerPl = sync.getPlaylist();
        if (!playerPl.includes(t)) sync.addToPlaylist([t]);
      }
    }
    persist(pls, currentPlName);
  }, [playlists, currentPlName, persist]);

  const replaceCurrentTracks = useCallback((tracks: string[]) => {
    const pls = { ...playlists };
    const pl = pls[currentPlName];
    if (!pl) return;
    pl.tracks = [...tracks];
    persist(pls, currentPlName);
    // Completely reset player playlist to match
    if (playerSyncRef.current) {
      playerSyncRef.current.clearPlaylist();
      playerSyncRef.current.addToPlaylist(tracks);
    }
  }, [playlists, currentPlName, persist]);

  const editPlaylist = useCallback((name: string, field: string, value: string) => {
    const pls = { ...playlists };
    const pl = pls[name];
    if (!pl) return { success: false, error: 'notFound' };
    let cur = currentPlName;
    if (field === 'name') {
      if (pls[value] && value !== name) return { success: false, error: 'duplicate' };
      pls[value] = pl;
      pl.name = value;
      delete pls[name];
      if (cur === name) cur = value;
    } else if (field === 'desc' || field === 'description') {
      pl.desc = value;
    } else {
      return { success: false, error: 'badField' };
    }
    persist(pls, cur);
    return { success: true };
  }, [playlists, currentPlName, persist]);

  const getCurrentPlaylist = useCallback((): Playlist | null => {
    return playlists[currentPlName] || null;
  }, [playlists, currentPlName]);

  const getCurrentPlName = useCallback((): string => currentPlName, [currentPlName]);

  const listAllPlaylists = useCallback((): PlaylistInfo[] => {
    return Object.values(playlists).map(p => ({
      name: p.name, desc: p.desc, createdAt: p.createdAt,
      trackCount: p.tracks.length, isCurrent: p.name === currentPlName,
    }));
  }, [playlists, currentPlName]);

  const getPlaylistData = useCallback((name: string): Playlist | null => {
    return playlists[name] || null;
  }, [playlists]);

  const getPlaylistsForTrack = useCallback((trackPath: string): string[] => {
    return Object.values(playlists)
      .filter(pl => pl.tracks.includes(trackPath))
      .map(pl => pl.name);
  }, [playlists]);

  const syncTrackToPlaylists = useCallback((trackPath: string, names: string[]) => {
    const pls = { ...playlists };
    for (const pl of Object.values(pls)) {
      if (names.includes(pl.name)) {
        if (!pl.tracks.includes(trackPath)) pl.tracks.push(trackPath);
      } else {
        pl.tracks = pl.tracks.filter(t => t !== trackPath);
      }
    }
    persist(pls, currentPlName);
  }, [playlists, currentPlName, persist]);

  return (
    <PlaylistContext.Provider value={{
      playlists, currentPlName,
      registerPlayerSync,
      createPlaylist, deletePlaylist, switchPlaylist,
      addTracksToCurrent, replaceCurrentTracks,
      editPlaylist, getCurrentPlaylist, getCurrentPlName,
      listAllPlaylists, getPlaylistData,
      getPlaylistsForTrack, syncTrackToPlaylists,
      savePlaylists: savePlaylistsFn, ensureDefault,
    }}>
      {children}
    </PlaylistContext.Provider>
  );
}

export function usePlaylists() {
  const ctx = useContext(PlaylistContext);
  if (!ctx) throw new Error('usePlaylists must be used within PlaylistProvider');
  return ctx;
}
