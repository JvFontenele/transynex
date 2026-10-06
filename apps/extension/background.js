// Faz a ponte com o servidor: content scripts rodam com a origem da página e
// o CORS do backend só libera origens de extensão.
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/tiff']; // IMAGE_MIMES do backend

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.type !== 'translate') return;
  translate(msg).then(send, (e) => send({ error: e.message ?? String(e) }));
  return true; // resposta assíncrona
});

async function translate({ src, dataUrl }) {
  const cfg = await chrome.storage.local.get(['server', 'apiKey', 'source', 'target']);
  if (!cfg.server || !cfg.apiKey) throw new Error('Configure servidor e chave de API no popup');

  // dataUrl: o content script já leu a imagem; senão busca aqui (host_permissions passa por cima do CORS)
  const img = await fetch(dataUrl ?? src);
  if (!img.ok) throw new Error(`Não consegui baixar a imagem (HTTP ${img.status})`);
  let blob = await img.blob();
  if (!ACCEPTED.includes(blob.type)) {
    // GIF/AVIF/tipo ausente → PNG
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    blob = await canvas.convertToBlob({ type: 'image/png' });
  }

  const form = new FormData();
  form.append('file', blob, `image.${blob.type.split('/')[1]}`);
  const query = new URLSearchParams({ sourceLanguage: cfg.source, targetLanguage: cfg.target, render: '1' });
  const res = await fetch(`${cfg.server.replace(/\/+$/, '')}/api/v1/translate/image?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Servidor respondeu HTTP ${res.status}`);
  if (!body.regions.length) throw new Error('Nenhum texto encontrado na imagem');
  return { image: body.image };
}
