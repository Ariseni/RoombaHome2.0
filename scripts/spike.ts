/**
 * Protocol spike: validates the whole cloud chain against your real robot
 * from Node, before any UI is involved.
 *
 *   ROOMBA_USER=... ROOMBA_PASS=... ROOMBA_COUNTRY=DE npx tsx scripts/spike.ts
 *
 * Options (env):
 *   ROOMBA_BLID=...       pick a robot when the account has several
 *   ROOMBA_AUTH=query     use query-string auth instead of WS headers
 *   ROOMBA_FIND=1         send the harmless "find" chime command
 *   ROOMBA_WATCH=60       keep listening for shadow/dock/timeline updates for N seconds
 *   ROOMBA_LIVEMAP=1      also subscribe to the live map stream while watching
 *   ROOMBA_DUMP=dir       write raw JSON responses + map bundle files into dir
 *
 * Nothing is stored. Close the official Roomba app first: iRobot limits
 * concurrent sessions per account.
 */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

import { RobotSession, type WebSocketFactory } from '../src/protocol';
import { simpleCommand } from '../src/protocol/commands';
import { buildMapModel, parseBundleFiles, regionNamesFrom } from '../src/protocol/maps/bundle';
import { activityOf, errorText, phaseLabel } from '../src/protocol';
import { dockStateInfo } from '../src/protocol/models/dock';

const env = process.env;
const username = env.ROOMBA_USER;
const password = env.ROOMBA_PASS;
const countryCode = env.ROOMBA_COUNTRY ?? 'US';
if (!username || !password) {
  console.error('Set ROOMBA_USER and ROOMBA_PASS (and optionally ROOMBA_COUNTRY).');
  process.exit(2);
}

const dumpDir = env.ROOMBA_DUMP;
function dump(name: string, data: unknown): void {
  if (!dumpDir) return;
  fs.mkdirSync(dumpDir, { recursive: true });
  const file = path.join(dumpDir, name);
  if (data instanceof Uint8Array) fs.writeFileSync(file, data);
  else fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  (wrote ${file})`);
}

const createSocket: WebSocketFactory = (url, protocols, options) =>
  new WebSocket(url, protocols, { headers: options.headers }) as unknown as ReturnType<WebSocketFactory>;

const log = (msg: string, ...args: unknown[]) => console.log('  [mqtt] ' + msg, ...args);

function step(title: string): void {
  console.log(`\n== ${title}`);
}

async function main(): Promise<void> {
  const session = new RobotSession({
    credentials: { username: username!, password: password!, countryCode },
    blid: env.ROOMBA_BLID,
    createSocket,
    authMode: env.ROOMBA_AUTH === 'query' ? 'query' : 'headers',
    log: env.ROOMBA_VERBOSE ? log : undefined,
  });

  session.on('status', (s) => console.log(`  status: ${s.status}${s.error ? ' — ' + s.error : ''}`));
  session.on('login', (r) => {
    step('Login OK');
    console.log(`  deployment:    ${r.deploymentId} (available: ${r.availableDeployments.join(', ')})`);
    console.log(`  mqtt endpoint: ${r.mqttEndpoint}`);
    console.log(`  REST base:     ${r.httpBaseAuth}`);
    console.log(`  topic prefix:  ${r.irbtTopicPrefix}`);
    console.log(`  tokens:        ${r.connectionTokens.length} (client_id ${r.connectionTokens[0]?.clientId})`);
    console.log(`  robots:`);
    for (const rb of Object.values(r.robots)) {
      console.log(`    - ${rb.blid}  "${rb.name}"  sku=${rb.sku}  fw=${rb.softwareVer}`);
      console.log(`      cap: ${JSON.stringify(rb.cap)}`);
    }
    dump('login.json', { ...r.raw, credentials: '<redacted>', connection_tokens: '<redacted>' });
  });
  session.on('dockReport', (d) => console.log(`  [dock/${d.kind}]`, JSON.stringify(d.payload)));
  session.on('timeline', (t) => console.log('  [timeline]', JSON.stringify(t).slice(0, 400)));
  session.on('rejected', (t) => console.log('  [REJECTED]', JSON.stringify(t)));
  session.on('livemap', (m) => {
    if (m.kind === 'position') {
      const last = m.samples[m.samples.length - 1];
      console.log(`  [livemap] seq=${m.sequence} ${m.samples.length} pts, last=(${last?.x}, ${last?.y}) θ=${last?.theta}`);
    } else console.log(`  [livemap] map update ${m.livemapUrl.slice(0, 80)}...`);
  });
  let stateCount = 0;
  session.on('state', (s) => {
    stateCount++;
    if (stateCount > 2) {
      console.log(
        `  [state] ${phaseLabel(s)} bat=${s.batPct}% phase=${s.mission.phase} cycle=${s.mission.cycle} err=${s.mission.error}`,
      );
    }
  });

  step('Discovery + Gigya + /v2/login + MQTT connect');
  await session.start();
  if (session.status !== 'connected') {
    console.error('Could not connect; see status above.');
    process.exit(1);
  }
  const blid = session.blid;
  console.log(`  connected as client ${session.login?.connectionTokens[0]?.clientId} for robot ${blid}`);

  step('Classic shadow GET');
  try {
    const doc = await session.getShadow(null);
    const rep = (doc.state?.reported ?? {}) as Record<string, unknown>;
    console.log(`  keys: ${Object.keys(rep).join(', ')}`);
    dump('shadow-classic.json', doc);
  } catch (e) {
    console.log(`  FAILED: ${(e as Error).message}`);
  }

  step('ro-currentstate shadow GET');
  try {
    const doc = await session.getShadow('ro-currentstate');
    const rep = (doc.state?.reported ?? {}) as Record<string, unknown>;
    console.log(`  keys: ${Object.keys(rep).join(', ')}`);
    dump('shadow-ro-currentstate.json', doc);
  } catch (e) {
    console.log(`  FAILED: ${(e as Error).message}`);
  }

  for (const named of ['rw-settings', 'ro-stats', 'ro-configinfo', 'rw-schedule'] as const) {
    step(`${named} shadow GET`);
    try {
      const doc = await session.getShadow(named, 6000);
      console.log(`  keys: ${Object.keys(doc.state?.reported ?? {}).join(', ')}`);
      dump(`shadow-${named}.json`, doc);
    } catch (e) {
      console.log(`  not available: ${(e as Error).message}`);
    }
  }

  step('Parsed robot state');
  const s = session.state;
  console.log(`  activity: ${activityOf(s)} (${phaseLabel(s)})`);
  console.log(`  battery:  ${s.batPct}%   bin present: ${s.binPresent}   tank present: ${s.tankPresent}   pad: ${s.detectedPad}`);
  console.log(`  mission:  cycle=${s.mission.cycle} phase=${s.mission.phase} error=${s.mission.error} notReady=${s.mission.notReady}`);
  const err = errorText(s.mission.error, s.name ?? 'Roomba');
  if (err) console.log(`  error:    ${err.title} — ${err.content}`);
  if (s.dock) {
    console.log(
      `  dock:     state=${s.dock.state} (${dockStateInfo(s.dock.state)?.label}) wash=${s.dock.pwState} (${dockStateInfo(s.dock.pwState)?.label}) dry=${s.dock.pdState} (${dockStateInfo(s.dock.pdState)?.label}) refill=${s.dock.frState} (${dockStateInfo(s.dock.frState)?.label}) tankLvl=${s.dock.tankLvl}`,
    );
  } else console.log('  dock:     (no dock block in shadow yet)');
  console.log(`  p2maps:   ${JSON.stringify(s.p2maps)}`);

  step('REST: active maps (SigV4)');
  let mapsOk = false;
  try {
    const maps = await session.rest.getActiveMapVersions(blid);
    dump('maps.json', maps);
    console.log(`  ${maps.length} map(s)`);
    for (const m of maps) {
      console.log(`    - ${m.p2map_id}  "${m.name ?? ''}"  version=${m.active_p2mapv_id}  rooms_metadata=${(m.rooms_metadata ?? []).length}`);
    }
    mapsOk = true;
    const first = maps[0];
    if (first) {
      step('REST: map version document + bundle download');
      let versionDoc: unknown = null;
      try {
        versionDoc = await session.rest.getMapVersion(first.p2map_id, first.active_p2mapv_id);
        dump('map-version.json', versionDoc);
      } catch (e) {
        console.log(`  version doc not available: ${(e as Error).message}`);
      }
      const url = await session.rest.getMapBundleUrl(first.p2map_id, first.active_p2mapv_id);
      console.log(`  bundle url: ${url.slice(0, 100)}...`);
      const bytes = await session.rest.downloadBundle(url);
      console.log(`  bundle: ${bytes.length} bytes`);
      dump('map-bundle.tar.gz', bytes);
      const files = parseBundleFiles(bytes);
      console.log(`  files: ${Object.keys(files).join(', ')}`);
      if (dumpDir) for (const [k, v] of Object.entries(files)) dump(`bundle-${k}.json`, v);
      const model = buildMapModel({
        p2mapId: first.p2map_id,
        versionId: first.active_p2mapv_id,
        name: first.name ?? null,
        files,
        regionNames: regionNamesFrom(first, versionDoc),
      });
      console.log(`  bounds: ${JSON.stringify(model.bounds)}  dock: ${JSON.stringify(model.dock)}`);
      console.log(`  rooms (${model.rooms.length}):`);
      for (const r of model.rooms) {
        console.log(`    - id=${r.id}  "${r.name ?? '?'}"  type=${r.roomType}  area=${r.area.toFixed(1)}  centroid=(${r.centroid[0].toFixed(2)}, ${r.centroid[1].toFixed(2)})`);
      }
      console.log(`  zones: ${model.zones.length}  policy zones: ${model.policyZones.length}  floor plan polys: ${model.floorPlan.length}  borders: ${model.borders.length}`);
    }
  } catch (e) {
    console.log(`  FAILED: ${(e as Error).message}`);
    const body = (e as { body?: string }).body;
    if (body) console.log(`  body: ${body.slice(0, 300)}`);
  }

  step('REST: mission history (last 3)');
  try {
    const hist = await session.rest.getMissionHistory(blid, { maxReports: 3 });
    dump('history.json', hist);
    const list = Array.isArray(hist) ? hist : ((hist as Record<string, unknown>).missions ?? (hist as Record<string, unknown>).history ?? hist);
    console.log(`  ${JSON.stringify(list).slice(0, 300)}...`);
  } catch (e) {
    console.log(`  not available: ${(e as Error).message}`);
  }

  if (env.ROOMBA_FIND === '1') {
    step('Sending "find" (robot should chime)');
    await session.sendCommand(simpleCommand('find'));
    console.log('  PUBACK received');
  }

  const watchSeconds = Number(env.ROOMBA_WATCH ?? 0);
  if (watchSeconds > 0) {
    step(`Watching updates for ${watchSeconds}s`);
    if (env.ROOMBA_LIVEMAP === '1') {
      try {
        await session.startLiveMap();
        console.log('  live map subscribed');
      } catch (e) {
        console.log(`  live map failed: ${(e as Error).message}`);
      }
    }
    await new Promise((r) => setTimeout(r, watchSeconds * 1000));
  }

  step('Summary');
  console.log(`  login/mqtt: OK   maps REST: ${mapsOk ? 'OK' : 'FAILED'}   state updates seen: ${stateCount}`);
  session.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('\nSPIKE FAILED:', e);
  process.exit(1);
});
