import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, ImagePlus, Images, X } from 'lucide-react';

let uid = 0;

// Multiple images, in order (page 1, page 2, …). Supports drag & drop and paste.
export default function ImageDropzone({ images, onChange, max = 10 }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const cameraRef = useRef(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const add = (fileList) => {
    const files = [...(fileList || [])];
    const valid = files.filter((f) => f.type.startsWith('image/') && !/heic|heif/i.test(f.type + f.name));
    const rejected = files.length - valid.length;
    const room = max - imagesRef.current.length;
    const accepted = valid.slice(0, Math.max(0, room));
    const messages = [];
    if (rejected) messages.push(`${rejected} file(s) skipped – use JPG, PNG or WebP images.`);
    if (valid.length > accepted.length) messages.push(`Only ${max} images per paper.`);
    setError(messages.join(' '));
    if (!accepted.length) return;
    onChange([
      ...imagesRef.current,
      ...accepted.map((file) => ({ id: ++uid, file, url: URL.createObjectURL(file) })),
    ]);
  };

  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) add(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = (id) => {
    const img = images.find((i) => i.id === id);
    if (img) URL.revokeObjectURL(img.url);
    onChange(images.filter((i) => i.id !== id));
  };

  const move = (index, delta) => {
    const next = [...images];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };

  return (
    <div className="stack">
      <div
        className={`dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
        <ImagePlus size={30} />
        <div className="dropzone-title">
          <span className="desktop-hint">Drop photos or screenshots of the questions</span>
          <span className="touch-only">Add photos of the questions</span>
        </div>
        <div className="muted small">
          <span className="desktop-hint">Click to browse, or paste with Ctrl+V · up to {max} images, in page order</span>
          <span className="touch-only">Up to {max} images, in page order</span>
        </div>
        <div className="dropzone-buttons touch-only">
          <button
            type="button"
            className="btn btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              cameraRef.current?.click();
            }}
          >
            <Camera size={18} /> Take photo
          </button>
          <button
            type="button"
            className="btn"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            <Images size={18} /> Choose from gallery
          </button>
        </div>
      </div>
      {error && <div className="alert alert-warn">{error}</div>}
      {images.length > 0 && (
        <div className="image-grid">
          {images.map((img, i) => (
            <figure key={img.id} className="image-tile">
              <img src={img.url} alt={`Page ${i + 1}`} />
              <figcaption>
                <span className="page-no">Page {i + 1}</span>
                <span className="tile-actions">
                  <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move earlier">
                    <ArrowLeft size={15} />
                  </button>
                  <button type="button" className="icon-btn" disabled={i === images.length - 1} onClick={() => move(i, 1)} aria-label="Move later">
                    <ArrowRight size={15} />
                  </button>
                  <button type="button" className="icon-btn danger" onClick={() => remove(img.id)} aria-label="Remove image">
                    <X size={15} />
                  </button>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
