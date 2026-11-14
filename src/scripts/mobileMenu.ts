function setMenuState(
  toggle: HTMLButtonElement,
  menu: HTMLElement,
  label: HTMLElement | null,
  open: boolean,
): void {
  toggle.setAttribute('aria-expanded', String(open));
  menu.hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
  if (label) label.textContent = open ? 'Close' : 'Menu';
}

function getMenuFocusables(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
}

function getWrapTarget(
  shiftKey: boolean,
  active: Element | null,
  items: HTMLElement[],
): HTMLElement | undefined {
  if (items.length === 0) return undefined;
  const edgeIdx = shiftKey ? 0 : items.length - 1;
  if (active !== items[edgeIdx]) return undefined;
  return items[items.length - 1 - edgeIdx];
}

function trapMenuTab(e: KeyboardEvent, items: HTMLElement[]): void {
  const target = getWrapTarget(e.shiftKey, document.activeElement, items);
  if (!target) return;
  e.preventDefault();
  target.focus();
}

let navController: AbortController | null = null;

export function cleanupMobileMenu(): void {
  navController?.abort();
  navController = null;
}

export function setupMobileMenu(): void {
  cleanupMobileMenu();
  navController = new AbortController();
  const { signal } = navController;

  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const menu = document.querySelector<HTMLElement>('[data-mobile-menu]');
  const label = document.querySelector<HTMLElement>('[data-menu-label]');
  if (!toggle || !menu) return;

  const close = () => setMenuState(toggle, menu, label, false);

  toggle.addEventListener(
    'click',
    () => {
      const nextOpen = toggle.getAttribute('aria-expanded') !== 'true';
      setMenuState(toggle, menu, label, nextOpen);
      if (nextOpen) getMenuFocusables(menu)[0]?.focus();
    },
    { signal },
  );

  menu.querySelectorAll('[data-mobile-link]').forEach((link) => {
    link.addEventListener('click', close, { signal });
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (toggle.getAttribute('aria-expanded') !== 'true') return;
      if (e.key === 'Escape') {
        close();
        toggle.focus();
        return;
      }
      if (e.key === 'Tab') {
        trapMenuTab(e, [toggle, ...getMenuFocusables(menu)]);
      }
    },
    { signal },
  );
}
