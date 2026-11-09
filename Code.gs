/**
 * PACE Mobile Sync - Google Apps Script
 * --------------------------------------
 * 1. Paste this whole file at https://script.google.com  (New project).
 * 2. Put the SAME secret key that you set in PACE (Settings > Advance > Mobile App Sync) below.
 * 3. Deploy > New deployment > type "Web app" > Execute as: Me, Who has access: Anyone > Deploy.
 * 4. Copy the Web app URL (ends with /exec) into PACE and into the mobile app.
 * Data is stored only in YOUR Google Drive, folder "PACE Mobile Sync".
 */
const SECRET = 'PASTE-YOUR-SECRET-KEY-HERE';
const FOLDER = 'PACE Mobile Sync';
const KEEP_HISTORY_DAYS = 120;   // daily snapshots kept
const KEEP_DB_COPIES = 15;       // database backups kept (only if "send full database" is ticked in PACE)

function folder_() {
  const it = DriveApp.getFoldersByName(FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
}
function sub_(name) {
  const f = folder_(), it = f.getFoldersByName(name);
  return it.hasNext() ? it.next() : f.createFolder(name);
}
function put_(f, blob) {
  const it = f.getFilesByName(blob.getName());
  while (it.hasNext()) it.next().setTrashed(true);
  return f.createFile(blob);
}
function file_(f, name) {
  const it = f.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}
function prune_(f, keep) {
  const files = [], it = f.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getName().localeCompare(a.getName()));
  files.slice(keep).forEach(x => x.setTrashed(true));
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out_({ok: false, error: 'Bad data'}); }
  if (!SECRET || SECRET.indexOf('PASTE') === 0 || b.key !== SECRET) return out_({ok: false, error: 'Wrong secret key'});
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const snap = b.snapshot, txt = JSON.stringify(snap), day = snap.meta.date;
    put_(folder_(), Utilities.newBlob(txt, 'application/json', 'latest.json'));
    const hist = sub_('history');
    put_(hist, Utilities.newBlob(txt, 'application/json', day + '.json'));
    prune_(hist, KEEP_HISTORY_DAYS);
    if (b.db) {
      const dbf = sub_('database_backups');
      put_(dbf, Utilities.newBlob(Utilities.base64Decode(b.db), 'application/octet-stream', 'pace_data_' + day + '.db'));
      prune_(dbf, KEEP_DB_COPIES);
    }
    const p = PropertiesService.getScriptProperties();
    p.setProperty('generated', snap.meta.generated);
    p.setProperty('store', snap.meta.store || '');
  } finally {
    lock.releaseLock();
  }
  return out_({ok: true});
}

function doGet(e) {
  const q = e.parameter || {};
  if (!SECRET || q.key !== SECRET) return out_({ok: false, error: 'Wrong secret key'});
  const p = PropertiesService.getScriptProperties();
  if (q.action === 'status') return out_({ok: true, generated: p.getProperty('generated') || '', store: p.getProperty('store') || ''});
  if (q.action === 'dates') {
    const names = [], it = sub_('history').getFiles();
    while (it.hasNext()) names.push(it.next().getName().replace('.json', ''));
    return out_({ok: true, dates: names.sort().reverse()});
  }
  const f = q.action === 'history' && q.date ? file_(sub_('history'), q.date + '.json') : file_(folder_(), 'latest.json');
  if (!f) return out_({ok: false, error: 'No data yet. Do a Day End Closing in PACE first.'});
  return ContentService.createTextOutput(f.getBlob().getDataAsString()).setMimeType(ContentService.MimeType.JSON);
}
