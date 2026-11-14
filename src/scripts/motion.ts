import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);

let activeCleanup: (() => void) | null = null;

export function initMotion(): () => void {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    return () => {};
  }

  const lenis = new Lenis({
    duration: 1.05,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });

  lenis.on('scroll', ScrollTrigger.update);

  const tickerCallback = (time: number) => {
    lenis.raf(time * 1000);
  };
  gsap.ticker.add(tickerCallback);
  gsap.ticker.lagSmoothing(0);

  const splits: SplitText[] = [];
  const ctx = gsap.context(() => {
    // 1. Wordmark letter reveal
    const wordmarkChars = document.querySelectorAll<HTMLElement>('[data-wordmark-char]');
    if (wordmarkChars.length > 0) {
      gsap.from(wordmarkChars, {
        yPercent: 35,
        opacity: 0,
        duration: 0.75,
        stagger: 0.028,
        ease: 'power3.out',
        clearProps: 'transform,opacity',
      });
    }

    // 2. SplitText line reveals for major headings
    document.querySelectorAll<HTMLElement>('[data-reveal="lines"]').forEach((heading) => {
      const split = new SplitText(heading, {
        type: 'lines',
        linesClass: 'split-line',
      });
      splits.push(split);

      gsap.from(split.lines, {
        y: 22,
        opacity: 0,
        duration: 0.65,
        stagger: 0.08,
        ease: 'power3.out',
        clearProps: 'transform,opacity',
        scrollTrigger: {
          trigger: heading,
          start: 'top 90%',
          once: true,
        },
      });
    });

    // 3. Fade-up blocks
    document.querySelectorAll<HTMLElement>('[data-reveal="up"]').forEach((el) => {
      gsap.from(el, {
        y: 18,
        opacity: 0,
        duration: 0.55,
        ease: 'power2.out',
        clearProps: 'transform,opacity',
        scrollTrigger: {
          trigger: el,
          start: 'top 92%',
          once: true,
        },
      });
    });
  });

  const cleanup = () => {
    ctx.revert();
    splits.forEach((s) => s.revert());
    ScrollTrigger.getAll().forEach((st) => st.kill());
    gsap.ticker.remove(tickerCallback);
    lenis.destroy();
  };

  activeCleanup = cleanup;
  return cleanup;
}
