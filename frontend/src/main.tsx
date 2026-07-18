import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

function isStandaloneDisplay() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    standaloneNavigator.standalone === true
  );
}

document.documentElement.classList.toggle("is-standalone-app", isStandaloneDisplay());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  let isReloadingForServiceWorkerUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (isReloadingForServiceWorkerUpdate) {
      return;
    }
    isReloadingForServiceWorkerUpdate = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => registration.update())
      .catch(() => undefined);
  });
}
