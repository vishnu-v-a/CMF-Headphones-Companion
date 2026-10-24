import { responseDb } from './response.mjs';
import { presets, tuningProfile, headroom, exportProfile } from './tuning.mjs';
import { createProfileLibrary } from './profile-library.mjs';

const $ = selector => document.querySelector(selector);
const invoke = window.__TAURI__?.core?.invoke;
const isAndroid = /Android/i.test(navigator.userAgent);
document.documentElement.classList.toggle('android', isAndroid);
const startingProfile = tuningProfile(presets.flat, 'Flat');
const draftKey = 'cmf-eq-draft-v1';
const bassCondition = 'Bass starting point · Custom EQ, ANC High, bass slider minimum, spatial off.';
let name = startingProfile.name, skipped = [], pending = null, importVersion = 0;
let rows = startingProfile.filters.map(filter => ({...filter, enabled: true}));
while (rows.length < 8) rows.push({id:rows.length+1,kind:'PK',frequency:1000,gain:0,q:1,enabled:false});
let toneValues = {...presets.flat}, previousDraft = null, writeReview = null, notificationTimer;
let selectedBand = 0;
let connection = { connected: false }, connectionBusy = false, pollTimer;
let ancExpanded = false;
let gainConsentKey = null, spatialConsentKey = null;
let profileLibrary = null;
const deviceKey = () => connection.connected ? `${connection.device.address}|${connection.firmware}` : null;
const cloneProfile = profile => JSON.parse(JSON.stringify(profile));
const spatialNames = {0:'Off',2:'Concert',3:'Cinema'};

function deviceSoundName() {
  const eq = connection.eq;
  if (!eq) return 'Unknown EQ';
  if (eq.filters.every(filter => filter.gain === 0)) return 'Flat';
  const same = (a,b) => Math.fround(a) === Math.fround(b);
  for (const preset of [presets.punch, presets.deep]) {
    const filters = tuningProfile(preset).filters;
    if (filters.length === eq.filters.length && filters.every((filter,index) => filter.kind === eq.filters[index].kind
      && ['frequency','gain','q'].every(key => same(filter[key],eq.filters[index][key])))) return preset.name;
  }
  return `Custom · ${eq.filters.length} bands`;
}
let pendingCondition = 'Imported draft · match ANC to the profile’s measurement condition.';

function renderConnection() {
  const connected = connection.connected;
  if (!connected) { gainConsentKey = null; spatialConsentKey = null; }
  $('#device-name').textContent = connection.device?.name || 'Headphone Pro';
  $('#device-name').title = connection.device?.name || 'Headphone Pro';
  $('#connection-state').textContent = connectionBusy ? (connected ? 'Updating settings…' : 'Connecting…') : connected ? 'Connected' : 'Not connected';
  $('.device-bar').classList.toggle('connected', connected);
  $('.connection-card').classList.toggle('is-connected', connected);
  $('#connection-picker').hidden = connected;
  $('#scan-devices').hidden = connected;
  $('#connection-summary').textContent = connected ? 'Connected' : 'Bluetooth';
  const battery = connection.battery;
  $('#battery-level').textContent = battery ? `${battery.percent}%${battery.charging ? ' ⚡' : ''}` : '—';
  $('#battery').setAttribute('aria-label', battery ? `Battery ${battery.percent} percent${battery.charging ? ', charging' : ''}` : 'Battery unavailable');
  $('#connection-info').textContent = connected ? `Firmware ${connection.firmware} · ${connection.device.address}` : `Pair in ${isAndroid ? 'Android' : 'Windows'} Bluetooth settings first.`;
  $('#connection-info').title = connected ? `Protocol ${connection.protocol_version} · ${connection.device.address} · Firmware ${connection.firmware}` : '';
  $('#paired-device').disabled = !invoke || connected || connectionBusy;
  $('#scan-devices').disabled = !invoke || connected || connectionBusy;
  $('#connect-headphones').disabled = !invoke || connectionBusy || (!connected && !$('#paired-device').value);
  $('#connect-headphones').textContent = connectionBusy ? 'Please wait…' : connected ? 'Disconnect' : 'Connect';
  $('#connect-headphones').classList.toggle('primary', !connected);
  $('#read-device').disabled = !connected || connectionBusy;
  $('#use-device-eq').disabled = !connected || !connection.eq || connectionBusy;
  const warnings = connected && connection.warnings?.length > 0;
  $('.connection-feedback').hidden = !warnings;
  $('#connection-help').textContent = warnings ? `${connection.warnings.length} setting readback(s) unavailable.` : '';
  if (!warnings) {
    $('#status-detail').hidden = true;
    $('#connection-details').setAttribute('aria-expanded', 'false');
  }
  $('#connection-details').hidden = !warnings;
  $('#retry-read').hidden = !warnings;
  $('#retry-read').disabled = connectionBusy;
  const mode = connection.anc_mode;
  const ancNames = { 1: 'High', 2: 'Medium', 3: 'Low', 4: 'Adaptive', 5: 'Off', 7: 'Transparency' };
  const ancActive = connected && [1,2,3,4].includes(mode);
  const ancAvailable = Boolean(invoke && connected && ancNames[mode] && !connectionBusy);
  if (!connected) ancExpanded = false;
  $('#noise-status').textContent = connected ? (ancNames[mode] || 'Unknown') : 'Unavailable';
  for (const button of document.querySelectorAll('[data-noise]')) {
    const selected = connected && (button.dataset.noise === 'off' ? mode === 5 : button.dataset.noise === 'transparency' ? mode === 7 : [1,2,3,4].includes(mode));
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = !ancAvailable;
  }
  $('#anc-levels').hidden = !(ancExpanded || ancActive);
  $('[data-noise="anc"]').setAttribute('aria-expanded', String(!$('#anc-levels').hidden));
  for (const button of document.querySelectorAll('[data-anc]')) {
    button.disabled = !ancAvailable;
    button.setAttribute('aria-pressed', String(ancActive && Number(button.dataset.anc) === mode));
  }
  const spatialAvailable = Boolean(invoke && connected && !connectionBusy && connection.spatial_mode !== null && connection.spatial_mode !== undefined && connection.firmware);
  $('#spatial-status').textContent = !connected ? 'Unavailable' : spatialNames[connection.spatial_mode] || (connection.spatial_mode === undefined || connection.spatial_mode === null ? 'Unknown' : `Other mode (${connection.spatial_mode})`);
  for (const button of document.querySelectorAll('[data-spatial]')) {
    button.setAttribute('aria-pressed', String(connected && Number(button.dataset.spatial) === connection.spatial_mode));
    button.disabled = !spatialAvailable;
    button.title = 'Set spatial mode and check headphone readback.';
  }
  renderEqState();
  $('.spatial-help').textContent = spatialConsentKey === deviceKey() && connected ? 'Select a mode to apply it.' : 'First change asks once; mode readback is checked.';
}

async function setAnc(mode) {
  if (!invoke || connectionBusy || !connection.connected) return;
  clearTimeout(pollTimer);
  connectionBusy = true;
  renderConnection();
  message('Applying noise control and checking headphone readback…');
  try {
    connection = await invoke('set_anc', { mode });
    ancExpanded = [1,2,3,4].includes(connection.anc_mode);
    connectionMessage('Noise control verified on headphones.');
  } catch (error) {
    try { connection = await invoke('headphone_status'); }
    catch { connection = { connected: false }; }
    ancExpanded = false;
    message(String(error.message ?? error), true);
  } finally {
    connectionBusy = false;
    renderConnection();
    schedulePoll();
  }
}

for (const button of document.querySelectorAll('[data-noise]')) {
  button.onclick = () => {
    if (button.dataset.noise === 'anc') {
      ancExpanded = true;
      renderConnection();
      if (![1,2,3,4].includes(connection.anc_mode)) {
        if ([1,2,3,4].includes(connection.last_anc_mode)) setAnc(connection.last_anc_mode);
        else message('Choose Low, Medium, High or Adaptive to enable ANC.');
      }
    } else {
      ancExpanded = false;
      setAnc(button.dataset.noise === 'off' ? 5 : 7);
    }
  };
}
for (const button of document.querySelectorAll('[data-anc]')) {
  button.onclick = () => setAnc(Number(button.dataset.anc));
}

function connectionMessage(prefix) {
  message(`${prefix}${connection.warnings?.length ? ` ${connection.warnings.join(' ')}` : ''}`);
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (connection.connected && !connectionBusy && !document.hidden && !$('#eq-confirm').open) {
    pollTimer = setTimeout(() => readHeadphones(true), 15000);
  }
}

async function scanDevices() {
  if (!invoke || connectionBusy || connection.connected) return;
  const selection = $('#paired-device').value;
  $('#scan-devices').disabled = true;
  $('#connect-headphones').disabled = true;
  $('#paired-device').disabled = true;
  try {
    const devices = await invoke('list_paired_devices');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = devices.length ? 'Select your paired headphones' : 'No paired devices found';
    $('#paired-device').replaceChildren(placeholder);
    for (const device of devices) {
      const option = document.createElement('option');
      option.value = device.address;
      option.textContent = `${device.name} · ${device.address}`;
      $('#paired-device').append(option);
    }
    if (devices.some(device => device.address === selection)) $('#paired-device').value = selection;
    message(devices.length ? 'Choose the headphone name and Bluetooth address, then Connect.' : 'No paired devices found. Pair the headphones in Bluetooth settings, then Refresh.');
  } catch (error) { message(String(error.message ?? error), true); }
  finally { renderConnection(); }
}

async function readHeadphones(quiet = false) {
  if (!invoke || connectionBusy || !connection.connected) return;
  clearTimeout(pollTimer);
  connectionBusy = true;
  renderConnection();
  if (!quiet) message('Reading headphone settings…');
  try {
    connection = await invoke('refresh_headphones');
    if (!quiet) connectionMessage('Headphone settings refreshed. Your editor draft is unchanged.');
  } catch (error) {
    // Recover authoritative backend state instead of retaining a stale green header.
    try { connection = await invoke('headphone_status'); }
    catch { connection = { connected: false }; }
    message(String(error.message ?? error), true);
  } finally {
    connectionBusy = false;
    renderConnection();
    schedulePoll();
  }
}

$('#paired-device').onchange = renderConnection;
$('#scan-devices').onclick = scanDevices;
$('#read-device').onclick = () => readHeadphones();
$('#retry-read').onclick = () => readHeadphones();
$('#connection-details').onclick = () => {
  $('#status-detail').textContent = connection.warnings.join('\n\n');
  $('#status-detail').hidden = !$('#status-detail').hidden;
  $('#connection-details').setAttribute('aria-expanded', String(!$('#status-detail').hidden));
};
$('#connect-headphones').onclick = async () => {
  if (!invoke || connectionBusy) return;
  clearTimeout(pollTimer);
  const disconnecting = connection.connected;
  const address = $('#paired-device').value;
  connectionBusy = true;
  renderConnection();
  message(disconnecting ? 'Closing the headphone control connection…' : 'Connecting to the selected headphones and reading settings…');
  try {
    connection = await invoke(disconnecting ? 'disconnect_headphones' : 'connect_headphones', disconnecting ? {} : { address });
    connectionMessage(disconnecting ? 'Disconnected. Your draft and headphone settings are unchanged.' : `Connected to ${connection.device.name}. Firmware ${connection.firmware}. Your editor draft is unchanged.`);
  } catch (error) {
    try { connection = await invoke('headphone_status'); }
    catch { connection = { connected: false }; }
    message(String(error.message ?? error), true);
  } finally {
    connectionBusy = false;
    renderConnection();
    schedulePoll();
  }
};

$('#use-device-eq').onclick = () => {
  if (!connection.connected || !connection.eq || connectionBusy) return;
  ++importVersion;
  pending = connection.eq;
  pendingCondition = 'Device EQ draft · read from headphones; no settings applied.';
  $('#preview-label').textContent = 'DEVICE EQ READBACK';
  $('#import-name').textContent = pending.name;
  $('#import-summary').textContent = `${connection.device.name} (${connection.device.address}), firmware ${connection.firmware}. ${pending.filters.length}/8 bands · ${pending.preamp} dB preamp. Use in editor replaces your draft only.`;
  $('#import-preview').hidden = false;
  message('Review the headphone readback before replacing your editor draft.');
};

document.addEventListener('visibilitychange', schedulePoll);

const tabs = [...document.querySelectorAll('[role="tab"]')];
function showTab(id, focus = false) {
  closeBandEditor(false);
  for (const tab of tabs) {
    const active = tab.getAttribute('aria-controls') === id;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    if (active && focus) tab.focus();
  }
  $('#status-detail').hidden = true;
  $('#connection-details').setAttribute('aria-expanded', 'false');
  $('#notification').hidden = true;
}
for (const [index, tab] of tabs.entries()) {
  tab.onclick = () => showTab(tab.getAttribute('aria-controls'));
  tab.onkeydown = event => {
    let target;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = tabs.length - 1;
    if (target !== undefined) {
      event.preventDefault();
      showTab(tabs[target].getAttribute('aria-controls'), true);
    }
  };
}

const appWindow = isAndroid ? null : window.__TAURI__?.window?.getCurrentWindow();
for (const [id, action] of [['minimize', 'minimize'], ['close', 'close']]) {
  $(`#${id}`).disabled = !appWindow;
  $(`#${id}`).onclick = async () => {
    try { await appWindow[action](); }
    catch (error) { message(String(error.message ?? error), true); }
  };
}
$('#pin').disabled = !appWindow;
$('#pin').onclick = async () => {
  $('#pin').disabled = true;
  try {
    const pinned = !(await appWindow.isAlwaysOnTop());
    await appWindow.setAlwaysOnTop(pinned);
    $('#pin').setAttribute('aria-pressed', String(pinned));
    $('#pin').title = pinned ? 'Unpin window' : 'Keep on top';
    $('#pin').setAttribute('aria-label', $('#pin').title);
  } catch (error) { message(String(error.message ?? error), true); }
  finally { $('#pin').disabled = false; }
};
$('#choose-profile').onclick = async () => {
  if (!isAndroid || !invoke) { $('#profile-file').click(); return; }
  const version = ++importVersion;
  pending = null; $('#import-preview').hidden = true;
  try {
    const profile = await invoke('import_profile_file');
    if (!profile || version !== importVersion) return;
    pending = profile; pendingCondition = 'Imported draft · match ANC to the profile’s measurement condition.';
    $('#preview-label').textContent = 'IMPORT PREVIEW'; $('#import-name').textContent = profile.name;
    $('#import-summary').textContent = `${profile.filters.length}/8 bands · ${profile.preamp} dB preamp. Confirm to replace your draft.`;
    $('#import-preview').hidden = false;
  } catch (error) { if (version === importVersion) message(String(error.message ?? error), true); }
};
$('#dismiss-notification').onclick = () => { $('#notification').hidden = true; };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeBandEditor();
    $('#status-detail').hidden = true;
    $('#connection-details').setAttribute('aria-expanded', 'false');
    $('#notification').hidden = true;
  }
});

function message(text, error = false) {
  clearTimeout(notificationTimer);
  $('#message').textContent = text;
  $('#message').title = text;
  $('#notification').classList.toggle('is-error', error);
  $('#notification').hidden = false;
  if (!error) notificationTimer = setTimeout(() => { $('#notification').hidden = true; }, 5000);
}

function draft() {
  if (!$('#preamp').checkValidity()) throw Error('Enter a finite preamp value.');
  for (const [index, filter] of rows.entries()) {
    if (filter.enabled && !validBand(filter)) {
      throw Error(`Check band ${index + 1}: use 20–20,000 Hz, a finite gain, and Q greater than zero.`);
    }
  }
  const filters = rows.filter(row => row.enabled).map(({enabled,...filter}) => filter);
  if (!filters.length) throw Error('Enable at least one filter.');
  const disabled = skipped.filter(id => !filters.some(filter => filter.id === id));
  return {name, preamp: Number($('#preamp').value), filters, disabled_filters: disabled};
}

function validBand(filter) {
  return [filter.frequency, filter.gain, filter.q].every(Number.isFinite)
    && filter.frequency >= 20 && filter.frequency <= 20000 && filter.q > 0;
}

function closeBandEditor(restoreFocus = true) {
  const wasOpen = !$('#band-editor').hidden;
  $('#band-editor').hidden = true;
  for (const button of $('#bands').children) {
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-pressed', 'false');
  }
  if (wasOpen && restoreFocus) $('#bands').children[selectedBand]?.focus();
}

function openBandEditor(index) {
  $('#tone-panel').hidden = true;
  $('#toggle-tone').setAttribute('aria-expanded', 'false');
  selectedBand = index;
  const filter = rows[index];
  $('#band-title').textContent = `Band ${String(index + 1).padStart(2, '0')}`;
  $('#band-enabled').checked = filter.enabled;
  $('#band-kind').value = filter.kind;
  for (const field of ['frequency', 'gain', 'q']) {
    const input = $(`#band-${field}`);
    input.value = Number.isFinite(filter[field]) ? filter[field] : '';
    input.setCustomValidity(field === 'q' && filter.q <= 0 ? 'Q must be greater than zero.' : '');
  }
  $('#band-editor').hidden = false;
  update();
  $('#band-enabled').focus();
}

function renderBands() {
  $('#bands').replaceChildren();
  rows.forEach((_, index) => {
    const button = document.createElement('button');
    button.className = 'band-button';
    button.setAttribute('aria-controls', 'band-editor');
    button.innerHTML = '<strong></strong><span></span>';
    button.onclick = () => openBandEditor(index);
    button.onkeydown = event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % rows.length;
      if (event.key === 'ArrowLeft') next = (index + rows.length - 1) % rows.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = rows.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        openBandEditor(next);
        $('#bands').children[next].focus();
      }
    };
    $('#bands').append(button);
  });
}

function update() {
  for (const [index, button] of [...$('#bands').children].entries()) {
    const filter = rows[index];
    const frequency = Number.isFinite(filter.frequency) ? String(Number((filter.frequency >= 1000 ? filter.frequency / 1000 : filter.frequency).toFixed(1))) + (filter.frequency >= 1000 ? 'k' : '') : '?';
    const invalid = filter.enabled && !validBand(filter);
    const selected = index === selectedBand && !$('#band-editor').hidden;
    button.querySelector('strong').textContent = String(index + 1).padStart(2, '0');
    button.querySelector('span').textContent = filter.enabled ? `${frequency} Hz` : 'Off';
    button.classList.toggle('off', !filter.enabled);
    button.classList.toggle('invalid', invalid);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-expanded', String(selected));
    button.setAttribute('aria-label', `Edit band ${index + 1}, ${filter.enabled ? 'enabled' : 'disabled'}, ${filter.frequency} Hz, ${filter.gain} dB, Q ${filter.q}${invalid ? ', invalid settings' : ''}`);
    button.title = `Band ${index + 1} · ${filter.frequency} Hz · ${filter.gain} dB · Q ${filter.q}${invalid ? ' · Check settings' : ''}`;
  }
  $('#band-enabled-label').textContent = rows[selectedBand].enabled ? 'Enabled' : 'Disabled';
  $('#profile-name').textContent=name;
  $('#band-count').textContent=`${rows.filter(row=>row.enabled).length} / 8 bands`;
  try {
    const current=draft();
    if(!Number.isFinite(current.preamp)||current.filters.some(f=>![f.frequency,f.gain,f.q].every(Number.isFinite)||f.q<=0))throw Error('Enter finite EQ values and a positive Q.');
    draw(current);
  } catch(error){$('#response').replaceChildren();}
  renderEqState();
}

function draw(profile) {
  const svg=$('#response'), ns='http://www.w3.org/2000/svg';
  svg.replaceChildren();
  const height = svg.clientWidth ? Math.max(160, svg.clientHeight * 920 / svg.clientWidth) : 240;
  const bottom = height - 32;
  svg.setAttribute('viewBox', `0 0 920 ${height}`);
  const add=(tag,attributes,text)=>{const el=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attributes))el.setAttribute(key,value);if(text)el.textContent=text;svg.append(el);return el;};
  const points=Array.from({length:321},(_,i)=>{const hz=20*1000**(i/320);return {hz,db:responseDb(profile.filters,profile.preamp,hz)};});
  if(points.some(p=>!Number.isFinite(p.db)))throw Error('These filter values cannot be plotted.');
  const lo=Math.floor(Math.min(-12,...points.map(p=>p.db))/6)*6,hi=Math.ceil(Math.max(6,...points.map(p=>p.db))/6)*6;
  const x=hz=>42+Math.log(hz/20)/Math.log(1000)*858,y=db=>12+(hi-db)/(hi-lo)*(bottom-12);
  for(let i=0;i<=4;i++){const db=lo+(hi-lo)*i/4;add('line',{x1:42,x2:900,y1:y(db),y2:y(db),class:Math.abs(db)<.01?'zero-line':'grid-line'});add('text',{x:32,y:y(db)+3,'text-anchor':'end',class:'axis-label'},`${db.toFixed(0)}`);}
  for(const hz of [20,50,100,200,500,1000,2000,5000,10000,20000]){add('line',{x1:x(hz),x2:x(hz),y1:12,y2:bottom,class:'grid-line'});add('text',{x:x(hz),y:height-9,'text-anchor':'middle',class:'axis-label'},hz>=1000?`${hz/1000}k`:`${hz}`);}
  const path=points.map((p,i)=>`${i?'L':'M'}${x(p.hz).toFixed(2)},${y(p.db).toFixed(2)}`).join(' ');
  add('path',{d:`${path} L900,${bottom} L42,${bottom} Z`,class:'curve-fill'});add('path',{d:path,class:'curve'});
  const band = rows[selectedBand];
  if (band?.enabled) {
    const db = responseDb(profile.filters, profile.preamp, band.frequency);
    add('line', {x1:x(band.frequency),x2:x(band.frequency),y1:12,y2:bottom,class:'band-guide'});
    add('circle', {cx:x(band.frequency),cy:y(db),r:7,class:'band-dot'});
  }
}

function useProfile(profile, condition = 'Imported draft · match ANC to the profile’s measurement condition.', tone = null) {
  closeBandEditor(false);
  toneValues = tone ? {...tone} : null;
  name=profile.name;skipped=profile.disabled_filters;rows=profile.filters.map(filter=>({...filter,enabled:true}));
  let id=Math.max(0,...rows.map(row=>row.id));
  while(rows.length<8)rows.push({id:++id,kind:'PK',frequency:1000,gain:0,q:1,enabled:false});
  selectedBand=0;
  $('#preamp').value=profile.preamp;renderBands();update();
  $('#condition').textContent=condition;
  syncToneControls();
}

$('#preamp').oninput=() => { toneValues = null; syncToneControls(); update(); };
$('#close-band').onclick = () => { closeBandEditor(); update(); };
$('#band-enabled').onchange = event => { toneValues = null; syncToneControls(); rows[selectedBand].enabled = event.target.checked; update(); };
$('#band-kind').onchange = event => { toneValues = null; syncToneControls(); rows[selectedBand].kind = event.target.value; update(); };
for (const field of ['frequency', 'gain', 'q']) {
  $(`#band-${field}`).oninput = event => {
    const input = event.target;
    rows[selectedBand][field] = input.value === '' ? NaN : Number(input.value);
    toneValues = null;
    syncToneControls();
    input.setCustomValidity(field === 'q' && rows[selectedBand].q <= 0 ? 'Q must be greater than zero.' : '');
    update();
  };
}
function syncToneControls() {
  for (const key of ['deep', 'punch', 'clarity']) {
    const slider = $(`#tone-${key}`);
    slider.disabled = !toneValues;
    if (toneValues) slider.value = toneValues[key];
    $(`#tone-${key}-value`).value = toneValues ? `${slider.value}%` : '—';
  }
  $('#tone-help').textContent = toneValues
    ? Object.values(toneValues).filter(value => typeof value === 'number').every(value => value === 0)
      ? 'Flat draft · no additional correction or preamp attenuation.'
      : 'Relative bass tuning · automatic headroom may lower overall level.'
    : 'Advanced/imported draft · choose a preset to use sound controls.';
  for (const button of document.querySelectorAll('[data-preset]')) {
    button.setAttribute('aria-pressed', String(Boolean(toneValues && name === presets[button.dataset.preset].name)));
  }
}

function renderEqState() {
  $('#toggle-tone').textContent = $('#tone-panel').hidden ? 'Tune sound' : 'Show presets';
  let valid = false;
  try {
    const profile = draft(), estimate = headroom(profile);
    valid = estimate.outputPeak <= 0 && profile.preamp <= 0;
    $('#headroom-status').textContent = profile.preamp > 0 ? 'Positive preamp: use Controls → Output gain' : valid
      ? `Estimated peak ${estimate.outputPeak.toFixed(1)} dB · draft`
      : `Needs ${estimate.outputPeak.toFixed(1)} dB more headroom`;
    $('#headroom-status').classList.toggle('invalid-draft', !valid);
    $('#headroom-status').title = `48 kHz mathematical response estimate, not measured loudness or a guarantee against transient clipping. Suggested preamp: ${estimate.recommended} dB.`;
    $('#auto-headroom').disabled = false;
    $('#save-draft').disabled = !invoke || Boolean(profileLibrary?.busy);
    $('#save-profile-from-editor').disabled = $('#save-draft').disabled;
    $('#export-draft').disabled = false;
  } catch (error) {
    $('#headroom-status').textContent = error.message;
    $('#headroom-status').title = error.message;
    $('#headroom-status').classList.add('invalid-draft');
    $('#auto-headroom').disabled = true;
    $('#save-draft').disabled = true;
    $('#save-profile-from-editor').disabled = true;
    $('#export-draft').disabled = true;
  }
  const canWrite = Boolean(invoke && connection.connected && !connectionBusy && connection.firmware && !connection.snapshot_error);
  const currentGain = connection.eq?.preamp;
  const gainReady = canWrite && connection.eq && !connection.gain_error;
  $('#gain-down').disabled = !gainReady || currentGain - 1 < -30;
  $('#gain-up').disabled = !gainReady || currentGain + 1 > 3;
  $('#undo-gain').disabled = !gainReady || !connection.gain_undo;
  $('#gain-value').value = Number.isFinite(currentGain) ? `${currentGain > 0 ? '+' : ''}${Number(currentGain.toFixed(1))} dB` : '— dB';
  $('#gain-status').textContent = connection.connected ? deviceSoundName() : 'On headphones';
  $('#active-sound').textContent = connection.connected ? `Headphones: ${deviceSoundName()}` : 'Headphones: not connected';
  $('#gain-help').textContent = connection.gain_error || (!invoke ? 'Desktop app required. This preview does not change sound.'
    : gainConsentKey === deviceKey() ? 'EQ kept. Boost may clip or have no audible effect.' : 'EQ bands stay unchanged · 1 dB steps. First use asks once.');
  try {
    const peak = headroom(connection.eq).outputPeak;
    $('#gain-peak').textContent = `Estimated device peak ${peak > 0 ? '+' : ''}${peak.toFixed(1)} dB${peak > 0 ? ' · clipping possible' : ''}`;
    $('#gain-peak').classList.toggle('invalid-draft', peak > 0);
  } catch { $('#gain-peak').textContent = 'Connect to read the current gain.'; $('#gain-peak').classList.remove('invalid-draft'); }
  $('#apply-eq').disabled = !canWrite || !valid || !connection.eq;
  $('#apply-eq').title = !invoke ? 'Open the desktop app to apply EQ.' : !connection.connected ? 'Connect your headphones first.' : !valid ? 'Fix the draft or use Auto headroom.' : connection.snapshot_error || 'Review the selected device and EQ before applying.';
  $('#restore-eq').disabled = !canWrite || !connection.snapshot;
  const eq = connection.eq;
  const states = { verified: 'Last request matches readback', different: 'Readback differs from last request', uncertain: 'EQ uncertain · read again', pending: 'Waiting for readback' };
  $('#device-eq-status').textContent = !invoke ? 'Browser preview · Apply and device reads need the desktop app.' : !connection.connected ? 'Connect to read the headphone EQ.'
    : `${eq ? `Device: ${eq.filters.length} bands · ${eq.preamp} dB preamp` : 'Device EQ unavailable'}${states[connection.eq_write_state] ? ` · ${states[connection.eq_write_state]}` : ' · review values ↗'}`;
  $('#device-eq-status').title = connection.eq_write_note || $('#device-eq-status').textContent;
  $('#device-eq-status').disabled = connectionBusy || !connection.connected || (!eq && !connection.requested_eq);
  $('#device-eq-status').classList.toggle('invalid-draft', ['different', 'uncertain'].includes(connection.eq_write_state));
  const snapshot = connection.snapshot;
  $('#snapshot-status').textContent = connection.snapshot_error || (snapshot
    ? `Original EQ: ${snapshot.bands} bands · ${snapshot.preamp} dB · saved ${new Date(snapshot.captured_at * 1000).toLocaleString()}.`
    : 'An original EQ backup is saved before your first Apply. Existing backups are kept.');
}

function captureDraft() {
  return { profile: draft(), condition: $('#condition').textContent, tone: toneValues ? {...toneValues} : null };
}

for (const button of document.querySelectorAll('[data-preset]')) {
  button.onclick = () => {
    try { previousDraft = captureDraft(); } catch { /* An invalid draft is never saved as an undo target. */ }
    const preset = presets[button.dataset.preset];
    useProfile(tuningProfile(preset, preset.name), preset === presets.flat ? 'Flat custom EQ · 0 dB preamp; no additional correction.' : bassCondition, preset);
    $('#tone-panel').hidden = true;
    $('#toggle-tone').setAttribute('aria-expanded', 'false');
    renderEqState();
    $('#undo-preset').disabled = !previousDraft;
  };
}
$('#undo-preset').onclick = () => {
  if (!previousDraft) return;
  const previous = previousDraft;
  previousDraft = null;
  useProfile(previous.profile, previous.condition, previous.tone);
  $('#undo-preset').disabled = true;
};
for (const key of ['deep', 'punch', 'clarity']) {
  $(`#tone-${key}`).oninput = event => {
    if (!toneValues) return;
    const values = {...toneValues, [key]: Number(event.target.value)};
    useProfile(tuningProfile(values), bassCondition, values);
  };
}
$('#toggle-tone').onclick = () => {
  const show = $('#tone-panel').hidden;
  if (show) closeBandEditor(false);
  $('#tone-panel').hidden = !show;
  $('#toggle-tone').setAttribute('aria-expanded', String(show));
  renderEqState();
};
$('#auto-headroom').onclick = () => {
  try { $('#preamp').value = headroom(draft()).recommended; update(); }
  catch (error) { message(error.message, true); }
};
$('#save-draft').onclick = () => profileLibrary.openSave();
$('#save-profile-from-editor').onclick = () => profileLibrary.openSave();
$('#export-draft').onclick = async () => {
  try {
    const profile = draft();
    const filename = `${profile.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'cmf-profile'}.txt`;
    if (isAndroid && invoke) {
      const saved = await invoke('export_profile_file', {name: filename, text: exportProfile(profile)});
      message(saved ? 'Editor draft exported.' : 'Export cancelled.'); return;
    }
    const url = URL.createObjectURL(new Blob([exportProfile(profile)], {type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message('Export requested. The file contains your editor draft.');
  } catch (error) { message(error.message, true); }
};

function initializeDraft() {
  useProfile(startingProfile, 'Flat custom EQ · 0 dB preamp; no additional correction.', presets.flat);
  try {
    const text = localStorage.getItem(draftKey);
    if (!text) return;
    if (text.length > 256 * 1024) throw Error('Saved draft is too large.');
    const saved = JSON.parse(text), profile = saved.profile;
    const finite = value => typeof value === 'number' && Number.isFinite(Math.fround(value));
    const ids = new Set();
    if (saved.version !== 1 || typeof profile?.name !== 'string' || !finite(profile.preamp)
      || !Array.isArray(profile.filters) || profile.filters.length < 1 || profile.filters.length > 8
      || !Array.isArray(profile.disabled_filters)) throw Error('Saved draft format is invalid.');
    for (const filter of profile.filters) {
      if (!Number.isSafeInteger(filter.id) || filter.id <= 0 || ids.has(filter.id)
        || !['PK','LS','HS'].includes(filter.kind) || !validBand(filter)
        || ![filter.frequency, filter.gain, filter.q].every(finite)) throw Error('Saved band settings are invalid.');
      ids.add(filter.id);
    }
    for (const id of profile.disabled_filters) {
      if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) throw Error('Saved filter IDs are invalid.');
      ids.add(id);
    }
    let tone = null;
    if (saved.tone) {
      try {
        const rebuilt = tuningProfile(saved.tone);
        const same = (left, right) => Math.fround(left) === Math.fround(right);
        if (same(profile.preamp, rebuilt.preamp) && profile.filters.length === rebuilt.filters.length
          && profile.filters.every((filter, index) => filter.kind === rebuilt.filters[index].kind
            && ['frequency','gain','q'].every(key => same(filter[key], rebuilt.filters[index][key])))) tone = saved.tone;
      } catch { /* Hand-edited profiles reopen with the advanced controls. */ }
    }
    useProfile(profile, typeof saved.condition === 'string' ? saved.condition : 'Saved editor draft.', tone);
    showTab('eq');
  } catch (error) { message(`Saved draft could not be loaded. Flat draft opened instead. ${error.message}`, true); }
}

function appendProfileRows(profile, label = '') {
  const body = $('#eq-confirm-bands');
  if (label) {
    const tr = document.createElement('tr'), cell = document.createElement('th');
    cell.colSpan = 5;
    cell.textContent = `${label} · ${profile.preamp} dB preamp`;
    tr.append(cell); body.append(tr);
  }
  for (const [index, filter] of profile.filters.entries()) {
    const tr = document.createElement('tr');
    for (const value of [index + 1, filter.kind, filter.frequency, filter.gain, filter.q]) {
      const td = document.createElement('td');
      td.textContent = typeof value === 'number' ? String(Number(value.toPrecision(6))) : value;
      tr.append(td);
    }
    body.append(tr);
  }
}

async function reviewEq(action, value = null) {
  if (!invoke || connectionBusy || !connection.connected) return;
  clearTimeout(pollTimer);
  connectionBusy = true;
  renderConnection();
  try {
    const target = { address: connection.device.address, firmware: connection.firmware };
    let profile = action === 'restore' ? await invoke('snapshot_profile') : action === 'apply' ? await invoke('validate_profile', {profile: draft()}) : null;
    const isGain = action === 'gain' || action === 'gainUndo';
    const expectedEq = isGain && connection.eq ? cloneProfile(connection.eq) : null;
    if (isGain) {
      if (!expectedEq || (action === 'gain' && ![-1,1].includes(value))) throw Error('Read the headphone EQ before adjusting gain.');
      profile = cloneProfile(expectedEq);
      profile.preamp = action === 'gainUndo' ? connection.gain_undo?.preamp : profile.preamp + value;
      if (!Number.isFinite(profile.preamp)) throw Error('No gain step is available to undo.');
      profile.name = `${deviceSoundName()} · device gain`;
    }
    if (action === 'apply' && profile.preamp > 0) throw Error('Use Controls → Output gain for positive preamp.');
    if (action === 'apply' && headroom(profile).outputPeak > 0) throw Error('Use Auto headroom before applying this draft.');
    writeReview = {action, profile, value, expectedEq, key: deviceKey(), ...target};
    $('#eq-confirm-title').textContent = action === 'inspect' ? 'Headphone EQ readback' : action === 'restore' ? 'Restore your original EQ' : 'Review your EQ';
    if (isGain) $('#eq-confirm-title').textContent = 'Enable direct gain control';
    if (action === 'spatial') $('#eq-confirm-title').textContent = 'Enable spatial control';
    $('#eq-confirm-target').textContent = `${connection.device.name} · ${target.address} · firmware ${target.firmware}`;
    $('#eq-confirm-summary').textContent = profile ? `${profile.name} · ${profile.filters.length} bands · ${profile.preamp} dB preamp.` : connection.eq_write_note || 'Stored filter values. Audible preset activation is not detected.';
    if (action === 'spatial') $('#eq-confirm-summary').textContent = `${spatialNames[connection.spatial_mode] || 'Current mode'} → ${spatialNames[value]}`;
    $('.confirm-table-wrap').hidden = action === 'spatial';
    $('#eq-confirm-bands').replaceChildren();
    if (profile) appendProfileRows(profile);
    else {
      if (connection.requested_eq) appendProfileRows(connection.requested_eq, 'Last requested');
      if (connection.eq) appendProfileRows(connection.eq, 'Read from headphones');
    }
    $('#eq-confirm-backup').textContent = action === 'inspect' ? 'Readback shows stored values; it does not measure sound or prove that Custom mode is active.'
      : action === 'restore' ? 'Restores saved EQ values for this device and firmware. Preset selection, ANC, slider position and your draft are unchanged.'
      : connection.snapshot ? 'Your existing original EQ backup will be kept.' : 'The current headphone EQ will be read and saved before applying.';
    if (isGain) $('#eq-confirm-backup').textContent = `Keeps all ${profile.filters.length} current EQ bands. Gain changes from ${expectedEq.preamp} to ${profile.preamp} dB. Undo step restores the previous gain; your original backup and editor draft are kept.`;
    if (action === 'spatial') $('#eq-confirm-backup').textContent = 'Uses the B175 reference mode mapping and verifies mode readback. Audible Cinema/Concert behavior still needs owner confirmation. Your editor draft is kept.';
    $('#eq-confirm-gain-warning').hidden = !isGain && action !== 'spatial';
    $('#eq-confirm-gain-warning').textContent = isGain
      ? 'Gain can clip, trigger limiting or have no audible benefit. The app adds no audio limiter. Lower playback volume first. After this confirmation, − / + apply directly until disconnect. Stored gain may persist; +3 dB is an app bound, not a manufacturer safety limit.'
      : action === 'spatial' ? 'After this confirmation, the spatial buttons apply directly until disconnect. The setting may persist. Select Off to disable spatial audio.' : '';
    $('#custom-mode-label').textContent = isGain
      ? 'Custom EQ is selected in Nothing X. Enable direct gain adjustments for this connection; I understand the clipping risk.'
      : action === 'spatial' ? 'Enable spatial mode controls for this connection.' : 'Custom EQ is selected in Nothing X.';
    $('.custom-mode-check').hidden = action === 'inspect';
    $('#custom-mode-confirmed').required = action !== 'inspect';
    $('#custom-mode-confirmed').checked = false;
    $('#confirm-eq').hidden = action === 'inspect';
    $('#confirm-eq').textContent = action === 'restore' ? 'Restore and verify' : 'Apply and verify';
    $('#cancel-eq').textContent = action === 'inspect' ? 'Close' : 'Cancel';
    $('#eq-confirm-result').textContent = '';
    $('#eq-confirm').showModal();
  } catch (error) { message(String(error.message ?? error), true); }
  finally { connectionBusy = false; renderConnection(); schedulePoll(); }
}

$('#apply-eq').onclick = () => reviewEq('apply');
function changeGain(delta) {
  if (!invoke || connectionBusy || !connection.eq) return;
  if (gainConsentKey !== deviceKey()) { reviewEq(delta === 'undo' ? 'gainUndo' : 'gain', delta); return; }
  commitDeviceChange({action: delta === 'undo' ? 'gainUndo' : 'gain', value: delta, expectedEq: cloneProfile(connection.eq),
    address:connection.device.address,firmware:connection.firmware,key:deviceKey()});
}
$('#gain-down').onclick = () => changeGain(-1);
$('#gain-up').onclick = () => changeGain(1);
$('#undo-gain').onclick = () => changeGain('undo');
for (const button of document.querySelectorAll('[data-spatial]')) button.onclick = () => {
  const mode = Number(button.dataset.spatial);
  if (!invoke || connectionBusy || mode === connection.spatial_mode) return;
  if (spatialConsentKey !== deviceKey()) { reviewEq('spatial', mode); return; }
  commitDeviceChange({action:'spatial',value:mode,address:connection.device.address,firmware:connection.firmware,key:deviceKey()});
};
$('#restore-eq').onclick = () => reviewEq('restore');
$('#device-eq-status').onclick = () => reviewEq('inspect');
$('#cancel-eq').onclick = () => { if (!connectionBusy) $('#eq-confirm').close(); };
$('#eq-confirm').addEventListener('cancel', event => { if (connectionBusy) event.preventDefault(); });
$('#eq-confirm').addEventListener('close', () => { writeReview = null; schedulePoll(); });
async function commitDeviceChange(review, fromDialog = false) {
  if (!invoke || connectionBusy || !connection.connected) return;
  clearTimeout(pollTimer);
  connectionBusy = true;
  renderConnection();
  $('#confirm-eq').disabled = true;
  $('#cancel-eq').disabled = true;
  $('#custom-mode-confirmed').disabled = true;
  $('#eq-confirm-result').textContent = 'Saving recovery settings, writing EQ, and checking device readback…';
  try {
    const args = { address: review.address, firmware: review.firmware, customModeConfirmed: true };
    if (review.action === 'apply') args.profile = review.profile;
    if (review.action === 'gain' || review.action === 'gainUndo') args.expectedEq = review.expectedEq;
    if (review.action === 'gain') { args.deltaDb = review.value; args.gainTrialConfirmed = true; }
    if (review.action === 'spatial') { args.mode = review.value; args.confirmed = true; }
    const command = {gain:'set_bluetooth_gain',gainUndo:'undo_bluetooth_gain',spatial:'set_spatial',apply:'apply_eq',restore:'restore_eq'}[review.action];
    connection = await invoke(command, args);
    if (review.action === 'gain' || review.action === 'gainUndo') gainConsentKey = review.key;
    if (review.action === 'spatial') spatialConsentKey = review.key;
    if (fromDialog) $('#eq-confirm').close();
    message(review.action === 'spatial' ? `${spatialNames[connection.spatial_mode]} matches mode readback.`
      : `${review.action === 'gain' || review.action === 'gainUndo' ? 'Gain updated; EQ bands kept.' : 'EQ values verified.'}${connection.eq_write_note ? ` ${connection.eq_write_note}` : ''} Your editor draft is kept.`);
  } catch (error) {
    try { connection = await invoke('headphone_status'); }
    catch { connection = {connected:false}; }
    if (fromDialog) $('#eq-confirm').close();
    message(String(error.message ?? error), true);
  } finally {
    connectionBusy = false;
    $('#confirm-eq').disabled = false;
    $('#cancel-eq').disabled = false;
    $('#custom-mode-confirmed').disabled = false;
    renderConnection();
    schedulePoll();
  }
}
$('#eq-confirm-form').onsubmit = event => {
  event.preventDefault();
  if (!writeReview || writeReview.action === 'inspect' || connectionBusy || !$('#custom-mode-confirmed').checked) return;
  commitDeviceChange(writeReview, true);
};

$('#profile-file').onchange=async event=>{
  pendingCondition = 'Imported draft · match ANC to the profile’s measurement condition.';
  $('#preview-label').textContent = 'IMPORT PREVIEW';
  const version=++importVersion;pending=null;$('#import-preview').hidden=true;
  const file=event.target.files[0];if(!file)return;
  try{
    if(!invoke)throw Error('File import needs the desktop app. This browser view is a visual preview.');
    if(file.size>256*1024)throw Error('Profile exceeds the 256 KB import limit.');
    const profile=await invoke('import_autoeq',{text:await file.text(),name:file.name.replace(/\.txt$/i,'')});
    if(version!==importVersion)return;
    pending=profile;$('#import-name').textContent=profile.name;
    $('#import-summary').textContent=`${profile.filters.length}/8 bands · ${profile.preamp} dB preamp · ${profile.disabled_filters.length} disabled rows skipped. Confirm to replace your draft.`;
    $('#import-preview').hidden=false;message('Profile validated. Review the import before replacing your draft.');
  }catch(error){if(version===importVersion)message(String(error.message??error),true);}
  finally{event.target.value='';}
};
$('#use-import').onclick=()=>{if(pending){useProfile(pending,pendingCondition);pending=null;$('#import-preview').hidden=true;showTab('eq', true);}};
$('#cancel-import').onclick=()=>{++importVersion;pending=null;$('#import-preview').hidden=true;message('Import cancelled. Your draft is unchanged.');};
$('#reference').onclick=async()=>{try{if(!invoke)throw Error('Load reference needs the desktop app. This preview opens with a Punch draft.');const profile=await invoke('reference_profile');++importVersion;pending=null;$('#import-preview').hidden=true;useProfile(profile);$('#condition').textContent='Reference tuning · ANC maximum.';showTab('eq', true);}catch(error){message(String(error.message??error),true);}};
profileLibrary = createProfileLibrary({
  invoke, capture: captureDraft, message, onBusy: renderEqState,
  openDraft(profile, condition, tone) {
    try { previousDraft = captureDraft(); } catch { previousDraft = null; }
    useProfile(cloneProfile(profile), condition, tone);
    $('#undo-preset').disabled = !previousDraft;
    showTab('eq', true);
  },
  savedDraft(entry) {
    name = entry.profile.name; update(); syncToneControls();
    $('#condition').textContent = entry.condition;
    try { localStorage.setItem(draftKey, JSON.stringify({ version: 1, profile: entry.profile, condition: entry.condition, tone: entry.tone })); }
    catch { /* The named file is saved even if the single working-draft cache is unavailable. */ }
  },
});
initializeDraft();
profileLibrary.refresh();
new ResizeObserver(() => {
  try { draw(draft()); }
  catch { $('#response').replaceChildren(); }
}).observe($('#response'));
renderConnection();
if (invoke) {
  (async () => {
    try {
      connection = await invoke('headphone_status');
      renderConnection();
      if (!connection.connected) await scanDevices();
      schedulePoll();
    } catch (error) { message(String(error.message ?? error), true); }
  })();
}
