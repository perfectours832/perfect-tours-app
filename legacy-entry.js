/* Keep historical bookmarks working through a single maintained application. */
(() => {
  const target = new URL('./', location.href);
  target.search = location.search;
  target.hash = location.hash;
  if (location.pathname.endsWith('/client.html') && !target.searchParams.has('trip')) {
    const id = target.searchParams.get('id');
    if (id) { target.searchParams.delete('id'); target.searchParams.set('trip', id); }
  }
  location.replace(target.href);
})();
