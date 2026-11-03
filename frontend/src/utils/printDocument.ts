/** Print an isolated copy so a receipt never includes the report behind it. */
export async function printDocument(element: HTMLElement, title: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.title = title;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;';
  document.body.append(frame);
  const printWindow = frame.contentWindow;
  const printDoc = frame.contentDocument;
  if (!printWindow || !printDoc) { frame.remove(); throw new Error('Unable to open the bill for printing. Please try again.'); }

  let cleaned = false;
  let preparationTimer: number | undefined;
  let cleanupTimer: number | undefined;
  let layoutFrame: number | undefined;
  const detach: Array<() => void> = [];
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.clearTimeout(preparationTimer);
    window.clearTimeout(cleanupTimer);
    if (layoutFrame !== undefined) printWindow.cancelAnimationFrame(layoutFrame);
    detach.forEach(remove => remove());
    frame.remove();
  };
  try {
    printDoc.title = title;
    printDoc.documentElement.lang = document.documentElement.lang || 'en';
    printDoc.body.className = 'print-document';
    const deadline = new Promise<never>((_, reject) => {
      preparationTimer = window.setTimeout(() => reject(new Error('Preparing the bill for printing timed out. Please try again.')), 15_000);
    });
    // Race the whole preparation pipeline, retaining rejection handlers even if a
    // font or stylesheet settles after the deadline and its frame is removed.
    await Promise.race([deadline, (async () => {
      const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(source => {
        const copy = source.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
        if (!(copy instanceof HTMLLinkElement)) { printDoc.head.append(copy); return Promise.resolve(); }
        const readiness = new Promise<void>((resolve, reject) => {
          const loaded = () => resolve();
          const failed = () => reject(new Error('Unable to load bill print styles. Please try again.'));
          copy.addEventListener('load', loaded);
          copy.addEventListener('error', failed);
          detach.push(() => { copy.removeEventListener('load', loaded); copy.removeEventListener('error', failed); });
          if (!copy.getAttribute('href')?.trim()) { failed(); return; }
          printDoc.head.append(copy);
        });
        // Also observe this promise if a later clone/setup operation throws.
        void readiness.catch(() => {});
        return readiness;
      });
      const receipt = element.cloneNode(true) as HTMLElement;
      receipt.removeAttribute('role');
      receipt.removeAttribute('aria-modal');
      receipt.querySelectorAll('button, footer').forEach(control => control.remove());
      printDoc.body.append(receipt);
      const fonts = Promise.resolve(printDoc.fonts.ready).catch(() => {
        throw new Error('Unable to prepare bill print fonts. Please try again.');
      });
      await Promise.all([...styles, fonts]);
      if (cleaned) return;
      // Wait for layout before opening the native print / Save as PDF dialog.
      await new Promise<void>(resolve => {
        layoutFrame = printWindow.requestAnimationFrame(() => { layoutFrame = undefined; resolve(); });
      }).catch(() => { throw new Error('Unable to prepare bill print layout. Please try again.'); });
    })()]);
    window.clearTimeout(preparationTimer);
    detach.splice(0).forEach(remove => remove());
    printWindow.addEventListener('afterprint', cleanup);
    detach.push(() => printWindow.removeEventListener('afterprint', cleanup));
    const media = [printWindow, window].flatMap(target => {
      try { return [target.matchMedia('print')]; } catch { return []; }
    });
    let enteredPrint = media.some(query => query.matches);
    const mediaChanged = () => {
      if (media.some(query => query.matches)) enteredPrint = true;
      else if (enteredPrint) cleanup();
    };
    media.forEach(query => {
      query.addEventListener('change', mediaChanged);
      detach.push(() => query.removeEventListener('change', mediaChanged));
    });
    // Native print normally blocks until its dialog closes. Allow five minutes
    // after it returns for browsers/stubs that omit afterprint; never tear down
    // a document while either window still reports active print media. Such an
    // active session can intentionally outlive this fallback until it exits.
    const fallback = () => {
      if (media.some(query => query.matches)) cleanupTimer = window.setTimeout(fallback, 60_000);
      else cleanup();
    };
    printWindow.focus();
    printWindow.print();
    if (!cleaned) cleanupTimer = window.setTimeout(fallback, 300_000);
  } catch (error) {
    cleanup();
    throw error;
  }
}
