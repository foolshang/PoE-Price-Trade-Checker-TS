/** The page skeleton every app uses (web page, and later the Electron windows): header, folder box, tabs, status, result, dialogs. */
export const SHELL_HTML = `
<main>
  <header class="top">
    <h1><span id="app-title">PoE Filter Generator</span> <small id="ver" class="muted" title="ใช้ตอนแจ้งบั๊ก"></small></h1>
    <div class="game-toggle" role="radiogroup" aria-label="เกม">
      <button type="button" id="game-poe1" data-game="poe1">PoE1</button>
      <button type="button" id="game-poe2" data-game="poe2">PoE2</button>
    </div>
  </header>

  <div id="loading" class="loading">กำลังโหลด…</div>
  <div id="fatal" class="fatal" hidden></div>

  <div id="app" hidden>
    <section id="folder-box" class="folder" hidden>
      <span class="lbl">โฟลเดอร์เกม:</span>
      <span id="folder-name" class="muted">ยังไม่ได้เลือก — จะดาวน์โหลดเป็นไฟล์แทน</span>
      <button type="button" id="btn-folder">เลือกโฟลเดอร์เกม</button>
      <button type="button" id="btn-folder-grant" class="secondary" hidden>ยืนยันสิทธิ์โฟลเดอร์</button>
      <button type="button" id="btn-folder-forget" class="secondary" hidden>เลิกใช้</button>
      <div class="muted small" id="folder-hint"></div>
    </section>

    <div class="tabs" role="tablist">
      <button type="button" role="tab" id="tab-ns" data-tab="tier" aria-selected="true">NeverSink</button>
      <button type="button" role="tab" id="tab-wl" data-tab="whitelist" aria-selected="false">Whitelist</button>
    </div>

    <section id="pane-tier" class="pane" role="tabpanel"></section>
    <section id="pane-whitelist" class="pane" role="tabpanel" hidden></section>

    <label class="section">Status</label>
    <div id="log" class="log" aria-live="polite"></div>

    <div id="result" class="result" hidden>
      <div class="actions">
        <button type="button" id="btn-download">ดาวน์โหลด</button>
        <button type="button" id="btn-copy" class="secondary">Copy</button>
      </div>
      <p class="muted" id="result-info"></p>
      <ol class="muted" id="result-steps"></ol>
    </div>
  </div>
</main>

<dialog id="dlg-style" class="dlg"></dialog>
<dialog id="dlg-ask" class="dlg"></dialog>
<dialog id="dlg-open" class="dlg"></dialog>
<dialog id="dlg-folder" class="dlg"></dialog>
`;
