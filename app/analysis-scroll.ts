export function keepInView(
  el: HTMLElement | null,
  container: HTMLElement | null,
  axis: 'x' | 'y',
) {
  if (!el || !container) return;
  const e = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  if (axis === 'y') {
    if (e.top < c.top) container.scrollTop -= c.top - e.top;
    else if (e.bottom > c.bottom) container.scrollTop += e.bottom - c.bottom;
  } else {
    if (e.left < c.left) container.scrollLeft -= c.left - e.left;
    else if (e.right > c.right) container.scrollLeft += e.right - c.right;
  }
}
