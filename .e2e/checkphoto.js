(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('ios-phone-db', 7);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const getAll = (store) => new Promise((resolve) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
  });
  const photos = await getAll('photos');
  const albums = await getAll('albums');
  db.close();
  return JSON.stringify({
    photosCount: photos.length,
    lastPhoto: photos[photos.length - 1]?.name,
    lastPhotoSize: photos[photos.length - 1]?.blob?.size,
    albumsCount: albums.length,
    lastAlbum: albums[albums.length - 1]?.name,
    lastAlbumOrigin: albums[albums.length - 1]?.origin,
    lastAlbumContact: albums[albums.length - 1]?.contactId,
  });
})()
