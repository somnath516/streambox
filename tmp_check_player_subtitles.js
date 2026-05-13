// Simple helper to inspect what the server is returning for a given movieId and subtitle filename.
// Usage (in Node):
//   node tmp_check_player_subtitles.js <movieId>

const http = require('http');

  const movieId = process.argv[2];
  const port = process.env.PORT || 3000;

  // If no movieId passed, just try most recent
  const actualMovieId = movieId || 'latest';


if (!movieId) {
  console.error('Missing movieId');
  process.exit(1);
}

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 3000, path }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function fetchText(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 3000, path }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  const movie = await fetchJson(`/movies/${movieId}`);
  console.log('movie id used:', movieId);
  console.log('movie.subtitle:', movie.subtitle);
  if (!movie.subtitle) process.exit(0);

  const encoded = encodeURIComponent(movie.subtitle);
  const r = await fetchText(`/subtitle/${encoded}`);
  console.log('GET /subtitle status:', r.status);
  console.log('subtitle content preview:', r.body.slice(0, 300));
})();