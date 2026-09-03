import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';

import { createRNSocket } from '@/lib/socket';
import {
  clearCredentials,
  loadCredentials,
  loadSelectedRobot,
  readJsonCache,
  saveCredentials,
  saveSelectedRobot,
  writeJsonCache,
} from '@/lib/storage';
import type { CommandPayload } from '@/protocol/commands';
import { AuthCredentialsError, AuthRateLimitedError } from '@/protocol/errors';
import type { LiveMapMessage, PositionSample } from '@/protocol/models/livemap';
import { type RobotState, emptyState } from '@/protocol/models/shadow';
import { type ConnectionStatus, RobotSession } from '@/protocol/session';
import type { Credentials, LoginResult, RobotLoginEntry } from '@/protocol/types';

export type AuthState = 'loading' | 'signedOut' | 'signedIn';

export interface DockReport {
  kind: string;
  payload: unknown;
  at: number;
}

interface SessionStore {
  authState: AuthState;
  status: ConnectionStatus;
  statusError: string | null;
  credentials: Credentials | null;
  selectedBlid: string | null;
  robots: RobotLoginEntry[];
  robotInfo: RobotLoginEntry | null;
  login: LoginResult | null;
  robot: RobotState;
  dockReports: DockReport[];
  timeline: unknown[];
  commandBusy: string | null;
  lastError: string | null;
  liveMap: { samples: PositionSample[]; lastSeq: number; mapUrl: string | null; active: boolean };

  bootstrap: () => Promise<void>;
  signIn: (creds: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
  selectRobot: (blid: string) => Promise<void>;
  reconnect: () => Promise<void>;
  sendCommand: (payload: CommandPayload, label?: string) => Promise<boolean>;
  refreshState: () => Promise<void>;
  startLiveMap: () => Promise<void>;
  stopLiveMap: () => void;
  clearError: () => void;
}

async function resetAccountStores(): Promise<void> {
  const [{ useFavorites }, { useHistory }, { useMaps }, { useSchedules }, { useSettings }] = await Promise.all([
    import('./favorites'),
    import('./history'),
    import('./maps'),
    import('./schedules'),
    import('./settings'),
  ]);
  useFavorites.getState().reset();
  useHistory.getState().reset();
  useMaps.getState().reset();
  useSchedules.getState().reset();
  useSettings.getState().reset();
}

let session: RobotSession | null = null;
let appStateSub: { remove: () => void } | null = null;
const log = (msg: string, ...args: unknown[]) => {
  if (__DEV__) console.log('[rh2] ' + msg, ...args);
};

export function getSession(): RobotSession | null {
  return session;
}

const LAST_STATE_KEY = 'last-state';
const MAX_LIVE_SAMPLES = 4000;

export const useSession = create<SessionStore>((set, get) => {
  function attach(s: RobotSession): void {
    s.on('status', ({ status, error }) => {
      set({ status, statusError: error ?? null });
      if (status === 'connected') set({ authState: 'signedIn' });
    });
    s.on('login', (r) => {
      set({ login: r, robots: Object.values(r.robots) });
    });
    s.on('state', (state) => {
      set({ robot: state, robotInfo: s.robotInfo });
      writeJsonCache(LAST_STATE_KEY, state);
    });
    s.on('dockReport', (d) => {
      set((st) => ({ dockReports: [{ ...d, at: Date.now() }, ...st.dockReports].slice(0, 30) }));
    });
    s.on('timeline', (t) => set((st) => ({ timeline: [t, ...st.timeline].slice(0, 30) })));
    s.on('rejected', (r) => {
      log('command rejected: %s', JSON.stringify(r));
      set({ lastError: `Robot rejected a command: ${JSON.stringify(r).slice(0, 200)}` });
    });
    s.on('livemap', (m: LiveMapMessage) => {
      set((st) => {
        if (m.kind === 'position') {
          const samples = st.liveMap.samples.concat(m.samples);
          return {
            liveMap: {
              ...st.liveMap,
              samples: samples.length > MAX_LIVE_SAMPLES ? samples.slice(samples.length - MAX_LIVE_SAMPLES) : samples,
              lastSeq: m.sequence,
            },
          };
        }
        return { liveMap: { ...st.liveMap, mapUrl: m.livemapUrl } };
      });
    });
  }

  async function connect(creds: Credentials, blid: string | null): Promise<RobotSession> {
    session?.stop();
    session?.clear();
    const s = new RobotSession({
      credentials: creds,
      blid: blid ?? undefined,
      createSocket: createRNSocket,
      log,
    });
    session = s;
    attach(s);
    await s.start();
    return s;
  }

  function ensureAppStateListener(): void {
    if (appStateSub) return;
    let bgTimer: ReturnType<typeof setTimeout> | null = null;
    appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const { authState, credentials, selectedBlid } = get();
      if (authState !== 'signedIn' || !credentials) return;
      if (next === 'active') {
        if (bgTimer) clearTimeout(bgTimer);
        bgTimer = null;
        if (session && session.status === 'idle') {
          log('foreground: reconnecting');
          session.start().catch(() => undefined);
        } else if (!session) {
          connect(credentials, selectedBlid).catch(() => undefined);
        } else {
          session.refreshState().catch(() => undefined);
        }
      } else if (next === 'background') {
        // Drop the connection shortly after backgrounding: frees the account's
        // MQTT slot and saves battery. Reconnect is quick on return.
        bgTimer = setTimeout(() => {
          log('background: pausing connection');
          session?.stop();
        }, 20000);
      }
    });
  }

  return {
    authState: 'loading',
    status: 'idle',
    statusError: null,
    credentials: null,
    selectedBlid: null,
    robots: [],
    robotInfo: null,
    login: null,
    robot: emptyState(),
    dockReports: [],
    timeline: [],
    commandBusy: null,
    lastError: null,
    liveMap: { samples: [], lastSeq: -1, mapUrl: null, active: false },

    bootstrap: async () => {
      ensureAppStateListener();
      const cached = readJsonCache<RobotState>(LAST_STATE_KEY);
      if (cached) set({ robot: cached });
      const creds = await loadCredentials();
      if (!creds) {
        set({ authState: 'signedOut' });
        return;
      }
      const blid = await loadSelectedRobot();
      set({ credentials: creds, selectedBlid: blid, authState: 'signedIn' });
      connect(creds, blid).catch((e) => log('connect failed: %s', (e as Error).message));
    },

    signIn: async (creds) => {
      set({ statusError: null, lastError: null });
      const s = await connect(creds, null);
      if (s.status === 'connected') {
        await saveCredentials(creds);
        set({ credentials: creds, authState: 'signedIn', selectedBlid: s.blid });
        await saveSelectedRobot(s.blid);
        return;
      }
      const err = get().statusError ?? 'Could not connect';
      s.stop();
      session = null;
      if (/rate|slot|too many/i.test(err)) throw new AuthRateLimitedError(err);
      throw new AuthCredentialsError(err);
    },

    signOut: async () => {
      session?.stop();
      session?.clear();
      session = null;
      await clearCredentials();
      set({
        authState: 'signedOut',
        credentials: null,
        selectedBlid: null,
        robots: [],
        robotInfo: null,
        login: null,
        robot: emptyState(),
        status: 'idle',
        statusError: null,
        dockReports: [],
        timeline: [],
        liveMap: { samples: [], lastSeq: -1, mapUrl: null, active: false },
      });
      await resetAccountStores();
    },

    selectRobot: async (blid) => {
      const creds = get().credentials;
      if (!creds) return;
      await saveSelectedRobot(blid);
      set({ selectedBlid: blid, robot: emptyState(), dockReports: [], timeline: [] });
      await resetAccountStores();
      await connect(creds, blid);
    },

    reconnect: async () => {
      const { credentials, selectedBlid } = get();
      if (!credentials) return;
      set({ statusError: null });
      await connect(credentials, selectedBlid);
    },

    sendCommand: async (payload, label) => {
      if (!session) {
        set({ lastError: 'Not connected' });
        return false;
      }
      set({ commandBusy: label ?? payload.command, lastError: null });
      try {
        await session.sendCommand(payload);
        // The robot reflects the change in its shadow shortly after.
        setTimeout(() => session?.refreshState().catch(() => undefined), 1500);
        return true;
      } catch (e) {
        set({ lastError: (e as Error).message });
        return false;
      } finally {
        set({ commandBusy: null });
      }
    },

    refreshState: async () => {
      await session?.refreshState();
    },

    startLiveMap: async () => {
      if (!session) return;
      set((st) => ({ liveMap: { ...st.liveMap, active: true, samples: [], lastSeq: -1 } }));
      try {
        await session.startLiveMap();
      } catch (e) {
        set((st) => ({ liveMap: { ...st.liveMap, active: false }, lastError: (e as Error).message }));
      }
    },

    stopLiveMap: () => {
      session?.stopLiveMap();
      set((st) => ({ liveMap: { ...st.liveMap, active: false } }));
    },

    clearError: () => set({ lastError: null }),
  };
});
