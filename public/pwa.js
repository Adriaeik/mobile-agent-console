export async function registerServiceWorker(serviceWorker = navigator.serviceWorker) {
  if (!serviceWorker?.register) return null;
  return serviceWorker.register("/service-worker.js", { scope: "/" });
}
