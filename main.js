// Keep the demo paused whenever it scrolls out of view.
const demo = document.querySelector('video');
if (demo && 'IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) demo.pause();
  }).observe(demo);
}
