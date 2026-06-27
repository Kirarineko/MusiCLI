import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Playlist, PlaylistInfo } from '../types';
import { t } from '../i18n';
import { getPlaylists as getPlaylistsFromStore, savePlaylists as savePlaylistsToStore } from '../configStore';

interface PlaylistContextValue {
  playlists: Record<string, Playlist>;
  currentPlName: string;
  getPlaylistTracks: (name: string) => string[] | null;
  createPlaylist: (name: string, desc?: string, sharer?: string) => { success: boolean; error?: string };
  createPlaylistWithTracks: (name: string, desc: string | undefined, sharer: string | undefined, tracks: string[]) => boolean;
  deletePlaylist: (name: string) => { success: boolean; error?: string };
  switchPlaylist: (name: string) => Playlist | { candidates: string[] } | null;
  addTracksToCurrent: (tracks: string[]) => void;
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
  reloadFromStore: () => void;
}

const PlaylistContext = createContext<PlaylistContextValue | null>(null);

function defaultPlaylistName(): string {
  return t('defaultPlName') || 'Default';
}

function loadPlaylistsFromStorage(): { pls: Record<string, Playlist>; cur: string } {
  const { pls, cur } = getPlaylistsFromStore();

  if (Object.keys(pls).length === 0) {
    const name = defaultPlaylistName();
    const newPls = { [name]: { name, desc: '', createdAt: new Date().toISOString(), tracks: [] } };
    savePlaylistsToStore(newPls, name);
    return { pls: newPls, cur: name };
  }
  if (!pls[cur]) {
    const newCur = Object.keys(pls)[0];
    savePlaylistsToStore(pls, newCur);
    return { pls, cur: newCur };
  }
  return { pls, cur };
}

export function PlaylistProvider({ children }: { children: ReactNode }) {
  // Load synchronously so data is ready before any child useEffect runs
  const [playlists, setPlaylists] = useState<Record<string, Playlist>>(() => loadPlaylistsFromStorage().pls);
  const [currentPlName, setCurrentPlName] = useState(() => loadPlaylistsFromStorage().cur);

  const persist = useCallback((pls: Record<string, Playlist>, cur: string) => {
    setPlaylists({ ...pls });
    setCurrentPlName(cur);
    savePlaylistsToStore(pls, cur);
  }, []);

  const getPlaylistTracks = useCallback((name: string): string[] | null => {
    const pl = playlists[name];
    return pl ? pl.tracks : null;
  }, [playlists]);

  /** Re-read playlists from configStore (e.g. after initConfig loaded files) */
  const reloadFromStore = useCallback(() => {
    const { pls, cur } = getPlaylistsFromStore();
    if (Object.keys(pls).length > 0) {
      setPlaylists({ ...pls });
      setCurrentPlName(cur);
    }
  }, []);

  const savePlaylistsFn = useCallback(() => {
    savePlaylistsToStore(playlists, currentPlName);
  }, [playlists, currentPlName]);

  const ensureDefault = useCallback(() => {
    const pls = { ...playlists };
    let cur = currentPlName;
    let changed = false;
    if (Object.keys(pls).length === 0) {
      const name = defaultPlaylistName();
      pls[name] = { name, desc: '', createdAt: new Date().toISOString(), tracks: [] };
      cur = name;
      changed = true;
    } else if (!pls[cur]) {
      cur = Object.keys(pls)[0];
      changed = true;
    }
    if (changed) persist(pls, cur);
  }, [playlists, currentPlName, persist]);

  const createPlaylist = useCallback((name: string, desc?: string, sharer?: string) => {
    const pls = { ...playlists };
    if (pls[name]) return { success: false, error: 'duplicate' };
    pls[name] = { name, desc: desc || '', createdAt: new Date().toISOString(), tracks: [], sharer: sharer || undefined };
    persist(pls, currentPlName);
    return { success: true };
  }, [playlists, currentPlName, persist]);

  /** Atomically create playlist + switch to it + set tracks. Avoids stale-closure issues. */
  const createPlaylistWithTracks = useCallback((name: string, desc: string | undefined, sharer: string | undefined, tracks: string[]) => {
    const pls = { ...playlists };
    if (pls[name]) return false;
    const now = new Date().toISOString();
    pls[name] = { name, desc: desc || '', createdAt: now, updatedAt: now, tracks, sharer: sharer || undefined };
    persist(pls, name);
    return true;
  }, [playlists, persist]);

  const deletePlaylist = useCallback((name: string) => {
    const pls = { ...playlists };
    if (!pls[name]) return { success: false, error: 'notFound' };
    if (Object.keys(pls).length <= 1) return { success: false, error: 'lastOne' };
    delete pls[name];
    let cur = currentPlName;
    if (cur === name) cur = Object.keys(pls)[0];
    persist(pls, cur);
    return { success: true };
  }, [playlists, currentPlName, persist]);

  const switchPlaylist = useCallback((name: string) => {
    const pls = { ...playlists };
    if (pls[name]) {
      persist(pls, name);
      return pls[name];
    }
    const lower = name.toLowerCase();
    const matches = Object.keys(pls).filter(n => n.toLowerCase().includes(lower));
    if (matches.length === 0) return null;
    if (matches.length === 1) {
      persist(pls, matches[0]);
      return pls[matches[0]];
    }
    return { candidates: matches };
  }, [playlists, persist]);

  const addTracksToCurrent = useCallback((tracks: string[]) => {
    const pls = { ...playlists };
    const pl = pls[currentPlName];
    if (!pl) return;
    for (const t of tracks) {
      if (!pl.tracks.includes(t)) pl.tracks.push(t);
    }
    persist(pls, currentPlName);
  }, [playlists, currentPlName, persist]);

  const replaceCurrentTracks = useCallback((tracks: string[]) => {
    const pls = { ...playlists };
    const pl = pls[currentPlName];
    if (!pl) return;
    pl.tracks = [...tracks];
    persist(pls, currentPlName);
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
    } else if (field === 'sharer') {
      pl.sharer = value || undefined;
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
      getPlaylistTracks,
      createPlaylist, createPlaylistWithTracks, deletePlaylist, switchPlaylist,
      addTracksToCurrent, replaceCurrentTracks,
      editPlaylist, getCurrentPlaylist, getCurrentPlName,
      listAllPlaylists, getPlaylistData,
      getPlaylistsForTrack, syncTrackToPlaylists,
      savePlaylists: savePlaylistsFn, ensureDefault, reloadFromStore,
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
