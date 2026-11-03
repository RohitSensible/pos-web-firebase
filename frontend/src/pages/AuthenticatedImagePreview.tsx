import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import './TransferPreviewPage.css';
import { cachedImagePreview, loadImagePreview } from './imagePreviewLoader.ts';

type PreviewProps = {
  endpoint: string; imagePath?: string; token: string; alt: string; onSessionExpired: () => void; paused?: boolean;
};

export function AuthenticatedImagePreview(props: PreviewProps) {
  // A new scope renders its placeholder immediately, before effect cleanup.
  return <ScopedImagePreview key={JSON.stringify([props.endpoint, props.imagePath, props.token, !!props.paused])} {...props} />;
}

function ScopedImagePreview({ endpoint, imagePath, token, alt, onSessionExpired, paused = false }: PreviewProps) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  const placeholder = useRef<HTMLSpanElement>(null);
  const sessionExpired = useRef(onSessionExpired);
  const failure = useRef<() => void>(() => {});
  useLayoutEffect(() => { sessionExpired.current = onSessionExpired; }, [onSessionExpired]);
  useEffect(() => {
    if (!imagePath || paused) return;
    const controller = new AbortController();
    let objectUrl = '';
    let started = false;
    const revoke = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; };
    const imageFailed = () => {
      if (controller.signal.aborted) return;
      revoke(); setSource(''); setFailed(true);
    };
    failure.current = imageFailed;
    const load = async () => {
      if (started || controller.signal.aborted) return;
      started = true;
      try {
        const blob = await loadImagePreview(endpoint, imagePath, token, controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setSource(objectUrl);
      } catch (error) {
        if (!controller.signal.aborted) {
          imageFailed();
          if ((error as { status?: number }).status === 401) sessionExpired.current();
        }
      }
    };
    let observer: IntersectionObserver | undefined;
    if (cachedImagePreview(endpoint, imagePath, token) || typeof IntersectionObserver === 'undefined' || !placeholder.current) void load();
    else {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); void load(); }
      }, { rootMargin: '160px' });
      observer.observe(placeholder.current);
    }
    return () => { observer?.disconnect(); controller.abort(); revoke(); };
  }, [endpoint, imagePath, token, paused]);

  const description = !imagePath || failed ? 'image unavailable' : paused ? 'image preview paused' : 'loading image';
  return source && !failed
    ? <img className="transfer-preview-image" src={source} alt={alt} decoding="async" onError={() => failure.current()} />
    : <span ref={placeholder} className="transfer-preview-image-placeholder" role="img" aria-label={`${alt}: ${description}`} aria-busy={!!imagePath && !paused && !failed}>
        <ImageIcon size={15} aria-hidden="true" />
      </span>;
}
