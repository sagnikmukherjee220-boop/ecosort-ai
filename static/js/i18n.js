// i18n.js — lightweight translation engine. Loads a JSON dictionary per
// language and applies it to any element tagged with data-i18n="a.b.c".
// New languages can be added by dropping /static/i18n/<code>.json (same
// keys as en.json) into LANGS below — no other code changes needed.
window.I18N = (() => {
  const LANGS = [
    { code: "en", name: "English" },
    { code: "hi", name: "हिन्दी" },
    { code: "bn", name: "বাংলা" },
    { code: "ta", name: "தமிழ்" },
    { code: "te", name: "తెలుగు" },
    { code: "mr", name: "मराठी" },
  ];

  const STORAGE_KEY = "ecosort_lang";
  let dict = {};
  let lang = localStorage.getItem(STORAGE_KEY) || "en";
  const cache = {};

  function get(obj, path) {
    return path.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }

  function t(path, fallback) {
    const v = get(dict, path);
    return v !== undefined ? v : (fallback !== undefined ? fallback : path);
  }

  function applyToDom() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const val = t(el.getAttribute("data-i18n"));
      if (val !== undefined) el.textContent = val;
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const val = t(el.getAttribute("data-i18n-title"));
      if (val !== undefined) el.setAttribute("title", val);
    });
    document.documentElement.lang = lang;
    document.querySelectorAll(".lang-select").forEach((sel) => (sel.value = lang));
  }

  async function load(code) {
    if (cache[code]) {
      dict = cache[code];
    } else {
      try {
        const res = await fetch(`/static/i18n/${code}.json`);
        dict = await res.json();
        cache[code] = dict;
      } catch (e) {
        console.error("i18n: failed to load", code, e);
        if (code !== "en") return load("en");
        return;
      }
    }
    lang = code;
    localStorage.setItem(STORAGE_KEY, code);
    applyToDom();
    document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang, dict } }));
  }

  function buildSwitchers() {
    document.querySelectorAll(".lang-select").forEach((sel) => {
      if (sel.dataset.built) return;
      sel.dataset.built = "1";
      LANGS.forEach((l) => {
        const opt = document.createElement("option");
        opt.value = l.code;
        opt.textContent = l.name;
        sel.appendChild(opt);
      });
      sel.value = lang;
      sel.addEventListener("change", () => load(sel.value));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    buildSwitchers();
    load(lang);
  });

  return { t, load, get lang() { return lang; }, get dict() { return dict; }, LANGS };
})();
