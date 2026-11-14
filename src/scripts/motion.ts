import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);

let activeCleanup: (() => void) | null = null;

function revealReducedMotion(): void {
  document.querySelectorAll<HTMLElement>('[data-reveal], [data-scrub-chars]').forEach((el) => {
    el.style.opacity = '1';
    el.style.transform = 'none';
  });
}

function setupWordmarkMotion(): void {
  const chars = document.querySelectorAll<HTMLElement>('[data-wordmark-char]');
  if (chars.length === 0) return;

  gsap.from(chars, {
    yPercent: 28,
    duration: 0.72,
    stagger: 0.025,
    ease: 'power3.out',
    clearProps: 'transform',
  });
}

function setupLineReveals(splits: SplitText[]): void {
  document.querySelectorAll<HTMLElement>('[data-reveal="lines"]').forEach((heading) => {
    const split = new SplitText(heading, {
      type: 'lines',
      linesClass: 'split-line',
    });
    splits.push(split);

    gsap.from(split.lines, {
      y: 18,
      duration: 0.6,
      stagger: 0.07,
      ease: 'power3.out',
      clearProps: 'transform',
      scrollTrigger: {
        trigger: heading,
        start: 'top 95%',
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
      { opacity: 0.48, y: 10 },
      {
        opacity: 1,
        y: 0,
        stagger: 0.03,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: heading,
          start: 'top 94%',
          end: 'top 62%',
          scrub: true,
        },
      },
    );
  });
}

function setupFadeUpBlocks(): void {
  document.querySelectorAll<HTMLElement>('[data-reveal="up"]').forEach((el) => {
    gsap.from(el, {
      y: 14,
      duration: 0.5,
      ease: 'power2.out',
      clearProps: 'transform',
      scrollTrigger: {
        trigger: el,
        start: 'top 96%',
        once: true,
      },
    });
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
    setupWordmarkMotion();
    setupLineReveals(splits);
    setupScrubbedChars(splits);
    setupFadeUpBlocks();
  });

  setupCursorPill(controller.signal);

  const cleanup = () => {
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
