export const themeStorageKey = "aimo-theme";

// Static trusted code applies the preference before paint; no user text is interpolated.
export const themeInitializationScript = `(function(){var t="system";try{var s=localStorage.getItem("${themeStorageKey}");if(s==="light"||s==="dark")t=s}catch(e){}var r=document.documentElement;var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);r.dataset.themePreference=t;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"})()`;
