let allMovies=[];

function hideLoader(){
  const loader = document.getElementById("loading");
  if (loader) loader.classList.add("fade-out");
}

function loadMovies(){
  setTimeout(hideLoader, 2500);
  
  fetch("/movies")
  .then(res=>res.json())
  .then(data => {
    allMovies = data;
    updateHero();
    render();
  })
  .catch(e => {
    console.error("Movies load failed",e);
    updateHero('Load Error', "Check console - try refresh");
  });
}

let currentHeroIndex = 0;

function getHeroImageSrc(movie) {
  if (!movie) return null;
  const file = movie.heroBanner || movie.thumbnail;
  return file ? '/hero-banner/' + file : null;
}

function updateHeroHeroContent(movie) {
  const heroTitle = document.getElementById("heroTitle");
  const heroDesc = document.getElementById("heroDesc");
  const playBtn = document.querySelector('.btn-play');
  const infoBtn = document.querySelector('.btn-info');

  if (!heroTitle || !heroDesc || !playBtn || !infoBtn) return;

  if (movie) {
    heroTitle.textContent = movie.title;
    heroDesc.textContent = movie.description || "";
    playBtn.textContent = 'Play';
    infoBtn.textContent = 'More Info';
    playBtn.onclick = () => openPlayer(movie);
  } else {
    heroTitle.textContent = "Welcome to StreamBox";
    heroDesc.textContent = "No movies yet. Upload your first blockbuster!";
    playBtn.textContent = 'Upload Movie';
    infoBtn.textContent = 'How to Upload';
    playBtn.onclick = () => location.href = '/upload.html';
    infoBtn.onclick = () => alert('Go to Upload page (top-right + icon), select movie + thumbnail, add title!');
  }
}

function updateHero() {
  currentHeroIndex = 0;
  if (allMovies.length > 0) {
    updateHeroHeroContent(allMovies[0]);
  } else {
    updateHeroHeroContent(null);
  }
}

function applyHeroImage(movie) {
  const heroImgA = document.getElementById('heroImgA');
  const heroImgB = document.getElementById('heroImgB');
  if (!heroImgA || !heroImgB) return;

  const src = (movie && movie.heroBanner)
    ? ('/hero-banner/' + movie.heroBanner)
    : (movie && movie.thumbnail)
      ? ('/thumbnail/' + movie.thumbnail)
      : null;

  if (!src) return;

  // Decide which img is currently visible by opacity
  const showA = heroImgA.classList.contains('active') || Number(heroImgA.style.opacity || 1) >= 1;
  const nextEl = showA ? heroImgB : heroImgA;

  nextEl.onload = () => {
    // swap via opacity
    nextEl.style.opacity = '1';
    nextEl.classList.add('active');

    const curEl = showA ? heroImgA : heroImgB;
    curEl.style.opacity = '0';
    curEl.classList.remove('active');

    nextEl.onload = null;
  };

  nextEl.onerror = () => {
    // fallback if hero-banner missing/invalid; try thumbnail
    if (movie && movie.thumbnail) {
      const fallbackSrc = '/thumbnail/' + movie.thumbnail;
      nextEl.onload = () => {
        nextEl.style.opacity = '1';
        nextEl.classList.add('active');
        const curEl = showA ? heroImgA : heroImgB;
        curEl.style.opacity = '0';
        curEl.classList.remove('active');
        nextEl.onload = null;
      };
      nextEl.src = fallbackSrc;
    }
  };

  // preload then fade
  const pre = new Image();
  pre.onload = () => { nextEl.src = src; };
  pre.onerror = () => {
    if (movie && movie.thumbnail) nextEl.src = '/thumbnail/' + movie.thumbnail;
  };
  pre.src = src;
}

let heroIntervalId = null;
let heroFadeTimer = null;
let heroRotationIndex = 0;

function startHeroRotation() {
  if (heroIntervalId || !Array.isArray(allMovies) || allMovies.length < 1) return;

  // show first immediately
  heroRotationIndex = 0;
  applyHeroImage(allMovies[heroRotationIndex]);
  updateHeroHeroContent(allMovies[heroRotationIndex]);

  heroIntervalId = setInterval(() => {
    if (!allMovies.length) return;

    // Prefer movies that have heroBanner, but fallback to thumbnail
    const nextIndex = (heroRotationIndex + 1) % allMovies.length;
    heroRotationIndex = nextIndex;

    const movie = allMovies[heroRotationIndex];
    applyHeroImage(movie);
    updateHeroHeroContent(movie);
  }, 10000);
}

// kick it once after movies render
function kickHero() {
  startHeroRotation();
}

function createCard(m,label=m.title){
  const d = document.createElement("div");
  d.className = "card";
  d.tabIndex = 0;
  d.setAttribute('role', 'button');
  d.setAttribute('aria-label', `Play ${label || m.title || 'movie'}`);
  d.innerHTML = `<img src="/thumbnail/${m.thumbnail || 'default.jpg'}" loading="lazy" decoding="async" alt="${String(label || '').replace(/"/g, '&quot;')}"><p>${label}</p>`;
  d.addEventListener('click', () => openPlayer(m));
  d.addEventListener('focus', () => d.classList.add('focused'));
  d.addEventListener('blur', () => d.classList.remove('focused'));
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      openPlayer(m);
    }
  });
  return d;
}


function render(){
  // Ensure hero starts rotating after movies are available
  kickHero();
  const moviesEl = document.getElementById("movies");
  const trendingEl = document.getElementById("trending");
  const continueEl = document.getElementById("continue");

  if (!moviesEl || !trendingEl || !continueEl) return;

  const moviesSection = moviesEl.closest('.section');
  const trendingSection = trendingEl.closest('.section');
  const continueSection = continueEl.closest('.section');

  // IMPORTANT: Render the sections even when thumbnails fail.
  // Previously we hid everything when posters were missing, which produced a visually empty homepage.
  // We keep the card-level onerror removal, but never hide the whole page pipeline.
  const moviesWithPoster = allMovies.filter(m => !!m.thumbnail);

  // Clear containers
  trendingEl.innerHTML = '';
  continueEl.innerHTML = '';
  moviesEl.innerHTML = '';

  const renderRow = (rowEl, list, resumeLabel) => {
    rowEl.innerHTML = '';
    list.forEach(m => {
      const card = createCard(m, resumeLabel || m.title);
      rowEl.appendChild(card);

      const img = card.querySelector('img');
      if (img) {
        img.onerror = () => {
          // Remove only the broken card; keep the rest of the UI visible.
          try { card.remove(); } catch {}
        };
      }
    });
  };

  if (moviesWithPoster.length) {
    if (moviesSection) moviesSection.classList.remove('is-empty');
    renderRow(moviesEl, moviesWithPoster.slice(0,12));

    const trendingList = moviesWithPoster.slice(5, 15);
    if (trendingList.length) {
      if (trendingSection) trendingSection.classList.remove('is-empty');
      renderRow(trendingEl, trendingList);
    } else {
      if (trendingSection) trendingSection.classList.add('is-empty');
      trendingEl.innerHTML = '';
    }
  } else {
    // Keep the hero + search + page layout visible.
    if (moviesSection) moviesSection.classList.add('is-empty');
    moviesEl.innerHTML = '';
    if (trendingSection) trendingSection.classList.add('is-empty');
    trendingEl.innerHTML = '';
  }

  // Continue: render if watch progress exists
  let continueCount = 0;
  allMovies.forEach(m => {
    if (!localStorage.getItem("watch_"+m.id)) return;
    if (!m.thumbnail) return;
    continueCount++;
    const card = createCard(m, "Resume");
    continueEl.appendChild(card);
    const img = card.querySelector('img');
    if (img) img.onerror = () => { try { card.remove(); } catch {} };
  });

  if (continueCount) {
    if (continueSection) continueSection.classList.remove('is-empty');
  } else {
    if (continueSection) continueSection.classList.add('is-empty');
    continueEl.innerHTML = '';
  }
}


function openPlayer(movie){
  const encodedMovie = encodeURIComponent(movie.movie);
  window.location.href = `/player.html?movie=${encodedMovie}&id=${movie.id}`;
}

function playFeatured(){
  // play whatever hero is currently active
  const movie = allMovies[heroRotationIndex] || allMovies[0];
  if (movie) openPlayer(movie);
}


function openSearch(){
  const overlay = document.getElementById("searchOverlay");
  if (!overlay) return;

  closeNavMenu();
  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('show'));

  // Netflix-like behavior: immediately show all movies before typing.
  // Uses existing liveSearch filtering (empty query => show all).
  const searchBox = document.getElementById('searchBox');
  const initialVal = searchBox ? (searchBox.value || '') : '';
  liveSearch(initialVal);
}

function closeSearch(){
  const overlay = document.getElementById("searchOverlay");
  if (!overlay) return;
  overlay.classList.remove('show');
  window.setTimeout(() => {
    if (!overlay.classList.contains('show')) overlay.style.display = "none";
  }, 240);
}

function setNavMenu(open) {
  const menuBtn = document.querySelector('.menu-btn');
  document.body.classList.toggle('nav-open', !!open);
  if (menuBtn) {
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuBtn.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  }
}

function toggleNavMenu() {
  setNavMenu(!document.body.classList.contains('nav-open'));
}

function closeNavMenu() {
  if (document.body.classList.contains('nav-open')) setNavMenu(false);
}

function liveSearch(val){
  const res = document.getElementById("searchResults");
  if (!res) return;
  res.innerHTML = "";

  const q = (val || "").toLowerCase().trim();
  const moviesWithPoster = allMovies.filter(m => !!m.thumbnail);

  moviesWithPoster
    .filter(m => String(m.title || "").toLowerCase().includes(q))
    .forEach(m => {
      const card = createCard(m);
      const img = card.querySelector('img');
      if (img) img.onerror = () => { try { card.remove(); } catch {} };
      res.appendChild(card);
    });
}





// Init on DOM ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

function init() {

  const menuBtn = document.querySelector('.menu-btn');
  if (menuBtn) menuBtn.addEventListener('click', toggleNavMenu);

  const navScrim = document.querySelector('.nav-scrim');
  if (navScrim) navScrim.addEventListener('click', closeNavMenu);

  document.querySelectorAll('.nav-links span').forEach(link => {
    link.addEventListener('click', closeNavMenu);
  });

  // Search button (first icon-btn)
  const searchBtn = document.querySelector('.nav-right .icon-btn:first-child');
  if (searchBtn) searchBtn.addEventListener('click', openSearch);

  // Admin button (second icon-btn)
  const adminBtn = document.querySelector('.nav-right .icon-btn:nth-child(2)');
  if (adminBtn) adminBtn.addEventListener('click', () => location.href = '/upload.html');

  // Close button
  const closeBtn = document.querySelector('.close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeSearch);

  // Search input
  const searchInput = document.getElementById('searchBox');
  if (searchInput) searchInput.addEventListener('input', (e) => liveSearch(e.target.value));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeSearch();
    closeNavMenu();
  });

  loadMovies();
}

