export const THEME_KEY = "ps.theme";

// Inlined in <head> so the saved theme is applied before first paint (no flash).
export const themeBootScript = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"system";var t=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;var r=document.documentElement;r.dataset.theme=t;r.dataset.themePref=p;}catch(e){}})();`;
