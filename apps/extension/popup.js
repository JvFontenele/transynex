const $ = (id) => document.getElementById(id);
const DEFAULTS = { server: '', apiKey: '', source: 'ja', target: 'pt-BR' };
const ALL_SITES = { origins: ['<all_urls>'] };

chrome.storage.local.get(DEFAULTS).then((cfg) => {
  chrome.storage.local.set(cfg); // grava os defaults para o background enxergar
  for (const k in DEFAULTS) {
    $(k).value = cfg[k];
    $(k).addEventListener('change', () => chrome.storage.local.set({ [k]: $(k).value.trim() }));
  }
});

// MV3 no Firefox deixa o acesso aos sites opcional; sem ele o content script não roda
chrome.permissions.contains(ALL_SITES).then((ok) => ($('grant').hidden = ok));
$('grant').onclick = () => chrome.permissions.request(ALL_SITES).then((ok) => ($('grant').hidden = ok));

async function send(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
    window.close();
  } catch {
    $('status').textContent = 'Recarregue a página e tente de novo.';
  }
}
$('all').onclick = () => send('all');
$('pick').onclick = () => send('pick');
