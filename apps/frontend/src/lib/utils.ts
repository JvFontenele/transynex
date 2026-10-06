import type { ClassValue } from "clsx"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { ref, watch } from "vue"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Último par de idiomas usado no envio rápido/importação (conveniência por navegador).
const LANGS_KEY = "quick-langs"
export function useStoredLangs() {
  let saved = { from: "en", to: "pt-BR" }
  try {
    saved = { ...saved, ...JSON.parse(localStorage.getItem(LANGS_KEY) ?? "{}") }
  } catch {
    /* storage indisponível: usa o padrão */
  }
  const from = ref(saved.from)
  const to = ref(saved.to)
  watch([from, to], () => {
    try {
      localStorage.setItem(LANGS_KEY, JSON.stringify({ from: from.value, to: to.value }))
    } catch {
      /* storage indisponível: só não lembra */
    }
  })
  return { from, to }
}
