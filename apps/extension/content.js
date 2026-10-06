// Troca <img> da página pela versão traduzida. Extensões no celular não têm
// menu de contexto: o popup aciona "traduzir todas" ou o modo "tocar para traduzir".
const MIN_SIZE = 150; // ignora ícones e avatares

const done = new WeakMap(); // img → { original, translated }
const busy = new WeakSet();
let picking = false;

const banner = document.createElement('div');
banner.style.cssText =
  'all:initial;position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;' +
  'max-width:calc(100vw - 32px);padding:10px 14px;border-radius:999px;background:#18181b;color:#fafafa;' +
  'font:14px/1.3 system-ui,sans-serif;box-shadow:0 4px 16px #0006;cursor:pointer';

function say(text) {
  banner.textContent = text;
  banner.hidden = !text;
  if (!banner.isConnected) document.documentElement.append(banner);
}

const isCandidate = (el) =>
  el.tagName === 'IMG' && el.complete && el.naturalWidth >= MIN_SIZE && el.naturalHeight >= MIN_SIZE;

const toDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

// Lido daqui a imagem sai com Referer/cookies da página (CDNs de mangá checam);
// se o CORS barrar, o background baixa sozinho.
async function grab(src) {
  try {
    const res = await fetch(src);
    if (res.ok) return await toDataUrl(await res.blob());
  } catch {}
  return null;
}

async function translate(img) {
  const prev = done.get(img);
  if (prev) {
    img.src = img.src === prev.translated ? prev.original : prev.translated; // tocar de novo alterna
    return;
  }
  if (busy.has(img)) return;
  busy.add(img);
  img.style.opacity = '0.5';
  try {
    const src = img.currentSrc || img.src;
    const res = await chrome.runtime.sendMessage({ type: 'translate', src, dataUrl: await grab(src) });
    if (res?.error) throw new Error(res.error);
    // <source>/srcset venceriam o src novo
    img.closest('picture')?.querySelectorAll('source').forEach((s) => s.remove());
    img.removeAttribute('srcset');
    // ponytail: data URL no src; página com CSP img-src sem data: quebra a imagem
    img.src = res.image;
    img.style.outline = '';
    done.set(img, { original: src, translated: res.image });
  } catch (e) {
    img.style.outline = '3px solid #e11d48';
    img.title = `Transynex: ${e.message}`;
    throw e;
  } finally {
    busy.delete(img);
    img.style.opacity = '';
  }
}

async function translateAll() {
  // ponytail: só imagens já carregadas (lazy-load fora da tela fica de fora), uma por vez
  // porque o OCR é o gargalo do servidor
  const imgs = [...document.images].filter((i) => isCandidate(i) && !done.has(i));
  if (!imgs.length) return say('Nenhuma imagem grande carregada nesta página.');
  let failed = 0;
  for (const [i, img] of imgs.entries()) {
    say(`Traduzindo ${i + 1}/${imgs.length}…`);
    await translate(img).catch(() => failed++);
  }
  say(`Pronto${failed ? ` · ${failed} falharam` : ''} · toque para fechar`);
}

document.addEventListener(
  'click',
  (e) => {
    if (e.target === banner) {
      picking = false;
      return say('');
    }
    if (!picking) return;
    // elementsFromPoint atravessa as camadas transparentes que leitores põem por cima da imagem
    const img = document.elementsFromPoint(e.clientX, e.clientY).find(isCandidate);
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    translate(img).catch((err) => say(err.message));
  },
  true,
);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'all') translateAll();
  if (msg.type === 'pick') {
    picking = !picking;
    say(picking ? 'Toque numa imagem para traduzir · aqui para sair' : '');
  }
});
