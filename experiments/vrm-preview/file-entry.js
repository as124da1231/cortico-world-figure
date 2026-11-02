// A classic relative script also runs when index.html is opened from Explorer.
// The VRM renderer itself needs the HTTP server for modules and local resources.
if (window.location.protocol === 'file:') {
  window.location.replace('http://127.0.0.1:4783/');
}
