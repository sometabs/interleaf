// Apply the saved theme before the page paints. Keep this external so the
// content security policy does not need to allow inline scripts.
try {
  const theme = JSON.parse(localStorage.getItem('interleaf.theme'))
  document.documentElement.dataset.theme = theme === 'dark' || theme === 'system' ? theme : 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}
