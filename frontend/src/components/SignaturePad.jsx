import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const SignaturePad = forwardRef(function SignaturePad(_props, ref) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const emptyRef = useRef(true);

  function resizeCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    let oldData = "";
    try {
      oldData = canvas.toDataURL();
    } catch {
      oldData = "";
    }

    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1f2d22";

    if (!emptyRef.current && oldData) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = oldData;
    }
  }

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, []);

  function pointFromEvent(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawingRef.current = true;
    const { x, y } = pointFromEvent(e);
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const { x, y } = pointFromEvent(e);
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.stroke();
    emptyRef.current = false;
  }

  function end(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    drawingRef.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    emptyRef.current = true;
  }

  useImperativeHandle(ref, () => ({
    clear,
    isEmpty: () => emptyRef.current,
    toDataURL: () => canvasRef.current.toDataURL("image/png"),
  }));

  return (
    <canvas
      ref={canvasRef}
      className="signature-canvas"
      onMouseDown={start}
      onMouseMove={move}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
      aria-label="Signature pad"
    />
  );
});

export default SignaturePad;
