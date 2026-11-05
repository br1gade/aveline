/** Whether the page would have the browser ask before it goes. */
export function isUnloadAsked(): boolean {
  const unloading = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unloading);
  return unloading.defaultPrevented;
}
