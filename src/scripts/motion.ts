import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);

let activeCleanup: (() => void) | null = null;

function runPreloader(onExitStart: () => void): void {
  const win = window as Window & { __preloaderDone?: boolean };
  const overlay = document.querySelector<HTMLElement>('[data-preloader]');
  win.__preloaderDone = true;
  if (!overlay) {
    onExitStart();
    return;
  }

  const percentEl = overlay.querySelector<HTMLElement>('[data-preloader-percent]');
  const barEl = overlay.querySelector<HTMLElement>('[data-preloader-bar]');
  const counter = { value: 0 };
  let exited = false;

  const exitCurtain = () => {
    if (exited) return;
    exited = true;
    overlay.style.pointerEvents = 'none';
    onExitStart();
    gsap.to(overlay, {
      yPercent: -100,
      duration: 0.62,
      ease: 'power4.inOut',
      onComplete: () => overlay.remove(),
    });
  };

  const progressTween = gsap.to(counter, {
    value: 100,
    duration: 0.52,
    ease: 'power2.out',
    onUpdate: () => {
      const pct = Math.round(counter.value);
      if (percentEl) percentEl.textContent = `${String(pct).padStart(2, '0')}%`;
      if (barEl) barEl.style.transform = `scaleX(${counter.value / 100})`;
    },
  });

  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  const minDelay = new Promise<void>((resolve) => {
    progressTween.eventCallback('onComplete', () => resolve());
  });
  const maxTimeout = new Promise<void>((resolve) => window.setTimeout(resolve, 900));

  Promise.race([Promise.all([fontsReady, minDelay]), maxTimeout]).then(exitCurtain);
}

function revealReducedMotion(): void {
  document.querySelectorAll<HTMLElement>('[data-reveal], [data-scrub-chars]').forEach((el) => {
    el.style.opacity = '1';
    el.style.transform = 'none';
  });
}

function setupHeroScroll(): void {
  const hero = document.querySelector<HTMLElement>('.hero');
  if (!hero) return;

  const display = hero.querySelector<HTMLElement>('.hero__display');
  const star = hero.querySelector<HTMLElement>('[data-hero-star]');
  if (display) {
    gsap.to(display, {
      y: -36,
      ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.8 },
    });
  }
  if (star) {
    gsap.to(star, {
      rotation: 180,
      ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.8 },
    });
  }
}

function setupWordmarkMotion(splits: SplitText[]): void {
  const chars = document.querySelectorAll<HTMLElement>('[data-wordmark-char]');
  const strategy = document.querySelector<HTMLElement>('[data-hero-strategy]');
  const meta = document.querySelectorAll<HTMLElement>('[data-hero-meta]');

  if (chars.length > 0) {
    gsap.from(chars, {
      yPercent: 60,
      opacity: 0,
      duration: 0.85,
      stagger: 0.025,
      ease: 'power4.out',
      clearProps: 'transform,opacity',
    });
  }

  if (strategy) {
    const split = new SplitText(strategy, { type: 'chars' });
    splits.push(split);
    gsap.from(split.chars, {
      yPercent: 55,
      opacity: 0,
      duration: 0.75,
      delay: 0.14,
      stagger: 0.025,
      ease: 'power4.out',
      clearProps: 'transform,opacity',
    });
  }

  if (meta.length > 0) {
    gsap.fromTo(
      meta,
      { y: 28, opacity: 0, scale: 0.96 },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.72,
        delay: 0.24,
        stagger: 0.12,
        ease: 'back.out(1.4)',
        clearProps: 'transform,opacity',
      },
    );
  }

  setupHeroScroll();
}

function setupLineReveals(splits: SplitText[]): void {
  document.querySelectorAll<HTMLElement>('[data-reveal="lines"]').forEach((heading) => {
    const split = new SplitText(heading, {
      type: 'lines',
      linesClass: 'split-line',
    });
    splits.push(split);

    gsap.from(split.lines, {
      y: 34,
      opacity: 0,
      duration: 0.8,
      stagger: 0.09,
      ease: 'power3.out',
      clearProps: 'transform,opacity',
      scrollTrigger: {
        trigger: heading,
        start: 'top 88%',
        once: true,
      },
    });
  });
}

function setupScrubbedChars(splits: SplitText[]): void {
  document.querySelectorAll<HTMLElement>('[data-scrub-chars]').forEach((heading) => {
    const split = new SplitText(heading, {
      type: 'words, chars',
    });
    splits.push(split);

    gsap.fromTo(
      split.chars,
      { opacity: 0.14, y: 16 },
      {
        opacity: 1,
        y: 0,
        stagger: 0.03,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: heading,
          start: 'top 86%',
          end: 'top 32%',
          scrub: 0.6,
        },
      },
    );
  });
}

function setupFadeUpBlocks(): void {
  const targets = gsap.utils.toArray<HTMLElement>('[data-reveal="up"]');
  if (targets.length === 0) return;

  gsap.set(targets, { opacity: 0, y: 30 });
  ScrollTrigger.batch(targets, {
    start: 'top 90%',
    once: true,
    onEnter: (batch) => {
      gsap.to(batch, {
        opacity: 1,
        y: 0,
        duration: 0.72,
        stagger: 0.08,
        ease: 'power3.out',
        clearProps: 'transform,opacity',
      });
    },
  });
}

function setupCursorPill(signal: AbortSignal): void {
  const pill = document.querySelector<HTMLElement>('[data-cursor-pill]');
  const isCoarse = window.matchMedia('(pointer: coarse)').matches;
  if (!pill || isCoarse) return;

  const xTo = gsap.quickTo(pill, 'x', { duration: 0.32, ease: 'power3.out' });
  const yTo = gsap.quickTo(pill, 'y', { duration: 0.32, ease: 'power3.out' });

  window.addEventListener(
    'mousemove',
    (e) => {
      xTo(e.clientX);
      yTo(e.clientY);
    },
    { signal },
  );

  document.querySelectorAll<HTMLElement>('[data-cursor-target]').forEach((target) => {
    target.addEventListener('mouseenter', () => pill.classList.add('is-active'), { signal });
    target.addEventListener('mouseleave', () => pill.classList.remove('is-active'), { signal });
  });

  document.addEventListener('mouseleave', () => pill.classList.remove('is-active'), { signal });
}

export function initMotion(): () => void {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    revealReducedMotion();
    return () => {};
  }

  const lenis = new Lenis({
    duration: 1.05,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });

  lenis.on('scroll', ScrollTrigger.update);
  const tickerCallback = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tickerCallback);
  gsap.ticker.lagSmoothing(0);

  const splits: SplitText[] = [];
  const controller = new AbortController();

  const ctx = gsap.context(() => {
    setupLineReveals(splits);
    setupScrubbedChars(splits);
    setupFadeUpBlocks();
  });

  if (document.querySelector('[data-preloader]')) {
    gsap.set('[data-wordmark-char], [data-hero-meta]', { opacity: 0 });
  }

  runPreloader(() => {
    ctx.add(() => setupWordmarkMotion(splits));
  });

  setupCursorPill(controller.signal);
  let alive = true;
  document.fonts?.ready.then(() => {
    if (alive) ScrollTrigger.refresh();
  });

  const cleanup = () => {
    alive = false;
    controller.abort();
    ctx.revert();
    splits.forEach((s) => s.revert());
    ScrollTrigger.getAll().forEach((st) => st.kill());
    gsap.ticker.remove(tickerCallback);
    lenis.destroy();
  };

  activeCleanup = cleanup;
  return cleanup;
}
