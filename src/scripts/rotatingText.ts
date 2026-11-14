import gsap from 'gsap';

export interface RotatingTextOptions {
  texts: string[];
  direction?: 'up' | 'down';
  rotationInterval?: number;
  staggerDuration?: number;
  staggerFrom?: 'first' | 'last' | 'center';
  pauseOnHover?: boolean;
  highlight?: boolean;
  highlightColor?: string;
  splitLevelClassName?: string;
  elementLevelClassName?: string;
}

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

function splitGraphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

function createCharSpan(ch: string, elemClass: string): HTMLSpanElement {
  const charSpan = document.createElement('span');
  charSpan.className = elemClass ? `text-rotate-element ${elemClass}` : 'text-rotate-element';
  charSpan.textContent = ch;
  return charSpan;
}

function appendSpace(parent: HTMLElement, addSpace: boolean): void {
  if (!addSpace) return;
  const space = document.createElement('span');
  space.className = 'text-rotate-space';
  space.textContent = ' ';
  parent.appendChild(space);
}

function buildWordSpan(
  word: string,
  addSpace: boolean,
  splitClass: string,
  elemClass: string,
  chars: HTMLElement[],
): HTMLSpanElement {
  const wordSpan = document.createElement('span');
  wordSpan.className = splitClass ? `text-rotate-word ${splitClass}` : 'text-rotate-word';
  for (const ch of splitGraphemes(word)) {
    const span = createCharSpan(ch, elemClass);
    wordSpan.appendChild(span);
    chars.push(span);
  }
  appendSpace(wordSpan, addSpace);
  return wordSpan;
}

function buildCharNodes(
  text: string,
  splitClass: string,
  elemClass: string,
): { fragment: DocumentFragment; chars: HTMLElement[] } {
  const fragment = document.createDocumentFragment();
  const chars: HTMLElement[] = [];
  const words = text.split(' ');
  words.forEach((word, wi) => {
    fragment.appendChild(buildWordSpan(word, wi < words.length - 1, splitClass, elemClass, chars));
  });
  return { fragment, chars };
}

function staggerOrder(staggerFrom: RotatingTextOptions['staggerFrom']): 'start' | 'end' | 'center' {
  if (staggerFrom === 'last') return 'end';
  if (staggerFrom === 'center') return 'center';
  return 'start';
}

function parseOptions(el: HTMLElement): RotatingTextOptions | null {
  try {
    const raw = el.dataset.rotatingText;
    return raw ? (JSON.parse(raw) as RotatingTextOptions) : null;
  } catch {
    return null;
  }
}

function bindHoverPause(
  root: HTMLElement,
  enabled: boolean | undefined,
  onPause: (paused: boolean) => void,
  signal: AbortSignal,
): void {
  if (!enabled) return;
  root.addEventListener('mouseenter', () => onPause(true), { signal });
  root.addEventListener('mouseleave', () => onPause(false), { signal });
}

function canMountRotator(opts: RotatingTextOptions | null, stage: HTMLElement | null): opts is RotatingTextOptions {
  const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  return Boolean(opts && stage && opts.texts.length > 1 && !reduced);
}

function resolveRotatorConfig(opts: RotatingTextOptions) {
  const merged = {
    direction: 'up',
    rotationInterval: 2200,
    staggerDuration: 0.025,
    splitLevelClassName: '',
    elementLevelClassName: '',
    ...opts,
  };
  return {
    up: merged.direction !== 'down',
    interval: merged.rotationInterval,
    stagger: merged.staggerDuration,
    from: staggerOrder(merged.staggerFrom),
    splitClass: merged.splitLevelClassName,
    elemClass: merged.elementLevelClassName,
  };
}

export function mountRotatingText(root: HTMLElement): () => void {
  const opts = parseOptions(root);
  const stage = root.querySelector<HTMLElement>('[data-rotate-stage]');
  if (!canMountRotator(opts, stage) || !stage) return () => {};

  const srOnly = root.querySelector<HTMLElement>('.text-rotate-sr-only');
  const cfg = resolveRotatorConfig(opts);
  let index = 0;
  let timer = 0;
  let paused = false;
  let alive = true;
  let currentChars = Array.from(stage.querySelectorAll<HTMLElement>('.text-rotate-element'));

  const schedule = () => {
    window.clearTimeout(timer);
    if (alive && !paused) timer = window.setTimeout(advance, cfg.interval);
  };

  const renderNextWord = () => {
    if (!alive) return;
    index = (index + 1) % opts.texts.length;
    const nextText = opts.texts[index];
    if (srOnly) srOnly.textContent = nextText;
    const { fragment, chars } = buildCharNodes(nextText, cfg.splitClass, cfg.elemClass);
    stage.replaceChildren(fragment);
    currentChars = chars;
    gsap.fromTo(
      chars,
      { yPercent: cfg.up ? 105 : -105, opacity: 0 },
      { yPercent: 0, opacity: 1, duration: 0.82, stagger: { each: cfg.stagger, from: cfg.from }, ease: 'power3.out', clearProps: 'transform,opacity', onComplete: schedule },
    );
  };

  const advance = () => {
    if (!alive || paused) return;
    gsap.to(currentChars, {
      yPercent: cfg.up ? -115 : 115,
      opacity: 0,
      duration: 0.52,
      stagger: { each: cfg.stagger, from: cfg.from },
      ease: 'power2.inOut',
      onComplete: renderNextWord,
    });
  };

  const controller = new AbortController();
  bindHoverPause(
    root,
    opts.pauseOnHover,
    (nextPaused) => {
      paused = nextPaused;
      if (paused) window.clearTimeout(timer);
      else schedule();
    },
    controller.signal,
  );
  schedule();

  return () => {
    alive = false;
    window.clearTimeout(timer);
    controller.abort();
    gsap.killTweensOf(currentChars);
  };
}
