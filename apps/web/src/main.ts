import { boot } from "@poe/ui";

boot(document.getElementById("root") as HTMLElement, { dataBase: import.meta.env.BASE_URL }).catch((e) => {
  const loading = document.getElementById("loading");
  if (loading) loading.hidden = true;
  const f = document.getElementById("fatal");
  if (f) {
    f.hidden = false;
    f.textContent = String(e && e.message ? e.message : e);
  }
  throw e;
});
