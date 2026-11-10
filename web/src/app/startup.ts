/** Removes the HTML splash once a real screen is about to paint. */
export function dismissAppStartup(): void {
  document.getElementById('app-startup')?.remove();
}
