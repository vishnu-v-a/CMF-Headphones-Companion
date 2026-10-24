// Local named drafts. Every Bluetooth write remains in the main editor flow.
import { tuningProfile } from './tuning.mjs';

function savedTone(entry) {
  if (!entry.tone) return null;
  try {
    const rebuilt = tuningProfile(entry.tone), profile = entry.profile;
    const same = (a, b) => Math.fround(a) === Math.fround(b);
    if (same(profile.preamp, rebuilt.preamp) && profile.filters.length === rebuilt.filters.length
      && profile.filters.every((f, i) => f.kind === rebuilt.filters[i].kind
        && ['frequency', 'gain', 'q'].every(key => same(f[key], rebuilt.filters[i][key])))) return entry.tone;
  } catch { /* Edited profiles reopen in the advanced editor. */ }
  return null;
}

export function createProfileLibrary({ invoke, capture, openDraft, savedDraft, message, onBusy }) {
  const $ = selector => document.querySelector(selector);
  let profiles = [], warnings = [], loadError = '', loading = false, busy = false;
  let page = 0, generation = 0, dialogState = null, removed = null;
  const pageSize = 2;
  const identity = value => value.trim().toLowerCase();
  const matchingName = () => profiles.find(entry => identity(entry.profile.name) === identity($('#saved-profile-name').value));

  function render() {
    const query = identity($('#profile-search').value);
    const matches = profiles.filter(entry => identity(`${entry.profile.name} ${entry.condition}`).includes(query));
    const pages = Math.ceil(matches.length / pageSize);
    page = Math.max(0, Math.min(page, pages - 1));
    $('#library-count').textContent = String(profiles.length);
    $('#refresh-profiles').disabled = !invoke || loading || busy;
    $('#undo-remove-profile').hidden = !removed;
    $('#undo-remove-profile').disabled = busy || loading;
    $('#profiles-previous').disabled = busy || page === 0;
    $('#profiles-next').disabled = busy || page + 1 >= pages;
    $('#profiles-page').textContent = matches.length ? `${page + 1} / ${pages} · ${matches.length} profiles` : '0 profiles';
    const status = $('#library-status');
    status.textContent = !invoke ? 'Open the desktop app to save profiles.' : loading ? 'Loading profiles…'
      : loadError || (warnings.length ? `${warnings.length} unreadable profile file(s) kept. Other profiles are available.`
        : !profiles.length ? 'Save a tuning from Equalizer to start your library.' : !matches.length ? 'No matching profiles.' : 'Open to preview · Apply to listen');
    status.classList.toggle('invalid-draft', Boolean(loadError || warnings.length));
    status.title = loadError || warnings.join('\n');
    status.hidden = Boolean(profiles.length && matches.length && !loading && !loadError && !warnings.length);
    $('#saved-profile-list').replaceChildren();
    for (const entry of matches.slice(page * pageSize, (page + 1) * pageSize)) {
      const card = document.createElement('div'); card.className = 'saved-profile-card';
      const open = document.createElement('button'); open.className = 'saved-profile-open'; open.disabled = busy;
      open.setAttribute('aria-label', `Open ${entry.profile.name} in editor`);
      const mark = document.createElement('span'); mark.className = 'saved-profile-mark'; mark.textContent = '≋'; mark.setAttribute('aria-hidden', 'true');
      const description = document.createElement('span'); description.className = 'profile-description';
      const name = document.createElement('strong'); name.textContent = entry.profile.name;
      const meta = document.createElement('span'); meta.className = 'small muted';
      meta.textContent = `${entry.profile.filters.length} bands · ${entry.profile.preamp > 0 ? '+' : ''}${entry.profile.preamp} dB`;
      const notes = document.createElement('span'); notes.className = 'small muted profile-notes'; notes.textContent = entry.condition || 'Custom tuning';
      open.title = `${entry.profile.name}\n${entry.condition}\nSaved ${new Date(entry.updated_at * 1000).toLocaleString()}`;
      description.append(name, meta, notes); open.append(mark, description);
      open.onclick = () => { openDraft(entry.profile, entry.condition, savedTone(entry)); message(`“${entry.profile.name}” opened in the editor. Apply to listen.`); };
      const manage = document.createElement('button'); manage.className = 'manage-profile'; manage.textContent = '···'; manage.disabled = busy;
      manage.setAttribute('aria-label', `Rename or remove ${entry.profile.name}`); manage.title = 'Rename or remove';
      manage.onclick = () => showDialog(entry);
      card.append(open, manage); $('#saved-profile-list').append(card);
    }
  }

  async function refresh() {
    if (!invoke) { render(); return; }
    const ticket = ++generation; loading = true; loadError = ''; render();
    try {
      const result = await invoke('list_library_profiles');
      if (ticket !== generation) return;
      profiles = result.profiles; warnings = result.warnings;
    } catch (error) { if (ticket === generation) loadError = String(error.message ?? error); }
    finally { if (ticket === generation) { loading = false; render(); } }
  }

  function dialogButtons() {
    const manage = dialogState?.mode === 'manage';
    $('#update-profile').hidden = manage || !matchingName();
    $('#update-profile').disabled = busy;
    $('#save-profile').textContent = manage ? 'Save changes' : 'Save new';
    $('#remove-profile').hidden = !manage;
    for (const element of $('#profile-form').querySelectorAll('button, input')) element.disabled = busy;
  }

  function setBusy(value) { busy = value; dialogButtons(); render(); onBusy(); }
  function dialogError(error) { $('#profile-dialog-error').textContent = String(error.message ?? error); $('#profile-dialog-error').hidden = false; }

  function showDialog(entry = null) {
    if (!invoke || busy) return;
    try {
      const draft = entry ? { profile: entry.profile, condition: entry.condition, tone: entry.tone } : capture();
      dialogState = { mode: entry ? 'manage' : 'save', entry, draft: JSON.parse(JSON.stringify(draft)) };
      $('#profile-dialog-title').textContent = entry ? 'Manage profile' : 'Save profile';
      $('#profile-dialog-summary').textContent = `${entry ? 'Saved tuning' : 'Editor draft'} · ${draft.profile.filters.length} bands · ${draft.profile.preamp} dB preamp`;
      $('#saved-profile-name').value = draft.profile.name;
      $('#saved-profile-notes').value = draft.condition || '';
      $('#profile-dialog-error').hidden = true;
      dialogButtons(); $('#profile-dialog').showModal(); $('#saved-profile-name').focus(); $('#saved-profile-name').select();
    } catch (error) { message(String(error.message ?? error), true); }
  }

  async function save(update = false) {
    if (busy || !dialogState || !$('#profile-form').reportValidity()) return;
    const existing = dialogState.mode === 'manage' ? dialogState.entry : update ? matchingName() : null;
    if (update && !existing) { dialogError('No matching profile. Refresh the library and try again.'); return; }
    if (dialogState.mode === 'save' && !update && matchingName()) { dialogError('That name is already saved. Choose Update existing or enter a new name.'); return; }
    const captured = dialogState.draft;
    const request = { id: existing?.id ?? null, expected_revision: existing?.revision ?? null,
      profile: { ...captured.profile, name: $('#saved-profile-name').value.trim() },
      condition: $('#saved-profile-notes').value, tone: captured.tone };
    const isEditor = dialogState.mode === 'save';
    setBusy(true); $('#profile-dialog-error').hidden = true;
    try {
      const result = await invoke('save_library_profile', { request });
      $('#profile-dialog').close();
      if (isEditor) savedDraft(result);
      page = 0;
      message(`“${result.profile.name}” saved on this computer.`);
      await refresh();
    } catch (error) { dialogError(error); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (busy || !dialogState?.entry) return;
    const entry = dialogState.entry;
    setBusy(true);
    try {
      await invoke('delete_library_profile', { id: entry.id, revision: entry.revision });
      removed = entry; $('#profile-dialog').close();
      message(`“${entry.profile.name}” removed. Undo remove is available in Profiles.`);
      await refresh();
    } catch (error) { dialogError(error); }
    finally { setBusy(false); }
  }

  $('#profile-form').onsubmit = event => { event.preventDefault(); save(); };
  $('#update-profile').onclick = () => save(true);
  $('#remove-profile').onclick = remove;
  $('#cancel-profile').onclick = () => { if (!busy) $('#profile-dialog').close(); };
  $('#profile-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('#saved-profile-name').oninput = () => { $('#profile-dialog-error').hidden = true; dialogButtons(); };
  $('#refresh-profiles').onclick = refresh;
  $('#profile-search').oninput = () => { page = 0; render(); };
  $('#profiles-previous').onclick = () => { --page; render(); };
  $('#profiles-next').onclick = () => { ++page; render(); };
  $('#undo-remove-profile').onclick = async () => {
    if (!removed || busy) return;
    setBusy(true);
    try {
      await invoke('restore_library_profile', { id: removed.id, revision: removed.revision });
      message(`“${removed.profile.name}” restored.`); removed = null; page = 0; await refresh();
    } catch (error) { message(String(error.message ?? error), true); }
    finally { setBusy(false); }
  };
  render();
  return { openSave: () => showDialog(), refresh, get busy() { return busy; } };
}
